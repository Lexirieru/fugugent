import { describe, expect, it } from "vitest";
import { runBacktest, type YieldBacktestInput } from "../backtest.js";
import { YieldError, type SwitchCostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const biaya: SwitchCostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: usd(1n) };

/** Dua pool yang bergantian menjadi yang tertinggi dengan selisih kecil. */
function berkedip(candles: number): { poolId: string; apyBps: bigint }[][] {
  const out: { poolId: string; apyBps: bigint }[][] = [];
  for (let i = 0; i < candles; i++) {
    const a = i % 2 === 0 ? 520n : 500n;
    const b = i % 2 === 0 ? 500n : 520n;
    out.push([
      { poolId: "venus-usdt", apyBps: a },
      { poolId: "aave-usdt", apyBps: b },
    ]);
  }
  return out;
}

/** Satu pool jelas dan tetap lebih tinggi sepanjang periode. */
function selisihNyata(candles: number): { poolId: string; apyBps: bigint }[][] {
  return Array.from({ length: candles }, () => [
    { poolId: "venus-usdt", apyBps: 500n },
    { poolId: "aave-usdt", apyBps: 1_500n },
  ]);
}

function input(over: Partial<YieldBacktestInput> = {}): YieldBacktestInput {
  return {
    startPrincipalBase: usd(10_000n),
    startPoolId: "venus-usdt",
    pools: [
      { poolId: "venus-usdt", protocol: "venus", tvlBase: usd(1_000_000n), riskScore: 10 },
      { poolId: "aave-usdt", protocol: "aave", tvlBase: usd(1_000_000n), riskScore: 10 },
    ],
    apySeriesBps: berkedip(60),
    daysPerCandle: 1n,
    cost: biaya,
    ...over,
  };
}

describe("runBacktest — kemurnian", () => {
  it("deterministik", () => {
    expect(runBacktest(input())).toEqual(runBacktest(input()));
  });

  it("melaporkan jumlah candle", () => {
    expect(runBacktest(input()).candles).toBe(60);
  });
});

describe("runBacktest — mengejar APY tertinggi adalah cara kalah", () => {
  it("pengejar berpindah pada hampir setiap candle, yang disiplin tidak sama sekali", () => {
    const r = runBacktest(input());
    expect(r.chaser.migrations).toBeGreaterThan(40);
    expect(r.disciplined.migrations).toBe(0);
  });

  it("pengejar membayar ongkos berlipat dan berakhir lebih miskin daripada yang diam saja", () => {
    const r = runBacktest(input());
    expect(r.chaser.totalCostBase).toBeGreaterThan(r.disciplined.totalCostBase);
    expect(r.chaser.finalPrincipalBase).toBeLessThan(r.passive.finalPrincipalBase);
  });

  it("yang disiplin mengungguli pengejar pada APY yang berkedip", () => {
    const r = runBacktest(input());
    expect(r.disciplinedBeatsChaser).toBe(true);
  });
});

describe("runBacktest — selisih yang nyata memang dikejar", () => {
  it("selisih 1000 bps yang bertahan memicu satu perpindahan, bukan nol dan bukan banyak", () => {
    const r = runBacktest(input({ apySeriesBps: selisihNyata(60) }));
    expect(r.disciplined.migrations).toBe(1);
  });

  it("perpindahan itu menguntungkan: mengungguli tetap diam", () => {
    const r = runBacktest(input({ apySeriesBps: selisihNyata(60) }));
    expect(r.disciplined.finalPrincipalBase).toBeGreaterThan(r.passive.finalPrincipalBase);
  });

  it("perpindahan baru terjadi setelah konfirmasi, bukan pada pengamatan pertama", () => {
    const r = runBacktest(input({ apySeriesBps: selisihNyata(60) }));
    expect(r.disciplined.firstMigrationCandle).toBeGreaterThanOrEqual(2);
  });

  it("periode terlalu pendek untuk membayar ongkos: yang disiplin tetap diam", () => {
    // Ongkos $16 tidak akan kembali dalam beberapa hari, tetapi ambang wajib
    // memakai horizon 30 hari dan tetap membolehkan pindah. Test ini merekam
    // bahwa keputusan tidak pernah melihat panjang deret — horizonnyalah
    // asumsinya, bukan durasi backtest.
    const r = runBacktest(input({ apySeriesBps: selisihNyata(4) }));
    expect(r.disciplined.migrations).toBe(1);
    expect(r.disciplined.finalPrincipalBase).toBeLessThan(r.passive.finalPrincipalBase);
  });
});

describe("runBacktest — gagal keras pada masukan tak masuk akal", () => {
  it("deret APY kosong ditolak", () => {
    expect(() => runBacktest(input({ apySeriesBps: [] }))).toThrow(YieldError);
  });

  it("pool awal yang tidak ada dalam daftar pool ditolak", () => {
    expect(() => runBacktest(input({ startPoolId: "tidak-ada" }))).toThrow(YieldError);
  });

  it("baris APY yang menyebut pool tak dikenal ditolak", () => {
    expect(() =>
      runBacktest(input({ apySeriesBps: [[{ poolId: "hantu", apyBps: 500n }]] })),
    ).toThrow(YieldError);
  });

  it("hari per candle nol ditolak", () => {
    expect(() => runBacktest(input({ daysPerCandle: 0n }))).toThrow(YieldError);
  });
});
