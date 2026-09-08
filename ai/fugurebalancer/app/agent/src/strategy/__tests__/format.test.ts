import { describe, expect, it } from "vitest";
import { formatBps, formatPercentFromBps, formatToken18, formatUsd8 } from "../format.js";

describe("formatUsd8", () => {
  it("12345678 on the 8-decimal basis is $0.12 — not twelve million", () => {
    expect(formatUsd8(12_345_678n)).toBe("$0.12");
  });

  it("100000000 is exactly $1.00", () => {
    expect(formatUsd8(100_000_000n)).toBe("$1.00");
  });

  it("truncates fractions of a cent instead of rounding up", () => {
    expect(formatUsd8(99_999_999n)).toBe("$0.99");
  });

  it("uses English-style thousands separators", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12,345,678.00");
  });

  it("keeps a negative value readable as negative", () => {
    expect(formatUsd8(-100_000_000n)).toBe("-$1.00");
  });

  it("keeps full precision above MAX_SAFE_INTEGER", () => {
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9,007,199,254,740,993.00");
  });
});

describe("formatToken18", () => {
  it("1e18 wei is 1.000000 token — 18 decimals, including USDT on BSC", () => {
    expect(formatToken18(10n ** 18n)).toBe("1.000000");
  });

  it("shows six decimals and truncates the rest", () => {
    expect(formatToken18(1_234_567_890_123_456_789n)).toBe("1.234567");
  });

  it("shows a very small value as an honest zero at six decimals, not a misleading rounding", () => {
    expect(formatToken18(1n)).toBe("0.000000");
  });

  it("keeps a negative value readable as negative", () => {
    expect(formatToken18(-(10n ** 18n))).toBe("-1.000000");
  });
});

describe("formatPercentFromBps", () => {
  it("2000 bps is 20.0 percent", () => {
    expect(formatPercentFromBps(2_000n)).toBe("20.0");
  });

  it("3750 bps is 37.5 percent", () => {
    expect(formatPercentFromBps(3_750n)).toBe("37.5");
  });

  it("shows a negative value with a minus sign, not as an odd fraction", () => {
    expect(formatPercentFromBps(-3_750n)).toBe("-37.5");
  });
});

describe("formatBps", () => {
  it("writes the bps unit explicitly so it is never confused with a percentage", () => {
    expect(formatBps(50n)).toBe("50 bps");
  });
});
