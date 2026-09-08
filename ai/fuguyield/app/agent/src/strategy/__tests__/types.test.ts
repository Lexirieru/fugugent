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

describe("konstanta domain", () => {
  it("USD8_ONE adalah 1e8 — satu dolar dalam basis 8 desimal", () => {
    expect(USD8_ONE).toBe(100_000_000n);
  });

  it("BPS_ONE adalah 10_000", () => {
    expect(BPS_ONE).toBe(10_000n);
  });

  it("WAD adalah 1e18 — token BSC 18 desimal, termasuk USDT", () => {
    expect(WAD).toBe(10n ** 18n);
  });

  it("setahun dihitung 365 hari, bukan 360 — APY protokol lending memakai 365", () => {
    expect(DAYS_PER_YEAR).toBe(365n);
  });

  it("ambang default sesuai yang didokumentasikan", () => {
    expect(DEFAULT_YIELD_THRESHOLDS.expectedHoldingDays).toBe(30n);
    expect(DEFAULT_YIELD_THRESHOLDS.spreadSafetyMultipleBps).toBe(20_000n);
    expect(DEFAULT_YIELD_THRESHOLDS.maxPoolShareBps).toBe(1_000n);
    expect(DEFAULT_YIELD_THRESHOLDS.maxPlausibleApyBps).toBe(100_000n);
    expect(DEFAULT_YIELD_THRESHOLDS.maxRiskScore).toBe(50);
    expect(DEFAULT_YIELD_THRESHOLDS.maxApyAgeSeconds).toBe(3_600);
    expect(DEFAULT_YIELD_THRESHOLDS.minConsecutiveFavorable).toBe(3);
  });

  it("pengali keamanan minimal 1,00x — di bawah itu berarti pindah pada titik impas", () => {
    expect(DEFAULT_YIELD_THRESHOLDS.spreadSafetyMultipleBps).toBeGreaterThanOrEqual(BPS_ONE);
  });

  it("pangsa pool maksimum di bawah 100% — menjadi seluruh pool berarti APY-nya milik kita sendiri", () => {
    expect(DEFAULT_YIELD_THRESHOLDS.maxPoolShareBps).toBeLessThan(BPS_ONE);
  });

  it("model biaya pindah default tidak negatif", () => {
    expect(DEFAULT_SWITCH_COST.swapFeeBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_SWITCH_COST.slippageBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_SWITCH_COST.gasCostBase).toBeGreaterThanOrEqual(0n);
  });

  it("YieldError membawa nama yang benar", () => {
    const e = new YieldError("uji");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("YieldError");
  });
});
