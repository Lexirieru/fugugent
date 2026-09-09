/**
 * The cycle that actually runs: collect what was used, count it, price it, pay it inside the
 * limits, record what happened. And then again.
 *
 * There is no new counting, pricing or paying logic here. What this file is about is the two
 * mistakes Fugu Guardian paid for, both of which apply in full to an agent that pays over
 * and over with nobody approving each payment:
 *
 * 1. **The state flows through the types, not through somebody's memory.** Guardian's first
 *    loop threw away the state its sending step returned, so the daily budget and the
 *    waiting time never moved. Here the cycle takes the state as an argument and hands the
 *    next one back, and the loop is the one place that keeps it between cycles.
 *
 * 2. **A payment that failed after touching the network still advances the state.** Waiting
 *    for a result can time out after the transaction already landed; keeping the old state
 *    means the next cycle pays the same bill again. The failure carrying a state is
 *    recognised by a marker on the object rather than by its class, so a wrapper somewhere
 *    upstream cannot silently break it.
 *
 * A cycle never throws. Not for a failed collection, not for a broken price ladder, not for
 * a failed payment, and not for a failure inside the clock or the logger either.
 *
 * ## The stretch of time each cycle bills
 *
 * From the mark of what has already been billed, up to now. That mark is part of the state
 * and is written before the payment goes out, which is what makes this survive a restart:
 * a process that dies mid payment comes back with those seconds already marked, so it cannot
 * count them a second time.
 */
import { asPaymentFailure, payInvoice, type ExecuteResult, type ExecuteState } from "./execute.js";
import { readMeter } from "./meter.js";
import { rate } from "./rating.js";
import type { Invoice, Tariff, UsageReading, UsageRecord } from "./types.js";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Collects the usage records for a stretch of time. Handed in, so tests never touch the network. */
export type CollectUsageFn = (fromSeconds: number, toSeconds: number) => Promise<readonly UsageRecord[]>;

/**
 * How the cycle asks for a bill to be paid. This is the real `payInvoice` with the limits
 * and the paying function already filled in AND NOTHING ELSE. The state is passed in
 * explicitly on every call rather than captured by the caller's closure:
 *
 * ```ts
 * const payFn: PayFn = (invoice, state) => payInvoice(invoice, limits, state, payDeps);
 * ```
 */
export type PayFn = (invoice: Invoice, state: ExecuteState) => Promise<ExecuteResult>;

export interface MeterCycleDeps {
  readonly meterId: string;
  readonly collectUsage: CollectUsageFn;
  readonly tariffs: readonly Tariff[];
  readonly payInvoice: PayFn;
  /** The clock in seconds. Handed in so time is fully controllable in tests. */
  readonly now: () => number;
  readonly logger: Logger;
  readonly onCycle?: (result: CycleResult) => void;
}

export interface CycleSuccess {
  readonly ok: true;
  readonly timestamp: number;
  readonly meterId: string;
  readonly windowFromSeconds: number;
  readonly windowToSeconds: number;
  readonly counted: number;
  readonly duplicates: number;
  readonly outsideWindow: number;
  readonly totalUsd8: bigint;
  readonly paid: boolean;
  readonly amountPaidUsd8: bigint;
  readonly txHash: `0x${string}` | null;
  /** Why it was paid or was not. */
  readonly reason: string;
}

export interface CycleFailure {
  readonly ok: false;
  readonly timestamp: number;
  readonly meterId: string;
  readonly error: string;
}

export type CycleResult = CycleSuccess | CycleFailure;

export interface MeterCycleOutcome {
  readonly result: CycleResult;
  /**
   * The state for the NEXT cycle. The same one that came in when this cycle failed before it
   * could pay, and the advanced one when the payment may already have gone out. The caller
   * has to use this value, never the one it passed in.
   */
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

/** Runs one cycle: collect, count, price, pay. Never throws. */
export async function runMeterCycle(
  deps: MeterCycleDeps,
  executeState: ExecuteState,
): Promise<MeterCycleOutcome> {
  let timestamp: number;
  try {
    timestamp = deps.now();
  } catch (err) {
    logError(deps.logger, "meter: the clock failed, cycle skipped", {
      meterId: deps.meterId,
      error: toMessage(err),
    });
    // Unlike the other agents, this one cannot carry on without a clock: the stretch of time
    // to bill is defined by it, and billing a made up stretch of time would move money.
    return {
      result: { ok: false, timestamp: 0, meterId: deps.meterId, error: toMessage(err) },
      nextExecuteState: executeState,
    };
  }

  const fromSeconds = executeState.billedThroughSeconds;
  const toSeconds = timestamp;

  if (toSeconds <= fromSeconds) {
    // The clock did not move, or moved backwards. Billing nothing is right, and billing a
    // stretch that runs backwards would be worse than doing nothing.
    return {
      result: {
        ok: true,
        timestamp,
        meterId: deps.meterId,
        windowFromSeconds: fromSeconds,
        windowToSeconds: toSeconds,
        counted: 0,
        duplicates: 0,
        outsideWindow: 0,
        totalUsd8: 0n,
        paid: false,
        amountPaidUsd8: 0n,
        txHash: null,
        reason: "No time has passed since the last bill, so there is nothing to count.",
      },
      nextExecuteState: executeState,
    };
  }

  let records: readonly UsageRecord[];
  try {
    records = await deps.collectUsage(fromSeconds, toSeconds);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "meter: could not collect what was used, cycle skipped", {
      meterId: deps.meterId,
      error,
    });
    return {
      result: { ok: false, timestamp, meterId: deps.meterId, error },
      nextExecuteState: executeState,
    };
  }

  let reading: UsageReading;
  let invoice: Invoice;
  try {
    reading = readMeter(records, { fromSeconds, toSeconds });
    invoice = rate(reading, deps.tariffs);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "meter: could not work out what is owed, cycle skipped", {
      meterId: deps.meterId,
      error,
    });
    return {
      result: { ok: false, timestamp, meterId: deps.meterId, error },
      nextExecuteState: executeState,
    };
  }

  let payResult: ExecuteResult;
  try {
    payResult = await deps.payInvoice(invoice, executeState);
  } catch (err) {
    const error = toMessage(err);
    // Recognised by a marker on the object, NOT by its class. See the note in execute.ts.
    const failureAfterSend = asPaymentFailure(err);
    if (failureAfterSend !== null) {
      logError(deps.logger, "meter: the payment failed AFTER it may have gone out", {
        meterId: deps.meterId,
        error,
        note:
          "the budget and the mark of what has been billed are still moved, and the payment " +
          "is recorded as in flight until the blockchain shows it done",
      });
      return {
        result: { ok: false, timestamp, meterId: deps.meterId, error },
        nextExecuteState: failureAfterSend.stateAfterSend,
      };
    }
    logError(deps.logger, "meter: the payment failed, cycle skipped", {
      meterId: deps.meterId,
      error,
    });
    return {
      result: { ok: false, timestamp, meterId: deps.meterId, error },
      nextExecuteState: executeState,
    };
  }

  return {
    result: {
      ok: true,
      timestamp,
      meterId: deps.meterId,
      windowFromSeconds: fromSeconds,
      windowToSeconds: toSeconds,
      counted: reading.counted,
      duplicates: reading.duplicates,
      outsideWindow: reading.outsideWindow,
      totalUsd8: invoice.totalUsd8,
      paid: payResult.paid,
      amountPaidUsd8: payResult.amountPaidUsd8,
      txHash: payResult.txHash,
      reason: payResult.reason,
    },
    nextExecuteState: payResult.state,
  };
}

export interface MeterLoopOptions {
  /**
   * Saves the state every time it changes. Its failures are logged and never stop the loop:
   * a full disk must not make the agent stop, and it must not be hidden either.
   */
  readonly saveExecuteState?: (state: ExecuteState) => Promise<void> | void;
}

export interface MeterLoopHandle {
  stop: () => void;
  /**
   * The stop switch, as a real lever rather than a field on the starting state. A one way
   * latch: a cycle already running when it is pulled finishes with a state that still says
   * the switch is off, and that must not undo the pull.
   */
  kill: () => void;
  isKilled: () => boolean;
  getExecuteState: () => ExecuteState;
  getLastResult: () => CycleResult | null;
}

export function startMeterLoop(
  deps: MeterCycleDeps,
  intervalMs: number,
  initialExecuteState: ExecuteState,
  options: MeterLoopOptions = {},
): MeterLoopHandle {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `meter: the interval has to be a positive, finite number of milliseconds, and it is ${intervalMs}.`,
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
      logError(deps.logger, "meter: the state could not be saved, the loop keeps running", {
        meterId: deps.meterId,
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
      const outcome = await runMeterCycle(deps, withKillLatch(currentExecuteState));
      currentExecuteState = withKillLatch(outcome.nextExecuteState);
      await persist(currentExecuteState);
      lastResult = outcome.result;
      if (deps.onCycle) {
        safeInvoke(() => deps.onCycle!(outcome.result));
      }
    } catch (err) {
      logError(deps.logger, "meter: a cycle failed unexpectedly, moving on to the next one", {
        meterId: deps.meterId,
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
      logInfo(deps.logger, "meter: the stop switch was pulled, nothing more is paid", {
        meterId: deps.meterId,
      });
      void persist(currentExecuteState);
    },
    isKilled: () => killLatched,
    getExecuteState: () => currentExecuteState,
    getLastResult: () => lastResult,
  };
}
