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
      `Ambang tidak valid: watchBandBps=${t.watchBandBps}, rebalanceBandBps=${t.rebalanceBandBps}. ` +
        `Urutan yang benar adalah 0 < watchBandBps < rebalanceBandBps.`,
    );
  }
  if (t.rebalanceBandBps > BPS_ONE) {
    throw new PortfolioError(
      `rebalanceBandBps=${t.rebalanceBandBps} melebihi 10000 bps; penyimpangan bobot tidak bisa melampaui 100%.`,
    );
  }
  if (minEconomicTurnoverBase(cost, t.maxRebalanceCostBps) === null) {
    throw new PortfolioError(
      `Anggaran biaya ${t.maxRebalanceCostBps} bps tidak melebihi biaya proporsional ` +
        `${cost.swapFeeBps + cost.slippageBps} bps: tidak ada ukuran turnover mana pun yang bisa lolos gerbang biaya.`,
    );
  }
}

function validateCostModel(cost: CostModel): void {
  if (cost.swapFeeBps < 0n || cost.slippageBps < 0n || cost.gasCostBase < 0n) {
    throw new PortfolioError(
      `Model biaya negatif tidak mungkin: swapFeeBps=${cost.swapFeeBps}, ` +
        `slippageBps=${cost.slippageBps}, gasCostBase=${cost.gasCostBase}.`,
    );
  }
  if (cost.swapFeeBps + cost.slippageBps >= BPS_ONE) {
    throw new PortfolioError(
      `Biaya proporsional ${cost.swapFeeBps + cost.slippageBps} bps mencapai atau melebihi 100%; ` +
        `transaksi seperti itu tidak menyisakan apa pun.`,
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
      `Portofolio berisi ${p.assets.length} aset. Rebalancing butuh minimal 2 aset — ` +
        `dengan satu aset tidak ada bobot yang bisa digeser.`,
    );
  }

  const terlihat = new Set<string>();
  let jumlahTarget = 0n;
  for (const a of p.assets) {
    if (terlihat.has(a.symbol)) {
      throw new PortfolioError(
        `Simbol duplikat "${a.symbol}": bobot target menjadi ambigu dan transaksi bisa dihitung dua kali.`,
      );
    }
    terlihat.add(a.symbol);

    if (a.valueBase < 0n) {
      throw new PortfolioError(`Nilai aset negatif tidak mungkin: ${a.symbol}=${a.valueBase}.`);
    }
    if (a.targetWeightBps < 0n || a.targetWeightBps > BPS_ONE) {
      throw new PortfolioError(
        `Bobot target ${a.symbol}=${a.targetWeightBps} bps di luar rentang 0..10000.`,
      );
    }
    jumlahTarget += a.targetWeightBps;
  }

  if (jumlahTarget !== BPS_ONE) {
    throw new PortfolioError(
      `Jumlah bobot target adalah ${jumlahTarget} bps, seharusnya tepat 10000 bps.`,
    );
  }

  if (totalValueBase(p.assets) <= 0n) {
    throw new PortfolioError(
      `Portofolio bernilai nol tidak punya bobot. Ini bukan portofolio yang seimbang sempurna, ` +
        `melainkan pembacaan yang gagal atau posisi yang sudah kosong.`,
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
  const dev = `Penyimpangan bobot terbesar ${formatPercentFromBps(maxDeviationBps)}%`;
  switch (action) {
    case "NONE":
      return `${dev}, masih di dalam toleransi. Tidak ada yang perlu dipindahkan.`;
    case "WATCH":
      return `${dev}, sudah melewati pita pengamatan tetapi belum mencapai pita rebalance ${formatPercentFromBps(bandBps)}%. Diamati, belum ada transaksi.`;
    case "REBALANCE":
      return (
        `${dev} melewati pita rebalance ${formatPercentFromBps(bandBps)}%. ` +
        `Memindahkan ${formatUsd8(turnover)} dengan taksiran biaya ${formatUsd8(costBase)} ` +
        `(${formatBps(costBps)} dari nilai yang dipindahkan, anggaran ${formatBps(maxCostBps)}).`
      );
    case "BLOCKED_BY_COST":
      return (
        `${dev} sudah melewati pita rebalance, tetapi memindahkan ${formatUsd8(turnover)} ` +
        `akan menghabiskan ${formatUsd8(costBase)} yaitu ${formatBps(costBps)} dari nilai yang dipindahkan — ` +
        `melampaui anggaran ${formatBps(maxCostBps)}. Menyeimbangkan sekarang justru merugi karena ongkos.`
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

  const kosong = (action: RebalanceAction): RebalanceDecision => ({
    action,
    totalValueBase: total,
    maxDeviationBps: maxDev,
    turnoverBase: 0n,
    estimatedCostBase: 0n,
    estimatedCostBps: 0n,
    trades: [],
    reason: buildReason(action, maxDev, 0n, 0n, 0n, thresholds.maxRebalanceCostBps, thresholds.rebalanceBandBps),
  });

  if (maxDev < thresholds.watchBandBps) return kosong("NONE");
  if (maxDev < thresholds.rebalanceBandBps) return kosong("WATCH");

  const trades = computeTrades(portfolio.assets, total);
  const turnover = turnoverBase(trades);

  // An invariant, not a defensive branch: if the largest deviation >= the rebalance
  // band (> 0), some asset must be overweight, because the differences from target sum
  // to zero. If this invariant is ever violated there is an arithmetic bug in
  // `computeTrades` and we MUST see it, not quietly return "nothing to do".
  if (turnover <= 0n) {
    throw new PortfolioError(
      `Invarian dilanggar: penyimpangan ${maxDev} bps mencapai pita rebalance ` +
        `${thresholds.rebalanceBandBps} bps tetapi tidak ada kaki jual yang dihasilkan.`,
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
