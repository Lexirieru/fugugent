/**
 * Yield and migration-cost arithmetic. Pure bigint: money values at this layer can
 * exceed Number.MAX_SAFE_INTEGER and converting to float silently drops the last digit.
 *
 * ROUNDING DIRECTIONS, and why:
 *  - migration costs and spread thresholds round UP     -> they demand more;
 *  - expected yield truncates DOWN                      -> it promises less;
 *  - our pool share rounds UP                           -> we never look smaller
 *    inside a pool than we really are.
 * All three point the same way: STAY PUT. Staying put is a choice you can reverse on
 * the next observation; a migration has already paid gas and slippage and cannot be
 * taken back.
 *
 * Interest is computed as SIMPLE interest (not compounded). This simplification
 * understates both sides of the comparison, but it understates the high-APY side
 * slightly more — meaning it makes a migration look slightly LESS attractive than it
 * is, the same direction as the rest of this module.
 */
import { BPS_ONE, DAYS_PER_YEAR, YieldError, type SwitchCostModel } from "./types.js";

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** The one-off cost of moving pools: proportional on the principal + fixed gas. */
export function switchCostBase(principalBase: bigint, cost: SwitchCostModel): bigint {
  if (principalBase <= 0n) {
    throw new YieldError(`Principal ${principalBase} is not positive: there is nothing to move.`);
  }
  return ceilDiv(principalBase * (cost.swapFeeBps + cost.slippageBps), BPS_ONE) + cost.gasCostBase;
}

/**
 * The MINIMUM APY SPREAD that exactly covers the migration cost over `days` days.
 * This is the most important constant in the whole strategy, and it is DERIVED, not
 * guessed: the cost is paid once, the spread is earned per day, so
 *
 *     cost = principal x spreadBps x days / (10000 x 365)
 *  => spreadBps = cost x 10000 x 365 / (principal x days)
 *
 * A consequence to understand before tuning anything: this threshold is INVERSELY
 * proportional to the principal and to the horizon. Moving $200 needs a spread tens of
 * times larger than moving $200,000, and a one-week horizon demands roughly four times
 * what a one-month horizon does. "Highest APY" is therefore not the answer — the answer
 * depends on how much money it is and how long it will stay.
 */
export function breakEvenSpreadBps(
  principalBase: bigint,
  switchCost: bigint,
  days: bigint,
): bigint {
  if (principalBase <= 0n) {
    throw new YieldError(`Principal ${principalBase} is not positive.`);
  }
  if (days <= 0n) {
    throw new YieldError(
      `A horizon of ${days} days is not positive: the question "is this move worth it" has no answer without a horizon.`,
    );
  }
  return ceilDiv(switchCost * BPS_ONE * DAYS_PER_YEAR, principalBase * days);
}

/** The break-even threshold times the safety multiple, rounded up. */
export function requiredSpreadBps(breakEvenBps: bigint, safetyMultipleBps: bigint): bigint {
  return ceilDiv(breakEvenBps * safetyMultipleBps, BPS_ONE);
}

/** Simple (non-compounded) yield over `days` days, truncated down. */
export function yieldOverPeriodBase(principalBase: bigint, apyBps: bigint, days: bigint): bigint {
  return (principalBase * apyBps * days) / (BPS_ONE * DAYS_PER_YEAR);
}

/** The net gain of a migration over the horizon; negative when it is not worth it. */
export function netGainBase(
  principalBase: bigint,
  spreadBps: bigint,
  days: bigint,
  switchCost: bigint,
): bigint {
  return yieldOverPeriodBase(principalBase, spreadBps, days) - switchCost;
}

/** Our share of the pool, rounded up. */
export function poolShareBps(principalBase: bigint, tvlBase: bigint): bigint {
  if (tvlBase <= 0n) {
    throw new YieldError(`TVL ${tvlBase} is not positive: that is not a pool, it is a failed reading.`);
  }
  return ceilDiv(principalBase * BPS_ONE, tvlBase);
}

export { ceilDiv };
