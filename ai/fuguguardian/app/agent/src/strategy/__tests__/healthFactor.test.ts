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
  it("agunan 1000, hutang 500, LT 80% menghasilkan HF 1.6", () => {
    expect(computeHealthFactor(1000n, 500n, 8000n)).toBe(1_600_000_000_000_000_000n);
  });

  it("tepat di ambang likuidasi menghasilkan HF 1.0", () => {
    expect(computeHealthFactor(1000n, 800n, 8000n)).toBe(HF_ONE);
  });

  it("hutang nol berarti tidak ada risiko sama sekali, dikembalikan null", () => {
    expect(computeHealthFactor(1000n, 0n, 8000n)).toBeNull();
  });

  it("agunan nol dengan hutang berjalan menghasilkan HF nol", () => {
    expect(computeHealthFactor(0n, 100n, 8000n)).toBe(0n);
  });
});

describe("dropToLiquidationBps", () => {
  it("HF 2.0 berarti agunan boleh turun 50%", () => {
    expect(dropToLiquidationBps(2n * HF_ONE)).toBe(5000n);
  });

  it("HF 1.25 berarti agunan boleh turun 20%", () => {
    expect(dropToLiquidationBps(1_250_000_000_000_000_000n)).toBe(2000n);
  });

  it("HF tepat 1.0 berarti tidak ada ruang turun sama sekali", () => {
    expect(dropToLiquidationBps(HF_ONE)).toBe(0n);
  });

  it("HF di bawah 1.0 tetap nol, bukan negatif", () => {
    expect(dropToLiquidationBps(900_000_000_000_000_000n)).toBe(0n);
  });

  it("tanpa hutang, jarak ke likuidasi tidak terdefinisi", () => {
    expect(dropToLiquidationBps(null)).toBeNull();
  });

  it("margin ke likuidasi tidak pernah melebihi batas sebenarnya", () => {
    // collateral=1300, debt=1000, ltBps=10000 -> HF tepat 1.3e18.
    const p = pos(1300n, 1000n, 10000n);
    expect(dropToLiquidationBps(p.healthFactor)).toBe(2307n);
    // Turun tepat 2307 bps: masih di atas atau tepat di ambang.
    expect(healthFactorAfterPriceDrop(p, 2307n)! >= HF_ONE).toBe(true);
    // Satu bps lebih jauh (2308) sudah melewati ambang likuidasi.
    expect(healthFactorAfterPriceDrop(p, 2308n)! < HF_ONE).toBe(true);
  });
});

describe("healthFactorAfterPriceDrop", () => {
  it("HF 1.6 setelah agunan turun 25% menjadi 1.2", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 500n), 2500n)).toBe(1_200_000_000_000_000_000n);
  });

  it("turun sebesar jarak ke likuidasi mendaratkan HF tepat di 1.0", () => {
    const p = pos(1000n, 500n);
    const d = dropToLiquidationBps(p.healthFactor)!;
    expect(healthFactorAfterPriceDrop(p, d)).toBe(HF_ONE);
  });

  it("posisi tanpa hutang tetap aman berapa pun harga turun", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 0n), 9000n)).toBeNull();
  });

  it("HF dari angka yang tidak habis dibagi tetap floor-down", () => {
    // collateral=1000, debt=333, ltBps=7777 -> tidak habis dibagi.
    // 1000n * 7777n * HF_ONE / (10000n * 333n) dihitung manual dengan bigint:
    // = 7777000n * HF_ONE / 3330000n = 2_335_435_435_435_435_435n (floor).
    expect(computeHealthFactor(1000n, 333n, 7777n)).toBe(2_335_435_435_435_435_435n);
  });
});

describe("repayToReachTarget", () => {
  it("menghitung pembayaran yang membawa HF ke target", () => {
    const p = pos(1000n, 800n); // HF 1.0
    const repay = repayToReachTarget(p, 1_600_000_000_000_000_000n);
    expect(repay).toBe(300n); // sisa hutang 500 memberi HF 1.6
  });

  it("posisi yang sudah lebih aman dari target tidak perlu membayar apa pun", () => {
    expect(repayToReachTarget(pos(1000n, 100n), 1_200_000_000_000_000_000n)).toBe(0n);
  });

  it("posisi tanpa hutang tidak perlu membayar apa pun", () => {
    expect(repayToReachTarget(pos(1000n, 0n), 2n * HF_ONE)).toBe(0n);
  });

  it("repay yang disarankan tidak pernah kurang dari kebutuhan sebenarnya", () => {
    // collateral=1000, debt=800, ltBps=8000, target=1.1 -> debtTarget=727
    // (tidak habis dibagi: nilai kontinu sebenarnya adalah 727.27...).
    const target = 1_100_000_000_000_000_000n;
    const p = pos(1000n, 800n, 8000n);
    const repay = repayToReachTarget(p, target);
    expect(repay).toBe(73n);
    const hfAfter = computeHealthFactor(p.collateralBase, p.debtBase - repay, p.liquidationThresholdBps)!;
    expect(hfAfter >= target).toBe(true);
  });
});
