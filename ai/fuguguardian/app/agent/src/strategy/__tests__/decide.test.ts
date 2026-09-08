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
  it("posisi tanpa hutang tidak memerlukan aksi apa pun", () => {
    const p = posWithHf(0n);
    const d = decide(p);
    expect(d.action).toBe("NONE");
    expect(d.suggestedRepayBase).toBe(0n);
    expect(d.dropToLiquidationBps).toBeNull();
  });

  it("HF 2.0 aman, tidak ada aksi", () => {
    expect(decide(posWithHf(2n * HF_ONE)).action).toBe("NONE");
  });

  it("HF tepat di ambang peringatan memicu WARN", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).action).toBe("WARN");
  });

  it("WARN tidak menyarankan pembayaran apa pun", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).suggestedRepayBase).toBe(0n);
  });

  it("HF tepat di ambang partial repay memicu PARTIAL_REPAY", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).action).toBe("PARTIAL_REPAY");
  });

  it("PARTIAL_REPAY menyarankan pembayaran yang lebih dari nol", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).suggestedRepayBase).toBeGreaterThan(0n);
  });

  it("HF tepat di ambang deleverage memicu DELEVERAGE", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.deleverage)).action).toBe("DELEVERAGE");
  });

  it("HF tepat 1.0 sudah darurat", () => {
    expect(decide(posWithHf(HF_ONE)).action).toBe("EMERGENCY");
  });

  it("HF di bawah 1.0 tetap darurat, bukan lempar error", () => {
    expect(decide(posWithHf(900_000_000_000_000_000n)).action).toBe("EMERGENCY");
  });

  it("alasan menyebut angka health factor", () => {
    const d = decide(posWithHf(1_300_000_000_000_000_000n));
    expect(d.reason).toMatch(/1[.,]3/);
  });

  it("alasan menyebut jarak ke likuidasi dalam persen untuk posisi berisiko", () => {
    const d = decide(posWithHf(1_250_000_000_000_000_000n));
    expect(d.reason).toMatch(/20([.,]0)?\s*%/);
  });

  it("ambang khusus menggantikan ambang default", () => {
    const ketat = { warn: 3n * HF_ONE, partialRepay: 2n * HF_ONE, deleverage: 15n * HF_ONE / 10n };
    expect(decide(posWithHf(25n * HF_ONE / 10n), ketat).action).toBe("WARN");
  });

  it("ambang yang tidak berurutan ditolak", () => {
    // deleverage (1.3) is greater than partialRepay (1.2) — the order is inverted.
    const salah = {
      warn: 15n * HF_ONE / 10n,
      partialRepay: 12n * HF_ONE / 10n,
      deleverage: 13n * HF_ONE / 10n,
    };
    expect(() => decide(posWithHf(2n * HF_ONE), salah)).toThrow(PositionError);
  });

  it("ambang di bawah atau sama dengan 1,0 ditolak", () => {
    // deleverage set exactly to HF_ONE — the agent must not first act once the position is
    // already at the liquidation point.
    const salah = {
      warn: 15n * HF_ONE / 10n,
      partialRepay: 12n * HF_ONE / 10n,
      deleverage: HF_ONE,
    };
    expect(() => decide(posWithHf(2n * HF_ONE), salah)).toThrow(PositionError);
  });

  it("ambang default lolos validasi", () => {
    expect(() => decide(posWithHf(2n * HF_ONE))).not.toThrow();
  });

  it("HF di tengah zona menghasilkan aksi zona itu", () => {
    // 1.15 sits right in the middle of the default PARTIAL_REPAY zone (deleverage 1.1 up to
    // partialRepay 1.2), not exactly on either threshold.
    expect(decide(posWithHf(115n * HF_ONE / 100n)).action).toBe("PARTIAL_REPAY");
  });

  it("posisi dengan ambang likuidasi tidak masuk akal ditolak", () => {
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

  it("nilai agunan atau hutang negatif ditolak", () => {
    const dasar = posWithHf(2n * HF_ONE);
    expect(() => decide({ ...dasar, collateralBase: -1n })).toThrow(PositionError);
    expect(() => decide({ ...dasar, debtBase: -1n })).toThrow(PositionError);
  });

  it("posisi tanpa hutang yang ambangnya tidak masuk akal tetap ditolak", () => {
    // Validation runs before the "no debt" path, so corrupt input cannot slip through just
    // because it happens to have no debt.
    const p = { ...posWithHf(0n), liquidationThresholdBps: 0n };
    expect(() => decide(p)).toThrow(PositionError);
  });
});
