/**
 * Types and thresholds for the YIELD strategy.
 *
 * UNITS — uniform across this whole package:
 *  - money: 8-decimal basis (`*Base`), 100_000_000n = $1.00
 *  - token amounts: 18 decimals (`WAD`) — EVERY token on BSC has 18 decimals,
 *    including USDT and USDC
 *  - APY and percentages: basis points (`*Bps`), 10_000n = 100%
 *
 * This module is pure: no network, clock, or environment. The age of the APY reading
 * arrives through `Pool.apyAgeSeconds`, it is NOT computed from `Date.now()` — if this
 * module read the clock, the same decision could not be replayed and could not be
 * backtested.
 */

export const USD8_ONE = 100_000_000n;
export const BPS_ONE = 10_000n;
export const WAD = 10n ** 18n;

/** Lending protocols use a 365-day basis for APY, not 360. */
export const DAYS_PER_YEAR = 365n;

export interface Pool {
  poolId: string;
  protocol: string;
  /** APY in bps. 500n = 5.00% per year. */
  apyBps: bigint;
  /** The pool's total value locked, USD on the 8-decimal basis. */
  tvlBase: bigint;
  /**
   * A 0..100 risk score from our own allowlist/research. This module does NOT compute
   * it and does not pretend it could: protocol risk is a human judgment (audits, age,
   * track record, oracle quality) that arrives here as data.
   */
  riskScore: number;
  /** false when the pool is paused, shut down, or marked deprecated by its protocol. */
  isActive: boolean;
  /** The age of the APY reading in seconds at the moment this observation was taken. */
  apyAgeSeconds: number;
}

export interface YieldPosition {
  /** The principal under management, USD on the 8-decimal basis. */
  principalBase: bigint;
  current: Pool;
}

export interface YieldObservation {
  position: YieldPosition;
  /** Alternative pools. A pool identical to the current position is ignored. */
  candidates: Pool[];
  /**
   * How many CONSECUTIVE observations the same best candidate has met the spread
   * threshold. Counted by the caller (the scheduler), not by this module — this module
   * is pure and has no memory. The counting rule is strict: increment when
   * `spreadQualifies` is true AND `targetPoolId` matches the previous observation;
   * otherwise set it to zero.
   */
  consecutiveFavorable: number;
  blockNumber: bigint;
}

export interface SwitchCostModel {
  /** The DEX pool fee for swapping assets during a migration. */
  swapFeeBps: bigint;
  /** Price impact plus slippage tolerance. */
  slippageBps: bigint;
  /** Gas for the WHOLE migration sequence (withdraw, swap, deposit), USD on the 8-decimal basis. */
  gasCostBase: bigint;
}

export type YieldAction = "STAY" | "MIGRATE" | "EXIT";

export type YieldReasonCode =
  | "NO_CANDIDATE"
  | "NO_BETTER_POOL"
  | "SPREAD_BELOW_BREAKEVEN"
  | "SPREAD_NOT_CONFIRMED"
  | "MIGRATION_ECONOMIC"
  | "CURRENT_POOL_UNSAFE"
  | "NO_ELIGIBLE_POOL"
  | "CURRENT_DATA_STALE";

export type RejectReason =
  | "SAME_POOL"
  | "INACTIVE"
  | "RISK_SCORE"
  | "POOL_SHARE"
  | "IMPLAUSIBLE_APY"
  | "STALE_DATA";

export interface RejectedPool {
  poolId: string;
  why: RejectReason;
}

export interface YieldDecision {
  action: YieldAction;
  reasonCode: YieldReasonCode;
  /** The best candidate that passed the risk gates; null if there is none. */
  targetPoolId: string | null;
  currentApyBps: bigint;
  bestApyBps: bigint | null;
  /** The best candidate's APY minus the current APY; 0 when there is no candidate. */
  spreadBps: bigint;
  /** The APY spread that exactly covers the migration cost over the horizon. */
  breakEvenSpreadBps: bigint;
  /** The break-even threshold times the safety multiple. */
  requiredSpreadBps: bigint;
  /** true when `spreadBps >= requiredSpreadBps`. The caller uses it to count confirmations. */
  spreadQualifies: boolean;
  switchCostBase: bigint;
  /** The estimated net gain over the horizon; can be negative. */
  netGainBase: bigint;
  rejected: RejectedPool[];
  reason: string;
}

export interface YieldThresholds {
  expectedHoldingDays: bigint;
  spreadSafetyMultipleBps: bigint;
  maxPoolShareBps: bigint;
  maxPlausibleApyBps: bigint;
  maxRiskScore: number;
  maxApyAgeSeconds: number;
  minConsecutiveFavorable: number;
}

/**
 * ========================== WHY THESE NUMBERS ARE WHAT THEY ARE ==========================
 *
 * `expectedHoldingDays = 30`
 *   Why it exists: the threshold "the minimum APY spread that justifies a migration"
 *   CANNOT be computed without a horizon. The migration cost is paid once; the APY spread
 *   is earned per day. Without an assumption about how long the position will last, the
 *   question "is this move worth it" has no answer.
 *   Why 30: roughly how long a lending market's APY holds up before a major re-rating,
 *   and short enough not to overstate things.
 *   If it is wrong: a horizon that is too LONG makes the break-even threshold small, so
 *   the agent migrates for a thin spread that may not last that long — a dangerous
 *   direction, because the loss is real and the gain is hypothetical. A horizon that is
 *   too SHORT makes the threshold so high that the agent never migrates and does nothing.
 *   NOT CONFIDENT: this is an assumption, and it is the assumption that determines the
 *   strategy's whole behavior. It must be re-tested against how long positions ACTUALLY
 *   last in production; if the average turns out to be 7 days, this number must be 7 and
 *   the threshold jumps from hundreds to thousands of bps.
 *
 * `spreadSafetyMultipleBps = 20_000` (2.00x the break-even threshold)
 *   Why it exists: an APY is not a promise, it is a snapshot. It drops the moment capital
 *   arrives (our own deposit pushes it down too), part of it is often reward-token
 *   emissions whose own price is falling, and it is computed from a utilization that
 *   changes every block. Migrating right at break-even means betting that a fragile
 *   number holds exactly.
 *   Why 2.00x: the migration is still worth it even if the spread actually realized is
 *   only half of what was quoted.
 *   If it is wrong: too small -> the agent migrates chasing a number that evaporates
 *   before the cost is recovered; too large -> the agent never migrates and lets real
 *   spreads go by.
 *   NOT CONFIDENT: 2.00x is a product decision, not derived.
 *
 * `maxPoolShareBps = 1_000` (principal at most 10% of the pool's TVL)
 *   Why it exists: the highest APY is usually in the smallest pool, and that is no
 *   coincidence — APY is computed from utilization, and a small pool is easy to make look
 *   attractive. Depositing into a pool we dominate means the APY we are chasing turns
 *   into a reflection of our own capital, and when we want out there is no exit
 *   liquidity but ourselves.
 *   Why 10%: it is tied to the PRINCIPAL, not to an absolute dollar figure, so it scales
 *   itself as the capital grows.
 *   If it is wrong: too loose -> the agent becomes someone else's exit liquidity; too
 *   tight -> only giant pools pass and the yield is barely better than sitting still.
 *
 * `maxPlausibleApyBps = 100_000` (1,000% per year)
 *   Why it exists: a number above this is almost always unsustainable reward emissions, a
 *   decimals bug in an indexer, or a pool built deliberately as bait. Rejecting it as
 *   BROKEN DATA is more correct than chasing it.
 *   If it is wrong: too low -> real but rare opportunities get rejected too; too high ->
 *   the agent chases a mirage.
 *   NOT CONFIDENT: this bound is a heuristic, not the result of measuring the APY
 *   distribution.
 *
 * `maxRiskScore = 50`
 *   The midpoint of a 0..100 scale that comes from human research. This module does not
 *   compute the score; it only rejects anything above the threshold.
 *   If it is wrong: too loose -> the agent puts money in an unaudited protocol for a few
 *   hundred bps; too tight -> only one or two protocols pass and this strategy loses its
 *   reason to exist.
 *
 * `maxApyAgeSeconds = 3_600` (one hour)
 *   Why it exists: a lending market's APY moves with utilization, which changes every
 *   block. Acting on an hour-old number is acting on a number that has already changed.
 *   Rejecting stale data is better than moving money on a number that no longer holds.
 *   If it is wrong: too tight -> data is almost never fresh enough and the agent is
 *   paralyzed; too loose -> a migration is paid for a spread that no longer exists.
 *
 * `minConsecutiveFavorable = 3`
 *   Why it exists: a single APY spike is usually one large loan that just landed and will
 *   be arbitraged away within minutes. Demanding that the spread PERSIST stops the agent
 *   from ping-ponging between two pools (each round trip pays the full cost twice).
 *   If it is wrong: too small -> it chases momentary spikes; too large -> the real
 *   opportunity has been taken by someone else before confirmation completes.
 *   NOT CONFIDENT: as with Grid, the right value is tied to the scheduler's CADENCE,
 *   which this module does not know. Three observations at hourly cadence is three hours;
 *   at daily cadence it is three days.
 *
 * `DEFAULT_SWITCH_COST`
 *   NOT CONFIDENT: an estimate, not a measurement. `gasCostBase = $1` represents a
 *   withdraw + swap + deposit sequence on BSC. It must be replaced with real numbers from
 *   the chain layer before deciding about money.
 * ======================================================================================
 */
export const DEFAULT_YIELD_THRESHOLDS: YieldThresholds = {
  expectedHoldingDays: 30n,
  spreadSafetyMultipleBps: 20_000n,
  maxPoolShareBps: 1_000n,
  maxPlausibleApyBps: 100_000n,
  maxRiskScore: 50,
  maxApyAgeSeconds: 3_600,
  minConsecutiveFavorable: 3,
};

export const DEFAULT_SWITCH_COST: SwitchCostModel = {
  swapFeeBps: 5n,
  slippageBps: 10n,
  gasCostBase: 100_000_000n,
};

export class YieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YieldError";
  }
}
