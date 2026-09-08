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

const seimbang: Asset[] = [
  { symbol: "WBNB", valueBase: usd(5_000n), targetWeightBps: 5_000n },
  { symbol: "USDT", valueBase: usd(5_000n), targetWeightBps: 5_000n },
];

const miring: Asset[] = [
  { symbol: "WBNB", valueBase: usd(6_000n), targetWeightBps: 5_000n },
  { symbol: "USDT", valueBase: usd(4_000n), targetWeightBps: 5_000n },
];

const biaya: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 30_000_000n };

describe("totalValueBase", () => {
  it("menjumlahkan seluruh nilai aset", () => {
    expect(totalValueBase(seimbang)).toBe(usd(10_000n));
  });

  it("portofolio kosong bernilai nol", () => {
    expect(totalValueBase([])).toBe(0n);
  });
});

describe("weightBps", () => {
  it("setengah portofolio adalah 5000 bps", () => {
    expect(weightBps(usd(5_000n), usd(10_000n))).toBe(5_000n);
  });

  it("dibulatkan ke bawah, bukan ke atas", () => {
    // 1/3 = 3333,33 bps -> 3333
    expect(weightBps(1n, 3n)).toBe(3_333n);
  });

  it("total nol adalah pertanyaan tanpa jawaban, bukan nol diam-diam", () => {
    expect(() => weightBps(0n, 0n)).toThrow(PortfolioError);
  });
});

describe("absDeviationBps", () => {
  it("aset 60% dengan target 50% menyimpang 1000 bps", () => {
    expect(absDeviationBps(usd(6_000n), 5_000n, usd(10_000n))).toBe(1_000n);
  });

  it("arah underweight menghasilkan magnitudo yang sama", () => {
    expect(absDeviationBps(usd(4_000n), 5_000n, usd(10_000n))).toBe(1_000n);
  });

  it("dipotong ke bawah supaya penyimpangan tidak pernah dilebih-lebihkan", () => {
    // nilai 1, target 5000 bps, total 3 -> |1*10000 - 3*5000| / 3 = 5000/3 = 1666,67 -> 1666
    expect(absDeviationBps(1n, 5_000n, 3n)).toBe(1_666n);
  });
});

describe("maxAbsDeviationBps", () => {
  it("portofolio tepat pada target tidak menyimpang", () => {
    expect(maxAbsDeviationBps(seimbang, totalValueBase(seimbang))).toBe(0n);
  });

  it("mengambil penyimpangan terbesar di antara aset", () => {
    expect(maxAbsDeviationBps(miring, totalValueBase(miring))).toBe(1_000n);
  });
});

describe("targetValueBase", () => {
  it("50% dari $10.000 adalah $5.000", () => {
    expect(targetValueBase(usd(10_000n), 5_000n)).toBe(usd(5_000n));
  });
});

describe("computeTrades", () => {
  it("portofolio seimbang tidak menghasilkan transaksi", () => {
    expect(computeTrades(seimbang, totalValueBase(seimbang))).toEqual([]);
  });

  it("aset kelebihan bobot dijual, yang kekurangan dibeli", () => {
    const t = computeTrades(miring, totalValueBase(miring));
    expect(t).toEqual([
      { symbol: "WBNB", side: "SELL", valueBase: usd(1_000n) },
      { symbol: "USDT", side: "BUY", valueBase: usd(1_000n) },
    ]);
  });

  it("jual selalu mendahului beli supaya eksekusi tidak butuh modal di muka", () => {
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
  it("hanya kaki jual yang dihitung — nilai yang sama tidak boleh dihitung dua kali", () => {
    const t = computeTrades(miring, totalValueBase(miring));
    expect(turnoverBase(t)).toBe(usd(1_000n));
  });

  it("tanpa transaksi tidak ada turnover", () => {
    expect(turnoverBase([])).toBe(0n);
  });
});

describe("estimateCostBase", () => {
  it("biaya = bagian proporsional + gas tetap", () => {
    // 15 bps dari $1.000 = $1,50; ditambah gas $0,30 = $1,80
    expect(estimateCostBase(usd(1_000n), biaya)).toBe(180_000_000n);
  });

  it("bagian proporsional dibulatkan ke ATAS supaya biaya tidak pernah diremehkan", () => {
    // 15 bps dari 1 unit basis = 0,0015 -> dibulatkan jadi 1
    expect(estimateCostBase(1n, { ...biaya, gasCostBase: 0n })).toBe(1n);
  });

  it("turnover nol tetap membayar gas nol karena tidak ada transaksi yang dikirim", () => {
    expect(estimateCostBase(0n, biaya)).toBe(0n);
  });
});

describe("costBpsOfTurnover", () => {
  it("biaya $1,80 atas turnover $1.000 adalah 18 bps", () => {
    expect(costBpsOfTurnover(180_000_000n, usd(1_000n))).toBe(18n);
  });

  it("dibulatkan ke atas supaya gerbang biaya tidak pernah lolos karena pembulatan", () => {
    expect(costBpsOfTurnover(1n, usd(1_000n))).toBe(1n);
  });

  it("turnover nol tidak punya biaya relatif yang bermakna", () => {
    expect(() => costBpsOfTurnover(1n, 0n)).toThrow(PortfolioError);
  });
});

describe("minEconomicTurnoverBase", () => {
  it("mengembalikan turnover yang DIJAMIN lolos gerbang biaya", () => {
    // Batas analitis murni adalah gas*10000/(maxCostBps - (fee+slip)) = 30_000_000*10000/35.
    // Karena estimateCostBase membulatkan bagian proporsional ke ATAS, batas itu
    // masih bisa gagal; rumusnya memakai (gas + 1) supaya pembulatan selalu tertutupi.
    expect(minEconomicTurnoverBase(biaya, 50n)).toBe(8_571_428_858n);
  });

  it("turnover yang dikembalikan benar-benar lolos gerbang", () => {
    const t = minEconomicTurnoverBase(biaya, 50n)!;
    expect(costBpsOfTurnover(estimateCostBase(t, biaya), t)).toBeLessThanOrEqual(50n);
  });

  it("batas analitis naif TIDAK lolos gerbang — inilah alasan rumusnya memakai gas+1", () => {
    const naif = 8_571_428_572n; // 30_000_000 * 10_000 / 35, dibulatkan ke atas
    expect(costBpsOfTurnover(estimateCostBase(naif, biaya), naif)).toBeGreaterThan(50n);
  });

  it("null bila biaya proporsional saja sudah melampaui anggaran — tidak ada ukuran yang menyelamatkannya", () => {
    expect(minEconomicTurnoverBase(biaya, 15n)).toBeNull();
    expect(minEconomicTurnoverBase(biaya, 10n)).toBeNull();
  });

  it("tanpa gas pun ada turnover minimum, karena biaya proporsional dibulatkan ke atas", () => {
    const t = minEconomicTurnoverBase({ ...biaya, gasCostBase: 0n }, 50n)!;
    expect(t).toBeGreaterThan(0n);
    expect(costBpsOfTurnover(estimateCostBase(t, { ...biaya, gasCostBase: 0n }), t)).toBeLessThanOrEqual(50n);
  });
});
