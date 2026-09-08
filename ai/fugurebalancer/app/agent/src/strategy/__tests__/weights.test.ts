import { describe, expect, it } from "vitest";
import {
  absDeviationBps,
  computeTrades,
  costBpsOfTurnover,
  estimateCostBase,
  maxAbsDeviationBps,
  minEconomicTurnoverBase,
  targetValueBase,
  totalValueBase,
  turnoverBase,
  weightBps,
} from "../weights.js";
import { PortfolioError, type Asset, type CostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;

const balanced: Asset[] = [
  { symbol: "WBNB", valueBase: usd(5_000n), targetWeightBps: 5_000n },
  { symbol: "USDT", valueBase: usd(5_000n), targetWeightBps: 5_000n },
];

const skewed: Asset[] = [
  { symbol: "WBNB", valueBase: usd(6_000n), targetWeightBps: 5_000n },
  { symbol: "USDT", valueBase: usd(4_000n), targetWeightBps: 5_000n },
];

const cost: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 30_000_000n };

describe("totalValueBase", () => {
  it("sums every asset value", () => {
    expect(totalValueBase(balanced)).toBe(usd(10_000n));
  });

  it("an empty portfolio is worth zero", () => {
    expect(totalValueBase([])).toBe(0n);
  });
});

describe("weightBps", () => {
  it("half of the portfolio is 5000 bps", () => {
    expect(weightBps(usd(5_000n), usd(10_000n))).toBe(5_000n);
  });

  it("rounds down, not up", () => {
    // 1/3 = 3333.33 bps -> 3333
    expect(weightBps(1n, 3n)).toBe(3_333n);
  });

  it("a zero total is a question with no answer, not a silent zero", () => {
    expect(() => weightBps(0n, 0n)).toThrow(PortfolioError);
  });
});

describe("absDeviationBps", () => {
  it("a 60% asset with a 50% target deviates by 1000 bps", () => {
    expect(absDeviationBps(usd(6_000n), 5_000n, usd(10_000n))).toBe(1_000n);
  });

  it("the underweight direction produces the same magnitude", () => {
    expect(absDeviationBps(usd(4_000n), 5_000n, usd(10_000n))).toBe(1_000n);
  });

  it("truncates downward so a deviation is never overstated", () => {
    // value 1, target 5000 bps, total 3 -> |1*10000 - 3*5000| / 3 = 5000/3 = 1666.67 -> 1666
    expect(absDeviationBps(1n, 5_000n, 3n)).toBe(1_666n);
  });
});

describe("maxAbsDeviationBps", () => {
  it("a portfolio exactly on target has no deviation", () => {
    expect(maxAbsDeviationBps(balanced, totalValueBase(balanced))).toBe(0n);
  });

  it("takes the largest deviation across the assets", () => {
    expect(maxAbsDeviationBps(skewed, totalValueBase(skewed))).toBe(1_000n);
  });
});

describe("targetValueBase", () => {
  it("50% of $10,000 is $5,000", () => {
    expect(targetValueBase(usd(10_000n), 5_000n)).toBe(usd(5_000n));
  });
});

describe("computeTrades", () => {
  it("a balanced portfolio produces no trade", () => {
    expect(computeTrades(balanced, totalValueBase(balanced))).toEqual([]);
  });

  it("an overweight asset is sold and an underweight one is bought", () => {
    const t = computeTrades(skewed, totalValueBase(skewed));
    expect(t).toEqual([
      { symbol: "WBNB", side: "SELL", valueBase: usd(1_000n) },
      { symbol: "USDT", side: "BUY", valueBase: usd(1_000n) },
    ]);
  });

  it("sells always precede buys so execution needs no capital up front", () => {
    const t = computeTrades(
      [
        { symbol: "A", valueBase: usd(2_000n), targetWeightBps: 5_000n },
        { symbol: "B", valueBase: usd(8_000n), targetWeightBps: 5_000n },
      ],
      usd(10_000n),
    );
    expect(t[0]!.side).toBe("SELL");
    expect(t[0]!.symbol).toBe("B");
  });
});

describe("turnoverBase", () => {
  it("only the sell legs are counted — the same value must not be counted twice", () => {
    const t = computeTrades(skewed, totalValueBase(skewed));
    expect(turnoverBase(t)).toBe(usd(1_000n));
  });

  it("no trades means no turnover", () => {
    expect(turnoverBase([])).toBe(0n);
  });
});

describe("estimateCostBase", () => {
  it("cost = the proportional part + the fixed gas", () => {
    // 15 bps of $1,000 = $1.50; plus $0.30 of gas = $1.80
    expect(estimateCostBase(usd(1_000n), cost)).toBe(180_000_000n);
  });

  it("the proportional part rounds UP so the cost is never understated", () => {
    // 15 bps of 1 basis unit = 0.0015 -> rounded up to 1
    expect(estimateCostBase(1n, { ...cost, gasCostBase: 0n })).toBe(1n);
  });

  it("zero turnover still pays zero gas because no transaction is sent", () => {
    expect(estimateCostBase(0n, cost)).toBe(0n);
  });
});

describe("costBpsOfTurnover", () => {
  it("a $1.80 cost on $1,000 of turnover is 18 bps", () => {
    expect(costBpsOfTurnover(180_000_000n, usd(1_000n))).toBe(18n);
  });

  it("rounds up so the cost gate is never cleared by rounding", () => {
    expect(costBpsOfTurnover(1n, usd(1_000n))).toBe(1n);
  });

  it("zero turnover has no meaningful relative cost", () => {
    expect(() => costBpsOfTurnover(1n, 0n)).toThrow(PortfolioError);
  });
});

describe("minEconomicTurnoverBase", () => {
  it("returns a turnover GUARANTEED to clear the cost gate", () => {
    // The purely analytic bound is gas*10000/(maxCostBps - (fee+slip)) = 30_000_000*10000/35.
    // Because estimateCostBase rounds the proportional part UP, that bound can still
    // fail; the formula uses (gas + 1) so the rounding is always covered.
    expect(minEconomicTurnoverBase(cost, 50n)).toBe(8_571_428_858n);
  });

  it("the returned turnover really does clear the gate", () => {
    const t = minEconomicTurnoverBase(cost, 50n)!;
    expect(costBpsOfTurnover(estimateCostBase(t, cost), t)).toBeLessThanOrEqual(50n);
  });

  it("the naive analytic bound does NOT clear the gate — this is why the formula uses gas+1", () => {
    const naive = 8_571_428_572n; // 30_000_000 * 10_000 / 35, rounded up
    expect(costBpsOfTurnover(estimateCostBase(naive, cost), naive)).toBeGreaterThan(50n);
  });

  it("null when the proportional cost alone already exceeds the budget — no size can save it", () => {
    expect(minEconomicTurnoverBase(cost, 15n)).toBeNull();
    expect(minEconomicTurnoverBase(cost, 10n)).toBeNull();
  });

  it("even with no gas there is a minimum turnover, because the proportional cost rounds up", () => {
    const t = minEconomicTurnoverBase({ ...cost, gasCostBase: 0n }, 50n)!;
    expect(t).toBeGreaterThan(0n);
    expect(costBpsOfTurnover(estimateCostBase(t, { ...cost, gasCostBase: 0n }), t)).toBeLessThanOrEqual(50n);
  });
});
