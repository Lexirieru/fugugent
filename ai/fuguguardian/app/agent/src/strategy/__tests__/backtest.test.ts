import { describe, expect, it } from "vitest";
import { runBacktest } from "../backtest.js";
import { PositionError } from "../types.js";

const dasar = {
  startCollateralBase: 10_000n,
  startDebtBase: 5_000n,
  liquidationThresholdBps: 8000n,
};

describe("runBacktest", () => {
  it("pasar tenang tidak menghasilkan intervensi maupun likuidasi", () => {
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 10_050n, 9_980n, 10_010n],
      humanReactionCandles: 3,
    });
    expect(r.agentInterventions).toBe(0);
    expect(r.agentLiquidations).toBe(0);
    expect(r.humanLiquidations).toBe(0);
    expect(r.liquidationsAvoided).toBe(0);
  });

  it("menghitung setiap candle yang diberikan", () => {
    const r = runBacktest({ ...dasar, priceSeriesBps: [10_000n, 9_000n, 8_000n], humanReactionCandles: 1 });
    expect(r.candles).toBe(3);
  });

  it("penurunan tajam melikuidasi manusia yang lambat tetapi tidak melikuidasi agent", () => {
    // agunan jatuh 45% dalam dua candle; manusia baru bereaksi lima candle kemudian
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n],
      humanReactionCandles: 5,
    });
    expect(r.agentInterventions).toBeGreaterThan(0);
    expect(r.humanLiquidations).toBeGreaterThan(r.agentLiquidations);
    expect(r.liquidationsAvoided).toBe(r.humanLiquidations - r.agentLiquidations);
  });

  it("manusia yang bereaksi secepat agent tidak tertolong lebih banyak", () => {
    const seri = [10_000n, 7_000n, 5_500n, 5_400n];
    const cepat = runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: 0 });
    expect(cepat.liquidationsAvoided).toBe(0);
  });

  it("posisi tanpa hutang tidak pernah terlikuidasi seberapa pun harga jatuh", () => {
    const r = runBacktest({
      ...dasar,
      startDebtBase: 0n,
      priceSeriesBps: [10_000n, 1_000n, 100n],
      humanReactionCandles: 0,
    });
    expect(r.agentLiquidations).toBe(0);
    expect(r.humanLiquidations).toBe(0);
  });

  it("backtest meneruskan kegagalan validasi ambang, bukan menelannya", () => {
    // Ambang tidak berurutan (deleverage > partialRepay) membuat decide()
    // melempar PositionError. Gagal keras di sini disengaja: hasil parsial
    // dari ambang yang salah lebih berbahaya daripada tidak ada hasil sama
    // sekali, karena orang bisa mengira angka setengah-jalan itu valid.
    const ambangTidakValid = {
      warn: 1_500_000_000_000_000_000n,
      partialRepay: 1_200_000_000_000_000_000n,
      deleverage: 1_300_000_000_000_000_000n,
    };
    expect(() =>
      runBacktest({
        ...dasar,
        priceSeriesBps: [10_000n],
        humanReactionCandles: 0,
        thresholds: ambangTidakValid,
      }),
    ).toThrow(PositionError);
  });

  it("humanReactionCandles negatif diperlakukan sebagai tidak pernah bertindak", () => {
    const seri = [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n];
    // Pilihan desain: nilai negatif TIDAK ditolak/divalidasi. Countdown
    // kematangan manusia adalah `i - pendingSince === humanReactionCandles`;
    // karena `i - pendingSince` tidak pernah negatif, syarat itu tidak akan
    // pernah terpenuhi bila humanReactionCandles negatif, sehingga manusia
    // efektif tidak pernah bertindak. Ini konsisten dengan "reaksi sangat
    // lambat" yang sudah dimodelkan lewat angka besar, jadi tidak perlu jalur
    // penolakan terpisah.
    expect(() =>
      runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: -1 }),
    ).not.toThrow();

    const negatif = runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: -1 });
    const takPernahSempatBertindak = runBacktest({
      ...dasar,
      priceSeriesBps: seri,
      humanReactionCandles: 999_999,
    });
    expect(negatif.humanLiquidations).toBe(takPernahSempatBertindak.humanLiquidations);
    expect(negatif.liquidationsAvoided).toBe(takPernahSempatBertindak.liquidationsAvoided);
  });
});
