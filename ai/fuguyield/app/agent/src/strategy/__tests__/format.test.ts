import { describe, expect, it } from "vitest";
import { formatApyBps, formatBps, formatPercentFromBps, formatToken18, formatUsd8 } from "../format.js";

describe("formatUsd8", () => {
  it("12345678 on the 8-decimal basis is $0.12 — not twelve million", () => {
    expect(formatUsd8(12_345_678n)).toBe("$0.12");
  });

  it("truncates fractions of a cent", () => {
    expect(formatUsd8(99_999_999n)).toBe("$0.99");
  });

  it("uses English-style thousands separators", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12,345,678.00");
  });

  it("keeps a negative value readable as negative — a loss must never disguise itself as a gain", () => {
    expect(formatUsd8(-100_000_000n)).toBe("-$1.00");
  });

  it("keeps full precision above MAX_SAFE_INTEGER", () => {
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9,007,199,254,740,993.00");
  });
});

describe("formatApyBps", () => {
  it("500 bps is 5.00% a year", () => {
    expect(formatApyBps(500n)).toBe("5.00%");
  });

  it("uses two decimals because the APY spreads this strategy argues about are tens of bps wide", () => {
    expect(formatApyBps(195n)).toBe("1.95%");
    expect(formatApyBps(1n)).toBe("0.01%");
  });

  it("keeps a large APY readable", () => {
    expect(formatApyBps(100_000n)).toBe("1,000.00%");
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
  it("2000 bps is 20.0 percent", () => {
    expect(formatPercentFromBps(2_000n)).toBe("20.0");
  });

  it("writes the bps unit explicitly", () => {
    expect(formatBps(390n)).toBe("390 bps");
  });
});
