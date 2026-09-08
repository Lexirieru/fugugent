import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestInput } from "../backtest.js";
import { DEFAULT_THRESHOLDS, PortfolioError, type CostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const cost: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 30_000_000n };

/** Asset 0's price swings up and down; asset 1 is a stablecoin with a fixed price. */
function swing(candles: number, amplitudeBps: bigint): bigint[][] {
  const out: bigint[][] = [];
  for (let i = 0; i < candles; i++) {
    const up = i % 2 === 0;
    out.push([up ? 10_000n + amplitudeBps : 10_000n - amplitudeBps, 10_000n]);
  }
  return out;
}

function input(over: Partial<BacktestInput> = {}): BacktestInput {
  return {
    startAssets: [
      { symbol: "WBNB", startValueBase: usd(5_000n), targetWeightBps: 5_000n },
      { symbol: "USDT", startValueBase: usd(5_000n), targetWeightBps: 5_000n },
    ],
    priceSeriesBps: swing(40, 300n),
    cost: cost,
    thresholds: DEFAULT_THRESHOLDS,
    ...over,
  };
}

describe("runBacktest — purity", () => {
  it("deterministic: two runs on the same input produce identical results", () => {
    expect(runBacktest(input())).toEqual(runBacktest(input()));
  });

  it("reports the candle count it was given", () => {
    expect(runBacktest(input()).candles).toBe(40);
  });
});

describe("runBacktest — costs are the reason the bands exist", () => {
  it("the 'rebalance every candle' policy pays far more in costs than the banded policy", () => {
    const r = runBacktest(input());
    expect(r.always.totalCostBase).toBeGreaterThan(r.banded.totalCostBase);
  });

  it("on small swings inside the band, the banded policy does not trade at all", () => {
    // a 100 bps amplitude -> the weight deviation stays far below the 500 bps band
    const r = runBacktest(input({ priceSeriesBps: swing(40, 100n) }));
    expect(r.banded.rebalances).toBe(0);
    expect(r.banded.totalCostBase).toBe(0n);
    expect(r.always.rebalances).toBeGreaterThan(0);
  });

  it("on a small portfolio, gas ALONE destroys the 'always rebalance' policy's capital", () => {
    // $100 total. Turnover per rebalance is about $0.50, gas is $0.30 per rebalance.
    // A fixed cost that does not shrink with portfolio size is the fastest way to lose
    // money slowly.
    const r = runBacktest(
      input({
        startAssets: [
          { symbol: "WBNB", startValueBase: usd(50n), targetWeightBps: 5_000n },
          { symbol: "USDT", startValueBase: usd(50n), targetWeightBps: 5_000n },
        ],
        priceSeriesBps: swing(40, 100n),
      }),
    );
    expect(r.always.finalValueBase).toBeLessThan(r.never.finalValueBase);
    expect(r.banded.finalValueBase).toBeGreaterThan(r.always.finalValueBase);
    expect(r.bandedBeatsAlways).toBe(true);
  });

  it("HONESTY: on large swings in a large portfolio, 'always rebalance' actually wins — the bands have a price", () => {
    // Rebalancing harvests volatility (sell what rose, buy what fell). When the
    // amplitude is far larger than the cost, that harvest exceeds what it costs and the
    // bands miss it. This is not a bug in the bands, it is the price the bands pay:
    // they trade away part of the volatility harvest for the certainty of not wasting
    // money on costs. This test exists so that the claim "the bands are always better"
    // can never be written anywhere without being contradicted here.
    const r = runBacktest(input({ priceSeriesBps: swing(40, 500n) }));
    expect(r.always.finalValueBase).toBeGreaterThan(r.banded.finalValueBase);
    expect(r.bandedBeatsAlways).toBe(false);
  });

  it("with no costs at all, 'always rebalance' no longer loses — costs are what separate them", () => {
    const free: CostModel = { swapFeeBps: 0n, slippageBps: 0n, gasCostBase: 0n };
    const r = runBacktest(input({ cost: free, priceSeriesBps: swing(40, 100n) }));
    expect(r.always.totalCostBase).toBe(0n);
    expect(r.banded.totalCostBase).toBe(0n);
  });

  it("the 'never rebalance' policy never pays a cost", () => {
    const r = runBacktest(input());
    expect(r.never.totalCostBase).toBe(0n);
    expect(r.never.rebalances).toBe(0);
  });

  it("the banded policy holds the deviation tighter than never rebalancing at all", () => {
    const rising: bigint[][] = [];
    for (let i = 0; i < 30; i++) rising.push([10_000n + BigInt(i) * 500n, 10_000n]);
    const r = runBacktest(input({ priceSeriesBps: rising }));
    expect(r.banded.maxDeviationBps).toBeLessThan(r.never.maxDeviationBps);
  });
});

describe("runBacktest — hard failure on nonsensical input", () => {
  it("rejects an empty price series", () => {
    expect(() => runBacktest(input({ priceSeriesBps: [] }))).toThrow(PortfolioError);
  });

  it("rejects a price row whose length differs from the asset count", () => {
    expect(() => runBacktest(input({ priceSeriesBps: [[10_000n]] }))).toThrow(PortfolioError);
  });

  it("rejects a zero or negative price — that is broken data, not a worthless asset", () => {
    expect(() => runBacktest(input({ priceSeriesBps: [[0n, 10_000n]] }))).toThrow(PortfolioError);
  });
});
