import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StateStoreError,
  createFileStateStore,
  createMemoryStateStore,
  initialExecuteState,
  parseExecuteState,
  serializeExecuteState,
} from "../state/store.js";
import type { ExecuteState } from "../execute.js";

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 123_456_789n,
    dayStartedAt: 1_700_000_000,
    lastActionAt: 1_700_000_500,
    killed: false,
    pendingRepay: null,
    ...overrides,
  };
}

describe("serialisasi ExecuteState", () => {
  it("bolak-balik mempertahankan bigint apa adanya, bukan lewat Number()", () => {
    // Nilai di atas Number.MAX_SAFE_INTEGER: kalau serialisasinya lewat
    // JSON.parse biasa (float), digit terakhir hilang diam-diam — persis digit
    // yang menentukan berapa dolar sudah dibelanjakan.
    const besar = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    const asli = state({ spentTodayUsd8: besar });
    const balik = parseExecuteState(serializeExecuteState(asli));
    expect(balik.spentTodayUsd8).toBe(besar);
    expect(balik).toEqual(asli);
  });

  it("bolak-balik mempertahankan pendingRepay lengkap", () => {
    const asli = state({
      pendingRepay: {
        asset: "0x932E82632E80b06318ca969e33F99A54F1a04b10",
        amountUsd8: 685_000_000n,
        startedAt: 1_700_000_400,
        txHash: null,
        debtBaseBeforeSend: 2_938_888_888n,
        blockNumberBeforeSend: 129_841_266n,
      },
    });
    expect(parseExecuteState(serializeExecuteState(asli))).toEqual(asli);
  });

  it.each([
    ["bukan JSON", "{bukan json"],
    ["bukan objek", '"halo"'],
    ["spentTodayUsd8 hilang", '{"version":1,"dayStartedAt":1,"lastActionAt":0,"killed":false}'],
    [
      "spentTodayUsd8 bukan angka desimal",
      '{"version":1,"spentTodayUsd8":"1.5","dayStartedAt":1,"lastActionAt":0,"killed":false}',
    ],
    [
      "killed bukan boolean",
      '{"version":1,"spentTodayUsd8":"0","dayStartedAt":1,"lastActionAt":0,"killed":"tidak"}',
    ],
    [
      "dayStartedAt bukan bilangan bulat",
      '{"version":1,"spentTodayUsd8":"0","dayStartedAt":1.5,"lastActionAt":0,"killed":false}',
    ],
    [
      "versi tidak dikenal",
      '{"version":99,"spentTodayUsd8":"0","dayStartedAt":1,"lastActionAt":0,"killed":false}',
    ],
  ])("menolak isi rusak (%s) alih-alih diam-diam mereset batas", (_label, raw) => {
    // Sebuah file rusak yang dibaca sebagai "state kosong" akan mengembalikan
    // spentTodayUsd8 ke nol dan lastActionAt ke 0 -- yaitu MELEPAS seluruh
    // batas harian dan cooldown tanpa satu pun peringatan. Gagal keras.
    expect(() => parseExecuteState(raw)).toThrow(StateStoreError);
  });
});

describe("createMemoryStateStore", () => {
  it("mengembalikan null saat belum pernah disimpan", async () => {
    const store = createMemoryStateStore();
    expect(await store.load()).toBeNull();
  });

  it("menyimpan salinan, bukan referensi yang bisa dimutasi dari luar", async () => {
    const store = createMemoryStateStore();
    const s = state();
    await store.save(s);
    s.spentTodayUsd8 = 0n;
    const dimuat = await store.load();
    expect(dimuat?.spentTodayUsd8).toBe(123_456_789n);
  });
});

describe("createFileStateStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugu-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("file belum ada -> null, bukan melempar", async () => {
    const store = createFileStateStore(path.join(dir, "belum/ada/state.json"));
    expect(await store.load()).toBeNull();
  });

  it("simpan lalu muat mengembalikan state yang sama persis", async () => {
    const file = path.join(dir, "nested/state.json");
    const store = createFileStateStore(file);
    const s = state({ killed: true, spentTodayUsd8: 685_000_000n });
    await store.save(s);
    expect(await store.load()).toEqual(s);
  });

  it("file rusak melempar StateStoreError, tidak mengembalikan state kosong", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{ini bukan json", "utf8");
    const store = createFileStateStore(file);
    await expect(store.load()).rejects.toThrow(StateStoreError);
  });

  it("penulisan atomik: tidak meninggalkan file sementara", async () => {
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    await store.save(state());
    await store.save(state({ spentTodayUsd8: 1n }));
    const isi = await readFile(file, "utf8");
    expect(JSON.parse(isi).spentTodayUsd8).toBe("1");
  });
});

describe("initialExecuteState", () => {
  it("hari anggaran dimulai sekarang, belum ada aksi, tidak dimatikan, tidak ada repay menggantung", () => {
    const s = initialExecuteState(1_700_000_000);
    expect(s).toEqual({
      spentTodayUsd8: 0n,
      dayStartedAt: 1_700_000_000,
      lastActionAt: 0,
      killed: false,
      pendingRepay: null,
    });
  });
});
