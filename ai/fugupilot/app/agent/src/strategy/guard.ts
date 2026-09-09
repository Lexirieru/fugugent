/**
 * The cycle that actually runs: read what is held, plan, act inside the limits, record what
 * happened. And then again.
 *
 * There is no new decision or sending logic here. What this file is really about is two
 * mistakes that were paid for once already, on Fugu Guardian, and that both apply in full
 * to an agent that acts over and over:
 *
 * 1. **The state has to flow through the types, not through somebody's memory.** The first
 *    version of Guardian's loop threw away the state that came back from the sending step,
 *    so the daily budget and the waiting time never moved and the agent could send the per
 *    step limit on every single interval. Here `runPilotCycle` takes the state as an
 *    argument and hands the next one back in `nextExecuteState`, and `startPilotLoop` is
 *    the one place that keeps it between cycles. A caller cannot forget to do something it
 *    is not being asked to do.
 *
 * 2. **A send that failed after touching the network still advances the state.** Guardian's
 *    first version returned the old state on every failure, which is right for a failure
 *    before sending and dangerous for one after. Waiting for a result can time out after
 *    the transaction already landed, and the old state means the next cycle sends again.
 *    So a failure carrying a state is recognised, by a marker on the object rather than by
 *    its class, and that state is the one carried forward.
 *
 * A cycle never throws. Not for a failed read, not for a failed plan, not for a failed
 * send, and not for a failure inside the clock or the logger either. Guardian learned that
 * last one too: a logger that threw made the loop die silently because the line that
 * schedules the next cycle was never reached.
 */
import { executePlan, asSendFailure, type ExecuteLimits, type ExecuteResult, type ExecuteState } from "./execute.js";
import { plan as buildPlan } from "./decide.js";
import type { PilotPlan, PilotPolicy, PlannedAction, PortfolioSnapshot } from "./types.js";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Reads what is currently held. Handed in, so tests never touch the network. */
export type ReadSnapshotFn = (account: `0x${string}`) => Promise<PortfolioSnapshot>;

/**
 * How the cycle asks for something to be sent. This is the real `executePlan`, with the
 * limits and the sending function already filled in by the caller AND NOTHING ELSE. The
 * state is not captured by the caller's closure: it is passed in explicitly on every call.
 * The correct wiring on the caller's side is:
 *
 * ```ts
 * const execFn: ExecuteFn = (plan, state) => executePlan(plan, limits, state, execDeps);
 * ```
 */
export type ExecuteFn = (plan: PilotPlan, state: ExecuteState) => Promise<ExecuteResult>;

export interface PilotCycleDeps {
  readonly account: `0x${string}`;
  readonly readSnapshot: ReadSnapshotFn;
  readonly policy: PilotPolicy;
  readonly executePlan: ExecuteFn;
  /** The clock in seconds. Handed in so time is fully controllable in tests. */
  readonly now: () => number;
  readonly logger: Logger;
  /**
   * Called after every cycle, successful or not, with the whole record. A failure in this
   * callback never stops the loop.
   */
  readonly onCycle?: (result: CycleResult) => void;
}

export interface CycleSuccess {
  readonly ok: true;
  readonly timestamp: number;
  readonly account: `0x${string}`;
  readonly plannedSteps: number;
  readonly plannedTotalUsd8: bigint;
  readonly sent: boolean;
  readonly amountSentUsd8: bigint;
  readonly cappedPerAction: boolean;
  readonly cappedPerDay: boolean;
  readonly txHash: `0x${string}` | null;
  readonly action: PlannedAction | null;
  /** Why the plan looks the way it does. */
  readonly planReason: string;
  /** Why it was sent, was not sent, or was cut down. */
  readonly executeReason: string;
}

export interface CycleFailure {
  readonly ok: false;
  readonly timestamp: number;
  readonly account: `0x${string}`;
  readonly error: string;
}

export type CycleResult = CycleSuccess | CycleFailure;

export interface PilotCycleOutcome {
  readonly result: CycleResult;
  /**
   * The state for the NEXT cycle. The same as the one that came in when this cycle failed
   * before it could send, and the advanced one when the send may already have gone out. The
   * caller has to use this value, never the one it passed in.
   */
  readonly nextExecuteState: ExecuteState;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Logging that never throws. The logger is handed in, so it might write to a pipe, a file
 * or somewhere far away, and its failures must never be the reason this agent stops.
 */
export function logInfo(logger: Logger, message: string, meta?: Record<string, unknown>): void {
  try {
    logger.info(message, meta);
  } catch {
    // Logging must never be the reason the agent stops working.
  }
}

export function logError(logger: Logger, message: string, meta?: Record<string, unknown>): void {
  try {
    logger.error(message, meta);
  } catch {
    // Same as above.
  }
}

function safeInvoke(fn: () => void): void {
  try {
    fn();
  } catch {
    // Somebody else's callback must never stop the loop.
  }
}

/**
 * Runs one cycle: read, plan, act. Never throws. Every failure, including a failure of the
 * clock or the logger, produces a record so the caller can always move on.
 */
export async function runPilotCycle(
  deps: PilotCycleDeps,
  executeState: ExecuteState,
): Promise<PilotCycleOutcome> {
  let timestamp: number;
  try {
    timestamp = deps.now();
  } catch (err) {
    logError(deps.logger, "pilot: the clock failed, using a fallback time", {
      account: deps.account,
      error: toMessage(err),
    });
    timestamp = 0;
  }

  let snapshot: PortfolioSnapshot;
  try {
    snapshot = await deps.readSnapshot(deps.account);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "pilot: could not read what is held, cycle skipped", {
      account: deps.account,
      error,
    });
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  let plan: PilotPlan;
  try {
    plan = buildPlan(snapshot, deps.policy);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "pilot: could not build a plan, cycle skipped", {
      account: deps.account,
      error,
    });
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  let execResult: ExecuteResult;
  try {
    execResult = await deps.executePlan(plan, executeState);
  } catch (err) {
    const error = toMessage(err);
    // Recognised by a marker on the object, NOT by its class. A wrapper somewhere above
    // that rethrows a different error, or two copies of the execute module in the
    // dependency tree, would make a class check fail silently and the branch below would
    // hand back the old state. That is the double payment bug returning with no test
    // complaining. The search also follows the chain of causes.
    const failureAfterSend = asSendFailure(err);
    if (failureAfterSend !== null) {
      logError(deps.logger, "pilot: the send failed AFTER it may have gone out", {
        account: deps.account,
        error,
        note:
          "the budget and the waiting time are still counted and the send is recorded as in " +
          "flight until the blockchain shows it done",
      });
      return {
        result: { ok: false, timestamp, account: deps.account, error },
        nextExecuteState: failureAfterSend.stateAfterSend,
      };
    }
    logError(deps.logger, "pilot: the send failed, cycle skipped", {
      account: deps.account,
      error,
    });
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  return {
    result: {
      ok: true,
      timestamp,
      account: deps.account,
      plannedSteps: plan.actions.length,
      plannedTotalUsd8: plan.totalUsd8,
      sent: execResult.sent,
      amountSentUsd8: execResult.amountSentUsd8,
      cappedPerAction: execResult.cappedPerAction,
      cappedPerDay: execResult.cappedPerDay,
      txHash: execResult.txHash,
      action: execResult.action,
      planReason: plan.reason,
      executeReason: execResult.reason,
    },
    nextExecuteState: execResult.state,
  };
}

export interface PilotLoopOptions {
  /**
   * Saves the state every time it changes, after every cycle and immediately after the stop
   * switch is pulled. Its failures are logged and never stop the loop: a full disk must not
   * make the agent stop, but it must not be hidden either.
   */
  readonly saveExecuteState?: (state: ExecuteState) => Promise<void> | void;
}

export interface PilotLoopHandle {
  /** Stops the loop. A cycle already running is left to finish, and none is scheduled after it. */
  stop: () => void;
  /**
   * The stop switch as a real lever rather than a field on the starting state.
   *
   * This is a one way latch. A cycle already running when it is pulled will finish with a
   * state that still says the switch is off, and that result must not undo the pull. So the
   * pull is recorded separately and folded into every state that comes back.
   *
   * Pulling it does not stop the loop. Watching and recording keep running; what stops is
   * sending. To stop entirely, call `stop` as well.
   */
  kill: () => void;
  isKilled: () => boolean;
  getExecuteState: () => ExecuteState;
  getLastResult: () => CycleResult | null;
}

/**
 * Runs a cycle every `intervalMs`, starting at once rather than after the first wait.
 *
 * The loop itself keeps the state and hands the latest one into every following cycle. The
 * caller does not have to manage it, and must not.
 */
export function startPilotLoop(
  deps: PilotCycleDeps,
  intervalMs: number,
  initialExecuteState: ExecuteState,
  options: PilotLoopOptions = {},
): PilotLoopHandle {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `pilot: the interval has to be a positive, finite number of milliseconds, and it is ${intervalMs}.`,
    );
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let killLatched = initialExecuteState.killed;
  let currentExecuteState = initialExecuteState;
  let lastResult: CycleResult | null = null;

  function withKillLatch(state: ExecuteState): ExecuteState {
    return killLatched && !state.killed ? { ...state, killed: true } : state;
  }

  async function persist(state: ExecuteState): Promise<void> {
    if (!options.saveExecuteState) return;
    try {
      await options.saveExecuteState(state);
    } catch (err) {
      logError(deps.logger, "pilot: the state could not be saved, the loop keeps running", {
        account: deps.account,
        error: toMessage(err),
      });
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, intervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const outcome = await runPilotCycle(deps, withKillLatch(currentExecuteState));
      currentExecuteState = withKillLatch(outcome.nextExecuteState);
      await persist(currentExecuteState);
      lastResult = outcome.result;
      if (deps.onCycle) {
        safeInvoke(() => deps.onCycle!(outcome.result));
      }
    } catch (err) {
      // A cycle should never reach here, but the loop must not die silently if it does.
      logError(deps.logger, "pilot: a cycle failed unexpectedly, moving on to the next one", {
        account: deps.account,
        error: toMessage(err),
      });
    } finally {
      // In `finally` on purpose: even a failure that escapes every guard above must not
      // stop the next cycle from being scheduled.
      scheduleNext();
    }
  }

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    kill: () => {
      killLatched = true;
      currentExecuteState = withKillLatch(currentExecuteState);
      logInfo(deps.logger, "pilot: the stop switch was pulled, nothing more is sent", {
        account: deps.account,
      });
      void persist(currentExecuteState);
    },
    isKilled: () => killLatched,
    getExecuteState: () => currentExecuteState,
    getLastResult: () => lastResult,
  };
}
