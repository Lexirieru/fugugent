import { HF_ONE, type Position } from "./types.js";

const BPS = 10_000n;

/** bigint division rounded up (a and b must be positive). */
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/**
 * The Aave v3-style health factor, on a 1e18 basis.
 * Returns null when there is no debt — that is not a large number, it is the absence of
 * risk. Aave itself returns 2^256-1 for this case; we normalize it to null so a caller
 * can never compare it wrongly.
 */
export function computeHealthFactor(
  collateralBase: bigint,
  debtBase: bigint,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (debtBase === 0n) return null;
  return (collateralBase * liquidationThresholdBps * HF_ONE) / (BPS * debtBase);
}

/**
 * How many basis points the collateral price may fall before HF touches 1.0.
 * The inner term (BPS x HF_ONE / hf) must be rounded UP: it is the bps "remaining" after
 * the fall, so if it were floored, the subtraction's result (the fall margin) would grow
 * and overstate how far the price may drop — which could land the position below HF 1.0
 * while it is reported as still safe. ceilDiv makes this margin smaller, the safe
 * direction.
 */
export function dropToLiquidationBps(hf: bigint | null): bigint | null {
  if (hf === null) return null;
  if (hf <= HF_ONE) return 0n;
  return BPS - ceilDiv(BPS * HF_ONE, hf);
}

/** The HF if the collateral price fell by `dropBps`. */
export function healthFactorAfterPriceDrop(pos: Position, dropBps: bigint): bigint | null {
  if (pos.debtBase === 0n) return null;
  const remaining = dropBps >= BPS ? 0n : BPS - dropBps;
  return computeHealthFactor(
    (pos.collateralBase * remaining) / BPS,
    pos.debtBase,
    pos.liquidationThresholdBps,
  );
}

/** The amount that must be repaid for HF to reach `targetHf`; 0n when it is already safe. */
export function repayToReachTarget(pos: Position, targetHf: bigint): bigint {
  if (pos.debtBase === 0n || targetHf === 0n) return 0n;
  const hutangTarget =
    (pos.collateralBase * pos.liquidationThresholdBps * HF_ONE) / (BPS * targetHf);
  if (hutangTarget >= pos.debtBase) return 0n;
  return pos.debtBase - hutangTarget;
}
