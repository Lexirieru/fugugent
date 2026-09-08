/**
 * The Guardian monitoring loop. It wires the existing modules — `decide`,
 * `executeDecision`, `explainDecision`, the position reader — into one cycle that
 * actually runs, then calls it repeatedly.
 *
 * There is no new decision or execution logic here: `runGuardCycle` purely runs read
 * position -> `decide` -> `executeDecision` -> then `explainDecision`, and turns the
 * result into a single record.
 *
 * RULES THAT MUST NOT BE BROKEN:
 *
 * 1. A cycle NEVER throws — not only for a failed position read/`decide`/execution, but
 *    also for a failure in `now()` or `logger` itself (first fix round: a `logger` that
 *    threw EPIPE used to make `tick()` die silently because `scheduleNext()` was skipped).
 *    Every logger call goes through `logInfo`/`logError`, which swallow exceptions, and
 *    `deps.now()` has a fallback if it fails.
 * 2. `explainDecision` is called AFTER execution finishes, never before — the execution
 *    result is already final before the explanation sentence is composed. Its failure
 *    NEVER changes the `action`/`amountSentUsd8`/`txHash` that already happened. For a
 *    `NONE` action it is skipped entirely — dGrid takes 3–46 seconds for a sentence nobody
 *    reads when the position is healthy (CLAUDE.md #1: dGrid is never on the critical
 *    path).
 * 3. The execution state (`ExecuteState` from `execute.ts`: the daily budget, the
 *    cooldown, the kill switch) FLOWS explicitly through the types — `runGuardCycle`
 *    takes it as a parameter and returns the new version via `nextExecuteState`;
 *    `startGuardLoop` is what holds it between cycles. This fixes a first-round defect: a
 *    caller closure that "has to remember" to keep `execResult.state` made the daily cap
 *    and the cooldown die completely as soon as the loop ran more than one cycle.
 * 4. An execution that FAILS AFTER touching the network (`RepaySendError`) STILL advances
 *    the state. The previous round returned the old state on every failure path — correct
 *    for a failure before sending, and dangerous for one after: a timed-out receipt leaves
 *    the budget and cooldown untouched, and the next cycle pays again. See the full note at
 *    the top of `execute.ts`.
 */
import { decide } from "./decide.js";
import { formatHf, formatUsd8 } from "./format.js";
import type { Action, Decision, Position, Thresholds } from "./types.js";
import { asRepaySendFailure, type ExecuteResult, type ExecuteState } from "./execute.js";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Reads the current position from the chain; injected so tests never touch the network. */
export type ReadPositionFn = (account: `0x${string}`) => Promise<Position>;

/**
 * The shape `runGuardCycle` uses to invoke execution. This is the real `executeDecision`
 * from `execute.ts`, partially applied by the caller for `limits` and `ExecuteDeps`
 * (`sendRepay`/`now`) ONLY — `state` is NOT captured by the caller's closure, it is passed
 * explicitly by `runGuardCycle` on every call (see note C1 above). The correct wiring on
 * the caller's side:
 *
 * ```ts
 * const execFn: ExecuteFn = (decision, pos, state) =>
 *   executeDecision(decision, pos, limits, state, execDeps);
 * ```
 */
export type ExecuteFn = (
  decision: Decision,
  pos: Position,
  state: ExecuteState,
) => Promise<ExecuteResult>;

/** The real `explainDecision`, called after execution (and skipped for a `NONE` action). */
export type ExplainFn = (pos: Position, decision: Decision) => Promise<string>;

export interface GuardCycleDeps {
  account: `0x${string}`;
  readPosition: ReadPositionFn;
  executeDecision: ExecuteFn;
  explainDecision: ExplainFn;
  /** The current clock in epoch seconds; injected so time is fully controllable in tests. */
  now: () => number;
  logger: Logger;
  /** Optional thresholds for `decide`; defaults to `DEFAULT_THRESHOLDS` when omitted. */
  thresholds?: Thresholds;
  /**
   * Called after every cycle (successful or failed) with the full record — used by
   * `startGuardLoop` so records do not get "lost" inside the loop (first round: `tick()`
   * simply threw away `runGuardCycle`'s return value). A failure in this callback never
   * stops the loop.
   */
  onCycle?: (result: CycleResult) => void;
}

/** The record of one cycle that ran to completion. */
export interface CycleSuccess {
  ok: true;
  timestamp: number;
  account: `0x${string}`;
  healthFactor: bigint | null;
  action: Action;
  /** true when a repay transaction was actually sent on this cycle. */
  sent: boolean;
  amountSentUsd8: bigint;
  /** true when the amount was capped by the per-action limit (see `execute.ts`). */
  cappedPerAction: boolean;
  /** true when the amount was capped by what is left of the daily budget (see `execute.ts`). */
  cappedPerDay: boolean;
  txHash: `0x${string}` | null;
  /**
   * The DECISION reason — why `decide` chose this `action` (`decision.reason`).
   * NOT the same as `executeReason` below: an `EMERGENCY` that is correct as a decision
   * can still end up `sent: false` because of the kill switch, the cooldown, or an
   * exhausted budget — and that is only visible in `executeReason`.
   */
  reason: string;
  /** The EXECUTION reason — why it was sent, not sent, or capped (`ExecuteResult.reason`). */
  executeReason: string;
  explanation: string;
}

/**
 * The record of a cycle that failed at one of its stages (position read, `decide`, or
 * execution). A failed cycle STILL produces a record — it never throws to the caller.
 */
export interface CycleFailure {
  ok: false;
  timestamp: number;
  account: `0x${string}`;
  error: string;
}

export type CycleResult = CycleSuccess | CycleFailure;

/** The result of one `runGuardCycle` call: the cycle record plus the execution state that must be carried into the next cycle. */
export interface GuardCycleOutcome {
  result: CycleResult;
  /**
   * The execution state for the NEXT cycle. Identical to the `executeState` input when
   * this cycle failed before it could execute (a failed position read/`decide`) or when
   * `executeDecision` itself threw (following the `execute.ts` contract: the budget only
   * changes after a send actually succeeds). The caller MUST use this value, not the old
   * `executeState`, on the next call.
   */
  nextExecuteState: ExecuteState;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Logging that never throws. `logger` is an injected dependency (it might write to a pipe,
 * a file, or an external service) — its failures (closed pipe -> EPIPE, full disk, and so
 * on) must NEVER stop Guardian. The first round missed this: a `logger.error` that threw
 * inside `tick()`'s `catch` block meant `scheduleNext()` was never reached, so the loop
 * died silently with no trace at all — exactly the failure this task exists to prevent.
 */
export function logInfo(logger: Logger, message: string, meta?: Record<string, unknown>): void {
  try {
    logger.info(message, meta);
  } catch {
    // Logging must never be the reason Guardian stops working.
  }
}

export function logError(logger: Logger, message: string, meta?: Record<string, unknown>): void {
  try {
    logger.error(message, meta);
  } catch {
    // Same as above.
  }
}

/** Calls a caller-injected callback without letting its failure propagate. */
function safeInvoke(fn: () => void): void {
  try {
    fn();
  } catch {
    // An outside callback must never kill the loop.
  }
}

/**
 * Runs one monitoring cycle: read position -> `decide` -> `executeDecision` ->
 * `explainDecision` (skipped for `NONE`). Never throws; every failure — including
 * `deps.now()` or `deps.logger` itself failing — produces a `CycleResult` with
 * `ok: false` and a record that is still complete, so the caller (`startGuardLoop`) can
 * always move on to the next cycle.
 *
 * `executeState` flows explicitly: the new value is always in `outcome.nextExecuteState`,
 * and the caller (including `startGuardLoop` itself) is responsible for passing it to the
 * next call — see the note at the top of this module about why this must not be a
 * convention the wiring code "remembers on its own".
 */
export async function runGuardCycle(
  deps: GuardCycleDeps,
  executeState: ExecuteState,
): Promise<GuardCycleOutcome> {
  let timestamp: number;
  try {
    timestamp = deps.now();
  } catch (err) {
    // A failing `now()` is a small dependency failure, not a reason to stop protecting
    // the position — use a fallback timestamp and carry on.
    logError(deps.logger, "guard: now() failed, using a fallback timestamp", {
      account: deps.account,
      error: toMessage(err),
    });
    timestamp = 0;
  }

  let pos: Position;
  try {
    pos = await deps.readPosition(deps.account);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "guard: failed to read the position, cycle skipped", {
      account: deps.account,
      error,
    });
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  let decision: Decision;
  try {
    decision = decide(pos, deps.thresholds);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "guard: decide failed, cycle skipped", {
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
    execResult = await deps.executeDecision(decision, pos, executeState);
  } catch (err) {
    const error = toMessage(err);
    // Recognized by a duck-typed marker, NOT `instanceof`: a wrapper around
    // `executeDecision` in the backend (telemetry, retry, tracing) that rethrows a
    // different error — or two copies of the `execute.js` module in the dependency tree —
    // would make `instanceof` fail SILENTLY, and the branch below would return the old
    // state. That is bug C2 coming back without a single test shouting.
    // `asRepaySendFailure` also walks the `cause` chain.
    const failureAfterSend = asRepaySendFailure(err);
    if (failureAfterSend !== null) {
      // The transaction MAY already have landed — only reading its result failed. The
      // state carried by this error has already deducted the budget, started the cooldown,
      // and recorded the repay as pending; passing it along is the only thing that stops
      // the next cycle from paying a second time. Returning the old `executeState` here is
      // bug C2.
      logError(deps.logger, "guard: the repay send failed AFTER it may have been sent", {
        account: deps.account,
        action: decision.action,
        error,
        note:
          "the budget and cooldown are still charged; the repay is recorded as pending until " +
          "the chain shows the debt reduced",
      });
      return {
        result: { ok: false, timestamp, account: deps.account, error },
        nextExecuteState: failureAfterSend.stateAfterSend,
      };
    }
    logError(deps.logger, "guard: execution failed, cycle skipped", {
      account: deps.account,
      action: decision.action,
      error,
    });
    // A failure that happened BEFORE anything touched the network (or before
    // `executeDecision` got to send): nothing changed on chain, so the old state is passed
    // through as-is.
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  // At this point execution is final. Whatever happens below with the explanation NEVER
  // changes the `execResult` or `decision` above.
  let explanation: string;
  if (decision.action === "NONE") {
    // There is nothing to explain about a safe position, and calling dGrid here would
    // only add 3–46 seconds to the most common cycle (a healthy position) for a sentence
    // nobody reads.
    explanation = decision.reason;
  } else {
    try {
      explanation = await deps.explainDecision(pos, decision);
    } catch (err) {
      logError(deps.logger, "guard: the explanation failed, using the raw reason", {
        account: deps.account,
        error: toMessage(err),
      });
      explanation = decision.reason;
    }
  }

  return {
    result: {
      ok: true,
      timestamp,
      account: deps.account,
      healthFactor: decision.healthFactor,
      action: decision.action,
      sent: execResult.sent,
      amountSentUsd8: execResult.amountSentUsd8,
      cappedPerAction: execResult.cappedPerAction,
      cappedPerDay: execResult.cappedPerDay,
      txHash: execResult.txHash,
      reason: decision.reason,
      executeReason: execResult.reason,
      explanation,
    },
    nextExecuteState: execResult.state,
  };
}

/** Writes one cycle's record to the logger, with USD/HF values already formatted (never the raw basis). */
function logCycleResult(logger: Logger, result: CycleResult): void {
  if (!result.ok) {
    logError(logger, "guard: cycle failed", {
      account: result.account,
      timestamp: result.timestamp,
      error: result.error,
    });
    return;
  }

  logInfo(logger, "guard: cycle finished", {
    account: result.account,
    timestamp: result.timestamp,
    action: result.action,
    healthFactor: result.healthFactor === null ? "no debt" : formatHf(result.healthFactor),
    sent: result.sent,
    amountSentUsd8: formatUsd8(result.amountSentUsd8),
    cappedPerAction: result.cappedPerAction,
    cappedPerDay: result.cappedPerDay,
    txHash: result.txHash,
    decisionReason: result.reason,
    executeReason: result.executeReason,
    explanation: result.explanation,
  });
}

export interface GuardLoopOptions {
  /**
   * Persists `ExecuteState` every time it changes — after every cycle AND immediately
   * after `kill()`. Injected as a function rather than a concrete store so the backend can
   * plug in Postgres without touching this module (`state/store.ts` provides JSON-file and
   * in-memory implementations).
   *
   * Its failures are logged and NEVER stop the loop: a full disk must not make Guardian
   * stop protecting a position. It is reported, not hidden.
   */
  saveExecuteState?: (state: ExecuteState) => Promise<void> | void;
}

export interface GuardLoopHandle {
  /** Stops the loop immediately. A cycle already in flight is left to finish, but no new cycle is scheduled after it. */
  stop: () => void;
  /**
   * The kill switch as a REAL LEVER, not just a field on the initial state.
   *
   * Before this, `killed` could only be true if it was ALREADY true before the loop
   * started — there was no way to pull it while the agent was running, even though the
   * product doc calls it "the user's way out". `kill()` closes that: it sets `killed`
   * immediately, persists it, and from that moment every following cycle is refused by
   * `executeDecision` on its first rule.
   *
   * This is a ONE-WAY LATCH. A cycle already in flight when `kill()` is called will finish
   * with a state that still says `killed: false`; that result MUST NOT undo the kill. That
   * is why the kill is recorded separately and OR-ed into every incoming state.
   *
   * `kill()` does not stop the loop: monitoring and logging keep running, what stops is
   * sending transactions. To stop entirely, call `stop()` as well.
   */
  kill: () => void;
  /** Whether the kill switch has been pulled. */
  isKilled: () => boolean;
  /** The current execution state (budget, cooldown, kill switch, pending repay). */
  getExecuteState: () => ExecuteState;
  /** The record of the last completed cycle, or `null` when none has completed yet. */
  getLastResult: () => CycleResult | null;
}

/**
 * Runs `runGuardCycle` repeatedly every `intervalMs`, starting immediately (it does not
 * wait out the first interval). `initialExecuteState` is the starting execution state (the
 * daily budget, the cooldown, the kill switch); `startGuardLoop` itself holds and passes
 * the latest version into every following cycle via `outcome.nextExecuteState` — the
 * caller does not need to (and must not) manage that state itself any more.
 *
 * Returns a handle that can be stopped at any time — by a user (a process-level kill
 * switch) or by a test, with no need to wait for the next cycle. If `stop()` is called
 * while a cycle is in flight, that cycle is left to finish but no new cycle is scheduled
 * after it.
 *
 * `runGuardCycle` is itself guaranteed not to throw (including `now()`/`logger`
 * failures), but `tick()` still wraps it in try/finally as a second layer of defense:
 * `scheduleNext()` lives in the `finally` block, so even an unexpected failure that
 * escapes every guard above never stops the next cycle from being scheduled.
 */
export function startGuardLoop(
  deps: GuardCycleDeps,
  intervalMs: number,
  initialExecuteState: ExecuteState,
  options: GuardLoopOptions = {},
): GuardLoopHandle {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `guard: intervalMs must be a positive, finite number, received ${intervalMs}.`,
    );
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The one-way kill latch, kept separate from the cycle state: the result of a cycle
  // that started before `kill()` must not set `killed` back to false.
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
      logError(deps.logger, "guard: failed to save the execution state, the loop keeps running", {
        account: deps.account,
        error: toMessage(err),
      });
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      // The timer has fired and is no longer valid to `clearTimeout` -- null it out before
      // `tick()` so a `stop()` called afterwards is not holding a stale id (harmless, but
      // untidy).
      timer = null;
      void tick();
    }, intervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const outcome = await runGuardCycle(deps, withKillLatch(currentExecuteState));
      currentExecuteState = withKillLatch(outcome.nextExecuteState);
      await persist(currentExecuteState);
      lastResult = outcome.result;
      logCycleResult(deps.logger, outcome.result);
      if (deps.onCycle) {
        safeInvoke(() => deps.onCycle!(outcome.result));
      }
    } catch (err) {
      // `runGuardCycle` should never reach here, but the loop must not die silently even
      // if it does (defense in depth).
      logError(deps.logger, "guard: the cycle threw unexpectedly in the loop, continuing to the next cycle", {
        account: deps.account,
        error: toMessage(err),
      });
    } finally {
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
      logInfo(deps.logger, "guard: kill switch pulled, no new transaction is sent", {
        account: deps.account,
      });
      // Persisted in the background: `kill()` must take effect in memory immediately, and
      // persisting it must not make the caller wait on I/O.
      void persist(currentExecuteState);
    },
    isKilled: () => killLatched,
    getExecuteState: () => currentExecuteState,
    getLastResult: () => lastResult,
  };
}
