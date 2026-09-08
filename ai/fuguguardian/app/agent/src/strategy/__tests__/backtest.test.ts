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

  it("anggaran agent yang habis menghentikan intervensi", () => {
    // Deret yang sama dengan skenario unggulan di atas. Tanpa anggaran, agent
    // membayar 1267 lalu 800 dan selamat. Dengan anggaran 1000 — lebih kecil
    // daripada intervensi pertama yang dibutuhkan — agent tidak bisa bertindak
    // sama sekali dan ikut terlikuidasi persis seperti manusia yang lambat.
    const seri = [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n];
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: seri,
      humanReactionCandles: 5,
      agentBudgetBase: 1_000n,
    });
    expect(r.agentBudgetExhausted).toBe(true);
    expect(r.agentInterventions).toBe(0);
    expect(r.agentLiquidations).toBe(1);
    // Keunggulan agent lenyap begitu modalnya dibatasi: inilah yang
    // disembunyikan oleh backtest tanpa anggaran.
    expect(r.liquidationsAvoided).toBe(0);
  });

  it("anggaran yang hanya cukup untuk satu intervensi berhenti setelah intervensi itu", () => {
    // 1267 adalah persis biaya intervensi pertama; intervensi kedua (800)
    // tidak muat lagi, jadi agent lumpuh sesudahnya. Tidak ada pembayaran
    // sebagian dari sisa anggaran (sisa 0).
    const seri = [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n];
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: seri,
      humanReactionCandles: 5,
      agentBudgetBase: 1_267n,
    });
    expect(r.agentInterventions).toBe(1);
    expect(r.agentBudgetExhausted).toBe(true);
  });

  it("tanpa anggaran, agent bertindak tanpa batas", () => {
    // Field agentBudgetBase dibiarkan kosong: agent boleh membayar berapa pun,
    // sesering apa pun. Ini yang membuat angka keunggulan agent harus dibaca
    // sebagai batas atas, bukan hasil yang bisa dijanjikan.
    const seri = [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n];
    const r = runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: 5 });
    expect(r.agentBudgetExhausted).toBe(false);
    expect(r.agentInterventions).toBeGreaterThan(1);
    expect(r.agentLiquidations).toBe(0);

    // Anggaran yang sangat besar berperilaku identik dengan tanpa anggaran.
    const berlimpah = runBacktest({
      ...dasar,
      priceSeriesBps: seri,
      humanReactionCandles: 5,
      agentBudgetBase: 1_000_000_000n,
    });
    expect(berlimpah.agentInterventions).toBe(r.agentInterventions);
    expect(berlimpah.agentLiquidations).toBe(r.agentLiquidations);
    expect(berlimpah.agentBudgetExhausted).toBe(false);
  });

  it("anggaran nol berarti agent tidak pernah bisa bertindak", () => {
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 7_000n, 5_500n],
      humanReactionCandles: 999_999,
      agentBudgetBase: 0n,
    });
    expect(r.agentInterventions).toBe(0);
    expect(r.agentBudgetExhausted).toBe(true);
    expect(r.agentLiquidations).toBe(r.humanLiquidations);
  });

  it("liquidationsAvoided satu run selalu di rentang -1..1", () => {
    // Dokumentasi eksekutabel untuk komentar pada field itu: satu run hanya
    // bisa membandingkan satu nasib lawan satu nasib.
    const kasus = [
      { priceSeriesBps: [10_000n, 10_050n], humanReactionCandles: 0 },
      { priceSeriesBps: [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n], humanReactionCandles: 5 },
      { priceSeriesBps: [10_000n, 4_000n, 3_000n, 2_000n, 1_000n], humanReactionCandles: 2 },
    ];
    for (const k of kasus) {
      const r = runBacktest({ ...dasar, ...k });
      expect(r.liquidationsAvoided).toBeGreaterThanOrEqual(-1);
      expect(r.liquidationsAvoided).toBeLessThanOrEqual(1);
    }
  });
});
