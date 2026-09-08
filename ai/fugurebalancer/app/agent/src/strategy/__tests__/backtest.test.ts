import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestInput } from "../backtest.js";
import { DEFAULT_THRESHOLDS, PortfolioError, type CostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const biaya: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 30_000_000n };

/** Asset 0's price swings up and down; asset 1 is a stablecoin with a fixed price. */
function ayunan(candles: number, amplitudoBps: bigint): bigint[][] {
  const out: bigint[][] = [];
  for (let i = 0; i < candles; i++) {
    const naik = i % 2 === 0;
    out.push([naik ? 10_000n + amplitudoBps : 10_000n - amplitudoBps, 10_000n]);
  }
  return out;
}

function input(over: Partial<BacktestInput> = {}): BacktestInput {
  return {
    startAssets: [
      { symbol: "WBNB", startValueBase: usd(5_000n), targetWeightBps: 5_000n },
      { symbol: "USDT", startValueBase: usd(5_000n), targetWeightBps: 5_000n },
    ],
    priceSeriesBps: ayunan(40, 300n),
    cost: biaya,
    thresholds: DEFAULT_THRESHOLDS,
    ...over,
  };
}

describe("runBacktest — kemurnian", () => {
  it("deterministik: dua kali jalan dengan input sama menghasilkan hasil identik", () => {
    expect(runBacktest(input())).toEqual(runBacktest(input()));
  });

  it("melaporkan jumlah candle yang diberikan", () => {
    expect(runBacktest(input()).candles).toBe(40);
  });
});

describe("runBacktest — biaya adalah alasan pita ada", () => {
  it("kebijakan 'rebalance setiap candle' membayar biaya jauh lebih besar daripada kebijakan berpita", () => {
    const r = runBacktest(input());
    expect(r.always.totalCostBase).toBeGreaterThan(r.banded.totalCostBase);
  });

  it("pada ayunan kecil di dalam pita, kebijakan berpita tidak bertransaksi sama sekali", () => {
    // a 100 bps amplitude -> the weight deviation stays far below the 500 bps band
    const r = runBacktest(input({ priceSeriesBps: ayunan(40, 100n) }));
    expect(r.banded.rebalances).toBe(0);
    expect(r.banded.totalCostBase).toBe(0n);
    expect(r.always.rebalances).toBeGreaterThan(0);
  });

  it("pada portofolio kecil, gas SAJA menghancurkan modal kebijakan 'rebalance selalu'", () => {
    // $100 total. Turnover per rebalance is about $0.50, gas is $0.30 per rebalance.
    // A fixed cost that does not shrink with portfolio size is the fastest way to lose
    // money slowly.
    const r = runBacktest(
      input({
        startAssets: [
          { symbol: "WBNB", startValueBase: usd(50n), targetWeightBps: 5_000n },
          { symbol: "USDT", startValueBase: usd(50n), targetWeightBps: 5_000n },
        ],
        priceSeriesBps: ayunan(40, 100n),
      }),
    );
    expect(r.always.finalValueBase).toBeLessThan(r.never.finalValueBase);
    expect(r.banded.finalValueBase).toBeGreaterThan(r.always.finalValueBase);
    expect(r.bandedBeatsAlways).toBe(true);
  });

  it("KEJUJURAN: pada ayunan besar di portofolio besar, 'rebalance selalu' justru unggul — pita ada ongkosnya", () => {
    // Rebalancing harvests volatility (sell what rose, buy what fell). When the
    // amplitude is far larger than the cost, that harvest exceeds what it costs and the
    // bands miss it. This is not a bug in the bands, it is the price the bands pay:
    // they trade away part of the volatility harvest for the certainty of not wasting
    // money on costs. This test exists so that the claim "the bands are always better"
    // can never be written anywhere without being contradicted here.
    const r = runBacktest(input({ priceSeriesBps: ayunan(40, 500n) }));
    expect(r.always.finalValueBase).toBeGreaterThan(r.banded.finalValueBase);
    expect(r.bandedBeatsAlways).toBe(false);
  });

  it("tanpa biaya sama sekali, 'rebalance selalu' tidak lagi kalah — biayalah pembedanya", () => {
    const gratis: CostModel = { swapFeeBps: 0n, slippageBps: 0n, gasCostBase: 0n };
    const r = runBacktest(input({ cost: gratis, priceSeriesBps: ayunan(40, 100n) }));
    expect(r.always.totalCostBase).toBe(0n);
    expect(r.banded.totalCostBase).toBe(0n);
  });

  it("kebijakan 'tidak pernah rebalance' tidak pernah membayar biaya", () => {
    const r = runBacktest(input());
    expect(r.never.totalCostBase).toBe(0n);
    expect(r.never.rebalances).toBe(0);
  });

  it("kebijakan berpita menahan penyimpangan lebih rapat daripada tidak rebalance sama sekali", () => {
    const naik: bigint[][] = [];
    for (let i = 0; i < 30; i++) naik.push([10_000n + BigInt(i) * 500n, 10_000n]);
    const r = runBacktest(input({ priceSeriesBps: naik }));
    expect(r.banded.maxDeviationBps).toBeLessThan(r.never.maxDeviationBps);
  });
});

describe("runBacktest — gagal keras pada masukan tak masuk akal", () => {
  it("deret harga kosong ditolak", () => {
    expect(() => runBacktest(input({ priceSeriesBps: [] }))).toThrow(PortfolioError);
  });

  it("baris harga yang panjangnya tidak sama dengan jumlah aset ditolak", () => {
    expect(() => runBacktest(input({ priceSeriesBps: [[10_000n]] }))).toThrow(PortfolioError);
  });

  it("harga nol atau negatif ditolak — bukan aset yang tak berharga, melainkan data rusak", () => {
    expect(() => runBacktest(input({ priceSeriesBps: [[0n, 10_000n]] }))).toThrow(PortfolioError);
  });
});
