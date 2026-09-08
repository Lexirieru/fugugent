/**
 * Types and thresholds for the GRID strategy.
 *
 * UNITS — uniform across this whole package:
 *  - prices and money: 8-decimal basis (`*Base`), 100_000_000n = $1.00
 *  - token amounts: 18 decimals (`WAD`) — EVERY token on BSC has 18 decimals,
 *    including USDT and USDC
 *  - percentages: basis points (`*Bps`), 10_000n = 100%
 *
 * This module is pure: no network, clock, or environment. Financial decisions in
 * Fugugent never pass through an LLM.
 */

export const USD8_ONE = 100_000_000n;
export const BPS_ONE = 10_000n;
export const WAD = 10n ** 18n;

/**
 * The configuration of one grid.
 *
 * `levels` is the number of grid LINES; the number of intervals (and of lots) is
 * `levels - 1`. Keeping the two apart matters: an off-by-one here makes every lot the
 * wrong size and shifts the entire cost calculation.
 */
export interface GridConfig {
  /** Lower bound price, USD on the 8-decimal basis. */
  lowerBase: bigint;
  /** Upper bound price, USD on the 8-decimal basis. */
  upperBase: bigint;
  /** The number of grid lines. Intervals = levels - 1. */
  levels: number;
  /** Capital allocated to this grid, USD on the 8-decimal basis. */
  capitalBase: bigint;
}

/**
 * The grid's entire memory. `decide` is a pure reducer over this structure: state
 * comes in through an argument and new state goes out through
 * `GridDecision.nextState`. Nothing is stored inside the strategy module.
 */
export interface GridState {
  /** The band the price was in at the previous observation, 0..intervals-1. */
  bandIndex: number;
  /** The number of base-asset lots currently held, 0..intervals. */
  lotsHeld: number;
  /** How many CONSECUTIVE observations the price has been outside the breakout buffer. */
  consecutiveOutside: number;
  /** The direction of the breach being counted; null while the price is inside the buffer. */
  outsideSide: "ABOVE" | "BELOW" | null;
}

export interface GridObservation {
  /** The base asset's price in the quote asset, USD on the 8-decimal basis. */
  priceBase: bigint;
  blockNumber: bigint;
}

export interface CostModel {
  /** DEX pool fee. The PancakeSwap v3 0.05% tier = 5 bps. */
  swapFeeBps: bigint;
  /** Price impact plus slippage tolerance. */
  slippageBps: bigint;
  /** Gas for one swap, USD on the 8-decimal basis. */
  gasCostBase: bigint;
}

export type GridAction = "IDLE" | "BUY" | "SELL" | "WATCH_BREAKOUT" | "EXIT_ABOVE" | "EXIT_BELOW";

export type BreakoutStatus = "NONE" | "WATCHING_ABOVE" | "WATCHING_BELOW";

export interface GridDecision {
  action: GridAction;
  /** The band the price is in now, already clamped to 0..intervals-1. */
  bandIndex: number;
  /** The number of lots actually traded after being capped by capital/inventory. */
  lots: number;
  /** The notional traded = lots x lot value, USD on the 8-decimal basis. */
  notionalBase: bigint;
  /** true when more lots were wanted than could be executed. */
  lotsCapped: boolean;
  breakout: BreakoutStatus;
  /** The cost of one buy-then-sell round trip at this lot size, in bps. */
  roundTripCostBps: bigint;
  /** The line-to-line spacing at its narrowest point (the upper bound), in bps. */
  minStepBps: bigint;
  nextState: GridState;
  reason: string;
}

export interface GridThresholds {
  breakoutBufferBps: bigint;
  breakoutConfirmObservations: number;
  hardBreakoutBps: bigint;
  minProfitMultipleBps: bigint;
  maxRangeRatioBps: bigint;
}

/**
 * ========================== WHY THESE NUMBERS ARE WHAT THEY ARE ==========================
 *
 * `breakoutBufferBps = 200` (2% outside the bound)
 *   Why this value: a price that pierces the bound by a basis unit or two is not a
 *   breakout, it is a candle wick in thin liquidity or one oracle read that missed.
 *   Tearing the grid down for that means paying gas out and back in to return to where
 *   you started.
 *   If it is wrong: too narrow -> the grid is torn down and rebuilt by noise, and every
 *   one of those cycles pays gas; too wide -> the grid sits idle outside its range,
 *   earning nothing while carrying full directional risk (below the range it is 100%
 *   long, above the range it is 100% quote and misses the upside).
 *   NOT CONFIDENT: 2% was chosen because it is roughly the size of a five-minute candle
 *   wick on a major BSC pair. It has to be recalibrated per pair, and thinner pairs
 *   need a wider buffer.
 *
 * `breakoutConfirmObservations = 3`
 *   Why this value: a single observation outside the bound is indistinguishable from an
 *   RPC returning stale data or one block with empty liquidity. Three consecutive
 *   observations demand that the price STAY outside.
 *   If it is wrong: too small -> you exit on one bad read; too large -> the delay in
 *   exiting scales directly with the loss you let grow on a real breakout.
 *   NOT CONFIDENT: the right value is tied to the keeper's CADENCE, which this module
 *   does not know (and must not know — this module is pure). Three observations at a
 *   one-minute cadence is three minutes; at a one-hour cadence it is three hours.
 *   Whoever configures the scheduler MUST set this number along with it.
 *
 * `hardBreakoutBps = 1000` (10% outside the bound)
 *   Why this value: at a distance this far out the price can no longer be called a
 *   wick. Waiting for confirmation here only adds to the loss, so the confirmation path
 *   is skipped entirely. This is the grid's last-resort safety catch, not a normal rule.
 *   If it is wrong: too close to the buffer -> the confirmation path is never used and
 *   noise can tear the grid down immediately; too far -> this catch never fires before
 *   ordinary confirmation does, so it is pointless.
 *
 * `minProfitMultipleBps = 20_000` (2.00x)
 *   Why this value: the grid's line-to-line spacing MUST be larger than the cost of one
 *   buy-then-sell round trip, otherwise every "successful" round trip actually loses
 *   money. A 1.00x multiple is a break-even grid: a busy machine paying costs while
 *   carrying inventory risk. 2.00x means half the gross spread is left as profit.
 *   NOT CONFIDENT: 2.00x is a product decision, not derived. What can be defended is
 *   its shape (spacing measured relative to a round-trip cost that ALREADY includes gas
 *   per lot), not the number.
 *   If it is wrong: too small -> a grid that is mathematically loss-making passes
 *   validation; too large -> a genuinely viable grid is rejected and the agent never
 *   trades.
 *
 * `maxRangeRatioBps = 30_000` (upper bound at most 3x the lower bound)
 *   Why this value: this grid is ARITHMETIC — its lines are evenly spaced in dollars,
 *   not in percent. The percentage spacing is therefore widest at the lower bound and
 *   narrowest at the upper bound, and the ratio between those two extremes is EXACTLY
 *   the range ratio. At 3x, one round trip at the bottom of the grid earns three times
 *   the percentage of one at the top. Wider than that and the profitability check
 *   (which uses the narrowest spacing) becomes so conservative that most grids are
 *   rejected, or — if that check is loosened — the top half of the grid trades below
 *   cost. A geometric grid (constant percentage spacing) does not have this problem,
 *   but it requires an nth root that cannot be computed exactly with bigint;
 *   approximating it with floats would put float error right on the price path that
 *   decides trades. The 3x limit is the price paid for exact arithmetic.
 *
 * `DEFAULT_COST_MODEL`
 *   NOT CONFIDENT: all three are estimates, not measurements. `swapFeeBps = 5` is the
 *   PancakeSwap v3 0.05% tier; `slippageBps = 10` is the usual tolerance for small
 *   size; `gasCostBase = 5_000_000` = $0.05 for one swap on BSC. All must be replaced
 *   with real numbers from the chain layer before deciding about money.
 * ======================================================================================
 */
export const DEFAULT_GRID_THRESHOLDS: GridThresholds = {
  breakoutBufferBps: 200n,
  breakoutConfirmObservations: 3,
  hardBreakoutBps: 1_000n,
  minProfitMultipleBps: 20_000n,
  maxRangeRatioBps: 30_000n,
};

export const DEFAULT_COST_MODEL: CostModel = {
  swapFeeBps: 5n,
  slippageBps: 10n,
  gasCostBase: 5_000_000n,
};

export class GridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridError";
  }
}
