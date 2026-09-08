/**
 * Weight and cost arithmetic. All pure bigint: no `Number()`, no network, no clock.
 * Money values here can exceed Number.MAX_SAFE_INTEGER, and converting to float
 * silently drops the last digit — exactly the digit that decides how many dollars
 * move.
 *
 * ROUNDING DIRECTIONS, and why:
 *  - deviation magnitudes round DOWN -> a deviation is never overstated, so the
 *    agent is never lured into trading by rounding;
 *  - costs round UP -> a cost is never understated, so the cost gate never opens
 *    because of rounding.
 * Both directions point the same way: DO NOT trade. Not trading is a choice you can
 * reverse on the next candle; a wrong trade has already paid gas and cannot be taken
 * back.
 */
import { BPS_ONE, PortfolioError, type Asset, type CostModel, type Trade } from "./types.js";

/** bigint division rounded up. `a >= 0`, `b > 0`. */
export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export function totalValueBase(assets: readonly Asset[]): bigint {
  let total = 0n;
  for (const a of assets) total += a.valueBase;
  return total;
}

/** An asset's weight in bps, truncated down. */
export function weightBps(valueBase: bigint, totalBase: bigint): bigint {
  if (totalBase <= 0n) {
    throw new PortfolioError(
      `Bobot tidak terdefinisi pada portofolio bernilai ${totalBase}. Nilai total wajib > 0.`,
    );
  }
  return (valueBase * BPS_ONE) / totalBase;
}

/**
 * The magnitude of a weight's deviation from target, in bps, truncated down.
 *
 * Computed from the already-scaled difference (`value x 10000` vs `total x target`)
 * and NOT from the difference of two separately rounded weights. Done the second
 * way, the rounding direction differs between overweight and underweight assets —
 * an underweight asset would look further off than it really is and could trigger a
 * trade that is not needed.
 */
export function absDeviationBps(valueBase: bigint, targetWeightBps: bigint, totalBase: bigint): bigint {
  if (totalBase <= 0n) {
    throw new PortfolioError(
      `Penyimpangan tidak terdefinisi pada portofolio bernilai ${totalBase}. Nilai total wajib > 0.`,
    );
  }
  const aktual = valueBase * BPS_ONE;
  const target = totalBase * targetWeightBps;
  const selisih = aktual > target ? aktual - target : target - aktual;
  return selisih / totalBase;
}

export function maxAbsDeviationBps(assets: readonly Asset[], totalBase: bigint): bigint {
  let max = 0n;
  for (const a of assets) {
    const d = absDeviationBps(a.valueBase, a.targetWeightBps, totalBase);
    if (d > max) max = d;
  }
  return max;
}

/** The value this asset ought to hold, truncated down. */
export function targetValueBase(totalBase: bigint, targetWeightBps: bigint): bigint {
  return (totalBase * targetWeightBps) / BPS_ONE;
}

/**
 * The trade sequence that brings every asset back to its target weight.
 *
 * SELL legs always come before BUY legs. This is not cosmetic: an Altana session key
 * executes the `calls` list in order inside a single userOp, and buying before
 * selling means needing capital that is not available yet.
 *
 * Because `targetValueBase` truncates down, the sum of all target values can fall
 * short of the portfolio total by at most (number of assets - 1) basis units, i.e.
 * under 1e-8 dollars per asset. Dust that small is left on the sell legs and is
 * deliberately not allocated: chasing it would add one unit to some asset
 * arbitrarily without changing anything visible.
 *
 * A rebalance always goes to the FULL target, never to the edge of the band.
 * Rebalancing to the band edge does move less value (cheaper) but leaves the
 * portfolio sitting exactly on the boundary, so the next small shock triggers
 * another rebalance immediately — the churn we are trying to avoid.
 */
export function computeTrades(assets: readonly Asset[], totalBase: bigint): Trade[] {
  const jual: Trade[] = [];
  const beli: Trade[] = [];
  for (const a of assets) {
    const target = targetValueBase(totalBase, a.targetWeightBps);
    const delta = a.valueBase - target;
    if (delta > 0n) jual.push({ symbol: a.symbol, side: "SELL", valueBase: delta });
    else if (delta < 0n) beli.push({ symbol: a.symbol, side: "BUY", valueBase: -delta });
  }
  return [...jual, ...beli];
}

/**
 * The value that actually moves: SELL legs only.
 *
 * Summing sells + buys would count the same dollar twice and make the relative cost
 * (`costBpsOfTurnover`) look half of what it really is — the cost gate would then
 * pass a rebalance it should have rejected.
 */
export function turnoverBase(trades: readonly Trade[]): bigint {
  let t = 0n;
  for (const tr of trades) if (tr.side === "SELL") t += tr.valueBase;
  return t;
}

/**
 * The estimated cost of one rebalance in USD on the 8-decimal basis.
 * The proportional part rounds UP.
 *
 * Zero turnover means no transaction is sent, so no gas is paid — not "free gas",
 * just no transaction at all.
 */
export function estimateCostBase(turnover: bigint, cost: CostModel): bigint {
  if (turnover <= 0n) return 0n;
  const proporsional = ceilDiv(turnover * (cost.swapFeeBps + cost.slippageBps), BPS_ONE);
  return proporsional + cost.gasCostBase;
}

/** Cost relative to turnover, rounded UP. */
export function costBpsOfTurnover(costBase: bigint, turnover: bigint): bigint {
  if (turnover <= 0n) {
    throw new PortfolioError(
      "Biaya relatif tidak terdefinisi ketika tidak ada nilai yang dipindahkan (turnover 0).",
    );
  }
  return ceilDiv(costBase * BPS_ONE, turnover);
}

/**
 * The smallest turnover GUARANTEED to pass the `maxCostBps` cost gate.
 *
 * This is the most useful constant in this module because it is not a magic number:
 * it is derived from gas and the cost budget. With proportional cost r = fee +
 * slippage and gas g, the relative cost of turnover T is r + g x 10000/T. The
 * requirement r + g x 10000/T <= M gives T >= g x 10000/(M - r).
 *
 * The formula uses (g + 1), not g, because `estimateCostBase` rounds the
 * proportional part up by less than one basis unit; that one extra unit covers that
 * rounding for every value of T. The result is therefore a safe bound (it can sit
 * one or two units above the true minimum), not the exact minimum — the same
 * direction as the rest of this module: demand more turnover, not less.
 *
 * Returns `null` when M <= r: the proportional cost alone already exceeds the
 * budget, so NO portfolio size makes a rebalance economical. That is not a condition
 * allowed to pass silently — `decide` rejects such a configuration.
 */
export function minEconomicTurnoverBase(cost: CostModel, maxCostBps: bigint): bigint | null {
  const proporsionalBps = cost.swapFeeBps + cost.slippageBps;
  if (maxCostBps <= proporsionalBps) return null;
  return ceilDiv((cost.gasCostBase + 1n) * BPS_ONE, maxCostBps - proporsionalBps);
}
