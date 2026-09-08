import { describe, expect, it } from "vitest";
import {
  USD8_ONE,
  UnitConversionError,
  assertFeedIsUsd8,
  assertTokenDecimalsAgree,
  tokenUnitsToUsd8,
  usd8ToTokenUnits,
} from "../units.js";

const ASSET = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const ONE_DOLLAR_PRICE = USD8_ONE; // $1.00 on the 8-decimal basis
const PRICE_750 = 75_000_000_000n; // $750.00

describe("usd8ToTokenUnits", () => {
  it("$1.00 at a price of $1.00 with an 18-decimal token = 1e18 units", () => {
    expect(usd8ToTokenUnits(USD8_ONE, 18, ONE_DOLLAR_PRICE)).toBe(10n ** 18n);
  });

  it("$6.85 at a price of $1.00 with an 18-decimal token", () => {
    expect(usd8ToTokenUnits(685_000_000n, 18, ONE_DOLLAR_PRICE)).toBe(6_850_000_000_000_000_000n);
  });

  it("a BSC stablecoin still has 18 decimals, not 6 — the unit count differs by 10^12", () => {
    // CLAUDE.md #2: every token on BSC has 18 decimals, including USDT. If someone uses 6
    // out of habit from another chain, the amount sent is off by a factor of ten trillion.
    // This test nails that gap down so it is visible.
    const eighteen = usd8ToTokenUnits(USD8_ONE, 18, ONE_DOLLAR_PRICE);
    const six = usd8ToTokenUnits(USD8_ONE, 6, ONE_DOLLAR_PRICE);
    expect(eighteen / six).toBe(10n ** 12n);
  });

  it("$750.00 at a price of $750.00 with an 18-decimal token = 1e18 units (one token)", () => {
    expect(usd8ToTokenUnits(PRICE_750, 18, PRICE_750)).toBe(10n ** 18n);
  });

  it("rounds DOWN: the agent never sends more than what was decided", () => {
    // $0.00000001 at a price of $1 with a zero-decimal token = 1e-8 tokens -> 0 units.
    expect(usd8ToTokenUnits(1n, 0, ONE_DOLLAR_PRICE)).toBe(0n);
    // One unit short of two full units is still one unit, not two.
    expect(usd8ToTokenUnits(199_999_999n, 0, ONE_DOLLAR_PRICE)).toBe(1n);
  });

  it("zero produces zero, not a throw", () => {
    expect(usd8ToTokenUnits(0n, 18, ONE_DOLLAR_PRICE)).toBe(0n);
  });

  it.each([
    ["a zero price", () => usd8ToTokenUnits(USD8_ONE, 18, 0n)],
    ["a negative price", () => usd8ToTokenUnits(USD8_ONE, 18, -1n)],
    ["a negative amount", () => usd8ToTokenUnits(-1n, 18, ONE_DOLLAR_PRICE)],
    ["negative decimals", () => usd8ToTokenUnits(USD8_ONE, -1, ONE_DOLLAR_PRICE)],
    ["fractional decimals", () => usd8ToTokenUnits(USD8_ONE, 18.5, ONE_DOLLAR_PRICE)],
    ["nonsensical decimals", () => usd8ToTokenUnits(USD8_ONE, 78, ONE_DOLLAR_PRICE)],
  ])("refuses nonsensical input (%s) instead of computing silently", (_l, run) => {
    expect(run).toThrow(UnitConversionError);
  });
});

describe("tokenUnitsToUsd8", () => {
  it("1e18 units of an 18-decimal token at a price of $1.00 = $1.00", () => {
    expect(tokenUnitsToUsd8(10n ** 18n, 18, ONE_DOLLAR_PRICE)).toBe(USD8_ONE);
  });

  it("1e18 units at a price of $750.00 = $750.00", () => {
    expect(tokenUnitsToUsd8(10n ** 18n, 18, PRICE_750)).toBe(PRICE_750);
  });

  it("rounds down", () => {
    expect(tokenUnitsToUsd8(10n ** 18n - 1n, 18, ONE_DOLLAR_PRICE)).toBe(USD8_ONE - 1n);
  });
});

describe("assertTokenDecimalsAgree", () => {
  // This replaces the "round-trip check" that used to be in the E2E script. That check
  // computed a*10^d/p then *p/10^d with the SAME d and p, so it holds for any d and p and
  // could never catch wrong decimals or a wrong feed. What actually catches them is
  // comparing two DIFFERENT SOURCES for the same number.
  it("the two sources agree -> passes", () => {
    expect(() => assertTokenDecimalsAgree(18, 18, ASSET)).not.toThrow();
  });

  it("the pool configuration says 17 while the token itself says 18 -> refused", () => {
    expect(() => assertTokenDecimalsAgree(17, 18, ASSET)).toThrow(UnitConversionError);
    expect(() => assertTokenDecimalsAgree(17, 18, ASSET)).toThrow(/17/);
  });
});

describe("assertFeedIsUsd8", () => {
  it("an 8-decimal feed passes: this whole layer treats its answer as USD on the 8-decimal basis", () => {
    expect(() => assertFeedIsUsd8(8, ASSET)).not.toThrow();
  });

  it.each([6, 18])("a %s-decimal feed is refused, not used as-is", (d) => {
    // `MockPriceFeed` takes `decimals_` as a constructor parameter, so a non-8-decimal feed
    // is not hypothetical — it could be deployed today.
    expect(() => assertFeedIsUsd8(d, ASSET)).toThrow(UnitConversionError);
  });
});
