import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, HF_ONE, PositionError } from "../types.js";

describe("domain constants", () => {
  it("HF_ONE is 1e18", () => {
    expect(HF_ONE).toBe(10n ** 18n);
  });

  it("the default thresholds descend in order and are all above 1.0", () => {
    expect(DEFAULT_THRESHOLDS.warn).toBeGreaterThan(DEFAULT_THRESHOLDS.partialRepay);
    expect(DEFAULT_THRESHOLDS.partialRepay).toBeGreaterThan(DEFAULT_THRESHOLDS.deleverage);
    expect(DEFAULT_THRESHOLDS.deleverage).toBeGreaterThan(HF_ONE);
  });

  it("the default thresholds match the research: 1.5 / 1.2 / 1.1", () => {
    expect(DEFAULT_THRESHOLDS.warn).toBe(1_500_000_000_000_000_000n);
    expect(DEFAULT_THRESHOLDS.partialRepay).toBe(1_200_000_000_000_000_000n);
    expect(DEFAULT_THRESHOLDS.deleverage).toBe(1_100_000_000_000_000_000n);
  });

  it("PositionError carries the right name", () => {
    const e = new PositionError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PositionError");
    expect(e.message).toBe("test");
  });
});
