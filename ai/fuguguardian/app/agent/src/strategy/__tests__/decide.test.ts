import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import { DEFAULT_THRESHOLDS, HF_ONE, PositionError, type Position } from "../types.js";

// helper: build a position with the desired HF at LT 80%
function posWithHf(hf: bigint): Position {
  // collateral is fixed at 10_000; debt = collateral x lt / 10000 x 1e18 / hf
  const collateral = 10_000n;
  const debt = hf === 0n ? 0n : (collateral * 8000n * HF_ONE) / (10_000n * hf);
  return {
    protocol: "aave",
    account: "0x0000000000000000000000000000000000000001",
    collateralBase: collateral,
    debtBase: debt,
    liquidationThresholdBps: 8000n,
    healthFactor: debt === 0n ? null : hf,
    blockNumber: 1n,
  };
}

describe("decide", () => {
  it("a position with no debt requires no action at all", () => {
    const p = posWithHf(0n);
    const d = decide(p);
    expect(d.action).toBe("NONE");
    expect(d.suggestedRepayBase).toBe(0n);
    expect(d.dropToLiquidationBps).toBeNull();
  });

  it("HF 2.0 is safe, no action", () => {
    expect(decide(posWithHf(2n * HF_ONE)).action).toBe("NONE");
  });

  it("an HF exactly at the warning threshold triggers WARN", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).action).toBe("WARN");
  });

  it("WARN suggests no repayment at all", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).suggestedRepayBase).toBe(0n);
  });

  it("an HF exactly at the partial repay threshold triggers PARTIAL_REPAY", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).action).toBe("PARTIAL_REPAY");
  });

  it("PARTIAL_REPAY suggests a repayment greater than zero", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).suggestedRepayBase).toBeGreaterThan(0n);
  });

  it("an HF exactly at the deleverage threshold triggers DELEVERAGE", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.deleverage)).action).toBe("DELEVERAGE");
  });

  it("an HF of exactly 1.0 is already an emergency", () => {
    expect(decide(posWithHf(HF_ONE)).action).toBe("EMERGENCY");
  });

  it("an HF below 1.0 is still an emergency, not a thrown error", () => {
    expect(decide(posWithHf(900_000_000_000_000_000n)).action).toBe("EMERGENCY");
  });

  it("the reason names the health factor number", () => {
    const d = decide(posWithHf(1_300_000_000_000_000_000n));
    expect(d.reason).toMatch(/1\.3/);
  });

  it("the reason names the room to liquidation as a percentage for a risky position", () => {
    const d = decide(posWithHf(1_250_000_000_000_000_000n));
    expect(d.reason).toMatch(/20\.0\s*%/);
  });

  it("custom thresholds replace the default ones", () => {
    const strict = { warn: 3n * HF_ONE, partialRepay: 2n * HF_ONE, deleverage: 15n * HF_ONE / 10n };
    expect(decide(posWithHf(25n * HF_ONE / 10n), strict).action).toBe("WARN");
  });

  it("out-of-order thresholds are refused", () => {
    // deleverage (1.3) is greater than partialRepay (1.2) — the order is inverted.
    const salah = {
      warn: 15n * HF_ONE / 10n,
      partialRepay: 12n * HF_ONE / 10n,
      deleverage: 13n * HF_ONE / 10n,
    };
    expect(() => decide(posWithHf(2n * HF_ONE), salah)).toThrow(PositionError);
  });

  it("thresholds at or below 1.0 are refused", () => {
    // deleverage set exactly to HF_ONE — the agent must not first act once the position is
    // already at the liquidation point.
    const salah = {
      warn: 15n * HF_ONE / 10n,
      partialRepay: 12n * HF_ONE / 10n,
      deleverage: HF_ONE,
    };
    expect(() => decide(posWithHf(2n * HF_ONE), salah)).toThrow(PositionError);
  });

  it("the default thresholds pass validation", () => {
    expect(() => decide(posWithHf(2n * HF_ONE))).not.toThrow();
  });

  it("an HF in the middle of a zone produces that zone's action", () => {
    // 1.15 sits right in the middle of the default PARTIAL_REPAY zone (deleverage 1.1 up to
    // partialRepay 1.2), not exactly on either threshold.
    expect(decide(posWithHf(115n * HF_ONE / 100n)).action).toBe("PARTIAL_REPAY");
  });

  it("a position with a nonsensical liquidation threshold is refused", () => {
    const dasar = posWithHf(2n * HF_ONE);

    // 0 bps: this used to produce HF 0, so a healthy position was judged EMERGENCY and the
    // agent was advised to repay ALL of its debt.
    expect(() => decide({ ...dasar, liquidationThresholdBps: 0n, healthFactor: 0n })).toThrow(
      PositionError,
    );
    // Above 100%: collateral cannot secure more than its own value.
    expect(() => decide({ ...dasar, liquidationThresholdBps: 10_001n })).toThrow(PositionError);
    // A negative value is plainly impossible.
    expect(() => decide({ ...dasar, liquidationThresholdBps: -1n })).toThrow(PositionError);
    // Exactly 100% is still valid (the physical upper bound).
    expect(() => decide({ ...dasar, liquidationThresholdBps: 10_000n })).not.toThrow();
  });

  it("a negative collateral or debt value is refused", () => {
    const dasar = posWithHf(2n * HF_ONE);
    expect(() => decide({ ...dasar, collateralBase: -1n })).toThrow(PositionError);
    expect(() => decide({ ...dasar, debtBase: -1n })).toThrow(PositionError);
  });

  it("a debt-free position with a nonsensical threshold is refused all the same", () => {
    // Validation runs before the "no debt" path, so corrupt input cannot slip through just
    // because it happens to have no debt.
    const p = { ...posWithHf(0n), liquidationThresholdBps: 0n };
    expect(() => decide(p)).toThrow(PositionError);
  });
});
