import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMeterCycle, startMeterLoop, type Logger, type MeterCycleDeps } from "../guard.js";
import {
  initialExecuteState,
  NeverSentError,
  payInvoice,
  PaymentFailedError,
  type ExecuteResult,
  type ExecuteState,
  type PaymentLimits,
} from "../execute.js";
import type { Invoice, Tariff, UsageRecord } from "../types.js";
import type { SessionPermissions } from "../session.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

/** One cent per call, flat. */
const TARIFFS: readonly Tariff[] = [
  { unit: "CALL", steps: [{ upToQuantity: null, priceUsd8: 1_000_000n, perQuantity: 1n }] },
];

const SESSION: SessionPermissions = {
  calls: [{ to: "0x1111111111111111111111111111111111111111", signature: "transfer(address,uint256)" }],
  spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
  expiresAt: NOW + 30 * 86_400,
};

const LIMITS: PaymentLimits = {
  maxPerPaymentUsd8: 10n * USD,
  maxPerDayUsd8: 50n * USD,
  minIntervalSeconds: 0,
};

function silentLogger(): Logger {
  return { info: () => {}, error: () => {} };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    ...initialExecuteState(NOW - 3_600),
    lastPaymentAt: 0,
    billedThroughSeconds: NOW - 3_600,
    ...overrides,
  };
}

/** Ten calls inside every stretch of time asked for, so a cycle always has something to bill. */
function usage(fromSeconds: number): readonly UsageRecord[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: `${fromSeconds}-${i}`,
    unit: "CALL" as const,
    quantity: 1n,
    at: fromSeconds,
  }));
}

function paidResult(next: ExecuteState, amount: bigint): ExecuteResult {
  return { paid: true, reason: "paid", amountPaidUsd8: amount, txHash: HASH, state: next };
}

function deps(overrides: Partial<MeterCycleDeps> = {}): MeterCycleDeps {
  return {
    meterId: "inference-per-call",
    collectUsage: async (from) => usage(from),
    tariffs: TARIFFS,
    payInvoice: async (inv, s) =>
      paidResult(
        {
          ...s,
          spentTodayUsd8: s.spentTodayUsd8 + inv.totalUsd8,
          lastPaymentAt: NOW,
          billedThroughSeconds: inv.window.toSeconds,
        },
        inv.totalUsd8,
      ),
    now: () => NOW,
    logger: silentLogger(),
    ...overrides,
  };
}

describe("one cycle", () => {
  it("collects, counts, prices and pays", async () => {
    const outcome = await runMeterCycle(deps(), state());
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.counted).toBe(10);
    expect(outcome.result.totalUsd8).toBe(10n * 1_000_000n);
    expect(outcome.result.paid).toBe(true);
    expect(outcome.nextExecuteState.billedThroughSeconds).toBe(NOW);
  });

  it("bills from where the last bill stopped, not from an arbitrary point", async () => {
    let asked: [number, number] | null = null;
    await runMeterCycle(
      deps({
        collectUsage: async (from, to) => {
          asked = [from, to];
          return usage(from);
        },
      }),
      state({ billedThroughSeconds: NOW - 120 }),
    );
    expect(asked).toEqual([NOW - 120, NOW]);
  });

  it("hands back a state that really moved, rather than the one it was given", async () => {
    // THE LESSON FROM GUARDIAN. Its first loop threw away the state its sending step
    // returned, so the daily budget never moved.
    const before = state();
    const outcome = await runMeterCycle(deps(), before);
    expect(outcome.nextExecuteState).not.toBe(before);
    expect(outcome.nextExecuteState.spentTodayUsd8).toBeGreaterThan(before.spentTodayUsd8);
  });

  it("bills nothing when no time has passed", async () => {
    const outcome = await runMeterCycle(deps(), state({ billedThroughSeconds: NOW }));
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.paid).toBe(false);
    expect(outcome.result.reason).toContain("No time has passed");
  });

  it("bills nothing when the clock has gone backwards", async () => {
    const outcome = await runMeterCycle(deps(), state({ billedThroughSeconds: NOW + 100 }));
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.paid).toBe(false);
  });

  it("stops rather than guessing when the clock fails", async () => {
    // Unlike the other agents, this one cannot carry on with a made up time: the stretch of
    // time to bill is defined by the clock, and billing a made up stretch would move money.
    const before = state();
    const outcome = await runMeterCycle(
      deps({
        now: () => {
          throw new Error("no clock");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("does not throw when collecting fails, and keeps the state as it was", async () => {
    const before = state();
    const outcome = await runMeterCycle(
      deps({
        collectUsage: async () => {
          throw new Error("the usage service is down");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("does not throw when the price ladder is broken, and keeps the state as it was", async () => {
    const before = state();
    const outcome = await runMeterCycle(deps({ tariffs: [] }), before);
    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.error).toContain("does not guess a price");
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("does not throw when two pieces of use wear the same id", async () => {
    const outcome = await runMeterCycle(
      deps({
        collectUsage: async (from) => [
          { id: "x", unit: "CALL", quantity: 1n, at: from },
          { id: "x", unit: "CALL", quantity: 99n, at: from },
        ],
      }),
      state(),
    );
    expect(outcome.result.ok).toBe(false);
  });

  it("keeps the old state when the payment failed before it reached the network", async () => {
    const before = state();
    const outcome = await runMeterCycle(
      deps({
        payInvoice: async () => {
          throw new NeverSentError("the record could not be saved");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("carries the ADVANCED state when the payment failed after it may have gone out", async () => {
    // THE SECOND LESSON FROM GUARDIAN. Keeping the old state here means the billing mark
    // rewinds and the next cycle bills and pays for the same seconds again.
    const before = state();
    const advanced: ExecuteState = {
      ...before,
      spentTodayUsd8: 10n * 1_000_000n,
      lastPaymentAt: NOW,
      billedThroughSeconds: NOW,
      pendingPayment: {
        amountUsd8: 10n * 1_000_000n,
        windowFromSeconds: NOW - 3_600,
        windowToSeconds: NOW,
        startedAt: NOW,
        txHash: null,
      },
    };
    const outcome = await runMeterCycle(
      deps({
        payInvoice: async () => {
          throw new PaymentFailedError("waiting for the result timed out", advanced);
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(advanced);
    expect(outcome.nextExecuteState.billedThroughSeconds).toBe(NOW);
  });

  it("finds the carried state through a wrapper", async () => {
    const advanced: ExecuteState = { ...state(), spentTodayUsd8: 7n * USD, billedThroughSeconds: NOW };
    const outcome = await runMeterCycle(
      deps({
        payInvoice: async () => {
          throw new Error("while tracing the cycle", {
            cause: new PaymentFailedError("the connection dropped", advanced),
          });
        },
      }),
      state(),
    );
    expect(outcome.nextExecuteState.spentTodayUsd8).toBe(7n * USD);
  });

  it("survives a logger that throws on every call", async () => {
    const angry: Logger = {
      info: () => {
        throw new Error("the pipe is closed");
      },
      error: () => {
        throw new Error("the pipe is closed");
      },
    };
    const outcome = await runMeterCycle(
      deps({
        logger: angry,
        collectUsage: async () => {
          throw new Error("the usage service is down");
        },
      }),
      state(),
    );
    expect(outcome.result.ok).toBe(false);
  });
});

describe("the key running out between one cycle and the next", () => {
  it("bills as normal while the key works and pays nothing once it has run out", async () => {
    // REQUIRED BY THE BRIEF, seen from the cycle rather than from one call. The agent keeps
    // counting and keeps producing a bill, which is right: the use really happened. What
    // stops is the paying.
    let clock = NOW;
    const permissions: SessionPermissions = { ...SESSION, expiresAt: NOW + 120 };
    const payDeps = {
      pay: async () => HASH,
      now: () => clock,
      sessionPermissions: permissions,
    };
    const cycleDeps = deps({
      now: () => clock,
      payInvoice: (inv: Invoice, s: ExecuteState) => payInvoice(inv, LIMITS, s, payDeps),
    });

    const first = await runMeterCycle(cycleDeps, state({ billedThroughSeconds: clock - 60 }));
    expect(first.result.ok && first.result.paid).toBe(true);

    // Time moves past the key's end date. Nothing else changes.
    clock = NOW + 200;
    const second = await runMeterCycle(cycleDeps, first.nextExecuteState);
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) return;
    expect(second.result.totalUsd8).toBeGreaterThan(0n);
    expect(second.result.paid).toBe(false);
    expect(second.result.reason).toContain("stopped working");
    // The mark must NOT move for a bill that was never paid, or those seconds would be lost.
    expect(second.nextExecuteState.billedThroughSeconds).toBe(first.nextExecuteState.billedThroughSeconds);
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
    expect(() => startMeterLoop(deps(), 0, state())).toThrow(/positive, finite/);
  });

  it("keeps the state between cycles, so the budget really does run down", async () => {
    let clock = NOW;
    const handle = startMeterLoop(deps({ now: () => clock }), 1_000, state());
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.getExecuteState().spentTodayUsd8).toBe(10n * 1_000_000n);
    clock = NOW + 60;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.getExecuteState().spentTodayUsd8).toBe(20n * 1_000_000n);
    handle.stop();
  });

  it("saves the state after every cycle", async () => {
    let clock = NOW;
    const saved: ExecuteState[] = [];
    const handle = startMeterLoop(deps({ now: () => clock }), 1_000, state(), {
      saveExecuteState: (s) => {
        saved.push(s);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    clock = NOW + 60;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved).toHaveLength(2);
    handle.stop();
  });

  it("keeps running when saving fails, and says so", async () => {
    const errors: string[] = [];
    const handle = startMeterLoop(
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
    expect(errors.some((m) => m.includes("could not be saved"))).toBe(true);
    handle.stop();
  });

  it("schedules the next cycle even after something unexpected escapes", async () => {
    let calls = 0;
    const handle = startMeterLoop(
      deps({
        collectUsage: async () => {
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
    const handle = startMeterLoop(
      deps({
        collectUsage: async (from) => {
          calls += 1;
          return usage(from);
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
    const handle = startMeterLoop(deps(), 1_000, state());
    await vi.advanceTimersByTimeAsync(0);
    handle.kill();
    expect(handle.isKilled()).toBe(true);
    expect(handle.getExecuteState().killed).toBe(true);
    handle.stop();
  });

  it("does not let a cycle already running undo the stop switch", async () => {
    let release: (() => void) | null = null;
    const handle = startMeterLoop(
      deps({
        payInvoice: async (inv, s) =>
          new Promise((resolve) => {
            release = () => resolve(paidResult({ ...s, killed: false }, inv.totalUsd8));
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

  it("keeps a callback's failure from stopping the loop", async () => {
    let clock = NOW;
    let calls = 0;
    const handle = startMeterLoop(
      deps({
        now: () => clock,
        collectUsage: async (from) => {
          calls += 1;
          return usage(from);
        },
        onCycle: () => {
          throw new Error("somebody else's problem");
        },
      }),
      1_000,
      state(),
    );
    await vi.advanceTimersByTimeAsync(0);
    clock = NOW + 60;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    handle.stop();
  });

  it("remembers the last record so an operator can read it", async () => {
    const handle = startMeterLoop(deps(), 1_000, state());
    expect(handle.getLastResult()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.getLastResult()?.ok).toBe(true);
    handle.stop();
  });
});
