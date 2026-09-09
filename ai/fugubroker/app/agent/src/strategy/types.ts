/**
 * Types and thresholds for the HIRING strategy.
 *
 * UNITS, held uniform across this whole package:
 *  - money: 8-decimal basis (`*Usd8`), 100_000_000n = $1.00. This is the unit
 *    `FuguRegistry.Listing.priceUsd8PerPeriod` is stored in, so no conversion happens
 *    between reading a price and deciding about it.
 *  - token amounts: 18 decimals (`WAD`), because EVERY token on BSC has 18 decimals,
 *    $U and USDT included (not 6 as on Ethereum mainnet).
 *  - percentages: basis points (`*Bps`), 10_000n = 100%.
 *  - time: whole seconds.
 *
 * This module must not import anything that touches the network, the clock, or the
 * environment. Financial decisions in Fugugent never pass through an LLM.
 */

/** $1.00 on the 8-decimal basis. */
export const USD8_ONE = 100_000_000n;

/** 100% in basis points. */
export const BPS_ONE = 10_000n;

/** 1 token in 18 decimals. Every BSC token has 18 decimals, $U and USDT included. */
export const WAD = 10n ** 18n;

/**
 * The factor between the money basis used by the catalog (8 decimals) and the token
 * basis used by every BSC token (18 decimals).
 *
 * It is 10^10, and it is the single most dangerous number in this file. Reading it as
 * 10^(18-6) would make every payment 10,000 times too large; that mistake is only
 * possible if someone assumes USDT on BSC has 6 decimals like on Ethereum. It does not.
 */
export const USD8_TO_WAD = 10n ** 10n;

/**
 * The agent capability catalog, in the order the on-chain `Category` enum declares it.
 *
 * The INDEX of each entry is the on-chain enum value. Adding a name in the middle would
 * silently re-label every existing listing, so new capabilities are only ever appended.
 * This array is the only place the mapping lives.
 */
export const CATEGORY_NAMES = [
  "REBALANCING",
  "GRID",
  "YIELD",
  "HEALTH_FACTOR",
  "HIRING",
  "COMMERCE",
  "AUTONOMOUS",
  "STREAMING",
  "TREASURY",
] as const;

export type Category = (typeof CATEGORY_NAMES)[number];

/** Human labels, for text a person reads. Same order, same length. */
export const CATEGORY_LABELS: Record<Category, string> = {
  REBALANCING: "Rebalancing",
  GRID: "Grid",
  YIELD: "Yield",
  HEALTH_FACTOR: "Health factor",
  HIRING: "Hiring",
  COMMERCE: "Commerce",
  AUTONOMOUS: "Autonomous",
  STREAMING: "Streaming",
  TREASURY: "Treasury",
};

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export class HiringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiringError";
  }
}

/** The enum index of a capability name. */
export function categoryIndex(category: Category): number {
  const index = CATEGORY_NAMES.indexOf(category);
  if (index < 0) {
    throw new CatalogError(`"${category}" is not a capability this agent knows.`);
  }
  return index;
}

/**
 * The capability name for an on-chain enum index.
 *
 * An index this build does not know is REFUSED, never guessed and never labelled
 * "unknown" and carried onward. The catalog is read from a contract that other people
 * can upgrade: if a tenth capability is added and this agent has not been rebuilt, the
 * honest answer is "I cannot read that listing", not a rental in a category whose
 * meaning this code invented.
 */
export function categoryFromIndex(index: number): Category {
  if (!Number.isInteger(index) || index < 0 || index >= CATEGORY_NAMES.length) {
    throw new CatalogError(
      `Category index ${index} is outside the ${CATEGORY_NAMES.length} capabilities this ` +
        `build knows (0..${CATEGORY_NAMES.length - 1}). The catalog contract has capabilities ` +
        `this agent has not been rebuilt for; refusing to guess what they mean.`,
    );
  }
  return CATEGORY_NAMES[index] as Category;
}

/** One entry of the agent catalog, as this agent understands it. */
export interface CatalogListing {
  listingId: bigint;
  erc8004AgentId: bigint;
  /** The address that gets paid. */
  owner: `0x${string}`;
  /** The address the agent works from. It never receives payment; it is a label. */
  agentWallet: `0x${string}`;
  category: Category;
  priceUsd8PerPeriod: bigint;
  periodSeconds: bigint;
  active: boolean;
  /** Set only by a curator who is not the listing owner. The one non-self claim. */
  curated: boolean;
  /** Read from the listing metadata; empty when the metadata could not be read. */
  name: string;
  /**
   * The listing's own claim about whether it can act, or only advise. Read from the
   * metadata, defaults to false. A claim, not proof: this agent treats it as a filter a
   * caller may ask for, never as evidence that anything was executed.
   */
  onchainExecution: boolean;
}

/** What the caller wants hired, and for how long. */
export interface HiringRequest {
  category: Category;
  /** How long the work needs the hired agent for, in whole seconds. */
  workSeconds: bigint;
  /** The caller's own ceiling for this one hire, on the 8-decimal basis. */
  budgetUsd8: bigint;
  /** Only consider listings a curator has vetted. */
  requireCurated?: boolean;
  /** Only consider listings that claim they can act, not only advise. */
  requireOnchainExecution?: boolean;
  /** Owner addresses this caller refuses to pay. */
  excludeOwners?: readonly `0x${string}`[];
  /**
   * How much this agent has already spent on hiring in the current window, on the
   * 8-decimal basis.
   *
   * The engine is stateless on purpose, so the running total arrives with the request.
   * Without it, an agent that respects the per-hire limit perfectly can still empty a
   * wallet by making that same hire two hundred times, and every single decision looks
   * correct in isolation. Left out, it counts as zero, which is right for the first hire
   * of a window and wrong for every one after it: a caller that keeps no total gets no
   * protection from one, and that is a caller's choice to make openly rather than a
   * default this agent hides.
   */
  alreadySpentUsd8?: bigint;
}

/**
 * The limits this agent enforces on ITSELF, whatever a caller asks for.
 *
 * The caller's budget and this policy are both ceilings, and the smaller one wins. A
 * caller cannot raise a limit by asking; a policy cannot force a spend the caller did
 * not want.
 */
export interface HiringPolicy {
  /** This agent's own ceiling for one hire. */
  maxTotalUsd8: bigint;
  /**
   * This agent's ceiling for everything it hires in one window, together with
   * `HiringRequest.alreadySpentUsd8`. The window itself is the caller's to define; this
   * engine only compares the two numbers.
   */
  windowBudgetUsd8: bigint;
  /** This agent's ceiling for the price of a single period. */
  maxPricePerPeriodUsd8: bigint;
  /** The most periods this agent will ever pay for in one go. */
  maxPeriods: bigint;
  /** The shortest and longest period length this agent will rent by. */
  minPeriodSeconds: bigint;
  maxPeriodSeconds: bigint;
  /**
   * How far the payment may move between deciding and the transaction landing, in bps.
   * The catalog stores a price in dollars and the payment is made in tokens, so the
   * amount is only known when a price feed is read inside the transaction.
   */
  slippageBps: bigint;
  /** How long a decision stays valid before it has to be made again, in seconds. */
  intentTtlSeconds: bigint;
}

export type HireAction =
  | "HIRE"
  | "NO_MATCH"
  | "OVER_BUDGET"
  | "BLOCKED_BY_POLICY"
  | "WINDOW_EXHAUSTED";

/** Why one listing was put aside. One code per rule, so a rule cannot fail silently. */
export type RejectionRule =
  | "CATEGORY"
  | "INACTIVE"
  | "SELF"
  | "EXCLUDED_OWNER"
  | "NOT_CURATED"
  | "NO_ONCHAIN_EXECUTION"
  | "PERIOD_LENGTH"
  | "PRICE_PER_PERIOD"
  | "TOO_MANY_PERIODS"
  | "OVER_BUDGET";

/**
 * The window ceiling is not a per-listing rule, so it never appears as a reason a
 * particular listing was put aside: when it binds, nothing in the catalog is affordable
 * and the decision says so once.
 */

export interface RejectedListing {
  listingId: bigint;
  rule: RejectionRule;
  detail: string;
}

/** One affordable candidate, priced for the work actually asked for. */
export interface HireQuote {
  listingId: bigint;
  name: string;
  category: Category;
  owner: `0x${string}`;
  agentWallet: `0x${string}`;
  curated: boolean;
  onchainExecution: boolean;
  pricePerPeriodUsd8: bigint;
  periodSeconds: bigint;
  /** Whole periods paid up front. Always at least 1. */
  periods: bigint;
  /** `periods * periodSeconds`. Never less than the work asked for. */
  coveredSeconds: bigint;
  totalUsd8: bigint;
}

export interface HireDecision {
  action: HireAction;
  chosen: HireQuote | null;
  /** The next best candidate, so a caller can see what the choice was made against. */
  runnerUp: HireQuote | null;
  /** How many catalog entries were looked at. */
  considered: number;
  rejected: RejectedListing[];
  /** The ceiling actually in force: the smaller of the caller's and this agent's. */
  budgetUsd8: bigint;
  /** How much of that ceiling the chosen hire uses, in bps. Zero when nothing is hired. */
  budgetUsedBps: bigint;
  /** 0 to 4, from how much of the ceiling this hire commits. Drives the fugu's puff. */
  puffLevel: PuffLevel;
  reason: string;
}

export type PuffLevel = 0 | 1 | 2 | 3 | 4;

/**
 * ========================= WHY THESE NUMBERS ARE WHAT THEY ARE =========================
 *
 * `maxTotalUsd8 = 500_000_000` ($5.00 per hire)
 *   Why this value: it is a testnet demonstration ceiling, chosen so that a single fault
 *   in this agent cannot spend more than a rounding error. The four listings that exist
 *   today cost $0.05 and $0.10 per period, so $5.00 buys tens of periods and is never
 *   the binding limit in normal use. That is deliberate: a ceiling that binds constantly
 *   gets raised until it stops meaning anything.
 *   NOT CONFIDENT: this is a product decision, not a derived constant. What can be
 *   defended is that a spending agent must carry its own ceiling separate from the one
 *   the caller supplies, not the exact figure.
 *   If it is wrong: too high and a bug becomes expensive; too low and every real hire is
 *   refused and the agent is useless.
 *
 * `windowBudgetUsd8 = 2_000_000_000` ($20.00 across a window)
 *   Why this value: four times the per-hire ceiling, so a fault has to repeat itself four
 *   times before it is stopped rather than being stopped on its second attempt, and a
 *   normal day of hiring never touches it. The per-hire ceiling alone cannot bound a loop:
 *   two hundred correct $5.00 hires are two hundred correct decisions and $1,000 gone.
 *   NOT CONFIDENT: the ratio of 4 is a judgement, and the window is not defined here at
 *   all, it is whatever period the caller resets its running total over. A window that is
 *   never reset makes this a lifetime cap; a window reset every call makes it useless.
 *   If it is wrong: too high and a loop runs longer before it stops; too low and a busy
 *   day stops halfway through with nothing broken.
 *
 * `maxPricePerPeriodUsd8 = 50_000_000` ($0.50 per period)
 *   Why this value: five times the most expensive listing in the catalog today ($0.10).
 *   Its job is not to negotiate, it is to catch a listing whose price moved by orders of
 *   magnitude between two reads. A seller can raise a price with one transaction, and
 *   the total-budget gate alone would answer that by buying fewer periods rather than by
 *   refusing.
 *   If it is wrong: too high and a repriced listing still gets paid; too low and an
 *   honest price rise stops the agent with no way to say yes.
 *
 * `maxPeriods = 720`
 *   Why this value: with the 120-second periods the live listings use, 720 periods is
 *   24 hours of work paid up front. Money paid for periods is committed the moment the
 *   transaction lands, and it is released to the seller as time passes, so a long
 *   prepayment is a long exposure to a seller that stops working.
 *   If it is wrong: too high and one decision commits days of money; too low and long
 *   jobs cannot be bought at all, because this agent refuses to under-buy.
 *
 * `minPeriodSeconds = 60`, `maxPeriodSeconds = 2_592_000` (30 days)
 *   Why these values: a period shorter than a minute makes the period count enormous for
 *   any real job and the arithmetic fragile; a period longer than a month means one
 *   payment covers a month of a seller's behaviour that has not happened yet.
 *   If it is wrong: an honest listing outside the band is refused, which is visible and
 *   fixable, rather than paid for on terms this agent cannot reason about.
 *
 * `slippageBps = 100` (1%)
 *   Why this value: the catalog stores dollars and the payment is made in tokens, so the
 *   token amount is only known when the price feed is read inside the transaction. The
 *   guard has to be wide enough that an ordinary price move does not waste a transaction
 *   and narrow enough that a seller cannot raise the price after this agent has decided.
 *   1% on a $0.10 rental is a tenth of a cent.
 *   NOT CONFIDENT: 1% was not measured against the real volatility of the feeds used;
 *   it is a starting point, and a failed hire is the cheap failure it is tuned toward.
 *   If it is wrong: too tight and hires fail as prices wobble; too loose and a seller can
 *   move the price between the decision and the payment and still be paid.
 *   NEVER answer this by removing the guard. Paying without a ceiling means signing for
 *   whatever the price is when the transaction lands, which is the seller's choice.
 *
 * `intentTtlSeconds = 300` (5 minutes)
 *   Why this value: long enough that a slow relay does not throw away a good decision,
 *   short enough that a decision cannot sit in a queue and execute against a catalog
 *   that has changed underneath it.
 * ======================================================================================
 */
export const DEFAULT_POLICY: HiringPolicy = {
  maxTotalUsd8: 500_000_000n,
  windowBudgetUsd8: 2_000_000_000n,
  maxPricePerPeriodUsd8: 50_000_000n,
  maxPeriods: 720n,
  minPeriodSeconds: 60n,
  maxPeriodSeconds: 2_592_000n,
  slippageBps: 100n,
  intentTtlSeconds: 300n,
};

/**
 * The puff level, from how much of the ceiling one hire commits.
 *
 * The fugu puffs up as the load rises, and here the load is money committed against the
 * limit that exists to hold it back. The bands are even quarters, with 0 reserved for
 * "nothing was committed at all" so that the calm shape means exactly one thing.
 */
export function puffFromBudgetBps(usedBps: bigint): PuffLevel {
  if (usedBps <= 0n) return 0;
  if (usedBps < 2_500n) return 1;
  if (usedBps < 5_000n) return 2;
  if (usedBps < 7_500n) return 3;
  return 4;
}
