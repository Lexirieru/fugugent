import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  type Asset,
  type CostModel,
  type Portfolio,
} from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const ACCOUNT = "0x0000000000000000000000000000000000000001" as const;

function portfolio(assets: Asset[]): Portfolio {
  return { account: ACCOUNT, assets, blockNumber: 1n };
}

/** Two assets targeting 50/50, with values chosen by the caller. */
function twoAssets(a: bigint, b: bigint): Portfolio {
  return portfolio([
    { symbol: "WBNB", valueBase: a, targetWeightBps: 5_000n },
    { symbol: "USDT", valueBase: b, targetWeightBps: 5_000n },
  ]);
}

const cheap: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 30_000_000n };

describe("decide — purity and the deviation gate", () => {
  it("a portfolio exactly on target does nothing", () => {
    const d = decide(twoAssets(usd(5_000n), usd(5_000n)), cheap);
    expect(d.action).toBe("NONE");
    expect(d.trades).toEqual([]);
    expect(d.maxDeviationBps).toBe(0n);
  });

  it("a deviation below the watch band stays NONE", () => {
    // 5100/4900 -> a 100 bps deviation
    const d = decide(twoAssets(usd(5_100n), usd(4_900n)), cheap);
    expect(d.action).toBe("NONE");
    expect(d.maxDeviationBps).toBe(100n);
  });

  it("a deviation exactly at the watch band triggers WATCH", () => {
    // 5250/4750 -> 250 bps
    const d = decide(twoAssets(usd(5_250n), usd(4_750n)), cheap);
    expect(d.action).toBe("WATCH");
    expect(d.maxDeviationBps).toBe(DEFAULT_THRESHOLDS.watchBandBps);
  });

  it("WATCH never proposes a trade", () => {
    expect(decide(twoAssets(usd(5_300n), usd(4_700n)), cheap).trades).toEqual([]);
  });

  it("a deviation exactly at the rebalance band already triggers a rebalance", () => {
    // 5500/4500 -> 500 bps
    const d = decide(twoAssets(usd(5_500n), usd(4_500n)), cheap);
    expect(d.action).toBe("REBALANCE");
    expect(d.maxDeviationBps).toBe(DEFAULT_THRESHOLDS.rebalanceBandBps);
  });

  it("a rebalance produces sell-then-buy trades of balanced value", () => {
    const d = decide(twoAssets(usd(6_000n), usd(4_000n)), cheap);
    expect(d.action).toBe("REBALANCE");
    expect(d.trades).toEqual([
      { symbol: "WBNB", side: "SELL", valueBase: usd(1_000n) },
      { symbol: "USDT", side: "BUY", valueBase: usd(1_000n) },
    ]);
    expect(d.turnoverBase).toBe(usd(1_000n));
  });

  it("pure function: two calls on the same input produce identical results", () => {
    const p = twoAssets(usd(6_000n), usd(4_000n));
    expect(decide(p, cheap)).toEqual(decide(p, cheap));
  });

  it("does not mutate the input portfolio", () => {
    const p = twoAssets(usd(6_000n), usd(4_000n));
    const copy = JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    decide(p, cheap);
    expect(JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))).toEqual(copy);
  });
});

describe("decide — the cost gate", () => {
  it("a large deviation on a small portfolio is refused because gas eats the turnover", () => {
    // $100 total, $10 turnover; the $0.30 of gas alone is already 300 bps of turnover
    const d = decide(twoAssets(usd(60n), usd(40n)), cheap);
    expect(d.action).toBe("BLOCKED_BY_COST");
    expect(d.estimatedCostBps).toBeGreaterThan(DEFAULT_THRESHOLDS.maxRebalanceCostBps);
  });

  it("BLOCKED_BY_COST returns no trades at all — the caller must not hold anything executable", () => {
    expect(decide(twoAssets(usd(60n), usd(40n)), cheap).trades).toEqual([]);
  });

  it("BLOCKED_BY_COST still reports turnover and cost so the decision can be audited", () => {
    const d = decide(twoAssets(usd(60n), usd(40n)), cheap);
    expect(d.turnoverBase).toBe(usd(10n));
    expect(d.estimatedCostBase).toBeGreaterThan(0n);
  });

  it("the same portfolio becomes economic once gas falls", () => {
    const d = decide(twoAssets(usd(60n), usd(40n)), { ...cheap, gasCostBase: 0n });
    expect(d.action).toBe("REBALANCE");
  });

  it("a cost exactly at the maximum threshold is still executed", () => {
    // gas chosen so costBps lands exactly on 50: $1,000 of turnover -> 15 bps
    // proportional, so the remaining 35 bps must come from gas = 35/10000 * 1e11 = 350_000_000
    const d = decide(twoAssets(usd(6_000n), usd(4_000n)), { ...cheap, gasCostBase: 350_000_000n });
    expect(d.estimatedCostBps).toBe(50n);
    expect(d.action).toBe("REBALANCE");
  });

  it("one base unit more gas is enough to refuse", () => {
    const d = decide(twoAssets(usd(6_000n), usd(4_000n)), { ...cheap, gasCostBase: 350_000_001n });
    expect(d.action).toBe("BLOCKED_BY_COST");
  });
});

describe("decide — the explanation", () => {
  it("the reason is always filled in and never carries a raw 8-decimal number", () => {
    const d = decide(twoAssets(usd(6_000n), usd(4_000n)), cheap);
    expect(d.reason.length).toBeGreaterThan(10);
    expect(d.reason).toContain("$");
    expect(d.reason).not.toContain("100000000000");
  });

  it("the BLOCKED_BY_COST reason names the cost budget", () => {
    const d = decide(twoAssets(usd(60n), usd(40n)), cheap);
    expect(d.reason).toContain("50");
  });
});

describe("decide — hard failure on nonsensical input", () => {
  it("rejects target weights that do not sum to 10,000 bps", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: 5_000n },
      { symbol: "B", valueBase: usd(5_000n), targetWeightBps: 4_000n },
    ]);
    expect(() => decide(p, cheap)).toThrow(PortfolioError);
  });

  it("a single-asset portfolio is not a portfolio — there is nothing to balance", () => {
    const p = portfolio([{ symbol: "A", valueBase: usd(1n), targetWeightBps: 10_000n }]);
    expect(() => decide(p, cheap)).toThrow(PortfolioError);
  });

  it("rejects a duplicate symbol because its weight becomes ambiguous", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: 5_000n },
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: 5_000n },
    ]);
    expect(() => decide(p, cheap)).toThrow(PortfolioError);
  });

  it("rejects a negative asset value", () => {
    expect(() => decide(twoAssets(-1n, usd(10_000n)), cheap)).toThrow(PortfolioError);
  });

  it("rejects a portfolio worth zero instead of treating it as perfectly balanced", () => {
    expect(() => decide(twoAssets(0n, 0n), cheap)).toThrow(PortfolioError);
  });

  it("rejects a negative target weight", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: -1n },
      { symbol: "B", valueBase: usd(5_000n), targetWeightBps: 10_001n },
    ]);
    expect(() => decide(p, cheap)).toThrow(PortfolioError);
  });

  it("rejects a watch band wider than the rebalance band", () => {
    expect(() =>
      decide(twoAssets(usd(6_000n), usd(4_000n)), cheap, {
        watchBandBps: 600n,
        rebalanceBandBps: 500n,
        maxRebalanceCostBps: 50n,
      }),
    ).toThrow(PortfolioError);
  });

  it("rejects a cost budget smaller than the proportional cost — no rebalance would ever clear it", () => {
    expect(() =>
      decide(twoAssets(usd(6_000n), usd(4_000n)), cheap, {
        ...DEFAULT_THRESHOLDS,
        maxRebalanceCostBps: 15n,
      }),
    ).toThrow(PortfolioError);
  });

  it("rejects a negative swap fee", () => {
    expect(() => decide(twoAssets(usd(6_000n), usd(4_000n)), { ...cheap, swapFeeBps: -1n })).toThrow(
      PortfolioError,
    );
  });

  it("the default cost model passes validation", () => {
    expect(() => decide(twoAssets(usd(6_000n), usd(4_000n)), DEFAULT_COST_MODEL)).not.toThrow();
  });
});

describe("decide — a three-asset portfolio", () => {
  it("balances three assets with unequal targets", () => {
    const p = portfolio([
      { symbol: "WBNB", valueBase: usd(6_000n), targetWeightBps: 4_000n },
      { symbol: "BTCB", valueBase: usd(2_000n), targetWeightBps: 4_000n },
      { symbol: "USDT", valueBase: usd(2_000n), targetWeightBps: 2_000n },
    ]);
    const d = decide(p, cheap);
    expect(d.action).toBe("REBALANCE");
    expect(d.trades).toEqual([
      { symbol: "WBNB", side: "SELL", valueBase: usd(2_000n) },
      { symbol: "BTCB", side: "BUY", valueBase: usd(2_000n) },
    ]);
    expect(d.turnoverBase).toBe(usd(2_000n));
  });

  it("sell and buy values balance to within a dust remainder below one base unit per asset", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(500n), targetWeightBps: 3_333n },
      { symbol: "B", valueBase: usd(250n), targetWeightBps: 3_333n },
      { symbol: "C", valueBase: usd(250n), targetWeightBps: 3_334n },
    ]);
    const d = decide(p, cheap);
    expect(d.action).toBe("REBALANCE");
    const sold = d.trades.filter((t) => t.side === "SELL").reduce((a, t) => a + t.valueBase, 0n);
    const bought = d.trades.filter((t) => t.side === "BUY").reduce((a, t) => a + t.valueBase, 0n);
    expect(sold - bought).toBeLessThan(BigInt(p.assets.length));
    expect(sold - bought).toBeGreaterThanOrEqual(0n);
  });
});
