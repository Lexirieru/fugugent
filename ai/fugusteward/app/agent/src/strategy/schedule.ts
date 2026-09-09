/**
 * Working out what is due.
 *
 * A pure function of the schedule and the clock. No network, no model, no memory of what the
 * agent felt like doing last time. The same schedule at the same second always produces the
 * same answer, which is what makes a repeating payment something a person can check ahead of
 * time rather than after the money has gone.
 *
 * ## Periods are counted from a fixed point, not from the last run
 *
 * Every period starts at `anchor + index * interval`. An agent that was switched off for two
 * hours therefore comes back and finds it is late; it does not quietly move all future
 * payments two hours later. That is the difference between a monthly bill and a bill that
 * arrives whenever somebody remembers.
 *
 * ## Catching up is capped, on purpose
 *
 * An agent that has been down for a month has thirty payments waiting for it. Firing all
 * thirty the instant it comes back is exactly the shape of an accident that empties a
 * wallet, and it happens at the worst possible moment: right after something already went
 * wrong. So two limits apply.
 *
 *   1. `maxCatchUpPerCycle` says how many late periods may be paid in one cycle. One, by
 *      default. The backlog still gets paid, one per cycle, at the speed the operator can
 *      watch.
 *   2. `maxBacklogPeriods` says how far back the agent will look at all. Anything older than
 *      that is reported and NOT paid, because a payment a month late is a decision, not a
 *      chore, and a person should make it.
 *
 * Both refuse in the direction of doing too little. An agent that pays late is visibly late.
 * An agent that pays thirty times in one second is not visible until the money is gone.
 */
import { ScheduleError, type DueCharge, type Subscription } from "./types.js";

export interface ScheduleOptions {
  /** How many late periods may be paid in one cycle. */
  readonly maxCatchUpPerCycle: number;
  /** How far back the agent looks at all. Older than this is reported, never paid. */
  readonly maxBacklogPeriods: number;
}

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  maxCatchUpPerCycle: 1,
  maxBacklogPeriods: 3,
};

/** Checks a schedule before anything is worked out from it. */
export function assertSubscriptionIsSane(sub: Subscription): void {
  if (sub.id.length === 0) {
    throw new ScheduleError("A repeating payment with no name cannot be tracked, so it is refused.");
  }
  if (sub.agentId.length === 0) {
    throw new ScheduleError(
      `The repeating payment "${sub.id}" does not say which agent may pay it. On a wallet ` +
        "shared by several agents that is the same as saying any of them may.",
    );
  }
  if (!Number.isInteger(sub.anchorSeconds)) {
    throw new ScheduleError(
      `The repeating payment "${sub.id}" starts at ${sub.anchorSeconds}, which is not a whole second.`,
    );
  }
  if (!Number.isInteger(sub.intervalSeconds) || sub.intervalSeconds <= 0) {
    throw new ScheduleError(
      `The repeating payment "${sub.id}" repeats every ${sub.intervalSeconds} seconds, which is ` +
        "not a usable gap. A gap of zero would make every second its own payment.",
    );
  }
  if (sub.amountUsd8 <= 0n) {
    throw new ScheduleError(
      `The repeating payment "${sub.id}" is for ${sub.amountUsd8}, which is not a positive amount.`,
    );
  }
  if (sub.totalPeriods !== null && (!Number.isInteger(sub.totalPeriods) || sub.totalPeriods < 0)) {
    throw new ScheduleError(
      `The repeating payment "${sub.id}" says it runs for ${sub.totalPeriods} periods, which is ` +
        "not a whole count.",
    );
  }
}

export function assertScheduleOptionsAreSane(options: ScheduleOptions): void {
  if (!Number.isInteger(options.maxCatchUpPerCycle) || options.maxCatchUpPerCycle < 1) {
    throw new ScheduleError(
      `Catching up ${options.maxCatchUpPerCycle} periods per cycle is not a usable number. At ` +
        "least one, or the agent never catches up at all.",
    );
  }
  if (!Number.isInteger(options.maxBacklogPeriods) || options.maxBacklogPeriods < 1) {
    throw new ScheduleError(
      `Looking back ${options.maxBacklogPeriods} periods is not a usable number.`,
    );
  }
}

/** The second the given period starts. */
export function periodStartSeconds(sub: Subscription, periodIndex: number): number {
  return sub.anchorSeconds + periodIndex * sub.intervalSeconds;
}

/**
 * Which period is running at `nowSeconds`, counting from zero. Returns -1 when the first
 * period has not started yet.
 *
 * A period is due at its START. These are payments made in advance, the way a subscription
 * is: you pay for the month, then you get the month.
 */
export function currentPeriodIndex(sub: Subscription, nowSeconds: number): number {
  if (nowSeconds < sub.anchorSeconds) return -1;
  return Math.floor((nowSeconds - sub.anchorSeconds) / sub.intervalSeconds);
}

/** The last period this subscription will ever have, or null when it runs on forever. */
export function lastPeriodIndex(sub: Subscription): number | null {
  return sub.totalPeriods === null ? null : sub.totalPeriods - 1;
}

/** What the schedule found, including the part it refuses to act on. */
export interface DueResult {
  /** Periods to pay now, oldest first, capped by `maxCatchUpPerCycle`. */
  readonly due: readonly DueCharge[];
  /** Periods that are late but still inside the backlog the agent will look at. */
  readonly lateButWithinBacklog: number;
  /**
   * Periods so far behind that the agent refuses to pay them at all. Reported so an operator
   * sees them, never paid on their own.
   */
  readonly tooOldToPay: readonly number[];
}

/**
 * Works out what one subscription owes right now.
 *
 * `isSettled` is asked about every candidate period, and it has to answer true for anything
 * already paid OR already being paid. Both, not just paid: a payment in flight that this
 * function offered up again would be sent twice.
 */
export function dueCharges(
  sub: Subscription,
  nowSeconds: number,
  isSettled: (subscriptionId: string, periodIndex: number) => boolean,
  options: ScheduleOptions = DEFAULT_SCHEDULE_OPTIONS,
): DueResult {
  assertSubscriptionIsSane(sub);
  assertScheduleOptionsAreSane(options);

  const empty: DueResult = { due: [], lateButWithinBacklog: 0, tooOldToPay: [] };
  if (!sub.active) return empty;

  const current = currentPeriodIndex(sub, nowSeconds);
  if (current < 0) return empty;

  const last = lastPeriodIndex(sub);
  const highest = last === null ? current : Math.min(current, last);
  if (highest < 0) return empty;

  const oldestLookedAt = Math.max(0, current - options.maxBacklogPeriods);

  const tooOldToPay: number[] = [];
  for (let i = 0; i < oldestLookedAt; i++) {
    if (last !== null && i > last) break;
    if (!isSettled(sub.id, i)) tooOldToPay.push(i);
  }

  const due: DueCharge[] = [];
  let lateButWithinBacklog = 0;
  for (let i = oldestLookedAt; i <= highest; i++) {
    if (isSettled(sub.id, i)) continue;
    if (i < current) lateButWithinBacklog += 1;
    if (due.length < options.maxCatchUpPerCycle) {
      due.push({
        subscriptionId: sub.id,
        agentId: sub.agentId,
        periodIndex: i,
        payee: sub.payee,
        amountUsd8: sub.amountUsd8,
        call: sub.call,
        periodStartSeconds: periodStartSeconds(sub, i),
      });
    }
  }

  return { due, lateButWithinBacklog, tooOldToPay };
}

/**
 * The same across a whole list of subscriptions.
 *
 * The result is sorted by when the period started and then by the subscription's name, so two
 * runs over the same list in a different order pay things in the same order. Anything else
 * makes "what did it do and why" impossible to answer after the fact.
 */
export function dueChargesForAll(
  subs: readonly Subscription[],
  nowSeconds: number,
  isSettled: (subscriptionId: string, periodIndex: number) => boolean,
  options: ScheduleOptions = DEFAULT_SCHEDULE_OPTIONS,
): DueResult {
  const seen = new Set<string>();
  const due: DueCharge[] = [];
  let lateButWithinBacklog = 0;
  const tooOldToPay: number[] = [];

  for (const sub of subs) {
    if (seen.has(sub.id)) {
      throw new ScheduleError(
        `Two repeating payments both call themselves "${sub.id}". The record of what has been ` +
          "paid is kept by that name, so two of them would share one record and one of the two " +
          "would never be paid.",
      );
    }
    seen.add(sub.id);
    const result = dueCharges(sub, nowSeconds, isSettled, options);
    due.push(...result.due);
    lateButWithinBacklog += result.lateButWithinBacklog;
    tooOldToPay.push(...result.tooOldToPay);
  }

  due.sort((a, b) =>
    a.periodStartSeconds !== b.periodStartSeconds
      ? a.periodStartSeconds - b.periodStartSeconds
      : a.subscriptionId < b.subscriptionId
        ? -1
        : a.subscriptionId > b.subscriptionId
          ? 1
          : 0,
  );

  return { due, lateButWithinBacklog, tooOldToPay };
}
