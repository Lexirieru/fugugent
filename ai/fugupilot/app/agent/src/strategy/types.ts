/**
 * The shapes Fugu Pilot plans against. Everything here is plain data with no behaviour, so
 * the planner in `decide.ts` can stay a pure function that never touches the network.
 *
 * All money is carried as a whole number of hundred-millionths of a dollar, the same
 * 8 decimal basis the rest of this repo uses (100000000 = one dollar). Never a floating
 * point number: a dollar amount that goes through a float loses its smallest digits
 * silently, and the smallest digits are somebody's money.
 */

/** One dollar, on the 8 decimal basis every money value in this agent uses. */
export const USD8_ONE = 100_000_000n;

/** A safety ratio of 1.0, on the 1e18 basis Aave and Venus both use for it. */
export const RATIO_ONE = 10n ** 18n;

/** One hundred percent, in basis points. 10000 = 100%. */
export const BPS_ONE = 10_000n;

/** What a single planned step does. */
export type PilotActionKind =
  /** Trade one holding for another so the mix matches what the owner asked for. */
  | "REBALANCE"
  /** Put idle money to work by lending it out. */
  | "LEND"
  /** Take on a loan against holdings already deposited. */
  | "BORROW"
  /** Lock BNB into liquid staking. */
  | "STAKE"
  /** Mirror a trade somebody else made, scaled down. */
  | "COPY_TRADE";

/** One holding, valued in dollars on the 8 decimal basis. */
export interface Holding {
  readonly assetId: string;
  readonly valueUsd8: bigint;
}

/** What the owner wants the mix to look like. Weights must add up to 10000. */
export interface TargetWeight {
  readonly assetId: string;
  readonly weightBps: bigint;
}

/** A trade somebody else made, which Pilot may mirror at a smaller size. */
export interface LeaderTrade {
  readonly assetId: string;
  readonly side: "BUY" | "SELL";
  readonly valueUsd8: bigint;
}

/**
 * Everything Pilot knows at one moment. Read from the chain by the caller, never by the
 * planner itself.
 */
export interface PortfolioSnapshot {
  readonly account: `0x${string}`;
  readonly blockNumber: bigint;
  readonly holdings: readonly Holding[];
  /** Money sitting still, not lent, staked or traded. */
  readonly idleUsd8: bigint;
  /** What has been deposited as backing for a loan. */
  readonly collateralUsd8: bigint;
  /** What is owed. */
  readonly debtUsd8: bigint;
  /**
   * The share of the backing the lender counts, in basis points. 8000 means the lender
   * counts 80% of what was deposited when deciding whether the loan is still safe.
   */
  readonly liquidationThresholdBps: bigint;
  /** The trade to mirror, when there is one. */
  readonly leaderTrade?: LeaderTrade;
}

/**
 * The owner's standing instructions. A product decision, not a protocol constant, and the
 * only place a number that shapes behaviour is allowed to live.
 */
export interface PilotPolicy {
  readonly targets: readonly TargetWeight[];
  /** How far the mix may drift before Pilot trades, in basis points. */
  readonly driftToleranceBps: bigint;
  /** Money kept idle on purpose. Only what is above this gets staked or lent. */
  readonly idleFloorUsd8: bigint;
  /** Which of the live venues to use for each job. */
  readonly swapVenueId: string;
  readonly lendVenueId: string;
  readonly stakeVenueId: string;
  /**
   * The safety ratio Pilot refuses to go below when borrowing, on the 1e18 basis. 2e18
   * means the backing has to be worth twice what the lender needs it to be worth.
   */
  readonly minSafetyRatio: bigint;
  /** How much of somebody else's trade to copy, in basis points. 500 = one twentieth. */
  readonly copyFactorBps: bigint;
  /** The most Pilot will ever copy in one go, whatever the leader did. */
  readonly maxCopyUsd8: bigint;
}

/** One step of a plan. Never carries a venue that was not proven to answer. */
export interface PlannedAction {
  readonly kind: PilotActionKind;
  readonly venueId: string;
  readonly assetId: string;
  /** Always positive. A sale and a purchase are told apart by `kind` and `direction`. */
  readonly amountUsd8: bigint;
  readonly direction: "IN" | "OUT";
  /** Why, in words a person can read. */
  readonly reason: string;
}

/** What the planner produced for one snapshot. */
export interface PilotPlan {
  readonly actions: readonly PlannedAction[];
  /** The sum of every action's amount. What the limits in `execute.ts` are measured against. */
  readonly totalUsd8: bigint;
  /** Why the plan looks the way it does, including why it is empty. */
  readonly reason: string;
}

export class PolicyError extends Error {
  /** Raised while reading the owner's instructions, long before anything is sent. */
  readonly neverSent = true as const;
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

/**
 * The safety ratio of a loan: how much the backing is worth, counted the way the lender
 * counts it, divided by what is owed. Returns null when nothing is owed, which is the
 * safest state there is rather than an error.
 */
export function safetyRatio(
  collateralUsd8: bigint,
  debtUsd8: bigint,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (debtUsd8 <= 0n) return null;
  return (collateralUsd8 * liquidationThresholdBps * RATIO_ONE) / (BPS_ONE * debtUsd8);
}
