import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { GuardianConfigError, createGuardian, type GuardianConfig } from "../createGuardian.js";
import { SessionPermissionError, type SessionCall } from "../chain/session.js";
import { UnitConversionError } from "../units.js";
import { createMemoryStateStore, initialExecuteState } from "../state/store.js";
import type { Logger } from "../guard.js";
import type { ExecuteState } from "../execute.js";

const AKUN = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const MUSD = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const FEED = "0x0aA42416bAccdb2fd4768B61111DeB7F7D212F9B" as const;
const TX = `0x${"ab".repeat(32)}` as const;

/** Posisi contoh: agunan $7.500, hutang $6.000, LT 75% -> HF 0,9375 (EMERGENCY). */
const AGUNAN = 750_000_000_000n;
const HUTANG = 600_000_000_000n;
const LT_BPS = 7_500n;
const HF = (AGUNAN * LT_BPS * 10n ** 18n) / (10_000n * HUTANG);

interface RantaiPalsu {
  tokenDecimalsPool?: number;
  tokenDecimalsToken?: number;
  feedDecimals?: number;
  hargaUsd8?: bigint;
  enabled?: boolean;
  saldo?: bigint;
  allowance?: bigint;
  debtBase?: bigint;
  blockNumber?: bigint;
}

/**
 * Client viem palsu — test ini TIDAK menyentuh jaringan sama sekali. Itu justru
 * intinya: seluruh perakitan yang dulu hanya hidup di dalam skrip E2E sekarang
 * bisa diuji tanpa gas, tanpa RPC, dan tanpa session key sungguhan.
 */
function fakeClient(o: RantaiPalsu = {}) {
  const calls: { functionName: string; address: string }[] = [];
  const readContract = vi.fn(async (args: { address: string; functionName: string }) => {
    calls.push({ functionName: args.functionName, address: args.address });
    switch (args.functionName) {
      case "assets":
        return [FEED, 6_000, Number(LT_BPS), o.tokenDecimalsPool ?? 18, o.enabled ?? true];
      case "decimals":
        return args.address.toLowerCase() === FEED.toLowerCase()
          ? (o.feedDecimals ?? 8)
          : (o.tokenDecimalsToken ?? 18);
      case "latestRoundData":
        return [1n, o.hargaUsd8 ?? 100_000_000n, 0n, 0n, 1n];
      case "balanceOf":
        return o.saldo ?? 10n ** 30n;
      case "allowance":
        return o.allowance ?? 0n;
      case "getUserAccountData":
        return [AGUNAN, o.debtBase ?? HUTANG, 0n, LT_BPS, 6_000n, HF];
      default:
        throw new Error(`fungsi tak terduga: ${args.functionName}`);
    }
  });
  const getBlockNumber = vi.fn(async () => o.blockNumber ?? 1_000n);
  const client = { chain: { id: 97 }, readContract, getBlockNumber } as unknown as PublicClient;
  return { client, readContract, getBlockNumber, calls };
}

/** Mock `sendCalls` dengan tipe parameter yang benar, supaya `mock.calls` ikut bertipe. */
function fakeSendCalls(
  impl: (calls: readonly SessionCall[], description: string) => Promise<{ transactionHash: `0x${string}`; status: number }> = async () => ({
    transactionHash: TX,
    status: 1,
  }),
) {
  return vi.fn(impl);
}

function silentLogger(): Logger {
  return { info: vi.fn(), error: vi.fn() };
}

function config(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
  const { client } = fakeClient();
  return {
    account: AKUN,
    client,
    pool: POOL,
    repayAsset: MUSD,
    permissions: {
      calls: [
        { to: POOL, signature: "repay(address,uint256)" },
        { to: MUSD, signature: "approve(address,uint256)" },
      ],
      spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
    },
    sendCalls: fakeSendCalls(),
    limits: {
      maxPerActionUsd8: 100_000_000_000n,
      maxPerDayUsd8: 200_000_000_000n,
      minIntervalSeconds: 0,
    },
    logger: silentLogger(),
    now: () => 1_700_000_000,
    ...overrides,
  };
}

describe("createGuardian — pemeriksaan saat konstruksi", () => {
  it("menolak aset yang tidak aktif di pool sebelum satu siklus pun berjalan", async () => {
    const { client } = fakeClient({ enabled: false });
    await expect(createGuardian(config({ client }))).rejects.toThrow(GuardianConfigError);
  });

  it("menolak desimal yang tidak disepakati pool dan kontrak token", async () => {
    // Persis kesalahan yang diklaim ditangkap oleh cek bolak-balik lama, dan
    // yang sebenarnya lolos dari cek itu.
    const { client } = fakeClient({ tokenDecimalsPool: 17, tokenDecimalsToken: 18 });
    await expect(createGuardian(config({ client }))).rejects.toThrow(UnitConversionError);
  });

  it("menolak feed harga yang bukan 8 desimal", async () => {
    const { client } = fakeClient({ feedDecimals: 18 });
    await expect(createGuardian(config({ client }))).rejects.toThrow(UnitConversionError);
  });

  it("menolak harga nol atau negatif", async () => {
    const { client } = fakeClient({ hargaUsd8: 0n });
    await expect(createGuardian(config({ client }))).rejects.toThrow(GuardianConfigError);
  });

  it("menolak izin sesi tanpa allowlist (calls kosong = izin tanpa batas di Altana)", async () => {
    await expect(
      createGuardian(config({ permissions: { calls: [], spend: [{ limit: 1n, period: "day" }] } })),
    ).rejects.toThrow(SessionPermissionError);
  });

  it("melaporkan konfigurasi aset yang DIBACA dari rantai, bukan yang diasumsikan", async () => {
    const g = await createGuardian(config());
    expect(g.repayAsset).toEqual({ asset: MUSD, feed: FEED, tokenDecimals: 18 });
  });
});

describe("createGuardian — satu siklus utuh tanpa jaringan", () => {
  it("baca posisi -> decide -> execute -> kirim batch approve+repay lewat sesi", async () => {
    const sendCalls = fakeSendCalls();
    const g = await createGuardian(config({ sendCalls }));

    const { result, nextExecuteState } = await g.runOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe("EMERGENCY");
    expect(result.sent).toBe(true);
    expect(result.txHash).toBe(TX);

    // Batch berisi approve DAN repay dalam satu userOp — guarded executor Porto
    // menolkan allowance di akhir userOp yang sama, jadi keduanya wajib menyatu.
    const batch = sendCalls.mock.calls[0]![0];
    expect(batch.map((c) => c.functionName)).toEqual(["approve", "repay"]);
    expect(batch[1].address).toBe(POOL);

    // Konversi satuan: harga $1,00 dan token 18 desimal -> jumlah USD8 * 1e10.
    const repayArgs = batch[1].args as readonly [string, bigint];
    expect(repayArgs[0]).toBe(MUSD);
    expect(repayArgs[1]).toBe(result.amountSentUsd8 * 10n ** 10n);

    expect(nextExecuteState.spentTodayUsd8).toBe(result.amountSentUsd8);
    expect(nextExecuteState.pendingRepay).toBeNull();
  });

  it("saldo token kurang -> tidak ada batch yang dikirim sama sekali", async () => {
    const sendCalls = fakeSendCalls();
    const { client } = fakeClient({ saldo: 1n });
    const g = await createGuardian(config({ client, sendCalls }));

    const { result } = await g.runOnce();

    expect(result.ok).toBe(false);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("allowance sudah cukup -> batch hanya berisi repay", async () => {
    const sendCalls = fakeSendCalls();
    const { client } = fakeClient({ allowance: 10n ** 30n });
    const g = await createGuardian(config({ client, sendCalls }));

    await g.runOnce();

    const batch = sendCalls.mock.calls[0]![0];
    expect(batch.map((c) => c.functionName)).toEqual(["repay"]);
  });

  it("posisi dibaca ditambatkan ke satu blok, dan bloknya ikut ke Position", async () => {
    const { client } = fakeClient({ blockNumber: 129_912_345n });
    const g = await createGuardian(config({ client }));
    const pos = await g.readPosition();
    expect(pos.blockNumber).toBe(129_912_345n);
    expect(pos.account).toBe(AKUN);
  });
});

describe("createGuardian — state persisten (C3)", () => {
  it("memuat state tersimpan alih-alih memulai dari anggaran kosong", async () => {
    const tersimpan: ExecuteState = {
      ...initialExecuteState(1_700_000_000),
      spentTodayUsd8: 199_000_000_000n, // sisa hanya $10 dari batas $2.000
    };
    const sendCalls = fakeSendCalls();
    const g = await createGuardian(
      config({ stateStore: createMemoryStateStore(tersimpan), sendCalls }),
    );

    const { result } = await g.runOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Anggaran yang tersisa dari SEBELUM restart-lah yang mengikat, bukan
    // batas penuh. Tanpa persistensi, angka ini akan $1.000 (batas per aksi).
    expect(result.amountSentUsd8).toBe(1_000_000_000n);
    expect(result.cappedPerDay).toBe(true);
  });

  it("state disimpan setelah siklus, sehingga proses berikutnya mewarisi anggaran", async () => {
    const store = createMemoryStateStore();
    const g1 = await createGuardian(config({ stateStore: store }));
    const { result } = await g1.runOnce();
    expect(result.ok && result.sent).toBe(true);

    const tersimpan = await store.load();
    expect(tersimpan?.spentTodayUsd8).toBeGreaterThan(0n);

    // "Restart": Guardian baru atas store yang sama tidak mengulang anggaran.
    const g2 = await createGuardian(config({ stateStore: store }));
    expect(g2.getExecuteState().spentTodayUsd8).toBe(tersimpan?.spentTodayUsd8);
  });

  it("state tersimpan dengan killed:true menolak mengirim setelah restart", async () => {
    const sendCalls = fakeSendCalls();
    const store = createMemoryStateStore({ ...initialExecuteState(1_700_000_000), killed: true });
    const g = await createGuardian(config({ stateStore: store, sendCalls }));

    const { result } = await g.runOnce();

    expect(result.ok).toBe(true);
    expect(result.ok === true ? result.executeReason : "").toMatch(/kill switch/i);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("kill() lewat handle loop menghentikan pengiriman dan tersimpan ke store", async () => {
    vi.useFakeTimers();
    try {
      const sendCalls = fakeSendCalls();
      const store = createMemoryStateStore();
      const g = await createGuardian(
        config({ stateStore: store, sendCalls, limits: { ...config().limits, minIntervalSeconds: 0 } }),
      );

      const handle = g.start(1_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(sendCalls).toHaveBeenCalledTimes(1);

      handle.kill();
      await vi.advanceTimersByTimeAsync(0);
      expect((await store.load())?.killed).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendCalls).toHaveBeenCalledTimes(1);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGuardian — C2 lewat rantai lengkap", () => {
  it("sendCalls melempar setelah tx mendarat: siklus berikutnya TIDAK mengirim ulang", async () => {
    vi.useFakeTimers();
    try {
      // Rantai tidak menunjukkan hutang berkurang (receipt hilang, node basi),
      // jadi rekonsiliasi tidak punya bukti dan catatan menggantung bertahan.
      const sendCalls = fakeSendCalls(async () => {
        throw new Error("waitForTransactionReceipt timeout setelah 180s");
      });
      const store = createMemoryStateStore();
      const g = await createGuardian(config({ sendCalls, stateStore: store }));

      const handle = g.start(1_000);
      await vi.advanceTimersByTimeAsync(0);
      expect(sendCalls).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendCalls).toHaveBeenCalledTimes(1);

      const tersimpan = await store.load();
      expect(tersimpan?.pendingRepay).not.toBeNull();
      expect(tersimpan?.spentTodayUsd8).toBeGreaterThan(0n);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
