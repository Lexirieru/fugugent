/**
 * Types and thresholds for the REBALANCING strategy.
 *
 * UNITS — held uniform across this whole package:
 *  - money: 8-decimal basis (`*Base`), 100_000_000n = $1.00
 *  - token amounts: 18 decimals (`WAD`), because EVERY token on BSC has 18 decimals,
 *    including USDT and USDC (not 6 as on Ethereum mainnet)
 *  - percentages: basis points (`*Bps`), 10_000n = 100%
 *
 * This module must not import anything that touches the network, the clock, or the
 * environment. Financial decisions in Fugugent never pass through an LLM.
 */

/** $1.00 in the 8-decimal basis. */
export const USD8_ONE = 100_000_000n;

/** 100% in basis points. */
export const BPS_ONE = 10_000n;

/** 1 token in 18 decimals. All BSC tokens have 18 decimals, including USDT. */
export const WAD = 10n ** 18n;

/** The actions the Rebalancer may take, from most passive to most active. */
export type RebalanceAction = "NONE" | "WATCH" | "REBALANCE" | "BLOCKED_BY_COST";

export type TradeSide = "SELL" | "BUY";

export interface Trade {
  symbol: string;
  side: TradeSide;
  /** Value of this trade leg in USD, 8-decimal basis. */
  valueBase: bigint;
}

export interface Asset {
  symbol: string;
  /** Current position value in USD, 8-decimal basis. */
  valueBase: bigint;
  /** Target weight in bps. The sum across all assets must be exactly 10_000. */
  targetWeightBps: bigint;
}

export interface Portfolio {
  account: `0x${string}`;
  assets: Asset[];
  blockNumber: bigint;
}

/**
 * The cost model for a single rebalance.
 *
 * `gasCostBase` is deliberately expressed in USD on the 8-decimal basis, not in gwei:
 * the cost gate compares it against turnover, which is also in USD, and the gwei->USD
 * conversion belongs to the chain layer, not to a decision engine that has to stay
 * pure.
 */
export interface CostModel {
  /** DEX pool fee. The PancakeSwap v3 0.05% tier = 5 bps. */
  swapFeeBps: bigint;
  /** Price impact plus the slippage tolerance set on the execution calendar. */
  slippageBps: bigint;
  /** Gas cost of the WHOLE rebalance transaction sequence, USD on the 8-decimal basis. */
  gasCostBase: bigint;
}

export interface RebalanceThresholds {
  /**
   * The watch band. Below it the portfolio counts as on target.
   */
  watchBandBps: bigint;
  /**
   * The no-trade band. A rebalance is only considered once the largest absolute
   * weight deviation reaches this threshold.
   */
  rebalanceBandBps: bigint;
  /**
   * The cost budget for one rebalance, relative to the turnover being moved.
   */
  maxRebalanceCostBps: bigint;
}

export interface RebalanceDecision {
  action: RebalanceAction;
  totalValueBase: bigint;
  /** The largest absolute weight deviation, truncated down. */
  maxDeviationBps: bigint;
  /** The value that has to move (sell legs only, never double-counted). */
  turnoverBase: bigint;
  estimatedCostBase: bigint;
  /** Cost relative to turnover, rounded up. */
  estimatedCostBps: bigint;
  /** Empty unless `action === "REBALANCE"`. */
  trades: Trade[];
  reason: string;
}

/**
 * ========================== WHY THESE NUMBERS ARE WHAT THEY ARE ==========================
 *
 * `watchBandBps = 250` (2.5%)
 *   Why this value: half the rebalance band. Its job is not to trigger anything, but
 *   to give one warning level before action — the same as WARN on Guardian — so an
 *   operator sees the portfolio starting to drift before the agent spends money.
 *   If it is wrong: too narrow and WATCH is lit almost always and means nothing; too
 *   wide and WATCH never lights up and the level is useless.
 *   No money moves because of this number, so the risk is small.
 *
 * `rebalanceBandBps = 500` (5% absolute weight deviation)
 *   Why this value: the 5% tolerance band is the point that keeps showing up in the
 *   portfolio rebalancing literature (e.g. Masters 2003, and the Vanguard studies on
 *   "rebalancing bands") as the region where most of the risk-control benefit is
 *   already captured while trade frequency drops sharply compared with calendar
 *   rebalancing or a zero band.
 *   NOT CONFIDENT: that number was calibrated for stock/bond portfolios. Crypto assets
 *   are far more volatile, so a 5% band will be touched FAR more often here than in a
 *   traditional portfolio. It has to be recalibrated via `runBacktest` on the price
 *   series of the pair actually being used.
 *   If it is wrong: too narrow -> the agent trades constantly and loses to costs
 *   (exactly the failure the cost gate is designed to hold back); too wide -> the
 *   portfolio is allowed to drift far from the risk profile the user chose, and that
 *   "rebalancer" turns into an expensive buy-and-hold.
 *
 * `maxRebalanceCostBps = 50` (0.5% of turnover)
 *   Why this value: the rebalancing benefit measured in the literature is on the order
 *   of tens of bps per YEAR. Paying more than 50 bps in ONE rebalance means spending
 *   several years of that benefit at once. This number must also be larger than
 *   `swapFeeBps + slippageBps`, otherwise no turnover size whatsoever can pass (see
 *   `minEconomicTurnoverBase`), and `decide` rejects such a configuration hard.
 *   NOT CONFIDENT: this is a product decision, not a derived constant. What can be
 *   defended is its shape (cost measured relative to the value being moved, not as an
 *   absolute amount), not its exact value.
 *   If it is wrong: too loose -> a small portfolio spends its capital on gas; too
 *   tight -> the agent never rebalances and its weights drift.
 *
 * `DEFAULT_COST_MODEL`
 *   `swapFeeBps = 5` is the PancakeSwap v3 0.05% tier for correlated pairs.
 *   `slippageBps = 10` (0.1%) is the usual tolerance for small size in a deep pool.
 *   `gasCostBase = 30_000_000` = $0.30 is a rough estimate for one swap sequence on
 *   BSC.
 *   NOT CONFIDENT: all three are estimates, not measurements. All three MUST be
 *   replaced with real numbers from the chain layer before they are used to decide
 *   about money; these defaults only give tests and backtests a sane starting point.
 * ======================================================================================
 */
export const DEFAULT_THRESHOLDS: RebalanceThresholds = {
  watchBandBps: 250n,
  rebalanceBandBps: 500n,
  maxRebalanceCostBps: 50n,
};

export const DEFAULT_COST_MODEL: CostModel = {
  swapFeeBps: 5n,
  slippageBps: 10n,
  gasCostBase: 30_000_000n,
};

export class PortfolioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioError";
  }
}
