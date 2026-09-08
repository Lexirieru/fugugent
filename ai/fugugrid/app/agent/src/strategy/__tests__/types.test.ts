import { describe, expect, it } from "vitest";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  USD8_ONE,
  WAD,
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

  it("buffer breakout lebih sempit daripada breakout keras", () => {
    expect(DEFAULT_GRID_THRESHOLDS.breakoutBufferBps).toBeLessThan(
      DEFAULT_GRID_THRESHOLDS.hardBreakoutBps,
    );
  });

  it("breakout keras tidak boleh mencapai 100% — batas bawah grid harus tetap harga positif", () => {
    expect(DEFAULT_GRID_THRESHOLDS.hardBreakoutBps).toBeLessThan(BPS_ONE);
  });

  it("konfirmasi breakout minimal satu pengamatan", () => {
    expect(DEFAULT_GRID_THRESHOLDS.breakoutConfirmObservations).toBeGreaterThanOrEqual(1);
  });

  it("pengali profit minimal 1,00x — grid impas hanyalah mesin pembayar biaya", () => {
    expect(DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps).toBeGreaterThanOrEqual(BPS_ONE);
  });

  it("ambang default: buffer 200 bps, konfirmasi 3, breakout keras 1000 bps, pengali 2,00x, rentang maks 3x", () => {
    expect(DEFAULT_GRID_THRESHOLDS.breakoutBufferBps).toBe(200n);
    expect(DEFAULT_GRID_THRESHOLDS.breakoutConfirmObservations).toBe(3);
    expect(DEFAULT_GRID_THRESHOLDS.hardBreakoutBps).toBe(1_000n);
    expect(DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps).toBe(20_000n);
    expect(DEFAULT_GRID_THRESHOLDS.maxRangeRatioBps).toBe(30_000n);
  });

  it("model biaya default tidak negatif", () => {
    expect(DEFAULT_COST_MODEL.swapFeeBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_COST_MODEL.slippageBps).toBeGreaterThanOrEqual(0n);
    expect(DEFAULT_COST_MODEL.gasCostBase).toBeGreaterThanOrEqual(0n);
  });

  it("GridError membawa nama yang benar", () => {
    const e = new GridError("uji");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("GridError");
  });
});
