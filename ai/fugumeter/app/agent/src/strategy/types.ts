/**
 * The shapes Fugu Meter works with: what was used, what it costs, and what the bill comes
 * to. Plain data with no behaviour, so the counting and the pricing can both stay pure
 * functions that never touch the network.
 *
 * All money is a whole number of hundred-millionths of a dollar, the same 8 decimal basis
 * the rest of this repo uses (100000000 = one dollar). Never a floating point number. A
 * meter adds up thousands of tiny amounts, and a floating point number loses its smallest
 * digits on every addition, so the error grows with use. That is the one shape of error a
 * meter must not have.
 */

/** One dollar, on the 8 decimal basis every money value in this agent uses. */
export const USD8_ONE = 100_000_000n;

/** What is being counted. */
export type Unit =
  /** One request answered. */
  | "CALL"
  /** One second of something running. */
  | "SECOND"
  /** One of whatever the seller counts: a token, a row, a page. */
  | "UNIT";

/**
 * One thing that happened, reported by whatever is being metered.
 *
 * `id` is what makes this safe to report more than once. A client that retries after a
 * timeout will send the same record again, and a meter that counts it twice pays twice for
 * one thing. The id is the only defence against that, so it is required rather than
 * optional.
 */
export interface UsageRecord {
  readonly id: string;
  readonly unit: Unit;
  /** How much. Never negative: a correction is a separate record, not a negative one. */
  readonly quantity: bigint;
  /** When it happened, in seconds since the start of 1970. */
  readonly at: number;
}

/** The stretch of time a bill covers. Includes `fromSeconds`, excludes `toSeconds`. */
export interface BillingWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
}

/** What the counting produced. */
export interface UsageReading {
  readonly window: BillingWindow;
  /** Totals per unit, only for units that had any use at all. */
  readonly totals: ReadonlyMap<Unit, bigint>;
  /** How many records were counted. */
  readonly counted: number;
  /** How many were the same thing reported again and were therefore counted once. */
  readonly duplicates: number;
  /** How many fell outside the stretch of time and were left out. */
  readonly outsideWindow: number;
}

/**
 * One step of a price ladder.
 *
 * `upToQuantity` is the top of this step, counted from zero. Null means this step has no
 * top and covers everything above the one before it. The ladder is progressive: the first
 * thousand calls are priced at the first step even when ten thousand were made, exactly the
 * way a utility bill works.
 */
export interface TariffStep {
  readonly upToQuantity: bigint | null;
  /** The price of `perQuantity` of them, on the 8 decimal dollar basis. */
  readonly priceUsd8: bigint;
  /** How many the price covers. Lets a seller price per thousand rather than per one. */
  readonly perQuantity: bigint;
}

export interface Tariff {
  readonly unit: Unit;
  /** Steps from cheapest quantity upwards. Checked by `assertTariffIsSane`. */
  readonly steps: readonly TariffStep[];
}

/** One line of a bill. */
export interface InvoiceLine {
  readonly unit: Unit;
  readonly quantity: bigint;
  readonly amountUsd8: bigint;
  /** How the amount was arrived at, in words a person can read. */
  readonly explanation: string;
}

export interface Invoice {
  readonly window: BillingWindow;
  readonly lines: readonly InvoiceLine[];
  readonly totalUsd8: bigint;
  /** True when nothing was used at all, so there is no bill rather than a bill for nothing. */
  readonly empty: boolean;
}

export class MeterError extends Error {
  /** Raised while counting or pricing, long before anything could be sent. */
  readonly neverSent = true as const;
  constructor(message: string) {
    super(message);
    this.name = "MeterError";
  }
}
