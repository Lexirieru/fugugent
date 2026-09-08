import { dropToLiquidationBps, repayToReachTarget } from "./healthFactor.js";
import { formatHf, formatPercentFromBps } from "./format.js";
import {
  DEFAULT_THRESHOLDS,
  HF_ONE,
  PositionError,
  type Action,
  type Decision,
  type Position,
  type Thresholds,
} from "./types.js";

/**
 * Builds the explanation sentence from the decision's numbers. This code, not an LLM,
 * determines what the sentence says — the LLM explanation module (a separate task) may
 * only polish this sentence, never change its numbers.
 */
function buildReason(action: Action, hf: bigint | null, dropBps: bigint | null): string {
  if (hf === null) {
    return "There is no debt, so there is no liquidation risk.";
  }

  // `dropBps` here is NEVER null: `dropToLiquidationBps` returns null only for
  // hf === null, and that case already returned above. This spot used to have a "0,0"
  // fallback branch that was never reached — a dead branch like that disguises a broken
  // invariant as a sentence that looks normal ("may fall 0,0%"). Now it fails hard and
  // visibly.
  if (dropBps === null) {
    throw new PositionError(
      `Invariant violated: dropToLiquidationBps is null while the health factor ${hf} is not null.`,
    );
  }

  const hfStr = formatHf(hf);
  const room = `The collateral may fall ${formatPercentFromBps(dropBps)}% before liquidation.`;

  switch (action) {
    case "EMERGENCY":
      return `Health factor ${hfStr} is already at the liquidation point. ${room} Emergency action is required now.`;
    case "DELEVERAGE":
      return `Health factor ${hfStr} is in the high-risk zone. ${room} Leverage needs to be reduced immediately.`;
    case "PARTIAL_REPAY":
      return `Health factor ${hfStr}. ${room} Repaying part of the debt is recommended to return to the safe zone.`;
    case "WARN":
      return `Health factor ${hfStr} is approaching the warning threshold. ${room}`;
    case "NONE":
    default:
      return `Health factor ${hfStr}, the position is still safe. ${room}`;
  }
}

/**
 * Ensures the thresholds are safely ordered: warn > partialRepay > deleverage > HF_ONE.
 * Thresholds that are out of order, or that touch or fall below the liquidation point
 * (HF_ONE), make the check chain in `decide` produce a silently undefined decision — for
 * an agent that spends a user's money this must fail hard and immediately, not slip
 * through undetected.
 */
function validateThresholds(t: Thresholds): void {
  if (t.warn <= t.partialRepay || t.partialRepay <= t.deleverage || t.deleverage <= HF_ONE) {
    throw new PositionError(
      `Invalid thresholds: warn=${t.warn}, partialRepay=${t.partialRepay}, deleverage=${t.deleverage}. ` +
        `The correct ordering is warn > partialRepay > deleverage > HF_ONE (${HF_ONE}).`,
    );
  }
}

/**
 * Ensures a `Position` makes sense before anything is computed from it.
 *
 * `decide` used to validate the thresholds but trust `Position` completely. The result
 * was that `liquidationThresholdBps: 0n` — a value that shows up from a partially failed
 * on-chain read, a test mock someone forgot to fill in, or a frozen market — produced an
 * HF of 0, so a genuinely healthy position was judged EMERGENCY and advised to repay ALL
 * of its debt. For an agent that spends a user's money, nonsensical input must fail hard
 * at the door, not turn into a recommendation to pay the maximum.
 *
 * A valid liquidation threshold is 0 < bps <= 10000 (10000 bps = 100%, the physical upper
 * bound: collateral cannot secure more than its own value).
 */
function validatePosition(pos: Position): void {
  if (pos.liquidationThresholdBps <= 0n || pos.liquidationThresholdBps > 10_000n) {
    throw new PositionError(
      `The liquidation threshold makes no sense: ${pos.liquidationThresholdBps} bps. ` +
        `A valid value is 0 < bps <= 10000.`,
    );
  }
  if (pos.collateralBase < 0n || pos.debtBase < 0n) {
    throw new PositionError(
      `A negative position value is impossible: collateralBase=${pos.collateralBase}, ` +
        `debtBase=${pos.debtBase}.`,
    );
  }
}

/**
 * The Guardian decision engine. Pure: no network, no Date.now(), no process.env, no I/O
 * of any kind. It checks from the most severe condition to the mildest, so a boundary
 * case (exactly on a threshold) always falls to the safer action, not the looser one.
 */
export function decide(pos: Position, thresholds: Thresholds = DEFAULT_THRESHOLDS): Decision {
  validateThresholds(thresholds);
  validatePosition(pos);

  const hf = pos.healthFactor;
  const drop = dropToLiquidationBps(hf);

  let action: Action;
  let suggestedRepayBase = 0n;

  if (hf === null) {
    action = "NONE";
  } else if (hf <= HF_ONE) {
    action = "EMERGENCY";
    suggestedRepayBase = repayToReachTarget(pos, thresholds.warn);
  } else if (hf <= thresholds.deleverage) {
    action = "DELEVERAGE";
    suggestedRepayBase = repayToReachTarget(pos, thresholds.warn);
  } else if (hf <= thresholds.partialRepay) {
    action = "PARTIAL_REPAY";
    suggestedRepayBase = repayToReachTarget(pos, thresholds.warn);
  } else if (hf <= thresholds.warn) {
    action = "WARN";
  } else {
    action = "NONE";
  }

  return {
    action,
    healthFactor: hf,
    dropToLiquidationBps: drop,
    reason: buildReason(action, hf, drop),
    suggestedRepayBase,
  };
}
