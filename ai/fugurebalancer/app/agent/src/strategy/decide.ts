/**
 * The Rebalancer decision engine.
 *
 * PURE: no network, no `Date.now()`, no `process.env`, no I/O. The whole outside
 * world arrives through arguments. Financial decisions never pass through an LLM —
 * the explanation module may polish the `reason` sentence, never its numbers.
 *
 * Two gates in sequence, and the order matters:
 *   1. the DEVIATION gate — is the portfolio off target enough to care?
 *   2. the COST gate — is fixing it cheaper than leaving it?
 * A rebalancer with only the first gate rebalances on every small drift and loses to
 * costs. That is the most expensive failure in this strategy because it does not look
 * like a failure: every single trade is "correct", it is only the sum of them that
 * loses money.
 */
import {
  computeTrades,
  costBpsOfTurnover,
  estimateCostBase,
  maxAbsDeviationBps,
  minEconomicTurnoverBase,
  totalValueBase,
  turnoverBase,
} from "./weights.js";
import { formatBps, formatPercentFromBps, formatUsd8 } from "./format.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  type CostModel,
  type Portfolio,
  type RebalanceAction,
  type RebalanceDecision,
  type RebalanceThresholds,
} from "./types.js";

/**
 * The thresholds must be ordered: 0 < watch < rebalance, and the cost budget must be
 * larger than the proportional cost. If `maxRebalanceCostBps` does not exceed
 * `swapFeeBps + slippageBps`, NO turnover size ever passes the gate — the agent will
 * look like it is working but will never rebalance anything, forever, without a
 * single error message. A configuration like that has to fail hard at the door.
 */
function validateThresholds(t: RebalanceThresholds, cost: CostModel): void {
  if (t.watchBandBps <= 0n || t.rebalanceBandBps <= t.watchBandBps) {
    throw new PortfolioError(
      `Invalid thresholds: watchBandBps=${t.watchBandBps}, rebalanceBandBps=${t.rebalanceBandBps}. ` +
        `The correct ordering is 0 < watchBandBps < rebalanceBandBps.`,
    );
  }
  if (t.rebalanceBandBps > BPS_ONE) {
    throw new PortfolioError(
      `rebalanceBandBps=${t.rebalanceBandBps} exceeds 10000 bps; a weight deviation cannot exceed 100%.`,
    );
  }
  if (minEconomicTurnoverBase(cost, t.maxRebalanceCostBps) === null) {
    throw new PortfolioError(
      `A cost budget of ${t.maxRebalanceCostBps} bps does not exceed the proportional cost of ` +
        `${cost.swapFeeBps + cost.slippageBps} bps: no turnover size whatsoever can clear the cost gate.`,
    );
  }
}

function validateCostModel(cost: CostModel): void {
  if (cost.swapFeeBps < 0n || cost.slippageBps < 0n || cost.gasCostBase < 0n) {
    throw new PortfolioError(
      `A negative cost model is impossible: swapFeeBps=${cost.swapFeeBps}, ` +
        `slippageBps=${cost.slippageBps}, gasCostBase=${cost.gasCostBase}.`,
    );
  }
  if (cost.swapFeeBps + cost.slippageBps >= BPS_ONE) {
    throw new PortfolioError(
      `A proportional cost of ${cost.swapFeeBps + cost.slippageBps} bps reaches or exceeds 100%; ` +
        `a trade like that leaves nothing behind.`,
    );
  }
}

/**
 * A nonsensical portfolio must fail hard, not turn quietly into a trade suggestion.
 * Target weights that do not sum to 10,000 bps are the example: if they sum to 9,000,
 * every asset looks overweight and the agent sells part of EVERYTHING, paying costs to
 * move the portfolio into a state nobody ever asked for.
 */
function validatePortfolio(p: Portfolio): void {
  if (p.assets.length < 2) {
    throw new PortfolioError(
      `The portfolio holds ${p.assets.length} assets. Rebalancing needs at least 2 — ` +
        `with a single asset there is no weight to shift.`,
    );
  }

  const seen = new Set<string>();
  let targetSum = 0n;
  for (const a of p.assets) {
    if (seen.has(a.symbol)) {
      throw new PortfolioError(
        `Duplicate symbol "${a.symbol}": the target weight becomes ambiguous and a trade could be counted twice.`,
      );
    }
    seen.add(a.symbol);

    if (a.valueBase < 0n) {
      throw new PortfolioError(`A negative asset value is impossible: ${a.symbol}=${a.valueBase}.`);
    }
    if (a.targetWeightBps < 0n || a.targetWeightBps > BPS_ONE) {
      throw new PortfolioError(
        `Target weight ${a.symbol}=${a.targetWeightBps} bps is outside the range 0..10000.`,
      );
    }
    targetSum += a.targetWeightBps;
  }

  if (targetSum !== BPS_ONE) {
    throw new PortfolioError(
      `The target weights sum to ${targetSum} bps, and should sum to exactly 10000 bps.`,
    );
  }

  if (totalValueBase(p.assets) <= 0n) {
    throw new PortfolioError(
      `A portfolio worth zero has no weights. This is not a perfectly balanced portfolio, ` +
        `it is a failed reading or a position that is already empty.`,
    );
  }
}

function buildReason(
  action: RebalanceAction,
  maxDeviationBps: bigint,
  turnover: bigint,
  costBase: bigint,
  costBps: bigint,
  maxCostBps: bigint,
  bandBps: bigint,
): string {
  const dev = `The largest weight deviation is ${formatPercentFromBps(maxDeviationBps)}%`;
  switch (action) {
    case "NONE":
      return `${dev}, still within tolerance. There is nothing to move.`;
    case "WATCH":
      return `${dev}, past the watch band but not yet at the ${formatPercentFromBps(bandBps)}% rebalance band. Watching, no trade yet.`;
    case "REBALANCE":
      return (
        `${dev}, past the ${formatPercentFromBps(bandBps)}% rebalance band. ` +
        `Moving ${formatUsd8(turnover)} at an estimated cost of ${formatUsd8(costBase)} ` +
        `(${formatBps(costBps)} of the value moved, against a budget of ${formatBps(maxCostBps)}).`
      );
    case "BLOCKED_BY_COST":
      return (
        `${dev}, past the rebalance band, but moving ${formatUsd8(turnover)} ` +
        `would spend ${formatUsd8(costBase)}, which is ${formatBps(costBps)} of the value moved — ` +
        `beyond the ${formatBps(maxCostBps)} budget. Rebalancing now would lose money to costs.`
      );
  }
}

/**
 * Decides whether the portfolio needs rebalancing, and by how much.
 *
 * The checks run from the mildest condition to the most severe, so a boundary case (a
 * deviation exactly on a band) always falls to the MORE active action — the opposite
 * direction from Guardian, because here "more active" is still held back by the cost
 * gate behind it, while letting the portfolio drift is held back by nothing.
 */
export function decide(
  portfolio: Portfolio,
  cost: CostModel = DEFAULT_COST_MODEL,
  thresholds: RebalanceThresholds = DEFAULT_THRESHOLDS,
): RebalanceDecision {
  validateCostModel(cost);
  validateThresholds(thresholds, cost);
  validatePortfolio(portfolio);

  const total = totalValueBase(portfolio.assets);
  const maxDev = maxAbsDeviationBps(portfolio.assets, total);

  const empty = (action: RebalanceAction): RebalanceDecision => ({
    action,
    totalValueBase: total,
    maxDeviationBps: maxDev,
    turnoverBase: 0n,
    estimatedCostBase: 0n,
    estimatedCostBps: 0n,
    trades: [],
    reason: buildReason(action, maxDev, 0n, 0n, 0n, thresholds.maxRebalanceCostBps, thresholds.rebalanceBandBps),
  });

  if (maxDev < thresholds.watchBandBps) return empty("NONE");
  if (maxDev < thresholds.rebalanceBandBps) return empty("WATCH");

  const trades = computeTrades(portfolio.assets, total);
  const turnover = turnoverBase(trades);

  // An invariant, not a defensive branch: if the largest deviation >= the rebalance
  // band (> 0), some asset must be overweight, because the differences from target sum
  // to zero. If this invariant is ever violated there is an arithmetic bug in
  // `computeTrades` and we MUST see it, not quietly return "nothing to do".
  if (turnover <= 0n) {
    throw new PortfolioError(
      `Invariant violated: a deviation of ${maxDev} bps reaches the ${thresholds.rebalanceBandBps} bps ` +
        `rebalance band but no sell leg was produced.`,
    );
  }

  const costBase = estimateCostBase(turnover, cost);
  const costBps = costBpsOfTurnover(costBase, turnover);

  if (costBps > thresholds.maxRebalanceCostBps) {
    return {
      action: "BLOCKED_BY_COST",
      totalValueBase: total,
      maxDeviationBps: maxDev,
      turnoverBase: turnover,
      estimatedCostBase: costBase,
      estimatedCostBps: costBps,
      // Deliberately empty. A caller that forgets to check `action` must not end up
      // holding a ready-to-execute trade list.
      trades: [],
      reason: buildReason(
        "BLOCKED_BY_COST",
        maxDev,
        turnover,
        costBase,
        costBps,
        thresholds.maxRebalanceCostBps,
        thresholds.rebalanceBandBps,
      ),
    };
  }

  return {
    action: "REBALANCE",
    totalValueBase: total,
    maxDeviationBps: maxDev,
    turnoverBase: turnover,
    estimatedCostBase: costBase,
    estimatedCostBps: costBps,
    trades,
    reason: buildReason(
      "REBALANCE",
      maxDev,
      turnover,
      costBase,
      costBps,
      thresholds.maxRebalanceCostBps,
      thresholds.rebalanceBandBps,
    ),
  };
}
