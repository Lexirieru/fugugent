/**
 * The shapes Fugu Steward works with: what has been agreed to be paid, when, by which of the
 * agents sharing one wallet, and what has already been paid.
 *
 * Plain data with no behaviour, so the schedule and the scope checks can both stay pure
 * functions that never touch the network.
 *
 * All money is a whole number of hundred-millionths of a dollar, the same 8 decimal basis the
 * rest of this repo uses (100000000 = one dollar). Never a floating point number.
 */

/** One dollar, on the 8 decimal basis every money value in this agent uses. */
export const USD8_ONE = 100_000_000n;

/**
 * A payment that repeats.
 *
 * `anchorSeconds` is the start of the very first period, and every period after it starts
 * exactly `intervalSeconds` later. Anchoring to a fixed point rather than to "whenever the
 * agent last ran" is what stops the schedule drifting: an agent that is late by an hour has
 * to catch up, not move the next payment an hour later for ever.
 */
export interface Subscription {
  readonly id: string;
  /** Which of the agents sharing this wallet is allowed to pay it. */
  readonly agentId: string;
  readonly payee: `0x${string}`;
  readonly amountUsd8: bigint;
  /** The second the first period starts. */
  readonly anchorSeconds: number;
  readonly intervalSeconds: number;
  /** How many periods in total. Null means it repeats until somebody stops it. */
  readonly totalPeriods: number | null;
  /** A paused one is never due. Pausing is not the same as cancelling. */
  readonly active: boolean;
  /** The contract and method the payment goes through. Checked against the agent's scope. */
  readonly call: BoundCall;
}

/** One contract and one method on it. Half of either is not a permission. */
export interface BoundCall {
  readonly to: `0x${string}`;
  readonly signature: string;
}

/** One payment that is due: a subscription and which of its periods. */
export interface DueCharge {
  readonly subscriptionId: string;
  readonly agentId: string;
  readonly periodIndex: number;
  readonly payee: `0x${string}`;
  readonly amountUsd8: bigint;
  readonly call: BoundCall;
  /** The second this period started. What makes the payment identifiable after the fact. */
  readonly periodStartSeconds: number;
}

export class ScheduleError extends Error {
  /** Raised while reading a schedule, long before anything could be sent. */
  readonly neverSent = true as const;
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}
