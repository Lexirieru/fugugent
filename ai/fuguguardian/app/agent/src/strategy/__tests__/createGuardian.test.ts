import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { GuardianConfigError, createGuardian, type GuardianConfig } from "../createGuardian.js";
import { SessionPermissionError, type SessionCall } from "../chain/session.js";
import { UnitConversionError } from "../units.js";
import {
  createFileStateStore,
  createMemoryStateStore,
  initialExecuteState,
} from "../state/store.js";
import type { Logger } from "../guard.js";
import type { ExecuteState } from "../execute.js";

const AKUN = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const MUSD = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const FEED = "0x0aA42416bAccdb2fd4768B61111DeB7F7D212F9B" as const;
const TX = `0x${"ab".repeat(32)}` as const;

/** The sample position: $7,500 collateral, $6,000 debt, LT 75% -> HF 0.9375 (EMERGENCY). */
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
 * A fake viem client — this test does NOT touch the network at all. That is precisely the
 * point: the entire assembly that used to live only inside the E2E script can now be tested
 * with no gas, no RPC, and no real session key.
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

/** A `sendCalls` mock with correct parameter types, so `mock.calls` is typed too. */
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
    // The store is REQUIRED — there is no silent in-memory default any more. In tests it is
    // named explicitly; in a real process what gets named is `createFileStateStore`.
    stateStore: createMemoryStateStore(),
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
    // Exactly the mistake the old round-trip check claimed to catch, and which in fact
    // slipped straight past it.
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

    // The batch holds approve AND repay in one userOp — Porto's guarded executor zeroes the
    // allowance at the end of that same userOp, so the two must travel together.
    const batch = sendCalls.mock.calls[0]![0];
    expect(batch.map((c) => c.functionName)).toEqual(["approve", "repay"]);
    expect(batch[1].address).toBe(POOL);

    // The unit conversion: a $1.00 price and an 18-decimal token -> the USD8 amount * 1e10.
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
      spentTodayUsd8: 199_000_000_000n, // only $10 left of the $2,000 cap
    };
    const sendCalls = fakeSendCalls();
    const g = await createGuardian(
      config({ stateStore: createMemoryStateStore(tersimpan), sendCalls }),
    );

    const { result } = await g.runOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // What binds is the budget left over from BEFORE the restart, not the full cap. Without
    // persistence this number would be $1,000 (the per-action cap).
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

    // "Restart": a new Guardian over the same store does not start the budget over.
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
      // The chain does not show the debt falling (a lost receipt, a stale node), so
      // reconciliation has no proof and the pending record survives.
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

describe("createGuardian — store berkas sungguhan melewati 'kematian proses'", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugu-guardian-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("catatan menggantung sudah ada di BERKAS pada detik batch dikirim, bukan setelah siklus", async () => {
    // `waitForTransactionReceipt` waits up to 180 seconds. A process that dies inside that
    // window never finishes its cycle, so anything saved "after the cycle" is never saved at
    // all. That is exactly what is tested here: the cycle DELIBERATELY never completes.
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    let masukKirim!: () => void;
    const sudahMasukKirim = new Promise<void>((r) => {
      masukKirim = r;
    });
    const sendCalls = fakeSendCalls(() => {
      masukKirim();
      return new Promise(() => {}); // never settles = a hung process
    });

    const g = await createGuardian(config({ stateStore: store, sendCalls }));
    void g.runOnce(); // deliberately NOT awaited: this cycle will never finish
    await sudahMasukKirim;

    const isi = await store.load();
    expect(isi).not.toBeNull();
    expect(isi?.pendingRepay).not.toBeNull();
    expect(isi?.spentTodayUsd8).toBeGreaterThan(0n);
  });

  it("restart setelah kegagalan tunggu-receipt TIDAK membayar lagi", async () => {
    const file = path.join(dir, "state.json");

    // The first process: the batch fails with a receipt timeout.
    const sendCalls1 = fakeSendCalls(async () => {
      throw new Error("waitForTransactionReceipt timeout setelah 180s");
    });
    const g1 = await createGuardian(
      config({ stateStore: createFileStateStore(file), sendCalls: sendCalls1 }),
    );
    const { result } = await g1.runOnce();
    expect(result.ok).toBe(false);
    expect(sendCalls1).toHaveBeenCalledTimes(1);

    // A SECOND process over the same file — a restart. The chain does not yet show the debt
    // falling, so the pending record still stands.
    const sendCalls2 = fakeSendCalls();
    const g2 = await createGuardian(
      config({ stateStore: createFileStateStore(file), sendCalls: sendCalls2 }),
    );
    const kedua = await g2.runOnce();

    expect(sendCalls2).not.toHaveBeenCalled();
    expect(kedua.result.ok).toBe(true);
    expect(kedua.result.ok === true ? kedua.result.executeReason : "").toMatch(
      /belum terbukti selesai/i,
    );
  });

  it("restart membebaskan diri sendiri begitu rantai menunjukkan hutang turun sebesar yang dibayar", async () => {
    const file = path.join(dir, "state.json");
    const sendCalls1 = fakeSendCalls(async () => {
      throw new Error("waitForTransactionReceipt timeout setelah 180s");
    });
    const g1 = await createGuardian(
      config({ stateStore: createFileStateStore(file), sendCalls: sendCalls1 }),
    );
    await g1.runOnce();

    const menggantung = (await createFileStateStore(file).load())?.pendingRepay;
    expect(menggantung).toBeTruthy();

    // The chain now reports the debt falling by EXACTLY the amount paid, at a newer block.
    const { client } = fakeClient({
      debtBase: HUTANG - menggantung!.amountUsd8,
      blockNumber: 2_000n,
    });
    const sendCalls2 = fakeSendCalls();
    const g2 = await createGuardian(
      config({ client, stateStore: createFileStateStore(file), sendCalls: sendCalls2 }),
    );
    const kedua = await g2.runOnce();

    expect(kedua.nextExecuteState.pendingRepay).toBeNull();
    // The remaining debt is still in the danger zone, so Guardian is free to act again.
    expect(sendCalls2).toHaveBeenCalledTimes(1);
  });
});
