import { describe, expect, it } from "vitest";
import { formatHf, formatPercentFromBps, formatUsd8 } from "../format.js";
import { HF_ONE } from "../types.js";

describe("formatUsd8", () => {
  it("12345678 (on the 8-decimal basis) is $0.12, not twelve million", () => {
    // The heart of the units bug that was fixed: the raw number 12345678 reads to a human
    // as twelve million, when it means twelve cents.
    expect(formatUsd8(12_345_678n)).toBe("$0.12");
  });

  it("100000000 is exactly $1.00", () => {
    expect(formatUsd8(100_000_000n)).toBe("$1.00");
  });

  it("shows zero as $0.00", () => {
    expect(formatUsd8(0n)).toBe("$0.00");
  });

  it("truncates fractions of a cent instead of rounding up", () => {
    // 0.999999 dollars must not display as $1.00.
    expect(formatUsd8(99_999_999n)).toBe("$0.99");
  });

  it("uses English-style thousands separators for large values", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12,345,678.00");
  });

  it("keeps a negative value readable as negative", () => {
    expect(formatUsd8(-100_000_000n)).toBe("-$1.00");
  });

  it("keeps full precision for values far above MAX_SAFE_INTEGER", () => {
    // 9_007_199_254_740_993 (2^53 + 1) on the 8-decimal basis.
    // Through Number() its last digit would be lost; bigint keeps it.
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9,007,199,254,740,993.00");
  });
});

describe("formatHf", () => {
  it("1e18 is 1.00", () => {
    expect(formatHf(HF_ONE)).toBe("1.00");
  });

  it("always writes both decimals in full", () => {
    expect(formatHf(1_600_000_000_000_000_000n)).toBe("1.60");
    expect(formatHf(1_050_000_000_000_000_000n)).toBe("1.05");
  });

  it("truncates downward so a position never looks healthier than it really is", () => {
    expect(formatHf(1_299_999_999_999_999_999n)).toBe("1.29");
  });
});

describe("formatPercentFromBps", () => {
  it("2000 bps is 20.0 percent", () => {
    expect(formatPercentFromBps(2000n)).toBe("20.0");
  });

  it("3750 bps is 37.5 percent", () => {
    expect(formatPercentFromBps(3750n)).toBe("37.5");
  });

  it("zero bps is 0.0 percent", () => {
    expect(formatPercentFromBps(0n)).toBe("0.0");
  });
});
