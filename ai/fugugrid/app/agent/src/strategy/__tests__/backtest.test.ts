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

const biaya: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 5_000_000n };

/** The price swings back and forth between two prices inside the grid's range. */
function ayunan(candles: number, a: bigint, b: bigint): bigint[] {
  const out: bigint[] = [usd(600n)];
  for (let i = 0; i < candles; i++) out.push(i % 2 === 0 ? usd(a) : usd(b));
  return out;
}

function input(over: Partial<GridBacktestInput> = {}): GridBacktestInput {
  return { config: grid, priceSeriesBase: ayunan(40, 560n, 640n), cost: biaya, ...over };
}

describe("runBacktest — kemurnian", () => {
  it("deterministik", () => {
    expect(runBacktest(input())).toEqual(runBacktest(input()));
  });

  it("melaporkan jumlah candle yang diberikan", () => {
    expect(runBacktest(input()).candles).toBe(41);
  });
});

describe("runBacktest — grid memanen ayunan di dalam rentang", () => {
  it("pasar sideways: grid mengungguli beli-lalu-diamkan", () => {
    const r = runBacktest(input());
    expect(r.gridBeatsHold).toBe(true);
    expect(r.finalValueBase).toBeGreaterThan(r.holdValueBase);
  });

  it("setiap ayunan menghasilkan pembelian dan penjualan", () => {
    const r = runBacktest(input());
    expect(r.buys).toBeGreaterThan(0);
    expect(r.sells).toBeGreaterThan(0);
  });

  it("biaya yang dibayar dicatat dan tidak nol", () => {
    expect(runBacktest(input()).totalCostBase).toBeGreaterThan(0n);
  });

  it("grid tidak keluar selama harga tetap di dalam rentang", () => {
    expect(runBacktest(input()).exitedAtCandle).toBeNull();
  });
});

describe("runBacktest — grid yang tahu kapan berhenti", () => {
  it("tren naik menembus batas atas memicu keluar, dan simulasi berhenti di sana", () => {
    const naik: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) naik.push(usd(600n) + BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: naik }));
    expect(r.exitedAtCandle).not.toBeNull();
    expect(r.exitSide).toBe("ABOVE");
  });

  it("KEJUJURAN: pada tren naik, beli-lalu-diamkan mengalahkan grid — grid menjual kenaikannya", () => {
    const naik: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) naik.push(usd(600n) + BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: naik }));
    expect(r.holdValueBase).toBeGreaterThan(r.finalValueBase);
    expect(r.gridBeatsHold).toBe(false);
  });

  it("tren turun menembus batas bawah memicu keluar ke bawah", () => {
    const turun: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) turun.push(usd(600n) - BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: turun }));
    expect(r.exitSide).toBe("BELOW");
  });

  it("keluar ke bawah membatasi kerugian: grid berhenti, harga terus jatuh", () => {
    const turun: bigint[] = [usd(600n)];
    for (let i = 0; i < 40; i++) turun.push(usd(600n) - BigInt(i) * usd(10n));
    const r = runBacktest(input({ priceSeriesBase: turun }));
    expect(r.finalValueBase).toBeGreaterThan(r.holdValueBase);
  });
});

describe("runBacktest — gagal keras pada masukan tak masuk akal", () => {
  it("deret harga kosong ditolak", () => {
    expect(() => runBacktest(input({ priceSeriesBase: [] }))).toThrow(GridError);
  });

  it("harga nol di tengah deret ditolak", () => {
    expect(() => runBacktest(input({ priceSeriesBase: [usd(600n), 0n] }))).toThrow(GridError);
  });

  it("konfigurasi grid yang tidak bisa untung ditolak sebelum satu candle pun dijalankan", () => {
    expect(() => runBacktest(input({ config: { ...grid, levels: 101 } }))).toThrow(GridError);
  });
});
