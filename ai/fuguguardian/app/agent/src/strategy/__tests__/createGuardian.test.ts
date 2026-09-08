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

const ACCOUNT = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const MUSD = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const FEED = "0x0aA42416bAccdb2fd4768B61111DeB7F7D212F9B" as const;
const TX = `0x${"ab".repeat(32)}` as const;

/** The sample position: $7,500 collateral, $6,000 debt, LT 75% -> HF 0.9375 (EMERGENCY). */
const COLLATERAL = 750_000_000_000n;
const DEBT = 600_000_000_000n;
const LT_BPS = 7_500n;
const HF = (COLLATERAL * LT_BPS * 10n ** 18n) / (10_000n * DEBT);

interface RantaiPalsu {
  tokenDecimalsPool?: number;
  tokenDecimalsToken?: number;
  feedDecimals?: number;
  hargaUsd8?: bigint;
  enabled?: boolean;
  balance?: bigint;
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
        return o.balance ?? 10n ** 30n;
      case "allowance":
        return o.allowance ?? 0n;
      case "getUserAccountData":
        return [COLLATERAL, o.debtBase ?? DEBT, 0n, LT_BPS, 6_000n, HF];
      default:
        throw new Error(`unexpected function: ${args.functionName}`);
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
    account: ACCOUNT,
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

describe("createGuardian — checks at construction", () => {
  it("refuses an asset that is not enabled in the pool before a single cycle runs", async () => {
    const { client } = fakeClient({ enabled: false });
    await expect(createGuardian(config({ client }))).rejects.toThrow(GuardianConfigError);
  });

  it("refuses decimals the pool and the token contract do not agree on", async () => {
    // Exactly the mistake the old round-trip check claimed to catch, and which in fact
    // slipped straight past it.
    const { client } = fakeClient({ tokenDecimalsPool: 17, tokenDecimalsToken: 18 });
    await expect(createGuardian(config({ client }))).rejects.toThrow(UnitConversionError);
  });

  it("refuses a price feed that is not 8 decimals", async () => {
    const { client } = fakeClient({ feedDecimals: 18 });
    await expect(createGuardian(config({ client }))).rejects.toThrow(UnitConversionError);
  });

  it("refuses a zero or negative price", async () => {
    const { client } = fakeClient({ hargaUsd8: 0n });
    await expect(createGuardian(config({ client }))).rejects.toThrow(GuardianConfigError);
  });

  it("refuses session permissions with no allowlist (an empty calls = unlimited permission in Altana)", async () => {
    await expect(
      createGuardian(config({ permissions: { calls: [], spend: [{ limit: 1n, period: "day" }] } })),
    ).rejects.toThrow(SessionPermissionError);
  });

  it("reports the asset configuration READ from the chain, not one that was assumed", async () => {
    const g = await createGuardian(config());
    expect(g.repayAsset).toEqual({ asset: MUSD, feed: FEED, tokenDecimals: 18 });
  });
});

describe("createGuardian — one whole cycle with no network", () => {
  it("read the position -> decide -> execute -> send an approve+repay batch through the session", async () => {
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

  it("an insufficient token balance -> no batch is sent at all", async () => {
    const sendCalls = fakeSendCalls();
    const { client } = fakeClient({ balance: 1n });
    const g = await createGuardian(config({ client, sendCalls }));

    const { result } = await g.runOnce();

    expect(result.ok).toBe(false);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("an allowance that is already enough -> the batch carries only the repay", async () => {
    const sendCalls = fakeSendCalls();
    const { client } = fakeClient({ allowance: 10n ** 30n });
    const g = await createGuardian(config({ client, sendCalls }));

    await g.runOnce();

    const batch = sendCalls.mock.calls[0]![0];
    expect(batch.map((c) => c.functionName)).toEqual(["repay"]);
  });

  it("the position is read anchored to a single block, and that block travels into Position", async () => {
    const { client } = fakeClient({ blockNumber: 129_912_345n });
    const g = await createGuardian(config({ client }));
    const pos = await g.readPosition();
    expect(pos.blockNumber).toBe(129_912_345n);
    expect(pos.account).toBe(ACCOUNT);
  });
});

describe("createGuardian — persistent state (C3)", () => {
  it("loads the stored state instead of starting from an empty budget", async () => {
    const stored: ExecuteState = {
      ...initialExecuteState(1_700_000_000),
      spentTodayUsd8: 199_000_000_000n, // only $10 left of the $2,000 cap
    };
    const sendCalls = fakeSendCalls();
    const g = await createGuardian(
      config({ stateStore: createMemoryStateStore(stored), sendCalls }),
    );

    const { result } = await g.runOnce();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // What binds is the budget left over from BEFORE the restart, not the full cap. Without
    // persistence this number would be $1,000 (the per-action cap).
    expect(result.amountSentUsd8).toBe(1_000_000_000n);
    expect(result.cappedPerDay).toBe(true);
  });

  it("the state is saved after the cycle, so the next process inherits the budget", async () => {
    const store = createMemoryStateStore();
    const g1 = await createGuardian(config({ stateStore: store }));
    const { result } = await g1.runOnce();
    expect(result.ok && result.sent).toBe(true);

    const stored = await store.load();
    expect(stored?.spentTodayUsd8).toBeGreaterThan(0n);

    // "Restart": a new Guardian over the same store does not start the budget over.
    const g2 = await createGuardian(config({ stateStore: store }));
    expect(g2.getExecuteState().spentTodayUsd8).toBe(stored?.spentTodayUsd8);
  });

  it("a stored state with killed:true refuses to send after a restart", async () => {
    const sendCalls = fakeSendCalls();
    const store = createMemoryStateStore({ ...initialExecuteState(1_700_000_000), killed: true });
    const g = await createGuardian(config({ stateStore: store, sendCalls }));

    const { result } = await g.runOnce();

    expect(result.ok).toBe(true);
    expect(result.ok === true ? result.executeReason : "").toMatch(/kill switch/i);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("kill() via the loop handle stops sending and is persisted to the store", async () => {
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

describe("createGuardian — C2 through the whole chain", () => {
  it("sendCalls throws after the tx landed: the next cycle does NOT resend", async () => {
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

      const stored = await store.load();
      expect(stored?.pendingRepay).not.toBeNull();
      expect(stored?.spentTodayUsd8).toBeGreaterThan(0n);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGuardian — a real file store surviving a 'process death'", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugu-guardian-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("the pending record is already IN THE FILE the moment the batch is sent, not after the cycle", async () => {
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

    const contents = await store.load();
    expect(contents).not.toBeNull();
    expect(contents?.pendingRepay).not.toBeNull();
    expect(contents?.spentTodayUsd8).toBeGreaterThan(0n);
  });

  it("a restart after a receipt-wait failure does NOT pay again", async () => {
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
    const second = await g2.runOnce();

    expect(sendCalls2).not.toHaveBeenCalled();
    expect(second.result.ok).toBe(true);
    expect(second.result.ok === true ? second.result.executeReason : "").toMatch(
      /has not yet been proven complete/i,
    );
  });

  it("a restart frees itself once the chain shows the debt fell by what was paid", async () => {
    const file = path.join(dir, "state.json");
    const sendCalls1 = fakeSendCalls(async () => {
      throw new Error("waitForTransactionReceipt timeout setelah 180s");
    });
    const g1 = await createGuardian(
      config({ stateStore: createFileStateStore(file), sendCalls: sendCalls1 }),
    );
    await g1.runOnce();

    const pending = (await createFileStateStore(file).load())?.pendingRepay;
    expect(pending).toBeTruthy();

    // The chain now reports the debt falling by EXACTLY the amount paid, at a newer block.
    const { client } = fakeClient({
      debtBase: DEBT - pending!.amountUsd8,
      blockNumber: 2_000n,
    });
    const sendCalls2 = fakeSendCalls();
    const g2 = await createGuardian(
      config({ client, stateStore: createFileStateStore(file), sendCalls: sendCalls2 }),
    );
    const second = await g2.runOnce();

    expect(second.nextExecuteState.pendingRepay).toBeNull();
    // The remaining debt is still in the danger zone, so Guardian is free to act again.
    expect(sendCalls2).toHaveBeenCalledTimes(1);
  });
});
