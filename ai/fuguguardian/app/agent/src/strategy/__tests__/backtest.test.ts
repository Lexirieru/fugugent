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
    // collateral falls 45% over two candles; the human only reacts five candles later
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
    // Out-of-order thresholds (deleverage > partialRepay) make decide() throw a
    // PositionError. Failing hard here is deliberate: a partial result from wrong thresholds
    // is more dangerous than no result at all, because someone could mistake that half-way
    // number for a valid one.
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
    // A design choice: negative values are NOT rejected or validated. The human's maturity
    // countdown is `i - pendingSince === humanReactionCandles`; because `i - pendingSince`
    // is never negative, that condition can never be met when humanReactionCandles is
    // negative, so the human effectively never acts. This is consistent with the "very slow
    // reaction" already modeled by a large number, so no separate rejection path is needed.
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
    // The same series as the winning scenario above. With no budget the agent pays 1267 then
    // 800 and survives. With a budget of 1000 — smaller than the first intervention it needs
    // — the agent cannot act at all and gets liquidated exactly like the slow human.
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
    // The agent's edge vanishes as soon as its capital is capped: this is what a backtest
    // with no budget hides.
    expect(r.liquidationsAvoided).toBe(0);
  });

  it("anggaran yang hanya cukup untuk satu intervensi berhenti setelah intervensi itu", () => {
    // 1267 is exactly the cost of the first intervention; the second one (800) no longer
    // fits, so the agent is paralyzed afterwards. There is no partial payment from what is
    // left of the budget (0 left).
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
    // The agentBudgetBase field is left empty: the agent may pay any amount, as often as it
    // likes. This is what makes the agent's edge a number to be read as an upper bound, not
    // as a result that can be promised.
    const seri = [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n];
    const r = runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: 5 });
    expect(r.agentBudgetExhausted).toBe(false);
    expect(r.agentInterventions).toBeGreaterThan(1);
    expect(r.agentLiquidations).toBe(0);

    // A very large budget behaves identically to no budget at all.
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
    // Executable documentation for that field's comment: one run can only compare one fate
    // against one fate.
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
