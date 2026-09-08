import { describe, expect, it } from "vitest";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  USD8_ONE,
  WAD,
} from "../types.js";

describe("domain constants", () => {
  it("USD8_ONE is 1e8 — one dollar on the 8-decimal basis", () => {
    expect(USD8_ONE).toBe(100_000_000n);
  });

  it("BPS_ONE is 10_000 — one hundred percent", () => {
    expect(BPS_ONE).toBe(10_000n);
  });

  it("WAD is 1e18 — every BSC token has 18 decimals, USDT included", () => {
    expect(WAD).toBe(10n ** 18n);
  });

  it("the watch band is narrower than the rebalance band", () => {
    expect(DEFAULT_THRESHOLDS.watchBandBps).toBeLessThan(DEFAULT_THRESHOLDS.rebalanceBandBps);
  });

  it("default thresholds: 250 bps watch, 500 bps rebalance, 50 bps maximum cost", () => {
    expect(DEFAULT_THRESHOLDS.watchBandBps).toBe(250n);
    expect(DEFAULT_THRESHOLDS.rebalanceBandBps).toBe(500n);
    expect(DEFAULT_THRESHOLDS.maxRebalanceCostBps).toBe(50n);
  });

  it("the maximum cost exceeds the default proportional cost, otherwise no turnover would ever be economic", () => {
    expect(DEFAULT_THRESHOLDS.maxRebalanceCostBps).toBeGreaterThan(
      DEFAULT_COST_MODEL.swapFeeBps + DEFAULT_COST_MODEL.slippageBps,
    );
  });

  it("PortfolioError carries the right name", () => {
    const e = new PortfolioError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PortfolioError");
  });
});
