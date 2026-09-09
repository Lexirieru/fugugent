/**
 * From a decision to the exact numbers a payment carries.
 *
 * PURE: no network, no clock, no I/O. The token price and the current time arrive as
 * arguments, so every number below can be reproduced from a test fixture.
 *
 * The payment contract takes five values, and three of them exist only to protect the
 * buyer:
 *   `maxAmount`  the most this agent will let the contract take;
 *   `deadline`   the moment after which the payment must not happen at all;
 *   `payToken`   which money is used, and therefore which price feed is read.
 * Getting those three right is the whole job of this file. The other two, the listing and
 * the number of blocks of time, were already decided in `decide.ts`.
 */
import {
  BPS_ONE,
  HiringError,
  USD8_TO_WAD,
  type HireDecision,
  type HireQuote,
  type HiringPolicy,
} from "./types.js";
import { DEFAULT_POLICY } from "./types.js";
import { formatToken18, formatUsd8Exact } from "./format.js";

/** The largest value a uint256 argument can carry. */
export const MAX_UINT256 = (1n << 256n) - 1n;

/** The largest value the `periods` argument can carry, because it is a uint32. */
export const MAX_UINT32 = (1n << 32n) - 1n;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** What a payment needs to know that the decision does not. */
export interface PaymentContext {
  /** The token the payment is made in. The zero address means the chain's own coin. */
  payToken: `0x${string}`;
  /**
   * How many token units the price feed says the whole hire costs right now, in 18
   * decimals. Read from the same contract the payment will read, so a mismatch here is a
   * price that moved, not a unit mistake.
   */
  quotedAmountWad: bigint;
  /** Unix seconds. Supplied by the caller so this module never reads a clock. */
  nowUnix: bigint;
  /** The tokens this agent is willing to pay in. */
  allowedPayTokens: readonly `0x${string}`[];
}

/** The five values the payment carries, plus what they were derived from. */
export interface PaymentIntent {
  listingId: bigint;
  periods: bigint;
  payToken: `0x${string}`;
  /** The ceiling written into the payment. Never unbounded. */
  maxAmountWad: bigint;
  deadlineUnix: bigint;
  /** The price that was quoted when the decision was made, for the record. */
  quotedAmountWad: bigint;
  totalUsd8: bigint;
  /** The room allowed between the quote and the ceiling, in bps. */
  slippageBps: bigint;
}

/**
 * The payment ceiling: the quoted amount plus the allowed room, rounded UP.
 *
 * Rounded up because rounding down would make the ceiling smaller than the quote itself
 * for tiny amounts, and a payment refused by its own guard is a guard that is wrong
 * rather than strict.
 */
export function ceilingWithSlippage(quotedWad: bigint, slippageBps: bigint): bigint {
  if (quotedWad < 0n) {
    throw new HiringError(`A quoted amount of ${quotedWad} is not a real price.`);
  }
  if (slippageBps < 0n) {
    throw new HiringError(
      `A negative allowance of ${slippageBps} bps would put the ceiling below the quoted price.`,
    );
  }
  return (quotedWad * (BPS_ONE + slippageBps) + BPS_ONE - 1n) / BPS_ONE;
}

/**
 * Money on the 8-decimal basis converted to an 18-decimal token amount, at one token to
 * the dollar.
 *
 * ONLY valid for a token that is worth a dollar by construction, which on this network
 * means $U. For anything else the price has to be read from a feed, and using this
 * function instead would silently price the hire as if the token never moved.
 *
 * The factor is 10^10, not 10^12. Every token on BSC has 18 decimals, USDT included. The
 * six-decimal habit comes from Ethereum and is wrong here by a factor of 10,000.
 */
export function usd8ToPeggedWad(usd8: bigint): bigint {
  if (usd8 < 0n) {
    throw new HiringError(`${usd8} is not an amount of money.`);
  }
  return usd8 * USD8_TO_WAD;
}

/**
 * Turns a decision to hire into the exact payment arguments.
 *
 * Refuses, rather than adjusting, whenever the inputs do not support a payment this
 * agent can bound. An adjusted payment is a payment nobody decided on.
 */
export function buildPaymentIntent(
  decision: HireDecision,
  context: PaymentContext,
  policy: HiringPolicy = DEFAULT_POLICY,
): PaymentIntent {
  if (decision.action !== "HIRE" || decision.chosen === null) {
    throw new HiringError(
      `The decision was ${decision.action}, so there is nothing to pay for. A payment must ` +
        `never be built from a refusal.`,
    );
  }
  const chosen: HireQuote = decision.chosen;

  // The chain's own coin is refused, and this is not a limitation, it is the guard.
  // The payment contract demands that the coin sent equals the amount the price feed
  // computes INSIDE the transaction, to the last unit. A ceiling cannot protect an
  // amount that has to be exact: send the quote and a price move fails the payment, send
  // more and the payment fails as well. Paying with a token lets the contract pull the
  // exact amount while the ceiling still holds it back.
  if (context.payToken === ZERO_ADDRESS) {
    throw new HiringError(
      "This agent does not pay with the chain's own coin. That payment path requires the " +
        "amount sent to match, to the last unit, a price the payment contract works out while " +
        "the transaction runs, so there is no way to set a ceiling and still succeed. Pay with " +
        "a token instead.",
    );
  }

  const allowed = context.allowedPayTokens.map((t) => t.toLowerCase());
  if (!allowed.includes(context.payToken.toLowerCase())) {
    throw new HiringError(
      `${context.payToken} is not one of the tokens this agent pays in ` +
        `(${context.allowedPayTokens.join(", ") || "none configured"}). Paying in an unknown ` +
        `token means trusting a price feed nobody checked.`,
    );
  }

  if (context.quotedAmountWad <= 0n) {
    throw new HiringError(
      `The price feed quoted ${context.quotedAmountWad} token units for ` +
        `${formatUsd8Exact(chosen.totalUsd8)}. A hire that costs nothing is a failed reading, ` +
        `not a bargain.`,
    );
  }

  if (chosen.periods <= 0n || chosen.periods > MAX_UINT32) {
    throw new HiringError(
      `${chosen.periods} blocks of time cannot be sent: the payment carries that count in a ` +
        `32-bit field, so it must be between 1 and ${MAX_UINT32}.`,
    );
  }

  if (context.nowUnix <= 0n) {
    throw new HiringError(
      `nowUnix is ${context.nowUnix}. Without a real clock reading the deadline would be in ` +
        `1970 and every payment would be refused as stale.`,
    );
  }

  const maxAmountWad = ceilingWithSlippage(context.quotedAmountWad, policy.slippageBps);

  // An unbounded ceiling is the single worst value this argument can hold: it lets the
  // seller raise the price after the decision and still be paid whatever they ask, out of
  // whatever this agent has approved. It cannot be reached by the arithmetic above, so
  // this check exists to make a future edit that reintroduces it fail loudly.
  if (maxAmountWad >= MAX_UINT256) {
    throw new HiringError(
      "The payment ceiling came out unbounded. An unbounded ceiling means agreeing to pay " +
        "whatever the price turns out to be when the payment lands, which is the seller's " +
        "choice and not this agent's.",
    );
  }

  return {
    listingId: chosen.listingId,
    periods: chosen.periods,
    payToken: context.payToken,
    maxAmountWad,
    deadlineUnix: context.nowUnix + policy.intentTtlSeconds,
    quotedAmountWad: context.quotedAmountWad,
    totalUsd8: chosen.totalUsd8,
    slippageBps: policy.slippageBps,
  };
}

/** A payment intent read back as text, for a person or for a log. */
export function describeIntent(intent: PaymentIntent): string {
  return (
    `Pay for listing ${intent.listingId}, ${intent.periods} block` +
    `${intent.periods === 1n ? "" : "s"} of time, worth ${formatUsd8Exact(intent.totalUsd8)}. ` +
    `The price today is ${formatToken18(intent.quotedAmountWad)} tokens and the payment will ` +
    `not take more than ${formatToken18(intent.maxAmountWad)}. It must land before unix second ` +
    `${intent.deadlineUnix} or not at all.`
  );
}

// ── the other rail: hiring an agent that is not in this catalog ────────────────

/**
 * What `hireErc8183Agent` from `@altananetwork/sdk` needs.
 *
 * That function exists and is exported by version 0.7.1, which is the version this agent
 * depends on. It is the buyer side of the wider BNB agent job market: the money is held
 * by a contract until the work is delivered and a waiting period has passed. This
 * function builds its arguments and nothing else, so the arithmetic can be tested
 * without a network and without money.
 */
export interface Erc8183HirePlan {
  /** The seller being hired. */
  provider: `0x${string}`;
  /** The task text the job records. */
  task: string;
  /** The amount held for the job, in $U, 18 decimals. */
  budgetWad: bigint;
  /** How long past the waiting period the seller has to deliver, in seconds. */
  deadlineSeconds: number;
}

/**
 * Turns a decision to hire into the arguments for the wider job market.
 *
 * The money is expressed in $U, which is worth a dollar by construction, so the
 * conversion is the peg and not a price feed. The amount is the same total the catalog
 * decision produced, so the two rails cannot disagree about what the work is worth.
 */
export function buildErc8183HirePlan(
  decision: HireDecision,
  opts: { task: string; deadlineSeconds?: number } = { task: "" },
): Erc8183HirePlan {
  if (decision.action !== "HIRE" || decision.chosen === null) {
    throw new HiringError(
      `The decision was ${decision.action}, so there is no job to open and no money to hold.`,
    );
  }
  const task = opts.task.trim();
  if (task.length === 0) {
    throw new HiringError(
      "A job with no description is a job nobody can be held to. Say what the work is.",
    );
  }
  if (task.length > 4096) {
    throw new HiringError(
      `The job description is ${task.length} characters and the limit is 4096.`,
    );
  }
  const deadlineSeconds = opts.deadlineSeconds ?? 1800;
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new HiringError(
      `deadlineSeconds is ${deadlineSeconds}. A job that expires immediately can only ever be ` +
        `refunded, never delivered.`,
    );
  }

  const budgetWad = usd8ToPeggedWad(decision.chosen.totalUsd8);
  if (budgetWad <= 0n) {
    throw new HiringError(
      "The amount to hold came out as zero. A job with nothing held gives the seller no " +
        "reason to deliver and gives this agent nothing to withhold.",
    );
  }

  return {
    // The listing owner is the address that gets paid. The agent wallet is a label and
    // is never a payee; sending money there would send it nowhere anyone can claim it.
    provider: decision.chosen.owner,
    task,
    budgetWad,
    deadlineSeconds,
  };
}
