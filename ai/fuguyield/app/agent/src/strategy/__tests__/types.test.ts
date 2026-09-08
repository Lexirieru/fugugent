import { describe, expect, it } from "vitest";
import {
  BPS_ONE,
  DAYS_PER_YEAR,
  DEFAULT_SWITCH_COST,
  DEFAULT_YIELD_THRESHOLDS,
  USD8_ONE,
  WAD,
  YieldError,
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

  it("a year counts 365 days, not 360 — lending protocol APYs use 365", () => {
    expect(DAYS_PER_YEAR).toBe(365n);
  });

  it("the default thresholds match what is documented", () => {
    expect(DEFAULT_YIELD_THRESHOLDS.expectedHoldingDays).toBe(30n);
    expect(DEFAULT_YIELD_THRESHOLDS.spreadSafetyMultipleBps).toBe(20_000n);
    expect(DEFAULT_YIELD_THRESHOLDS.maxPoolShareBps).toBe(1_000n);
    expect(DEFAULT_YIELD_THRESHOLDS.maxPlausibleApyBps).toBe(100_000n);
    expect(DEFAULT_YIELD_THRESHOLDS.maxRiskScore).toBe(50);
    expect(DEFAULT_YIELD_THRESHOLDS.maxApyAgeSeconds).toBe(3_600);
    expect(DEFAULT_YIELD_THRESHOLDS.minConsecutiveFavorable).toBe(3);
  });

  it("the safety multiple is at least 1.00x — below that means migrating at break-even", () => {
    expect(DEFAULT_YIELD_THRESHOLDS.spreadSafetyMultipleBps).toBeGreaterThanOrEqual(BPS_ONE);
  });

  it("the maximum pool share is below 100% — being the whole pool means its APY is our own", () => {
    expect(DEFAULT_YIELD_THRESHOLDS.maxPoolShareBps).toBeLessThan(BPS_ONE);
  });

  it("the default switch cost model is not negative", () => {
    expect(DEFAULT_SWITCH_COST.swapFeeBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_SWITCH_COST.slippageBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_SWITCH_COST.gasCostBase).toBeGreaterThanOrEqual(0n);
  });

  it("YieldError carries the right name", () => {
    const e = new YieldError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("YieldError");
  });
});
