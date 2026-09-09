/**
 * The cycle that actually runs: work out what is due, pay the oldest one that is due, record
 * it. And then again.
 *
 * ## One payment per cycle
 *
 * On purpose, and it is the same reasoning as capping how far the agent catches up. A cycle
 * that paid everything it found would, on the first run after a long outage, send every
 * missed payment in one burst. One per cycle means the backlog still clears, at a speed an
 * operator can watch, and the stop switch can be pulled between any two of them.
 *
 * ## What this file inherits from Fugu Guardian
 *
 * Two mistakes that were paid for once:
 *
 * 1. **The state flows through the types.** The cycle takes it as an argument and hands the
 *    next one back; the loop is the one place that keeps it. Guardian's first loop threw the
 *    returned state away, so its budget and waiting time never moved.
 *
 * 2. **A payment that failed after touching the network still advances the state.** The
 *    failure carrying a state is recognised by a marker on the object rather than by its
 *    class, so a wrapper somewhere upstream cannot silently break it.
 *
 * A cycle never throws. Not for a broken schedule, not for a failed payment, and not for a
 * failure inside the clock or the logger either.
 */
import { asPaymentFailure, type ExecuteResult, type ExecuteState } from "./execute.js";
import { isSettled } from "./ledger.js";
import { dueChargesForAll, DEFAULT_SCHEDULE_OPTIONS, type ScheduleOptions } from "./schedule.js";
import type { ScopeRegistry } from "./scope.js";
import type { DueCharge, Subscription } from "./types.js";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * How the cycle asks for one charge to be paid. This is the real `payCharge` with the scope
 * registry, the timing and the paying function already filled in AND NOTHING ELSE. The state
 * is passed in explicitly on every call:
 *
 * ```ts
 * const payFn: PayFn = (charge, state) => payCharge(charge, registry, timing, state, payDeps);
 * ```
 */
export type PayFn = (charge: DueCharge, state: ExecuteState) => Promise<ExecuteResult>;

export interface StewardCycleDeps {
  readonly walletLabel: string;
  /** Reads the current list of repeating payments. Handed in, so tests never touch the network. */
  readonly loadSubscriptions: () => Promise<readonly Subscription[]>;
  readonly registry: ScopeRegistry;
  readonly payCharge: PayFn;
  readonly now: () => number;
  readonly logger: Logger;
  readonly scheduleOptions?: ScheduleOptions;
  readonly onCycle?: (result: CycleResult) => void;
}

export interface CycleSuccess {
  readonly ok: true;
  readonly timestamp: number;
  readonly walletLabel: string;
  /** How many periods were due and unpaid inside the backlog the agent looks at. */
  readonly dueCount: number;
  /** How many were late but still inside that backlog. */
  readonly lateCount: number;
  /** Periods so far behind that the agent refuses to pay them without a person. */
  readonly tooOldToPay: number;
  readonly charge: DueCharge | null;
  readonly paid: boolean;
  readonly amountPaidUsd8: bigint;
  readonly txHash: `0x${string}` | null;
  readonly reason: string;
}

export interface CycleFailure {
  readonly ok: false;
  readonly timestamp: number;
  readonly walletLabel: string;
  readonly error: string;
}

export type CycleResult = CycleSuccess | CycleFailure;

export interface StewardCycleOutcome {
  readonly result: CycleResult;
  /** The state for the NEXT cycle. The caller has to use this, never the one it passed in. */
  readonly nextExecuteState: ExecuteState;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

export async function runStewardCycle(
  deps: StewardCycleDeps,
  executeState: ExecuteState,
): Promise<StewardCycleOutcome> {
  let timestamp: number;
  try {
    timestamp = deps.now();
  } catch (err) {
    // A schedule is defined by time, so a broken clock means the agent does not know what is
    // due. Guessing here would move money on a made up date.
    logError(deps.logger, "steward: the clock failed, cycle skipped", {
      wallet: deps.walletLabel,
      error: toMessage(err),
    });
    return {
      result: { ok: false, timestamp: 0, walletLabel: deps.walletLabel, error: toMessage(err) },
      nextExecuteState: executeState,
    };
  }

  let subscriptions: readonly Subscription[];
  try {
    subscriptions = await deps.loadSubscriptions();
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "steward: could not read the repeating payments, cycle skipped", {
      wallet: deps.walletLabel,
      error,
    });
    return {
      result: { ok: false, timestamp, walletLabel: deps.walletLabel, error },
      nextExecuteState: executeState,
    };
  }

  const options = deps.scheduleOptions ?? DEFAULT_SCHEDULE_OPTIONS;
  let due;
  try {
    due = dueChargesForAll(
      subscriptions,
      timestamp,
      (subId, index) => isSettled(executeState.ledger, subId, index),
      options,
    );
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "steward: could not work out what is due, cycle skipped", {
      wallet: deps.walletLabel,
      error,
    });
    return {
      result: { ok: false, timestamp, walletLabel: deps.walletLabel, error },
      nextExecuteState: executeState,
    };
  }

  if (due.tooOldToPay.length > 0) {
    // Reported every cycle, never paid on its own. A payment a month late is a decision, and
    // a person makes decisions.
    logError(deps.logger, "steward: some payments are too far behind to be made without a person", {
      wallet: deps.walletLabel,
      periods: due.tooOldToPay,
    });
  }

  if (due.due.length === 0) {
    return {
      result: {
        ok: true,
        timestamp,
        walletLabel: deps.walletLabel,
        dueCount: 0,
        lateCount: due.lateButWithinBacklog,
        tooOldToPay: due.tooOldToPay.length,
        charge: null,
        paid: false,
        amountPaidUsd8: 0n,
        txHash: null,
        reason: "Nothing is due.",
      },
      nextExecuteState: executeState,
    };
  }

  // One per cycle: the oldest. See the note at the top of this file.
  const charge = due.due[0]!;

  let payResult: ExecuteResult;
  try {
    payResult = await deps.payCharge(charge, executeState);
  } catch (err) {
    const error = toMessage(err);
    // Recognised by a marker on the object, NOT by its class. See the note in execute.ts.
    const failureAfterSend = asPaymentFailure(err);
    if (failureAfterSend !== null) {
      logError(deps.logger, "steward: the payment failed AFTER it may have gone out", {
        wallet: deps.walletLabel,
        subscription: charge.subscriptionId,
        period: charge.periodIndex,
        error,
        note:
          "the budget has moved and the period is recorded as being paid until somebody has " +
          "checked the blockchain",
      });
      return {
        result: { ok: false, timestamp, walletLabel: deps.walletLabel, error },
        nextExecuteState: failureAfterSend.stateAfterSend,
      };
    }
    logError(deps.logger, "steward: the payment failed, cycle skipped", {
      wallet: deps.walletLabel,
      subscription: charge.subscriptionId,
      period: charge.periodIndex,
      error,
    });
    return {
      result: { ok: false, timestamp, walletLabel: deps.walletLabel, error },
      nextExecuteState: executeState,
    };
  }

  return {
    result: {
      ok: true,
      timestamp,
      walletLabel: deps.walletLabel,
      dueCount: due.due.length,
      lateCount: due.lateButWithinBacklog,
      tooOldToPay: due.tooOldToPay.length,
      charge,
      paid: payResult.paid,
      amountPaidUsd8: payResult.amountPaidUsd8,
      txHash: payResult.txHash,
      reason: payResult.reason,
    },
    nextExecuteState: payResult.state,
  };
}

export interface StewardLoopOptions {
  readonly saveExecuteState?: (state: ExecuteState) => Promise<void> | void;
}

export interface StewardLoopHandle {
  stop: () => void;
  /**
   * The stop switch, as a real lever. A one way latch: a cycle already running when it is
   * pulled finishes with a state that still says the switch is off, and that must not undo
   * the pull.
   */
  kill: () => void;
  isKilled: () => boolean;
  getExecuteState: () => ExecuteState;
  getLastResult: () => CycleResult | null;
}

export function startStewardLoop(
  deps: StewardCycleDeps,
  intervalMs: number,
  initialExecuteState: ExecuteState,
  options: StewardLoopOptions = {},
): StewardLoopHandle {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `steward: the interval has to be a positive, finite number of milliseconds, and it is ${intervalMs}.`,
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
      logError(deps.logger, "steward: the state could not be saved, the loop keeps running", {
        wallet: deps.walletLabel,
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
      const outcome = await runStewardCycle(deps, withKillLatch(currentExecuteState));
      currentExecuteState = withKillLatch(outcome.nextExecuteState);
      await persist(currentExecuteState);
      lastResult = outcome.result;
      if (deps.onCycle) {
        safeInvoke(() => deps.onCycle!(outcome.result));
      }
    } catch (err) {
      logError(deps.logger, "steward: a cycle failed unexpectedly, moving on to the next one", {
        wallet: deps.walletLabel,
        error: toMessage(err),
      });
    } finally {
      // In `finally` on purpose: even a failure that escapes every guard above must not stop
      // the next cycle from being scheduled.
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
      logInfo(deps.logger, "steward: the stop switch was pulled, nothing more is paid", {
        wallet: deps.walletLabel,
      });
      void persist(currentExecuteState);
    },
    isKilled: () => killLatched,
    getExecuteState: () => currentExecuteState,
    getLastResult: () => lastResult,
  };
}
