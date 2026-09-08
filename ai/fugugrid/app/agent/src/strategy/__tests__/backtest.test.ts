import { describe, expect, it } from "vitest";
import { runBacktest, type GridBacktestInput } from "../backtest.js";
import { GridError, type CostModel, type GridConfig } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;

const grid: GridConfig = {
  lowerBase: usd(500n),
  upperBase: usd(700n),
  levels: 11,
  capitalBase: usd(1_000n),
};

const cost: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 5_000_000n };

/** The price swings back and forth between two prices inside the grid's range. */
function swing(candles: number, a: bigint, b: bigint): bigint[] {
  const out: bigint[] = [usd(600n)];
  for (let i = 0; i < candles; i++) out.push(i % 2 === 0 ? usd(a) : usd(b));
  return out;
}

function input(over: Partial<GridBacktestInput> = {}): GridBacktestInput {
  return { config: grid, priceSeriesBase: swing(40, 560n, 640n), cost, ...over };
}

describe("runBacktest — purity", () => {
  it("is deterministic", () => {
    expect(runBacktest(input())).toEqual(runBacktest(input()));
  });

  it("reports the candle count it was given", () => {
    expect(runBacktest(input()).candles).toBe(41);
  });
});

describe("runBacktest — the grid harvests swings inside its range", () => {
  it("sideways market: the grid beats buy-and-hold", () => {
    const r = runBacktest(input());
    expect(r.gridBeatsHold).toBe(true);
    expect(r.finalValueBase).toBeGreaterThan(r.holdValueBase);
  });

  it("every swing produces a buy and a sell", () => {
    const r = runBacktest(input());
    expect(r.buys).toBeGreaterThan(0);
    expect(r.sells).toBeGreaterThan(0);
  });

  it("the costs paid are recorded and are not zero", () => {
    expect(runBacktest(input()).totalCostBase).toBeGreaterThan(0n);
  });

  it("the grid does not exit while the price stays inside the range", () => {
    expect(runBacktest(input()).exitedAtCandle).toBeNull();
  });
});

describe("runBacktest — a grid that knows when to stop", () => {
  it("an uptrend through the upper bound triggers an exit, and the simulation stops there", () => {
    const rising: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) rising.push(usd(600n) + BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: rising }));
    expect(r.exitedAtCandle).not.toBeNull();
    expect(r.exitSide).toBe("ABOVE");
  });

  it("HONESTY: in an uptrend, buy-and-hold beats the grid — the grid sells the rally away", () => {
    const rising: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) rising.push(usd(600n) + BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: rising }));
    expect(r.holdValueBase).toBeGreaterThan(r.finalValueBase);
    expect(r.gridBeatsHold).toBe(false);
  });

  it("a downtrend through the lower bound triggers an exit downward", () => {
    const falling: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) falling.push(usd(600n) - BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: falling }));
    expect(r.exitSide).toBe("BELOW");
  });

  it("exiting downward caps the loss: the grid stops while the price keeps falling", () => {
    const falling: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) falling.push(usd(600n) - BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: falling }));
    expect(r.finalValueBase).toBeGreaterThan(r.holdValueBase);
  });
});

describe("runBacktest — hard failure on nonsensical input", () => {
  it("rejects an empty price series", () => {
    expect(() => runBacktest(input({ priceSeriesBase: [] }))).toThrow(GridError);
  });

  it("rejects a zero price in the middle of the series", () => {
    expect(() => runBacktest(input({ priceSeriesBase: [usd(600n), 0n] }))).toThrow(GridError);
  });

  it("rejects a grid configuration that cannot turn a profit before a single candle is run", () => {
    expect(() => runBacktest(input({ config: { ...grid, levels: 101 } }))).toThrow(GridError);
  });
});
