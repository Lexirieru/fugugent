import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import { DEFAULT_THRESHOLDS, HF_ONE, PositionError, type Position } from "../types.js";

// helper: bangun posisi dengan HF yang diinginkan pada LT 80%
function posWithHf(hf: bigint): Position {
  // collateral tetap 10_000; debt = collateral × lt / 10000 × 1e18 / hf
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
    // deleverage (1,3) lebih besar daripada partialRepay (1,2) — urutan terbalik.
    const salah = {
      warn: 15n * HF_ONE / 10n,
      partialRepay: 12n * HF_ONE / 10n,
      deleverage: 13n * HF_ONE / 10n,
    };
    expect(() => decide(posWithHf(2n * HF_ONE), salah)).toThrow(PositionError);
  });

  it("ambang di bawah atau sama dengan 1,0 ditolak", () => {
    // deleverage diisi tepat HF_ONE — agent tidak boleh baru bertindak saat
    // posisi sudah di titik likuidasi.
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
    // 1,15 berada tepat di tengah zona PARTIAL_REPAY default (deleverage 1,1
    // sampai partialRepay 1,2), bukan tepat di salah satu ambangnya.
    expect(decide(posWithHf(115n * HF_ONE / 100n)).action).toBe("PARTIAL_REPAY");
  });
});
