import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPilotCycle, startPilotLoop, type Logger, type PilotCycleDeps } from "../guard.js";
import {
  initialExecuteState,
  NeverSentError,
  SendFailedError,
  type ExecuteResult,
  type ExecuteState,
} from "../execute.js";
import { RATIO_ONE, type PilotPolicy, type PortfolioSnapshot } from "../types.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const POLICY: PilotPolicy = {
  targets: [
    { assetId: "BNB", weightBps: 6_000n },
    { assetId: "USDT", weightBps: 4_000n },
  ],
  driftToleranceBps: 500n,
  idleFloorUsd8: 0n,
  swapVenueId: "pancakeswap-v3",
  lendVenueId: "venus",
  stakeVenueId: "lista-liquid-staking",
  minSafetyRatio: 2n * RATIO_ONE,
  copyFactorBps: 0n,
  maxCopyUsd8: 0n,
};

/** A mix that is off, so every cycle has something real to do. */
const DRIFTED: PortfolioSnapshot = {
  account: ACCOUNT,
  blockNumber: 1_000n,
  holdings: [
    { assetId: "BNB", valueUsd8: 700n * USD },
    { assetId: "USDT", valueUsd8: 300n * USD },
  ],
  idleUsd8: 0n,
  collateralUsd8: 0n,
  debtUsd8: 0n,
  liquidationThresholdBps: 8_000n,
};

function silentLogger(): Logger {
  return { info: () => {}, error: () => {} };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return { ...initialExecuteState(NOW - 3_600), lastActionAt: NOW - 3_600, ...overrides };
}

function sentResult(next: ExecuteState, amount = 100n * USD): ExecuteResult {
  return {
    sent: true,
    reason: "sent",
    amountSentUsd8: amount,
    cappedPerAction: false,
    cappedPerDay: false,
    txHash: HASH,
    action: null,
    state: next,
  };
}

function deps(overrides: Partial<PilotCycleDeps> = {}): PilotCycleDeps {
  return {
    account: ACCOUNT,
    readSnapshot: async () => DRIFTED,
    policy: POLICY,
    executePlan: async (_plan, s) => sentResult({ ...s, spentTodayUsd8: s.spentTodayUsd8 + 100n * USD }),
    now: () => NOW,
    logger: silentLogger(),
    ...overrides,
  };
}

describe("one cycle", () => {
  it("reads, plans and acts, then reports what happened", async () => {
    const outcome = await runPilotCycle(deps(), state());
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.plannedSteps).toBe(2);
    expect(outcome.result.sent).toBe(true);
    expect(outcome.nextExecuteState.spentTodayUsd8).toBe(100n * USD);
  });

  it("hands back a state that really moved, rather than the one it was given", async () => {
    // THE LESSON FROM GUARDIAN. Its first loop threw away the state the sending step
    // returned, so the daily budget and the waiting time never moved and the agent could
    // send the per step limit on every single interval. Changing
    // `nextExecuteState: execResult.state` back to the incoming state makes this fail.
    const before = state();
    const outcome = await runPilotCycle(deps(), before);
    expect(outcome.nextExecuteState).not.toBe(before);
    expect(outcome.nextExecuteState.spentTodayUsd8).toBeGreaterThan(before.spentTodayUsd8);
  });

  it("does not throw when the reading fails, and keeps the state as it was", async () => {
    const before = state();
    const outcome = await runPilotCycle(
      deps({
        readSnapshot: async () => {
          throw new Error("the RPC is unreachable");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("does not throw when the instructions are broken, and keeps the state as it was", async () => {
    const before = state();
    const outcome = await runPilotCycle(
      deps({ policy: { ...POLICY, targets: [{ assetId: "BNB", weightBps: 1n }] } }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.error).toContain("add up to exactly");
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("keeps the old state when the send failed before it reached the network", async () => {
    const before = state();
    const outcome = await runPilotCycle(
      deps({
        executePlan: async () => {
          throw new NeverSentError("the record could not be saved");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("carries the ADVANCED state when the send failed after it may have gone out", async () => {
    // THE SECOND LESSON FROM GUARDIAN. Waiting for a result can time out after the
    // transaction already landed. Returning the old state here means the budget does not
    // move, the waiting time does not move, and the next cycle pays again. Deleting the
    // `asSendFailure` branch in guard.ts makes this fail.
    const before = state();
    const advanced: ExecuteState = {
      ...before,
      spentTodayUsd8: 100n * USD,
      lastActionAt: NOW,
      pendingSend: {
        kind: "REBALANCE",
        venueId: "pancakeswap-v3",
        assetId: "BNB",
        amountUsd8: 100n * USD,
        startedAt: NOW,
        txHash: null,
        blockNumberBeforeSend: 0n,
      },
    };
    const outcome = await runPilotCycle(
      deps({
        executePlan: async () => {
          throw new SendFailedError("waiting for the result timed out", advanced);
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(advanced);
    expect(outcome.nextExecuteState.pendingSend).not.toBeNull();
  });

  it("finds the carried state even when the failure was wrapped by something upstream", async () => {
    const advanced: ExecuteState = { ...state(), spentTodayUsd8: 100n * USD, lastActionAt: NOW };
    const outcome = await runPilotCycle(
      deps({
        executePlan: async () => {
          throw new Error("while tracing the cycle", {
            cause: new SendFailedError("the connection dropped", advanced),
          });
        },
      }),
      state(),
    );
    expect(outcome.nextExecuteState.spentTodayUsd8).toBe(100n * USD);
  });

  it("survives a clock that fails, instead of stopping", async () => {
    const outcome = await runPilotCycle(
      deps({
        now: () => {
          throw new Error("no clock");
        },
      }),
      state(),
    );
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.timestamp).toBe(0);
  });

  it("survives a logger that throws on every call", async () => {
    // Guardian died silently once because a logger threw inside a catch block and the line
    // that schedules the next cycle was never reached.
    const angry: Logger = {
      info: () => {
        throw new Error("the pipe is closed");
      },
      error: () => {
        throw new Error("the pipe is closed");
      },
    };
    const outcome = await runPilotCycle(
      deps({
        logger: angry,
        readSnapshot: async () => {
          throw new Error("the RPC is unreachable");
        },
      }),
      state(),
    );
    expect(outcome.result.ok).toBe(false);
  });
});

describe("the loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses an interval that is not a positive number", () => {
    expect(() => startPilotLoop(deps(), 0, state())).toThrow(/positive, finite/);
    expect(() => startPilotLoop(deps(), Number.NaN, state())).toThrow(/positive, finite/);
  });

  it("keeps the state between cycles, so the budget really does run down", async () => {
    // The whole point. Without this the agent spends its daily limit on every interval.
    const handle = startPilotLoop(deps(), 1_000, state());
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.getExecuteState().spentTodayUsd8).toBe(100n * USD);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.getExecuteState().spentTodayUsd8).toBe(200n * USD);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.getExecuteState().spentTodayUsd8).toBe(300n * USD);
    handle.stop();
  });

  it("saves the state after every cycle", async () => {
    const saved: ExecuteState[] = [];
    const handle = startPilotLoop(deps(), 1_000, state(), {
      saveExecuteState: (s) => {
        saved.push(s);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved).toHaveLength(2);
    expect(saved[1]!.spentTodayUsd8).toBe(200n * USD);
    handle.stop();
  });

  it("keeps running when saving fails, rather than stopping quietly", async () => {
    // A full disk must not make the agent stop, and it must not be hidden either.
    const errors: string[] = [];
    const handle = startPilotLoop(
      deps({ logger: { info: () => {}, error: (m) => errors.push(m) } }),
      1_000,
      state(),
      {
        saveExecuteState: () => {
          throw new Error("the disk is full");
        },
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.getExecuteState().spentTodayUsd8).toBe(200n * USD);
    expect(errors.some((m) => m.includes("could not be saved"))).toBe(true);
    handle.stop();
  });

  it("schedules the next cycle even after something unexpected escapes", async () => {
    // The scheduling line lives in a finally block for exactly this reason.
    let calls = 0;
    const handle = startPilotLoop(
      deps({
        readSnapshot: async () => {
          calls += 1;
          throw new Error("boom");
        },
      }),
      1_000,
      state(),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(3);
    handle.stop();
  });

  it("stops scheduling once it is stopped", async () => {
    let calls = 0;
    const handle = startPilotLoop(
      deps({
        readSnapshot: async () => {
          calls += 1;
          return DRIFTED;
        },
      }),
      1_000,
      state(),
    );
    await vi.advanceTimersByTimeAsync(0);
    handle.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  });

  it("turns the stop switch into a lever that can be pulled while it runs", async () => {
    const handle = startPilotLoop(deps(), 1_000, state());
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.isKilled()).toBe(false);
    handle.kill();
    expect(handle.isKilled()).toBe(true);
    expect(handle.getExecuteState().killed).toBe(true);
    handle.stop();
  });

  it("does not let a cycle already running undo the stop switch", async () => {
    // A one way latch. The cycle that started before the switch was pulled finishes with a
    // state that still says the switch is off, and that must not win.
    let release: (() => void) | null = null;
    const handle = startPilotLoop(
      deps({
        executePlan: async (_p, s) =>
          new Promise((resolve) => {
            release = () => resolve(sentResult({ ...s, killed: false }));
          }),
      }),
      1_000,
      state(),
    );
    await vi.advanceTimersByTimeAsync(0);
    handle.kill();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.getExecuteState().killed).toBe(true);
    handle.stop();
  });

  it("saves the state the moment the stop switch is pulled, not only after the next cycle", async () => {
    const saved: ExecuteState[] = [];
    const handle = startPilotLoop(deps(), 100_000, state(), {
      saveExecuteState: (s) => {
        saved.push(s);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const before = saved.length;
    handle.kill();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved.length).toBeGreaterThan(before);
    expect(saved.at(-1)!.killed).toBe(true);
    handle.stop();
  });

  it("keeps a callback's failure from stopping the loop", async () => {
    let calls = 0;
    const handle = startPilotLoop(
      deps({
        readSnapshot: async () => {
          calls += 1;
          return DRIFTED;
        },
        onCycle: () => {
          throw new Error("somebody else's problem");
        },
      }),
      1_000,
      state(),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    handle.stop();
  });

  it("remembers the last record so an operator can read it", async () => {
    const handle = startPilotLoop(deps(), 1_000, state());
    expect(handle.getLastResult()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.getLastResult()?.ok).toBe(true);
    handle.stop();
  });
});
