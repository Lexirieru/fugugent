import { describe, expect, it } from "vitest";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  USD8_ONE,
  WAD,
} from "../types.js";

describe("konstanta domain", () => {
  it("USD8_ONE adalah 1e8 — satu dolar dalam basis 8 desimal", () => {
    expect(USD8_ONE).toBe(100_000_000n);
  });

  it("BPS_ONE adalah 10_000 — seratus persen", () => {
    expect(BPS_ONE).toBe(10_000n);
  });

  it("WAD adalah 1e18 — semua token BSC 18 desimal, termasuk USDT", () => {
    expect(WAD).toBe(10n ** 18n);
  });

  it("pita pengamatan lebih sempit daripada pita rebalance", () => {
    expect(DEFAULT_THRESHOLDS.watchBandBps).toBeLessThan(DEFAULT_THRESHOLDS.rebalanceBandBps);
  });

  it("ambang default: watch 250 bps, rebalance 500 bps, biaya maksimum 50 bps", () => {
    expect(DEFAULT_THRESHOLDS.watchBandBps).toBe(250n);
    expect(DEFAULT_THRESHOLDS.rebalanceBandBps).toBe(500n);
    expect(DEFAULT_THRESHOLDS.maxRebalanceCostBps).toBe(50n);
  });

  it("biaya maksimum lebih besar daripada biaya proporsional default, kalau tidak tidak ada turnover yang pernah ekonomis", () => {
    expect(DEFAULT_THRESHOLDS.maxRebalanceCostBps).toBeGreaterThan(
      DEFAULT_COST_MODEL.swapFeeBps + DEFAULT_COST_MODEL.slippageBps,
    );
  });

  it("PortfolioError membawa nama yang benar", () => {
    const e = new PortfolioError("uji");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PortfolioError");
  });
});
