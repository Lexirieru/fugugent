import { describe, expect, it, vi } from "vitest";
import {
  runGuardCycle,
  startGuardLoop,
  type CycleResult,
  type ExecuteFn,
  type GuardCycleDeps,
  type GuardLoopHandle,
  type Logger,
} from "../guard.js";
import {
  executeDecision,
  type ExecuteDeps,
  type ExecuteLimits,
  type ExecuteResult,
  type ExecuteState,
} from "../execute.js";
import type { Decision, Position } from "../types.js";

const ACCOUNT = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;
const REPAY_ASSET = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

const SAFE_POSITION: Position = {
  protocol: "aave",
  account: ACCOUNT,
  collateralBase: 750_000_000_000n,
  debtBase: 312_500_000_000n,
  liquidationThresholdBps: 7_500n,
  healthFactor: 1_800_000_000_000_000_000n,
  blockNumber: 1n,
};

// HF 1.05e18 > HF_ONE (1e18) but <= the default deleverage threshold (1.1e18) ->
// `decide` produces DELEVERAGE, not EMERGENCY (which needs HF <= 1.0e18).
const RISKY_POSITION: Position = {
  ...SAFE_POSITION,
  debtBase: 500_000_000_000n,
  healthFactor: 1_050_000_000_000_000_000n,
};

// HF <= HF_ONE -> EMERGENCY.
const EMERGENCY_POSITION: Position = {
  ...SAFE_POSITION,
  debtBase: 600_000_000_000n,
  healthFactor: 980_000_000_000_000_000n,
};

function silentLogger(): Logger {
  return { info: vi.fn(), error: vi.fn() };
}

function limits(overrides: Partial<ExecuteLimits> = {}): ExecuteLimits {
  return {
    maxPerActionUsd8: 100_000_000_000n,
    maxPerDayUsd8: 500_000_000_000n,
    minIntervalSeconds: 0,
    ...overrides,
  };
}

function execState(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: 1_000_000,
    lastActionAt: 0,
    killed: false,
    pendingRepay: null,
    ...overrides,
  };
}

function canned(overrides: Partial<ExecuteResult> = {}): ExecuteResult {
  return {
    sent: false,
    reason: "test: not sending",
    amountSentUsd8: 0n,
    cappedPerAction: false,
    cappedPerDay: false,
    txHash: null,
    state: execState(),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<GuardCycleDeps> = {}): GuardCycleDeps {
  return {
    account: ACCOUNT,
    readPosition: vi.fn(async () => SAFE_POSITION),
    executeDecision: vi.fn(async (): Promise<ExecuteResult> => canned()),
    explainDecision: vi.fn(async () => "A friendly explanation from the LLM."),
    now: () => 1_700_000_000,
    logger: silentLogger(),
    ...overrides,
  };
}

function expectOk(result: CycleResult): asserts result is CycleResult & { ok: true } {
  if (!result.ok) throw new Error(`expected ok cycle, got failure: ${result.error}`);
}

function expectFail(result: CycleResult): asserts result is CycleResult & { ok: false } {
  if (result.ok) throw new Error("expected failed cycle, got success");
}

describe("runGuardCycle", () => {
  it("a normal cycle produces a complete record", async () => {
    // RISKY_POSITION (action != NONE) is used here on purpose rather than SAFE_POSITION, so
    // that `explainDecision` really is called and the record carries the mock's explanation
    // instead of the `decision.reason` fallback (see rule #2 at the top of the module: NONE
    // skips explainDecision).
    const deps = baseDeps({ readPosition: vi.fn(async () => RISKY_POSITION) });
    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.timestamp).toBe(1_700_000_000);
    expect(result.account).toBe(ACCOUNT);
    expect(result.healthFactor).toBe(RISKY_POSITION.healthFactor);
    expect(result.action).not.toBe("NONE");
    expect(result.sent).toBe(false);
    expect(result.amountSentUsd8).toBe(0n);
    expect(result.txHash).toBeNull();
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
    expect(typeof result.executeReason).toBe("string");
    expect(result.explanation).toBe("A friendly explanation from the LLM.");
    // There is no real execution in this cycle -> the execution state does not change.
    expect(nextExecuteState).toEqual(execState());
  });

  it("a failed position read does not throw, is recorded as a failed cycle, and does not call execution", async () => {
    const readPosition = vi.fn(async () => {
      throw new Error("RPC mati");
    });
    const executeDecisionSpy = vi.fn();
    const explainDecisionSpy = vi.fn();
    const deps = baseDeps({
      readPosition,
      executeDecision: executeDecisionSpy,
      explainDecision: explainDecisionSpy,
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectFail(result);
    expect(result.error).toContain("RPC mati");
    expect(result.account).toBe(ACCOUNT);
    expect(executeDecisionSpy).not.toHaveBeenCalled();
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalled();
    expect(nextExecuteState).toEqual(execState());
  });

  it("an execution failure (e.g. refused) does not throw and is recorded as a failed cycle, the state unchanged", async () => {
    const executeDecisionSpy = vi.fn(async () => {
      throw new Error("execution refused by the session key");
    });
    const explainDecisionSpy = vi.fn();
    const startingState = execState({ spentTodayUsd8: 7_000_000n, lastActionAt: 42 });
    const deps = baseDeps({
      executeDecision: executeDecisionSpy,
      explainDecision: explainDecisionSpy,
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, startingState);

    expectFail(result);
    expect(result.error).toContain("execution refused");
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    // The execute.ts contract: state only changes AFTER a send succeeds. If executeDecision
    // throws there is no new state -- the old state is passed through as-is, not quietly
    // treated as changed.
    expect(nextExecuteState).toEqual(startingState);
  });

  it("a failed explanation does not change an execution result that already happened", async () => {
    const successResult = canned({
      sent: true,
      reason: "terkirim",
      amountSentUsd8: 42_000_000n,
      txHash: "0xdeadbeef" as `0x${string}`,
      state: execState({ spentTodayUsd8: 42_000_000n, lastActionAt: 1_700_000_000 }),
    });
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION),
      executeDecision: vi.fn(async () => successResult),
      explainDecision: vi.fn(async () => {
        throw new Error("dGrid timeout");
      }),
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectOk(result);
    // The execution result stays intact even when the explanation fails.
    expect(result.sent).toBe(true);
    expect(result.amountSentUsd8).toBe(42_000_000n);
    expect(result.txHash).toBe("0xdeadbeef");
    expect(nextExecuteState).toEqual(successResult.state);
    // The explanation falls back to EXACTLY the decision's raw reason, not to a leaked error
    // message or some other generic string.
    expect(result.explanation).toBe(result.reason);
  });

  it("a NONE action never calls sendRepay (through the real executeDecision)", async () => {
    const sendRepay = vi.fn(async () => "0xabc" as `0x${string}`);
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits(), state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => SAFE_POSITION), // HF tinggi -> decide menghasilkan NONE
      executeDecision: execFn,
    });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.action).toBe("NONE");
    expect(sendRepay).not.toHaveBeenCalled();
  });

  it("a NONE action does not call explainDecision at all", async () => {
    const explainDecisionSpy = vi.fn(async () => "must never be seen");
    const deps = baseDeps({
      readPosition: vi.fn(async () => SAFE_POSITION),
      explainDecision: explainDecisionSpy,
    });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.action).toBe("NONE");
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    expect(result.explanation).toBe(result.reason);
  });

  it("aksi selain NONE tetap memanggil explainDecision", async () => {
    const explainDecisionSpy = vi.fn(async () => "penjelasan LLM");
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION),
      explainDecision: explainDecisionSpy,
    });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.action).not.toBe("NONE");
    expect(explainDecisionSpy).toHaveBeenCalledOnce();
    expect(result.explanation).toBe("penjelasan LLM");
  });

  it("the explanation is called after execution -- the call order is proven", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION), // needs an action != NONE for explain to be called
      executeDecision: vi.fn(async () => {
        order.push("execute");
        return canned();
      }),
      explainDecision: vi.fn(async () => {
        order.push("explain");
        return "penjelasan";
      }),
    });

    await runGuardCycle(deps, execState());

    expect(order).toEqual(["execute", "explain"]);
  });

  it("two consecutive cycles with the real executeDecision: the second is refused by the cooldown/budget, sendRepay only once", async () => {
    const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
    let clock = 1_700_000_000;
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => clock };
    const theLimits = limits({
      maxPerActionUsd8: 100_000_000_000n, // $1000
      maxPerDayUsd8: 100_000_000_000n, // $1000/day -- exhausted in a single send
      minIntervalSeconds: 3_600, // 1 jam
    });
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, theLimits, state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
      now: () => clock,
    });

    const initialState = execState({ dayStartedAt: clock });

    const first = await runGuardCycle(deps, initialState);
    expectOk(first.result);
    expect(first.result.sent).toBe(true);
    expect(sendRepay).toHaveBeenCalledTimes(1);
    // The daily budget is spent and the cooldown has just begun -- the state MUST carry this
    // into the next cycle, not reset to `initialState`.
    expect(first.nextExecuteState.spentTodayUsd8).toBeGreaterThan(0n);
    expect(first.nextExecuteState.lastActionAt).toBe(clock);

    // The second cycle, 60 seconds later (simulating intervalMs = 60_000 in startGuardLoop)
    // -- NOT 1 hour, so it is still inside the cooldown AND the daily budget was already
    // spent by the first cycle.
    clock += 60;
    const second = await runGuardCycle(deps, first.nextExecuteState);
    expectOk(second.result);
    expect(second.result.sent).toBe(false);
    expect(second.result.amountSentUsd8).toBe(0n);
    // sendRepay is NOT called again -- this is the proof that the state really flows rather
    // than being quietly reset every cycle.
    expect(sendRepay).toHaveBeenCalledTimes(1);
  });

  it("a throwing logger (e.g. EPIPE) does not stop the cycle", async () => {
    const throwingLogger: Logger = {
      info: vi.fn(() => {
        throw new Error("EPIPE");
      }),
      error: vi.fn(() => {
        throw new Error("EPIPE");
      }),
    };
    const deps = baseDeps({
      logger: throwingLogger,
      readPosition: vi.fn(async () => {
        throw new Error("RPC mati");
      }),
    });

    const { result } = await runGuardCycle(deps, execState());

    expectFail(result);
    expect(result.error).toContain("RPC mati");
  });

  it("a throwing now() does not stop the cycle, the fallback timestamp is used", async () => {
    const throwingNow = vi.fn(() => {
      throw new Error("jam sistem rusak");
    });
    const deps = baseDeps({ now: throwingNow });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.timestamp).toBe(0);
  });

  it("the record separates the decision reason from the execution reason (the kill switch refuses EMERGENCY)", async () => {
    const sendRepay = vi.fn(async () => "0xabc" as `0x${string}`);
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits(), state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
    });

    const { result } = await runGuardCycle(deps, execState({ killed: true }));

    expectOk(result);
    expect(result.action).toBe("EMERGENCY");
    expect(result.sent).toBe(false);
    expect(result.amountSentUsd8).toBe(0n);
    expect(sendRepay).not.toHaveBeenCalled();
    // The decision reason talks about the health factor/liquidation...
    expect(result.reason).toMatch(/liquidation|emergency/i);
    // ...while the execution reason must explicitly talk about the kill switch -- whoever
    // reads the record has to be able to tell "not sent because of the kill switch" from
    // "not sent because of the cooldown / an exhausted budget".
    expect(result.executeReason).toMatch(/kill switch/i);
    expect(result.executeReason).not.toBe(result.reason);
  });
});

describe("startGuardLoop", () => {
  it("the loop can be stopped and calls no further cycles afterwards", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      // The first cycle runs immediately.
      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      handle.stop();

      const callsBeforeAdvance = readPosition.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(readPosition).toHaveBeenCalledTimes(callsBeforeAdvance);
    } finally {
      vi.useRealTimers();
    }
  });

  it("repeated position-read failures do not stop the loop -- cycles 2 and 3 still run", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => {
        throw new Error("RPC selalu mati");
      });
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);
      expect(handle.getLastResult()?.ok).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);
      expect(handle.getLastResult()?.ok).toBe(false);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() called while a cycle is running prevents the next cycle from being scheduled", async () => {
    vi.useFakeTimers();
    try {
      let resolveReadPosition!: (pos: Position) => void;
      const pending = new Promise<Position>((resolve) => {
        resolveReadPosition = resolve;
      });
      const readPosition = vi.fn(async () => pending);
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      // The first cycle has started (readPosition was called) but has not finished --
      // stop() is called IN THE MIDDLE of a cycle in flight.
      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);
      handle.stop();

      // The first cycle finally finishes...
      resolveReadPosition(SAFE_POSITION);
      await vi.advanceTimersByTimeAsync(0);

      // ...but because stop() was called before it finished, no new cycle is scheduled after
      // it.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(readPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("onCycle is called with the record of every cycle and getLastResult follows the latest one", async () => {
    vi.useFakeTimers();
    try {
      const onCycle = vi.fn();
      const deps = baseDeps({ onCycle });
      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(onCycle).toHaveBeenCalledTimes(1);
      const firstArg = onCycle.mock.calls[0][0] as CycleResult;
      expect(firstArg.ok).toBe(true);
      expect(handle.getLastResult()).toEqual(firstArg);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logger.info carries the health factor and amount formatted, not on the raw basis", async () => {
    vi.useFakeTimers();
    try {
      const logger = silentLogger();
      const deps = baseDeps({ logger });
      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalled();
      const meta = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
      expect(meta.healthFactor).toBe("1.80");
      expect(meta.amountSentUsd8).toBe("$0.00");
      expect(typeof meta.decisionReason).toBe("string");
      expect(typeof meta.executeReason).toBe("string");

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a zero or negative intervalMs is refused instead of becoming a busy loop", () => {
    const deps = baseDeps();
    expect(() => startGuardLoop(deps, 0, execState())).toThrow();
    expect(() => startGuardLoop(deps, -100, execState())).toThrow();
  });

  it("startGuardLoop flows the execution state between cycles: a budget exhausted in cycle 1 refuses cycle 2, sendRepay only once", async () => {
    // Round 2 review: the earlier two-cycle test called runGuardCycle directly and flowed
    // the state by hand at the test level -- that locks in runGuardCycle's contract, BUT it
    // does NOT lock in that startGuardLoop actually does that flowing itself. This test runs
    // two cycles through the real startGuardLoop (fake timers), so if the line that stores
    // `outcome.nextExecuteState` into `currentExecuteState` is deleted, it is this test (not
    // just the runGuardCycle-level one) that fails.
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
      const theLimits = limits({
        maxPerActionUsd8: 100_000_000_000n, // $1000
        maxPerDayUsd8: 100_000_000_000n, // $1000/day -- exhausted in a single send
        minIntervalSeconds: 0, // isolates the daily budget alone, not the cooldown
      });
      const execFn: ExecuteFn = (decision, pos, state) =>
        executeDecision(decision, pos, theLimits, state, execDeps);

      const deps = baseDeps({
        readPosition: vi.fn(async () => EMERGENCY_POSITION),
        executeDecision: execFn,
        now: () => 1_700_000_000,
      });

      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      // Cycle 1 (immediately): a full budget -> send, spending the entire daily budget in one
      // transaction.
      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);

      // Cycle 2, scheduled BY THE LOOP ITSELF 1000ms later. If cycle 1's execution state
      // flows correctly into this one, the daily budget is already zero -> it must not send
      // again.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).toHaveBeenCalledTimes(1);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a persistently throwing logger (the success path) does not stop the next cycle from being scheduled", async () => {
    vi.useFakeTimers();
    try {
      const throwingLogger: Logger = {
        info: vi.fn(() => {
          throw new Error("EPIPE");
        }),
        error: vi.fn(() => {
          throw new Error("EPIPE");
        }),
      };
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const deps = baseDeps({ logger: throwingLogger, readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a persistently throwing logger (the failure path) does not stop the next cycle from being scheduled", async () => {
    vi.useFakeTimers();
    try {
      const throwingLogger: Logger = {
        info: vi.fn(() => {
          throw new Error("EPIPE");
        }),
        error: vi.fn(() => {
          throw new Error("EPIPE");
        }),
      };
      const readPosition = vi.fn(async () => {
        throw new Error("RPC mati");
      });
      const deps = baseDeps({ logger: throwingLogger, readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);
      expect(handle.getLastResult()?.ok).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);
      expect(handle.getLastResult()?.ok).toBe(false);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("C2 — a failure after the transaction landed never pays twice", () => {
  it("runGuardCycle carries forward the state from RepaySendError, not the old state", async () => {
    // The failure shape that is the whole reason this rule exists: the transaction landed in
    // a block, only `waitForTransactionReceipt` failed.
    const sendRepay = vi.fn(async () => {
      throw new Error("waitForTransactionReceipt timeout setelah 180s");
    });
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits({ minIntervalSeconds: 0 }), state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectFail(result);
    // The budget AND the cooldown both move even though the cycle is recorded as failed...
    expect(nextExecuteState.spentTodayUsd8).toBeGreaterThan(0n);
    expect(nextExecuteState.lastActionAt).toBe(1_700_000_000);
    // ...and the repay is recorded as pending, with its reconciliation anchors.
    expect(nextExecuteState.pendingRepay).not.toBeNull();
    expect(nextExecuteState.pendingRepay?.debtBaseBeforeSend).toBe(EMERGENCY_POSITION.debtBase);
    expect(nextExecuteState.pendingRepay?.blockNumberBeforeSend).toBe(EMERGENCY_POSITION.blockNumber);
  });

  it("THE HEART OF THE TASK: sendRepay throws after the tx landed -> the next cycle does NOT resend", async () => {
    vi.useFakeTimers();
    try {
      // The only thing allowed to hold back the second cycle in this test is the pending
      // repay record: the cooldown is zero, the daily budget is far larger than one payment,
      // the kill switch is off, and the position stays in the EMERGENCY zone so `decide` keeps
      // asking to pay.
      const sendRepay = vi.fn(async () => {
        throw new Error("waitForTransactionReceipt timeout setelah 180s");
      });
      const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
      const theLimits = limits({
        maxPerActionUsd8: 100_000_000_000n,
        maxPerDayUsd8: 100_000_000_000_000n, // one payment cannot exhaust it
        minIntervalSeconds: 0,
      });
      const execFn: ExecuteFn = (decision, pos, state) =>
        executeDecision(decision, pos, theLimits, state, execDeps);

      // The chain does not yet show the debt falling (a stale node / a receipt not yet seen) —
      // exactly the state in which the old version paid a second time.
      const deps = baseDeps({
        readPosition: vi.fn(async () => EMERGENCY_POSITION),
        executeDecision: execFn,
        now: () => 1_700_000_000,
      });

      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      // Three cycles, one send. This is what the whole C2 change buys.
      expect(sendRepay).toHaveBeenCalledTimes(1);
      expect(handle.getExecuteState().pendingRepay).not.toBeNull();

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the chain proves the repay landed -> the record is cleared and Guardian may act again", async () => {
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => {
        throw new Error("waitForTransactionReceipt timeout setelah 180s");
      });
      const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
      const theLimits = limits({
        maxPerActionUsd8: 100_000_000_000n,
        maxPerDayUsd8: 100_000_000_000_000n,
        minIntervalSeconds: 0,
      });
      const execFn: ExecuteFn = (decision, pos, state) =>
        executeDecision(decision, pos, theLimits, state, execDeps);

      // Cycle 1 reads the position as-is; the following cycles read a position whose debt has
      // fallen by EXACTLY what we paid, at a newer block — on-chain proof that the transaction
      // that "failed" actually landed. The amount is taken from the pending record itself
      // rather than retyped, so this test keeps binding if `decide`'s thresholds change.
      let handle: GuardLoopHandle | undefined;
      const readPosition = vi.fn(async () => {
        const menggantung = handle?.getExecuteState().pendingRepay;
        if (!menggantung) return EMERGENCY_POSITION;
        return {
          ...EMERGENCY_POSITION,
          blockNumber: EMERGENCY_POSITION.blockNumber + 5n,
          debtBase: EMERGENCY_POSITION.debtBase - menggantung.amountUsd8,
        };
      });

      const deps = baseDeps({ readPosition, executeDecision: execFn, now: () => 1_700_000_000 });
      handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);
      expect(handle.getExecuteState().pendingRepay).not.toBeNull();

      // Cycle 2: reconciliation clears the record, and because the position is still in the
      // EMERGENCY zone the agent may try again. Guardian does not freeze forever just because
      // one receipt went missing.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).toHaveBeenCalledTimes(2);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("C3 — the kill switch has a lever, and the state is persisted", () => {
  function killDeps(sendRepay: ReturnType<typeof vi.fn>, overrides: Partial<GuardCycleDeps> = {}) {
    const execDeps: ExecuteDeps = {
      repayAsset: REPAY_ASSET,
      sendRepay: sendRepay as unknown as ExecuteDeps["sendRepay"],
      now: () => 1_700_000_000,
    };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits({ minIntervalSeconds: 0 }), state, execDeps);
    return baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
      now: () => 1_700_000_000,
      ...overrides,
    });
  }

  it("kill() while the loop is running stops the next cycle from sending", async () => {
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay);
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);
      expect(handle.isKilled()).toBe(false);

      handle.kill();
      expect(handle.isKilled()).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).toHaveBeenCalledTimes(1);
      const terakhir = handle.getLastResult();
      expect(terakhir?.ok).toBe(true);
      expect(terakhir?.ok === true ? terakhir.executeReason : "").toMatch(/kill switch/i);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("kill() in the MIDDLE of a cycle cannot be undone by that cycle's result", async () => {
    vi.useFakeTimers();
    try {
      let lepas!: (pos: Position) => void;
      const tertunda = new Promise<Position>((resolve) => {
        lepas = resolve;
      });
      let bacaanKe = 0;
      const readPosition = vi.fn(async () => {
        bacaanKe += 1;
        return bacaanKe === 1 ? tertunda : EMERGENCY_POSITION;
      });
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay, { readPosition });
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);

      // The kill is pulled while cycle 1 is still waiting on RPC. That cycle will finish
      // carrying a state with `killed: false` -- that state MUST NOT undo a kill already
      // pulled.
      handle.kill();
      lepas(EMERGENCY_POSITION);
      await vi.advanceTimersByTimeAsync(0);

      expect(handle.isKilled()).toBe(true);
      expect(handle.getExecuteState().killed).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      // Cycle 1 did get to send (the kill arrived after it passed rule 1); cycle 2 must not
      // send at all.
      expect(sendRepay).toHaveBeenCalledTimes(1);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saveExecuteState is called every cycle and on kill()", async () => {
    vi.useFakeTimers();
    try {
      const tersimpan: ExecuteState[] = [];
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay);
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }), {
        saveExecuteState: (s) => {
          tersimpan.push(s);
        },
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(tersimpan).toHaveLength(1);
      expect(tersimpan[0].spentTodayUsd8).toBeGreaterThan(0n);

      handle.kill();
      await vi.advanceTimersByTimeAsync(0);
      expect(tersimpan.at(-1)?.killed).toBe(true);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a throwing saveExecuteState is logged but does not kill the loop", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const logger = silentLogger();
      const deps = baseDeps({ readPosition, logger });
      const handle = startGuardLoop(deps, 1_000, execState(), {
        saveExecuteState: () => {
          throw new Error("disk penuh");
        },
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalled();

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("an initial state that is already killed is honored and never released", async () => {
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay);
      const handle = startGuardLoop(deps, 1_000, execState({ killed: true }));

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).not.toHaveBeenCalled();
      expect(handle.isKilled()).toBe(true);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("guard recognizes a failure-after-send without relying on instanceof", () => {
  it("a wrapper error carrying the marker still advances the state instead of returning the old one", async () => {
    // The backend scenario: `executeDecision` is wrapped for telemetry/retry, and the wrapper
    // throws a different error with a `cause`. If guard.ts used `instanceof`, this error would
    // fall into the "old state" branch — the budget would not move, the pending record would
    // be lost, and bug C2 would come back silently.
    const stateAfterSend: ExecuteState = execState({
      spentTodayUsd8: 42_000_000n,
      lastActionAt: 1_700_000_000,
      pendingRepay: {
        asset: REPAY_ASSET,
        amountUsd8: 42_000_000n,
        startedAt: 1_700_000_000,
        txHash: null,
        debtBaseBeforeSend: EMERGENCY_POSITION.debtBase,
        blockNumberBeforeSend: EMERGENCY_POSITION.blockNumber,
      },
    });
    const original = Object.assign(new Error("receipt timeout"), {
      repaySendFailure: true,
      stateAfterSend: stateAfterSend,
    });
    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: vi.fn(async () => {
        throw new Error("the cycle failed (telemetry wrapper)", { cause: original });
      }),
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectFail(result);
    expect(nextExecuteState).toEqual(stateAfterSend);
    expect(nextExecuteState.pendingRepay).not.toBeNull();
  });

  it("an ordinary error still returns the old state — the distinction is still real", async () => {
    const initial = execState({ spentTodayUsd8: 7_000_000n, lastActionAt: 42 });
    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: vi.fn(async () => {
        throw new Error("RPC 502 before anything was sent");
      }),
    });

    const { nextExecuteState } = await runGuardCycle(deps, initial);

    expect(nextExecuteState).toEqual(initial);
  });
});
