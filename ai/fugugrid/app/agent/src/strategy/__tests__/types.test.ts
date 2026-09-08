import { describe, expect, it } from "vitest";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  USD8_ONE,
  WAD,
} from "../types.js";

describe("domain constants", () => {
  it("USD8_ONE is 1e8 — one dollar on the 8-decimal basis", () => {
    expect(USD8_ONE).toBe(100_000_000n);
  });

  it("BPS_ONE is 10_000", () => {
    expect(BPS_ONE).toBe(10_000n);
  });

  it("WAD is 1e18 — BSC tokens have 18 decimals, USDT included", () => {
    expect(WAD).toBe(10n ** 18n);
  });

  it("the breakout buffer is narrower than the hard breakout", () => {
    expect(DEFAULT_GRID_THRESHOLDS.breakoutBufferBps).toBeLessThan(
      DEFAULT_GRID_THRESHOLDS.hardBreakoutBps,
    );
  });

  it("the hard breakout must not reach 100% — the grid's lower bound has to stay a positive price", () => {
    expect(DEFAULT_GRID_THRESHOLDS.hardBreakoutBps).toBeLessThan(BPS_ONE);
  });

  it("breakout confirmation takes at least one observation", () => {
    expect(DEFAULT_GRID_THRESHOLDS.breakoutConfirmObservations).toBeGreaterThanOrEqual(1);
  });

  it("the profit multiple is at least 1.00x — a break-even grid is just a fee-paying machine", () => {
    expect(DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps).toBeGreaterThanOrEqual(BPS_ONE);
  });

  it("default thresholds: 200 bps buffer, 3 confirmations, 1000 bps hard breakout, 2.00x multiple, 3x max range", () => {
    expect(DEFAULT_GRID_THRESHOLDS.breakoutBufferBps).toBe(200n);
    expect(DEFAULT_GRID_THRESHOLDS.breakoutConfirmObservations).toBe(3);
    expect(DEFAULT_GRID_THRESHOLDS.hardBreakoutBps).toBe(1_000n);
    expect(DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps).toBe(20_000n);
    expect(DEFAULT_GRID_THRESHOLDS.maxRangeRatioBps).toBe(30_000n);
  });

  it("the default cost model is not negative", () => {
    expect(DEFAULT_COST_MODEL.swapFeeBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_COST_MODEL.slippageBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_COST_MODEL.gasCostBase).toBeGreaterThanOrEqual(0n);
  });

  it("GridError carries the right name", () => {
    const e = new GridError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("GridError");
  });
});
