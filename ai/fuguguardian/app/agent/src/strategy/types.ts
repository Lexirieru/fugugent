/** The health factor is expressed on a 1e18 basis, following Aave v3. HF 1.0 = 1e18. */
export const HF_ONE = 10n ** 18n;

export type Protocol = "venus" | "aave";

/**
 * The actions Guardian may take, from mildest to most aggressive.
 * This decision is ALWAYS produced by deterministic code, never by an LLM.
 */
export type Action = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY";

/**
 * A snapshot of a borrow position at one block. All money values are in the relevant
 * protocol's "base unit" (Aave uses a USD 8-decimal basis).
 */
export interface Position {
  protocol: Protocol;
  account: `0x${string}`;
  collateralBase: bigint;
  debtBase: bigint;
  /** The liquidation threshold in basis points, e.g. 8000n = 80%. */
  liquidationThresholdBps: bigint;
  /** null means there is no debt at all — not dangerous, in fact the safest state. */
  healthFactor: bigint | null;
  blockNumber: bigint;
}

export interface Thresholds {
  warn: bigint;
  partialRepay: bigint;
  deleverage: bigint;
}

export interface Decision {
  action: Action;
  healthFactor: bigint | null;
  /** How many basis points the collateral price may fall before HF reaches 1.0. */
  dropToLiquidationBps: bigint | null;
  reason: string;
  /** The amount suggested for repayment to bring HF back to safety; 0n when none is needed. */
  suggestedRepayBase: bigint;
}

/**
 * Default thresholds from docs/research/06 §4.2. These are a product decision, not a
 * protocol constant — our own research flags them as examples that must be recalibrated
 * via backtest for more volatile assets.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  warn: 1_500_000_000_000_000_000n,
  partialRepay: 1_200_000_000_000_000_000n,
  deleverage: 1_100_000_000_000_000_000n,
};

export class PositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionError";
  }
}
