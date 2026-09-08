/**
 * Grid geometry and cost arithmetic. All pure bigint for money values; `Number` is
 * used only for band indices and level counts, which are genuinely small counts and
 * never touch a money value.
 *
 * ROUNDING DIRECTIONS, and why:
 *  - line-to-line spacing (`minStepBps`) truncates DOWN -> the grid never looks more
 *    profitable than it is;
 *  - costs (`roundTripCostBps`) round UP -> a cost is never understated;
 *  - the UPPER breakout bound truncates down and the LOWER breakout bound rounds up
 *    -> both move CLOSER to the grid's range, so a breakout is detected earlier.
 *    Exiting too early means losing a few round trips and paying the exit gas; exiting
 *    too late means holding a directional position with no plan, and nothing bounds
 *    that loss.
 */
import { BPS_ONE, GridError, type CostModel, type GridConfig, type GridThresholds } from "./types.js";

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** The number of intervals (= the number of lots). Grid lines minus one. */
export function intervalsOf(config: GridConfig): number {
  return config.levels - 1;
}

/** The width of one interval in dollars, truncated down. */
export function stepBase(config: GridConfig): bigint {
  return (config.upperBase - config.lowerBase) / BigInt(intervalsOf(config));
}

/**
 * The price of grid line `i`, from 0 (the lower bound) to `intervals` (the upper
 * bound).
 *
 * Computed as `lower + (upper - lower) x i / intervals`, not as `lower + step x i`.
 * The difference matters: the second way accumulates `step`'s rounding error i times,
 * so the topmost line misses the upper bound and the last band quietly becomes wider
 * than the others.
 */
export function levelPriceBase(config: GridConfig, i: number): bigint {
  const intervals = intervalsOf(config);
  if (!Number.isInteger(i) || i < 0 || i > intervals) {
    throw new GridError(`Grid line index ${i} is outside the range 0..${intervals}.`);
  }
  return config.lowerBase + ((config.upperBase - config.lowerBase) * BigInt(i)) / BigInt(intervals);
}

/**
 * The line-to-line spacing at its NARROWEST point in percentage terms, which is at
 * the upper bound. On an arithmetic grid the dollar spacing is constant but the
 * percentage spacing shrinks as the price rises; the thinnest-margin round trip is the
 * one at the top. Using the average spacing here would pass grids whose top half
 * trades below cost.
 */
export function minStepBps(config: GridConfig): bigint {
  return (stepBase(config) * BPS_ONE) / config.upperBase;
}

/** The value of one lot in the quote asset, truncated down. */
export function lotValueBase(config: GridConfig): bigint {
  return config.capitalBase / BigInt(intervalsOf(config));
}

/**
 * The cost of one full buy-then-sell round trip, expressed in bps of the lot value.
 *
 * Gas GOES INTO this number, divided by the lot value. This is why adding levels
 * without adding capital is dangerous: every lot shrinks, gas per lot stays the same,
 * and the round-trip cost swells until it exceeds the line-to-line spacing. A grid like
 * that loses money on every "successful" trade.
 */
export function roundTripCostBps(lotValue: bigint, cost: CostModel): bigint {
  if (lotValue <= 0n) {
    throw new GridError(
      `Lot value ${lotValue} is not positive: the grid capital is too small for the requested level count.`,
    );
  }
  const proporsional = 2n * (cost.swapFeeBps + cost.slippageBps);
  const gas = ceilDiv(2n * cost.gasCostBase * BPS_ONE, lotValue);
  return proporsional + gas;
}

/** The minimum line-to-line spacing that makes one round trip worth doing. */
export function minProfitableStepBps(
  lotValue: bigint,
  cost: CostModel,
  minProfitMultipleBps: bigint,
): bigint {
  return ceilDiv(roundTripCostBps(lotValue, cost) * minProfitMultipleBps, BPS_ONE);
}

export type PricePosition = "BELOW" | "INSIDE" | "ABOVE";

/** Where the price sits relative to the grid's range, with no clamping. */
export function pricePosition(priceBase: bigint, config: GridConfig): PricePosition {
  if (priceBase < config.lowerBase) return "BELOW";
  if (priceBase >= config.upperBase) return "ABOVE";
  return "INSIDE";
}

/**
 * The band the price is in, CLAMPED to 0..intervals-1.
 *
 * The clamping is deliberate: a price outside the range still maps to the edge band, so
 * the last lot at that edge still gets traded when the price jumps out in one step.
 * Without clamping, a price jump would leave inventory that is never sold.
 */
export function bandIndexOf(priceBase: bigint, config: GridConfig): number {
  const intervals = intervalsOf(config);
  if (priceBase <= config.lowerBase) return 0;
  if (priceBase >= config.upperBase) return intervals - 1;
  const i = ((priceBase - config.lowerBase) * BigInt(intervals)) / (config.upperBase - config.lowerBase);
  return Number(i);
}

/** Upper bound + buffer. Truncated down -> a breakout is detected earlier. */
export function softUpperBase(config: GridConfig, t: GridThresholds): bigint {
  return (config.upperBase * (BPS_ONE + t.breakoutBufferBps)) / BPS_ONE;
}

/** Upper bound + the hard breakout. Truncated down, same reason. */
export function hardUpperBase(config: GridConfig, t: GridThresholds): bigint {
  return (config.upperBase * (BPS_ONE + t.hardBreakoutBps)) / BPS_ONE;
}

/** Lower bound - buffer. Rounded UP -> a breakout is detected earlier. */
export function softLowerBase(config: GridConfig, t: GridThresholds): bigint {
  return ceilDiv(config.lowerBase * (BPS_ONE - t.breakoutBufferBps), BPS_ONE);
}

/** Lower bound - the hard breakout. Rounded UP, same reason. */
export function hardLowerBase(config: GridConfig, t: GridThresholds): bigint {
  return ceilDiv(config.lowerBase * (BPS_ONE - t.hardBreakoutBps), BPS_ONE);
}

export { ceilDiv };
