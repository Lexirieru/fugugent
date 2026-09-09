/**
 * The units, the arithmetic, and the way numbers are written out.
 *
 * These look like small tests and they are guarding the largest mistakes available in
 * this codebase. A wrong decimal factor does not produce a wrong-looking number, it
 * produces a plausible number that is off by four orders of magnitude, and the code
 * around it keeps working perfectly.
 */
import { describe, expect, it } from "vitest";
import {
  BPS_ONE,
  CATEGORY_NAMES,
  CatalogError,
  USD8_ONE,
  USD8_TO_WAD,
  WAD,
  categoryFromIndex,
  categoryIndex,
  puffFromBudgetBps,
} from "../types.js";
import {
  formatBps,
  formatDuration,
  formatShare,
  formatToken18,
  formatUsd8,
  formatUsd8Exact,
} from "../format.js";
import {
  budgetUsedBps,
  compareQuotes,
  effectiveBudgetUsd8,
  periodsForWork,
  sameAddress,
} from "../select.js";
import { DEFAULT_POLICY, type HireQuote } from "../types.js";

describe("the units", () => {
  it("keeps money on the 8-decimal basis", () => {
    expect(USD8_ONE).toBe(100_000_000n);
  });

  it("uses 18 decimals for tokens, because every token on BSC has 18, USDT included", () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
  });

  it("converts between the two with 10^10, not 10^12", () => {
    // 10^12 is what you get by assuming USDT has 6 decimals as it does on Ethereum. That
    // assumption makes every payment ten thousand times too large.
    expect(USD8_TO_WAD).toBe(10n ** 10n);
    expect(USD8_ONE * USD8_TO_WAD).toBe(WAD);
  });

  it("uses 10000 bps for one hundred percent", () => {
    expect(BPS_ONE).toBe(10_000n);
  });
});

describe("the capability names", () => {
  it("carries the nine capabilities in the order the contract declares them", () => {
    expect([...CATEGORY_NAMES]).toEqual([
      "REBALANCING",
      "GRID",
      "YIELD",
      "HEALTH_FACTOR",
      "HIRING",
      "COMMERCE",
      "AUTONOMOUS",
      "STREAMING",
      "TREASURY",
    ]);
  });

  it("maps every name back to its own index", () => {
    for (const name of CATEGORY_NAMES) {
      expect(categoryFromIndex(categoryIndex(name))).toBe(name);
    }
  });

  it("keeps the four capabilities that already exist on their original indexes", () => {
    // Moving any of these would relabel every listing already registered on chain.
    expect(categoryIndex("REBALANCING")).toBe(0);
    expect(categoryIndex("GRID")).toBe(1);
    expect(categoryIndex("YIELD")).toBe(2);
    expect(categoryIndex("HEALTH_FACTOR")).toBe(3);
  });

  it("refuses an index this build does not know rather than inventing a meaning", () => {
    expect(() => categoryFromIndex(9)).toThrow(CatalogError);
    expect(() => categoryFromIndex(-1)).toThrow(CatalogError);
    expect(() => categoryFromIndex(1.5)).toThrow(CatalogError);
  });
});

describe("periodsForWork", () => {
  it("rounds up, so the rental never ends before the work does", () => {
    expect(periodsForWork(1n, 120n)).toBe(1n);
    expect(periodsForWork(120n, 120n)).toBe(1n);
    expect(periodsForWork(121n, 120n)).toBe(2n);
    expect(periodsForWork(3_600n, 120n)).toBe(30n);
  });

  it("charges one block for no work at all, because there is no fraction of a block to buy", () => {
    expect(periodsForWork(0n, 120n)).toBe(1n);
  });

  it("refuses a block of zero seconds instead of dividing by it", () => {
    expect(() => periodsForWork(60n, 0n)).toThrow(RangeError);
  });
});

describe("effectiveBudgetUsd8", () => {
  it("takes the smallest of the caller's limit, the per-hire limit and what is left of the window", () => {
    const base = { category: "YIELD" as const, workSeconds: 60n };
    expect(effectiveBudgetUsd8({ ...base, budgetUsd8: 1_000_000n }, DEFAULT_POLICY)).toBe(1_000_000n);
    expect(effectiveBudgetUsd8({ ...base, budgetUsd8: 10n ** 12n }, DEFAULT_POLICY)).toBe(
      DEFAULT_POLICY.maxTotalUsd8,
    );
    expect(
      effectiveBudgetUsd8(
        { ...base, budgetUsd8: 10n ** 12n, alreadySpentUsd8: DEFAULT_POLICY.windowBudgetUsd8 - 7n },
        DEFAULT_POLICY,
      ),
    ).toBe(7n);
  });

  it("never goes below zero when more has been spent than the window allows", () => {
    expect(
      effectiveBudgetUsd8(
        {
          category: "YIELD",
          workSeconds: 60n,
          budgetUsd8: 10n ** 12n,
          alreadySpentUsd8: DEFAULT_POLICY.windowBudgetUsd8 * 2n,
        },
        DEFAULT_POLICY,
      ),
    ).toBe(0n);
  });
});

describe("budgetUsedBps", () => {
  it("rounds up, so the share shown never understates what was committed", () => {
    expect(budgetUsedBps(1n, 3n)).toBe(3_334n);
    expect(budgetUsedBps(1n, 2n)).toBe(5_000n);
    expect(budgetUsedBps(2n, 2n)).toBe(10_000n);
  });

  it("reports nothing committed as nothing", () => {
    expect(budgetUsedBps(0n, 100n)).toBe(0n);
  });

  it("reports spending against a limit of zero as fully loaded", () => {
    expect(budgetUsedBps(1n, 0n)).toBe(10_000n);
  });
});

describe("puffFromBudgetBps", () => {
  it("keeps the calm shape for nothing committed only", () => {
    expect(puffFromBudgetBps(0n)).toBe(0);
    expect(puffFromBudgetBps(1n)).toBe(1);
  });

  it("rises through even quarters and stops at four", () => {
    expect(puffFromBudgetBps(2_499n)).toBe(1);
    expect(puffFromBudgetBps(2_500n)).toBe(2);
    expect(puffFromBudgetBps(4_999n)).toBe(2);
    expect(puffFromBudgetBps(5_000n)).toBe(3);
    expect(puffFromBudgetBps(7_499n)).toBe(3);
    expect(puffFromBudgetBps(7_500n)).toBe(4);
    expect(puffFromBudgetBps(100_000n)).toBe(4);
  });
});

describe("the formatters", () => {
  it("writes money as dollars, truncating rather than rounding up", () => {
    expect(formatUsd8(100_000_000n)).toBe("$1.00");
    expect(formatUsd8(5_000_000n)).toBe("$0.05");
    expect(formatUsd8(199_999_999n)).toBe("$1.99");
    expect(formatUsd8(123_456_789_012n)).toBe("$1,234.56");
  });

  it("keeps all eight decimals where a truncated cent would hide a difference", () => {
    expect(formatUsd8Exact(5_000_000n)).toBe("$0.05000000");
    expect(formatUsd8Exact(5_000_001n)).toBe("$0.05000001");
    expect(formatUsd8(5_000_000n)).toBe(formatUsd8(5_000_001n));
  });

  it("writes an 18-decimal token amount with six decimals", () => {
    expect(formatToken18(WAD)).toBe("1.000000");
    expect(formatToken18(WAD / 2n)).toBe("0.500000");
    expect(formatToken18(1n)).toBe("0.000000");
  });

  it("writes shares and basis points without disagreeing with each other", () => {
    expect(formatBps(50n)).toBe("50 bps");
    expect(formatShare(2_500n)).toBe("25.0%");
    expect(formatShare(10_000n)).toBe("100.0%");
  });

  it("writes a length of time the way a person would say it", () => {
    expect(formatDuration(0n)).toBe("0 seconds");
    expect(formatDuration(1n)).toBe("1 second");
    expect(formatDuration(120n)).toBe("2 minutes");
    expect(formatDuration(3_600n)).toBe("1 hour");
    expect(formatDuration(3_660n)).toBe("1 hour 1 minute");
    expect(formatDuration(2_592_000n)).toBe("30 days");
  });

  it("keeps only the two largest units, so the text is never longer than the real length", () => {
    // 1 day, 1 hour, 1 minute and 1 second.
    expect(formatDuration(90_061n)).toBe("1 day 1 hour");
  });
});

describe("sameAddress", () => {
  it("ignores letter case, because sources disagree about it and values do not", () => {
    expect(sameAddress("0xAbC0000000000000000000000000000000000001", "0xabc0000000000000000000000000000000000001")).toBe(true);
    expect(sameAddress("0xabc0000000000000000000000000000000000001", "0xabc0000000000000000000000000000000000002")).toBe(false);
  });
});

describe("compareQuotes", () => {
  const base: HireQuote = {
    listingId: 1n,
    name: "",
    category: "YIELD",
    owner: "0x1111111111111111111111111111111111111111",
    agentWallet: "0x1111111111111111111111111111111111111111",
    curated: false,
    onchainExecution: false,
    pricePerPeriodUsd8: 5_000_000n,
    periodSeconds: 120n,
    periods: 1n,
    coveredSeconds: 120n,
    totalUsd8: 5_000_000n,
  };

  it("is a total order, so two catalog entries can never tie", () => {
    const a = { ...base, listingId: 1n };
    const b = { ...base, listingId: 2n };
    expect(compareQuotes(a, b)).toBeLessThan(0);
    expect(compareQuotes(b, a)).toBeGreaterThan(0);
    expect(compareQuotes(a, { ...a })).toBe(0);
  });

  it("puts cost first, vetting second and the listing id last", () => {
    const cheap = { ...base, listingId: 9n, totalUsd8: 1n, curated: false };
    const vetted = { ...base, listingId: 1n, totalUsd8: 2n, curated: true };
    expect(compareQuotes(cheap, vetted)).toBeLessThan(0);

    const sameCostVetted = { ...base, listingId: 9n, curated: true };
    const sameCostPlain = { ...base, listingId: 1n, curated: false };
    expect(compareQuotes(sameCostVetted, sameCostPlain)).toBeLessThan(0);
  });
});
