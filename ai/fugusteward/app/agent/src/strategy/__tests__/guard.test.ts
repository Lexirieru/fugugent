import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runStewardCycle, startStewardLoop, type Logger, type StewardCycleDeps } from "../guard.js";
import {
  initialExecuteState,
  NeverSentError,
  payCharge,
  PaymentFailedError,
  type ExecuteResult,
  type ExecuteState,
  type PaymentTiming,
} from "../execute.js";
import { createFileStateStore } from "../state/store.js";
import { createScopeRegistry, type Scope } from "../scope.js";
import { entryFor, markInFlight } from "../ledger.js";
import type { DueCharge, Subscription } from "../types.js";
import type { SessionPermissions } from "../session.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const DAY = 86_400;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const RENT_PAYEE = "0xAAAA000000000000000000000000000000000001" as const;
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const TRANSFER = "transfer(address,uint256)";

const RENT: Scope = {
  agentId: "rent-agent",
  allowedPayees: [RENT_PAYEE],
  allowedCalls: [{ to: USDT, signature: TRANSFER }],
  maxPerPaymentUsd8: 50n * USD,
  maxPerDayUsd8: 500n * USD,
};

const REGISTRY = createScopeRegistry([RENT]);
const TIMING: PaymentTiming = { minIntervalSeconds: 0 };

const SESSION: SessionPermissions = {
  calls: [{ to: USDT, signature: TRANSFER }],
  spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
  expiresAt: NOW + 30 * DAY,
};

const SUB: Subscription = {
  id: "office-rent",
  agentId: "rent-agent",
  payee: RENT_PAYEE,
  amountUsd8: 10n * USD,
  anchorSeconds: NOW,
  intervalSeconds: DAY,
  totalPeriods: null,
  active: true,
  call: { to: USDT, signature: TRANSFER },
};

function silentLogger(): Logger {
  return { info: () => {}, error: () => {} };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return { ...initialExecuteState(), ...overrides };
}

function paidResult(next: ExecuteState, amount: bigint): ExecuteResult {
  return { paid: true, reason: "paid", amountPaidUsd8: amount, txHash: HASH, state: next };
}

function deps(overrides: Partial<StewardCycleDeps> = {}): StewardCycleDeps {
  return {
    walletLabel: "shared-wallet",
    loadSubscriptions: async () => [SUB],
    registry: REGISTRY,
    payCharge: (charge, s) => payCharge(charge, REGISTRY, TIMING, s, {
      pay: async () => HASH,
      now: () => NOW,
      sessionPermissions: SESSION,
    }),
    now: () => NOW,
    logger: silentLogger(),
    ...overrides,
  };
}

describe("one cycle", () => {
  it("finds what is due and pays it", async () => {
    const outcome = await runStewardCycle(deps(), state());
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.paid).toBe(true);
    expect(outcome.result.amountPaidUsd8).toBe(10n * USD);
    expect(entryFor(outcome.nextExecuteState.ledger, "office-rent", 0)!.status).toBe("PAID");
  });

  it("pays nothing when nothing is due", async () => {
    const outcome = await runStewardCycle(
      deps({ now: () => NOW - 1 }),
      state(),
    );
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.paid).toBe(false);
    expect(outcome.result.reason).toBe("Nothing is due.");
  });

  it("pays only ONE thing per cycle, whatever it finds", async () => {
    // MONEY SAFETY RULE S3, seen from the cycle. A cycle that paid everything it found would,
    // on the first run after a long outage, send every missed payment at once.
    const paid: DueCharge[] = [];
    const outcome = await runStewardCycle(
      deps({
        loadSubscriptions: async () => [
          SUB,
          { ...SUB, id: "compute", anchorSeconds: NOW - 10 },
          { ...SUB, id: "domain", anchorSeconds: NOW - 20 },
        ],
        payCharge: async (charge, s) => {
          paid.push(charge);
          return paidResult(s, charge.amountUsd8);
        },
      }),
      state(),
    );
    expect(paid).toHaveLength(1);
    // The oldest goes first, so the backlog clears in order.
    expect(paid[0]!.subscriptionId).toBe("domain");
    expect(outcome.result.ok).toBe(true);
  });

  it("reports the payments that are too far behind to be made without a person", async () => {
    const errors: Record<string, unknown>[] = [];
    const outcome = await runStewardCycle(
      deps({
        now: () => NOW + 10 * DAY,
        logger: { info: () => {}, error: (_m, meta) => errors.push(meta ?? {}) },
      }),
      state(),
    );
    expect(outcome.result.ok).toBe(true);
    if (!outcome.result.ok) return;
    expect(outcome.result.tooOldToPay).toBe(7);
    expect(errors.some((m) => Array.isArray(m.periods))).toBe(true);
  });

  it("stops rather than guessing when the clock fails", async () => {
    // A schedule is defined by time, so guessing here would move money on a made up date.
    const before = state();
    const outcome = await runStewardCycle(
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

  it("does not throw when the list of repeating payments cannot be read", async () => {
    const before = state();
    const outcome = await runStewardCycle(
      deps({
        loadSubscriptions: async () => {
          throw new Error("the database is down");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("does not throw when the schedule itself is broken", async () => {
    const before = state();
    const outcome = await runStewardCycle(
      deps({ loadSubscriptions: async () => [SUB, { ...SUB }] }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    if (outcome.result.ok) return;
    expect(outcome.result.error).toContain("both call themselves");
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("keeps the old state when the payment failed before it reached the network", async () => {
    const before = state();
    const outcome = await runStewardCycle(
      deps({
        payCharge: async () => {
          throw new NeverSentError("the record could not be saved");
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(before);
  });

  it("carries the ADVANCED state when the payment failed after it may have gone out", async () => {
    // THE LESSON FROM GUARDIAN. Keeping the old state means the period comes back round as
    // due and gets paid a second time.
    const before = state();
    const advanced: ExecuteState = {
      ...before,
      ledger: markInFlight(before.ledger, {
        subscriptionId: "office-rent",
        periodIndex: 0,
        amountUsd8: 10n * USD,
        agentId: "rent-agent",
        startedAt: NOW,
      }),
    };
    const outcome = await runStewardCycle(
      deps({
        payCharge: async () => {
          throw new PaymentFailedError("waiting for the result timed out", advanced);
        },
      }),
      before,
    );
    expect(outcome.result.ok).toBe(false);
    expect(outcome.nextExecuteState).toBe(advanced);
    // And the next cycle finds nothing due, because that record blocks it.
    const next = await runStewardCycle(deps(), outcome.nextExecuteState);
    expect(next.result.ok).toBe(true);
    if (!next.result.ok) return;
    expect(next.result.reason).toBe("Nothing is due.");
  });

  it("finds the carried state through a wrapper", async () => {
    const advanced: ExecuteState = {
      ...state(),
      ledger: markInFlight({}, {
        subscriptionId: "office-rent",
        periodIndex: 0,
        amountUsd8: 10n * USD,
        agentId: "rent-agent",
        startedAt: NOW,
      }),
    };
    const outcome = await runStewardCycle(
      deps({
        payCharge: async () => {
          throw new Error("while tracing", {
            cause: new PaymentFailedError("dropped", advanced),
          });
        },
      }),
      state(),
    );
    expect(outcome.nextExecuteState).toBe(advanced);
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
    const outcome = await runStewardCycle(
      deps({
        logger: angry,
        loadSubscriptions: async () => {
          throw new Error("the database is down");
        },
      }),
      state(),
    );
    expect(outcome.result.ok).toBe(false);
  });
});

describe("dying in the middle of a cycle and coming back", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugusteward-crash-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("does not pay the same period twice after a crash between saving and sending", async () => {
    // REQUIRED BY THE BRIEF. The whole path, through a real file on disk: the agent writes
    // down that it is about to pay, the process dies before the payment leaves, and the next
    // start reads that file and refuses. Nothing here is mocked except the network itself.
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    await store.save(state());

    const payDeps = {
      pay: async () => {
        throw new Error("the process was killed here");
      },
      now: () => NOW,
      sessionPermissions: SESSION,
      persistBeforeSend: (s: ExecuteState) => store.save(s),
    };

    const first = await runStewardCycle(
      deps({ payCharge: (charge, s) => payCharge(charge, REGISTRY, TIMING, s, payDeps) }),
      (await store.load())!,
    );
    expect(first.result.ok).toBe(false);

    // Everything the process knew is gone. Only the file survives.
    const reloaded = (await store.load())!;
    expect(entryFor(reloaded.ledger, "office-rent", 0)!.status).toBe("IN_FLIGHT");
    expect(reloaded.agents["rent-agent"]!.spentTodayUsd8).toBe(10n * USD);

    // Second start, with the network working perfectly this time.
    const sent: DueCharge[] = [];
    const second = await runStewardCycle(
      deps({
        payCharge: (charge, s) =>
          payCharge(charge, REGISTRY, TIMING, s, {
            pay: async () => {
              sent.push(charge);
              return HASH;
            },
            now: () => NOW,
            sessionPermissions: SESSION,
          }),
      }),
      reloaded,
    );
    expect(sent).toEqual([]);
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) return;
    // The schedule itself no longer offers it, because the record counts as settled.
    expect(second.result.reason).toBe("Nothing is due.");
  });

  it("also refuses when the crash happened after the payment really did land", async () => {
    // The dangerous shape: the transaction went into a block and only reading the result
    // failed. From here it is indistinguishable from the case above, and both have to end in
    // the same silence.
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    await store.save(state());

    const first = await runStewardCycle(
      deps({
        payCharge: (charge, s) =>
          payCharge(charge, REGISTRY, TIMING, s, {
            pay: async () => {
              // The transaction landed. Reading the result is what failed.
              throw new Error("waiting for the result timed out");
            },
            now: () => NOW,
            sessionPermissions: SESSION,
            persistBeforeSend: (st: ExecuteState) => store.save(st),
          }),
      }),
      (await store.load())!,
    );
    expect(first.result.ok).toBe(false);

    const reloaded = (await store.load())!;
    const second = await runStewardCycle(deps(), reloaded);
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) return;
    expect(second.result.paid).toBe(false);
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
    expect(() => startStewardLoop(deps(), 0, state())).toThrow(/positive, finite/);
  });

  it("keeps the record between cycles, so nothing is paid twice by the loop itself", async () => {
    let sent = 0;
    const handle = startStewardLoop(
      deps({
        payCharge: (charge, s) =>
          payCharge(charge, REGISTRY, TIMING, s, {
            pay: async () => {
              sent += 1;
              return HASH;
            },
            now: () => NOW,
            sessionPermissions: SESSION,
          }),
      }),
      1_000,
      state(),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toBe(1);
    handle.stop();
  });

  it("saves the state after every cycle", async () => {
    const saved: ExecuteState[] = [];
    const handle = startStewardLoop(deps(), 1_000, state(), {
      saveExecuteState: (s) => {
        saved.push(s);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved).toHaveLength(2);
    handle.stop();
  });

  it("keeps running when saving fails, and says so", async () => {
    const errors: string[] = [];
    const handle = startStewardLoop(
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
    const handle = startStewardLoop(
      deps({
        loadSubscriptions: async () => {
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
    const handle = startStewardLoop(
      deps({
        loadSubscriptions: async () => {
          calls += 1;
          return [SUB];
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
    const handle = startStewardLoop(deps(), 1_000, state());
    await vi.advanceTimersByTimeAsync(0);
    handle.kill();
    expect(handle.isKilled()).toBe(true);
    expect(handle.getExecuteState().killed).toBe(true);
    handle.stop();
  });

  it("does not let a cycle already running undo the stop switch", async () => {
    let release: (() => void) | null = null;
    const handle = startStewardLoop(
      deps({
        payCharge: async (charge, s) =>
          new Promise((resolve) => {
            release = () => resolve(paidResult({ ...s, killed: false }, charge.amountUsd8));
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
    let calls = 0;
    const handle = startStewardLoop(
      deps({
        loadSubscriptions: async () => {
          calls += 1;
          return [SUB];
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
    const handle = startStewardLoop(deps(), 1_000, state());
    expect(handle.getLastResult()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.getLastResult()?.ok).toBe(true);
    handle.stop();
  });
});
