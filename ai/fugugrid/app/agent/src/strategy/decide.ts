/**
 * The Grid decision engine.
 *
 * PURE: no network, no `Date.now()`, no `process.env`, no I/O. Its shape is a reducer —
 * `(config, state, observation) -> decision` with the next state returned alongside, so
 * the grid's entire memory lives outside this module and every decision can be replayed
 * exactly from its arguments.
 *
 * A grid that does not know when to stop is a way to lose money slowly, so this module
 * has TWO layers of stopping:
 *   1. soft breakout — the price is outside the buffer for N consecutive observations
 *   2. hard breakout — the price is very far outside; exit at once, no waiting
 * plus one layer of prevention that works before the grid ever runs:
 *   3. profitability validation — a grid whose line spacing is narrower than its
 *      round-trip cost is REJECTED, not run and then quietly loss-making.
 */
import {
  bandIndexOf,
  hardLowerBase,
  hardUpperBase,
  intervalsOf,
  lotValueBase,
  minProfitableStepBps,
  minStepBps,
  roundTripCostBps,
  softLowerBase,
  softUpperBase,
  stepBase,
} from "./grid.js";
import { formatPriceUsd8, formatUsd8 } from "./format.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  type BreakoutStatus,
  type CostModel,
  type GridAction,
  type GridConfig,
  type GridDecision,
  type GridObservation,
  type GridState,
  type GridThresholds,
} from "./types.js";

function validateThresholds(t: GridThresholds): void {
  if (t.breakoutBufferBps <= 0n || t.breakoutBufferBps >= t.hardBreakoutBps) {
    throw new GridError(
      `Invalid breakout thresholds: buffer=${t.breakoutBufferBps} bps, hard=${t.hardBreakoutBps} bps. ` +
        `The correct ordering is 0 < buffer < hard.`,
    );
  }
  if (t.hardBreakoutBps >= BPS_ONE) {
    throw new GridError(
      `hardBreakoutBps=${t.hardBreakoutBps} reaches 100%: the grid's lower bound minus this number becomes zero or negative, ` +
        `and a price of zero is not a price.`,
    );
  }
  if (!Number.isInteger(t.breakoutConfirmObservations) || t.breakoutConfirmObservations < 1) {
    throw new GridError(
      `breakoutConfirmObservations=${t.breakoutConfirmObservations} must be an integer >= 1.`,
    );
  }
  if (t.minProfitMultipleBps < BPS_ONE) {
    throw new GridError(
      `minProfitMultipleBps=${t.minProfitMultipleBps} is below 10000 (1.00x): that formalizes a grid that ` +
        `loses money on every round trip once costs are paid.`,
    );
  }
  if (t.maxRangeRatioBps <= BPS_ONE) {
    throw new GridError(`maxRangeRatioBps=${t.maxRangeRatioBps} must be greater than 10000 (1.00x).`);
  }
}

/**
 * A grid configuration that cannot turn a profit must FAIL, not run. This is the most
 * important check in the whole package: a grid whose line spacing is narrower than one
 * round trip's cost will look busy and successful — every buy fills, every sell fills —
 * while eating the capital on every round trip. A failure like that does not look like a
 * failure until the capital is gone.
 */
function validateConfig(config: GridConfig, cost: CostModel, t: GridThresholds): void {
  if (config.lowerBase <= 0n) {
    throw new GridError(`Lower bound ${config.lowerBase} is not positive; a price of zero is not a price.`);
  }
  if (config.upperBase <= config.lowerBase) {
    throw new GridError(
      `Upper bound ${config.upperBase} does not exceed lower bound ${config.lowerBase}.`,
    );
  }
  if (config.upperBase * BPS_ONE > config.lowerBase * t.maxRangeRatioBps) {
    throw new GridError(
      `Range ${config.lowerBase}..${config.upperBase} exceeds the ${t.maxRangeRatioBps} bps limit ` +
        `(${t.maxRangeRatioBps / BPS_ONE}x). On an arithmetic grid, the range ratio EQUALS the ratio between ` +
        `the widest percentage step (at the bottom) and the narrowest (at the top).`,
    );
  }
  if (!Number.isInteger(config.levels) || config.levels < 3) {
    throw new GridError(
      `levels=${config.levels} must be an integer >= 3. Two lines form only one interval, ` +
        `which is a pair of limit orders — not a grid.`,
    );
  }
  if (config.capitalBase <= 0n) {
    throw new GridError(`Grid capital ${config.capitalBase} is not positive.`);
  }
  if (stepBase(config) <= 0n) {
    throw new GridError(
      `The spacing between lines rounds to zero: the range is too narrow for ${config.levels} lines.`,
    );
  }

  const lot = lotValueBase(config);
  if (lot <= 0n) {
    throw new GridError(
      `The lot value rounds to zero: capital ${config.capitalBase} is too small for ${intervalsOf(config)} intervals.`,
    );
  }

  const step = minStepBps(config);
  const minimum = minProfitableStepBps(lot, cost, t.minProfitMultipleBps);
  if (step < minimum) {
    throw new GridError(
      `This grid cannot turn a profit: the narrowest spacing between lines is ${step} bps, while one ` +
        `buy-then-sell round trip needs at least ${minimum} bps (round-trip cost ${roundTripCostBps(lot, cost)} bps ` +
        `times the ${t.minProfitMultipleBps} bps multiple). Reduce the level count, widen the range, or add capital.`,
    );
  }
}

function validateCost(cost: CostModel): void {
  if (cost.swapFeeBps < 0n || cost.slippageBps < 0n || cost.gasCostBase < 0n) {
    throw new GridError(
      `A negative cost model is impossible: swapFeeBps=${cost.swapFeeBps}, ` +
        `slippageBps=${cost.slippageBps}, gasCostBase=${cost.gasCostBase}.`,
    );
  }
}

function validateState(state: GridState, config: GridConfig): void {
  const intervals = intervalsOf(config);
  if (!Number.isInteger(state.bandIndex) || state.bandIndex < 0 || state.bandIndex > intervals - 1) {
    throw new GridError(`bandIndex=${state.bandIndex} is outside the range 0..${intervals - 1}.`);
  }
  if (!Number.isInteger(state.lotsHeld) || state.lotsHeld < 0 || state.lotsHeld > intervals) {
    throw new GridError(`lotsHeld=${state.lotsHeld} is outside the range 0..${intervals}.`);
  }
  if (!Number.isInteger(state.consecutiveOutside) || state.consecutiveOutside < 0) {
    throw new GridError(`consecutiveOutside=${state.consecutiveOutside} must be an integer >= 0.`);
  }
  // An impossible state: counting a breach without knowing its direction. If this got
  // through, observations above and below could stack into a "confirmation" that never
  // actually happened in either single direction.
  if ((state.consecutiveOutside > 0) !== (state.outsideSide !== null)) {
    throw new GridError(
      `Inconsistent state: consecutiveOutside=${state.consecutiveOutside} with outsideSide=${state.outsideSide}.`,
    );
  }
}

function validateObservation(obs: GridObservation): void {
  if (obs.priceBase <= 0n) {
    throw new GridError(
      `Price ${obs.priceBase} is not positive. That is a broken reading, not an asset that became free.`,
    );
  }
}

function buildReason(
  action: GridAction,
  priceBase: bigint,
  lots: number,
  notionalBase: bigint,
  lotsCapped: boolean,
  breakout: BreakoutStatus,
  confirmProgress: string,
): string {
  const price = formatPriceUsd8(priceBase);
  const capNote = lotsCapped ? " The lot count was capped by the available capital or inventory." : "";
  switch (action) {
    case "IDLE":
      return `Price ${price} is still in the same band; no grid line was crossed.${capNote}`;
    case "BUY":
      return `Price fell to ${price} and crossed ${lots} grid lines: buying ${lots} lots worth ${formatUsd8(notionalBase)}.${capNote}`;
    case "SELL":
      return `Price rose to ${price} and crossed ${lots} grid lines: selling ${lots} lots worth ${formatUsd8(notionalBase)}.${capNote}`;
    case "WATCH_BREAKOUT":
      return `Price ${price} is outside the grid range (${breakout === "WATCHING_ABOVE" ? "above" : "below"}), ${confirmProgress}. No action yet.`;
    case "EXIT_ABOVE":
      return `Price ${price} broke out above the grid range; the grid no longer applies. Unwinding ${lots} lots worth ${formatUsd8(notionalBase)} and stopping.`;
    case "EXIT_BELOW":
      return `Price ${price} broke out below the grid range; the grid no longer applies and the position is fully directional. Unwinding ${lots} lots worth ${formatUsd8(notionalBase)} and stopping.`;
  }
}

export function decide(
  config: GridConfig,
  state: GridState,
  observation: GridObservation,
  cost: CostModel = DEFAULT_COST_MODEL,
  thresholds: GridThresholds = DEFAULT_GRID_THRESHOLDS,
): GridDecision {
  validateCost(cost);
  validateThresholds(thresholds);
  validateConfig(config, cost, thresholds);
  validateState(state, config);
  validateObservation(observation);

  const price = observation.priceBase;
  const lot = lotValueBase(config);
  const rt = roundTripCostBps(lot, cost);
  const step = minStepBps(config);
  const band = bandIndexOf(price, config);

  const exit = (action: "EXIT_ABOVE" | "EXIT_BELOW", side: "ABOVE" | "BELOW", count: number): GridDecision => {
    // Exiting ALWAYS unwinds the entire inventory. A grid that is no longer valid but
    // still holds lots is not a grid any more: it is a directional position with no exit
    // rule, which is exactly the state this whole module exists to avoid.
    const lots = state.lotsHeld;
    return {
      action,
      bandIndex: band,
      lots,
      notionalBase: BigInt(lots) * lot,
      lotsCapped: false,
      breakout: side === "ABOVE" ? "WATCHING_ABOVE" : "WATCHING_BELOW",
      roundTripCostBps: rt,
      minStepBps: step,
      nextState: { bandIndex: band, lotsHeld: 0, consecutiveOutside: count, outsideSide: side },
      reason: buildReason(action, price, lots, BigInt(lots) * lot, false, side === "ABOVE" ? "WATCHING_ABOVE" : "WATCHING_BELOW", ""),
    };
  };

  // --- layer 2: hard breakout, exit at once with no waiting for confirmation ---
  if (price >= hardUpperBase(config, thresholds)) return exit("EXIT_ABOVE", "ABOVE", state.consecutiveOutside + 1);
  if (price <= hardLowerBase(config, thresholds)) return exit("EXIT_BELOW", "BELOW", state.consecutiveOutside + 1);

  // --- layer 1: soft breakout, needs consecutive confirmation ---
  const above = price >= softUpperBase(config, thresholds);
  const below = price <= softLowerBase(config, thresholds);
  const side: "ABOVE" | "BELOW" | null = above ? "ABOVE" : below ? "BELOW" : null;

  // Flipping direction RESETS the count: one observation above followed by one below is
  // not two observations pointing to the same conclusion, it is a market churning around
  // the range — precisely the condition this grid is built to serve.
  const count = side === null ? 0 : side === state.outsideSide ? state.consecutiveOutside + 1 : 1;

  if (side !== null && count >= thresholds.breakoutConfirmObservations) {
    return exit(side === "ABOVE" ? "EXIT_ABOVE" : "EXIT_BELOW", side, count);
  }

  // --- ordinary trading ---
  // The band is computed from the clamped price, so a price that jumps outside the range
  // still completes the trade at the edge before the breakout is confirmed. Without this,
  // a single candle that jumps out would leave inventory that is never sold at a grid
  // price.
  const delta = band - state.bandIndex;
  const intervals = intervalsOf(config);

  let action: GridAction;
  let lots = 0;
  let capped = false;

  if (delta < 0) {
    const wanted = -delta;
    const capacity = intervals - state.lotsHeld;
    lots = Math.min(wanted, capacity);
    capped = lots < wanted;
    action = lots > 0 ? "BUY" : side !== null ? "WATCH_BREAKOUT" : "IDLE";
  } else if (delta > 0) {
    const wanted = delta;
    lots = Math.min(wanted, state.lotsHeld);
    capped = lots < wanted;
    action = lots > 0 ? "SELL" : side !== null ? "WATCH_BREAKOUT" : "IDLE";
  } else {
    action = side !== null ? "WATCH_BREAKOUT" : "IDLE";
  }

  const nextLotsHeld =
    action === "BUY" ? state.lotsHeld + lots : action === "SELL" ? state.lotsHeld - lots : state.lotsHeld;

  const breakout: BreakoutStatus =
    side === "ABOVE" ? "WATCHING_ABOVE" : side === "BELOW" ? "WATCHING_BELOW" : "NONE";

  return {
    action,
    bandIndex: band,
    lots,
    notionalBase: BigInt(lots) * lot,
    lotsCapped: capped,
    breakout,
    roundTripCostBps: rt,
    minStepBps: step,
    nextState: {
      // The band ALWAYS advances to where the price is now, even when the wanted lots
      // could not all be executed. If the band were held back, the same crossing would be
      // detected again on every following observation and the grid would retry the same
      // trade over and over, forever.
      bandIndex: band,
      lotsHeld: nextLotsHeld,
      consecutiveOutside: count,
      outsideSide: side,
    },
    reason: buildReason(
      action,
      price,
      lots,
      BigInt(lots) * lot,
      capped,
      breakout,
      `observation ${count} of the ${thresholds.breakoutConfirmObservations} needed to confirm a breakout`,
    ),
  };
}
