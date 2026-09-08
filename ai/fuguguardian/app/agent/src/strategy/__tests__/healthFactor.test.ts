import { describe, expect, it } from "vitest";
import {
  computeHealthFactor,
  dropToLiquidationBps,
  healthFactorAfterPriceDrop,
  repayToReachTarget,
} from "../healthFactor.js";
import { HF_ONE, type Position } from "../types.js";

const pos = (collateral: bigint, debt: bigint, ltBps = 8000n): Position => ({
  protocol: "aave",
  account: "0x0000000000000000000000000000000000000001",
  collateralBase: collateral,
  debtBase: debt,
  liquidationThresholdBps: ltBps,
  healthFactor: computeHealthFactor(collateral, debt, ltBps),
  blockNumber: 1n,
});

describe("computeHealthFactor", () => {
  it("collateral 1000, debt 500, LT 80% produces HF 1.6", () => {
    expect(computeHealthFactor(1000n, 500n, 8000n)).toBe(1_600_000_000_000_000_000n);
  });

  it("exactly at the liquidation threshold produces HF 1.0", () => {
    expect(computeHealthFactor(1000n, 800n, 8000n)).toBe(HF_ONE);
  });

  it("zero debt means no risk at all, returned as null", () => {
    expect(computeHealthFactor(1000n, 0n, 8000n)).toBeNull();
  });

  it("zero collateral with debt outstanding produces an HF of zero", () => {
    expect(computeHealthFactor(0n, 100n, 8000n)).toBe(0n);
  });
});

describe("dropToLiquidationBps", () => {
  it("HF 2.0 means the collateral may fall 50%", () => {
    expect(dropToLiquidationBps(2n * HF_ONE)).toBe(5000n);
  });

  it("HF 1.25 means the collateral may fall 20%", () => {
    expect(dropToLiquidationBps(1_250_000_000_000_000_000n)).toBe(2000n);
  });

  it("an HF of exactly 1.0 means there is no room to fall at all", () => {
    expect(dropToLiquidationBps(HF_ONE)).toBe(0n);
  });

  it("an HF below 1.0 stays zero, not negative", () => {
    expect(dropToLiquidationBps(900_000_000_000_000_000n)).toBe(0n);
  });

  it("with no debt, the room to liquidation is undefined", () => {
    expect(dropToLiquidationBps(null)).toBeNull();
  });

  it("the margin to liquidation never exceeds the real limit", () => {
    // collateral=1300, debt=1000, ltBps=10000 -> HF is exactly 1.3e18.
    const p = pos(1300n, 1000n, 10000n);
    expect(dropToLiquidationBps(p.healthFactor)).toBe(2307n);
    // A fall of exactly 2307 bps: still above or exactly on the threshold.
    expect(healthFactorAfterPriceDrop(p, 2307n)! >= HF_ONE).toBe(true);
    // One bps further (2308) is already past the liquidation threshold.
    expect(healthFactorAfterPriceDrop(p, 2308n)! < HF_ONE).toBe(true);
  });
});

describe("healthFactorAfterPriceDrop", () => {
  it("HF 1.6 becomes 1.2 after the collateral falls 25%", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 500n), 2500n)).toBe(1_200_000_000_000_000_000n);
  });

  it("a fall equal to the room to liquidation lands the HF exactly on 1.0", () => {
    const p = pos(1000n, 500n);
    const d = dropToLiquidationBps(p.healthFactor)!;
    expect(healthFactorAfterPriceDrop(p, d)).toBe(HF_ONE);
  });

  it("a debt-free position stays safe however far the price falls", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 0n), 9000n)).toBeNull();
  });

  it("an HF from numbers that do not divide evenly still floors down", () => {
    // collateral=1000, debt=333, ltBps=7777 -> does not divide evenly.
    // 1000n * 7777n * HF_ONE / (10000n * 333n) computed by hand in bigint:
    // = 7777000n * HF_ONE / 3330000n = 2_335_435_435_435_435_435n (floored).
    expect(computeHealthFactor(1000n, 333n, 7777n)).toBe(2_335_435_435_435_435_435n);
  });
});

describe("repayToReachTarget", () => {
  it("computes the repayment that brings the HF to the target", () => {
    const p = pos(1000n, 800n); // HF 1.0
    const repay = repayToReachTarget(p, 1_600_000_000_000_000_000n);
    expect(repay).toBe(300n); // a remaining debt of 500 gives HF 1.6
  });

  it("a position already safer than the target needs to repay nothing", () => {
    expect(repayToReachTarget(pos(1000n, 100n), 1_200_000_000_000_000_000n)).toBe(0n);
  });

  it("a debt-free position needs to repay nothing", () => {
    expect(repayToReachTarget(pos(1000n, 0n), 2n * HF_ONE)).toBe(0n);
  });

  it("the suggested repayment is never less than what is actually needed", () => {
    // collateral=1000, debt=800, ltBps=8000, target=1.1 -> debtTarget=727
    // (does not divide evenly: the true continuous value is 727.27...).
    const target = 1_100_000_000_000_000_000n;
    const p = pos(1000n, 800n, 8000n);
    const repay = repayToReachTarget(p, target);
    expect(repay).toBe(73n);
    const hfAfter = computeHealthFactor(p.collateralBase, p.debtBase - repay, p.liquidationThresholdBps)!;
    expect(hfAfter >= target).toBe(true);
  });
});
