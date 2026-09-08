import { describe, expect, it } from "vitest";
import { formatBps, formatPercentFromBps, formatPriceUsd8, formatToken18, formatUsd8 } from "../format.js";

describe("formatUsd8", () => {
  it("12345678 on the 8-decimal basis is $0.12 — not twelve million", () => {
    expect(formatUsd8(12_345_678n)).toBe("$0.12");
  });

  it("truncates fractions of a cent instead of rounding up", () => {
    expect(formatUsd8(99_999_999n)).toBe("$0.99");
  });

  it("uses English-style thousands separators", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12,345,678.00");
  });

  it("keeps full precision above MAX_SAFE_INTEGER", () => {
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9,007,199,254,740,993.00");
  });
});

describe("formatPriceUsd8", () => {
  it("keeps two decimals for large prices", () => {
    expect(formatPriceUsd8(60_000_000_000n)).toBe("$600.00");
  });

  it("does NOT truncate a cheap token price down to $0.00", () => {
    // This is why prices get their own formatter: every grid line on a token priced at a
    // ten-thousandth of a dollar would look identical through formatUsd8.
    expect(formatPriceUsd8(12_345n)).toBe("$0.00012345");
    expect(formatUsd8(12_345n)).toBe("$0.00");
  });

  it("trims trailing zeros but keeps at least two decimals", () => {
    expect(formatPriceUsd8(150_000_000n)).toBe("$1.50");
    expect(formatPriceUsd8(100_000_000n)).toBe("$1.00");
  });

  it("keeps a negative value readable as negative", () => {
    expect(formatPriceUsd8(-100_000_000n)).toBe("-$1.00");
  });
});

describe("formatToken18", () => {
  it("1e18 wei is 1.000000 token — every BSC token has 18 decimals", () => {
    expect(formatToken18(10n ** 18n)).toBe("1.000000");
  });

  it("truncates at six decimals", () => {
    expect(formatToken18(1_234_567_890_123_456_789n)).toBe("1.234567");
  });
});

describe("formatPercentFromBps and formatBps", () => {
  it("285 bps is 28.5 percent divided by ten — that is 2.8 percent", () => {
    expect(formatPercentFromBps(285n)).toBe("2.8");
  });

  it("writes the bps unit explicitly so it is never confused with a percentage", () => {
    expect(formatBps(285n)).toBe("285 bps");
  });

  it("keeps a negative value readable as negative", () => {
    expect(formatPercentFromBps(-2_000n)).toBe("-20.0");
  });
});
