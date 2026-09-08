import { describe, expect, it } from "vitest";
import {
  bandIndexOf,
  hardLowerBase,
  hardUpperBase,
  intervalsOf,
  levelPriceBase,
  lotValueBase,
  minProfitableStepBps,
  minStepBps,
  pricePosition,
  roundTripCostBps,
  softLowerBase,
  softUpperBase,
  stepBase,
} from "../grid.js";
import { DEFAULT_GRID_THRESHOLDS, GridError, type CostModel, type GridConfig } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;

const grid: GridConfig = {
  lowerBase: usd(500n),
  upperBase: usd(700n),
  levels: 11,
  capitalBase: usd(1_000n),
};

const biaya: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 5_000_000n };

describe("geometri grid", () => {
  it("11 garis grid berarti 10 interval", () => {
    expect(intervalsOf(grid)).toBe(10);
  });

  it("langkah nominal $700-$500 dibagi 10 adalah $20", () => {
    expect(stepBase(grid)).toBe(usd(20n));
  });

  it("garis pertama tepat di batas bawah dan garis terakhir tepat di batas atas", () => {
    expect(levelPriceBase(grid, 0)).toBe(usd(500n));
    expect(levelPriceBase(grid, 10)).toBe(usd(700n));
  });

  it("garis di tengah berjarak sama", () => {
    expect(levelPriceBase(grid, 5)).toBe(usd(600n));
  });

  it("indeks garis di luar 0..interval ditolak", () => {
    expect(() => levelPriceBase(grid, -1)).toThrow(GridError);
    expect(() => levelPriceBase(grid, 11)).toThrow(GridError);
  });
});

describe("minStepBps — jarak antar-garis di titik paling sempit", () => {
  it("diukur di batas ATAS karena di sanalah jarak persentasenya paling kecil", () => {
    // $20 / $700 = 2.857% -> 285 bps (truncated down)
    expect(minStepBps(grid)).toBe(285n);
  });

  it("jarak persentase di batas bawah memang lebih besar — inilah distorsi grid aritmetik", () => {
    const diBawah = (stepBase(grid) * 10_000n) / grid.lowerBase; // $20/$500 = 400 bps
    expect(diBawah).toBeGreaterThan(minStepBps(grid));
    expect(diBawah).toBe(400n);
  });

  it("makin banyak level, makin sempit langkahnya", () => {
    expect(minStepBps({ ...grid, levels: 21 })).toBeLessThan(minStepBps(grid));
  });
});

describe("lotValueBase", () => {
  it("modal $1.000 dibagi 10 interval adalah $100 per lot", () => {
    expect(lotValueBase(grid)).toBe(usd(100n));
  });

  it("level terlalu banyak membuat setiap lot mengecil", () => {
    expect(lotValueBase({ ...grid, levels: 101 })).toBe(usd(10n));
  });
});

describe("roundTripCostBps — ongkos satu putaran beli-lalu-jual", () => {
  it("dua kali biaya proporsional ditambah dua kali gas yang diukur terhadap nilai lot", () => {
    // 2*(5+10) = 30 bps, plus 2*$0.05 of gas on a $100 lot = 10 bps
    expect(roundTripCostBps(usd(100n), biaya)).toBe(40n);
  });

  it("lot yang lebih kecil membuat gas menguasai ongkos", () => {
    expect(roundTripCostBps(usd(10n), biaya)).toBe(130n);
  });

  it("dibulatkan ke ATAS supaya ongkos tidak pernah diremehkan", () => {
    expect(roundTripCostBps(usd(1_000_000n), { swapFeeBps: 0n, slippageBps: 0n, gasCostBase: 1n })).toBe(1n);
  });

  it("lot bernilai nol bukan angka, melainkan konfigurasi rusak", () => {
    expect(() => roundTripCostBps(0n, biaya)).toThrow(GridError);
  });
});

describe("minProfitableStepBps", () => {
  it("dua kali ongkos putaran pada pengali default 2,00x", () => {
    expect(minProfitableStepBps(usd(100n), biaya, DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps)).toBe(80n);
  });

  it("pengali 1,00x menghasilkan grid impas — persis ongkos putaran", () => {
    expect(minProfitableStepBps(usd(100n), biaya, 10_000n)).toBe(40n);
  });

  it("grid $500-$700 dengan 11 level lolos syarat ini dengan lapang", () => {
    expect(minStepBps(grid)).toBeGreaterThan(
      minProfitableStepBps(lotValueBase(grid), biaya, DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps),
    );
  });

  it("grid yang sama dengan 101 level TIDAK lolos — terlalu banyak level adalah cara kehilangan uang perlahan", () => {
    const padat = { ...grid, levels: 101 };
    expect(minStepBps(padat)).toBeLessThan(
      minProfitableStepBps(lotValueBase(padat), biaya, DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps),
    );
  });
});

describe("bandIndexOf dan pricePosition", () => {
  it("harga di batas bawah berada di pita 0", () => {
    expect(bandIndexOf(usd(500n), grid)).toBe(0);
  });

  it("$600 berada di pita 5", () => {
    expect(bandIndexOf(usd(600n), grid)).toBe(5);
  });

  it("$619,99 masih pita 5, $620 sudah pita 6", () => {
    expect(bandIndexOf(usd(620n) - 1n, grid)).toBe(5);
    expect(bandIndexOf(usd(620n), grid)).toBe(6);
  });

  it("harga di atas batas atas dijepit ke pita teratas, bukan meluber", () => {
    expect(bandIndexOf(usd(700n), grid)).toBe(9);
    expect(bandIndexOf(usd(5_000n), grid)).toBe(9);
  });

  it("harga di bawah batas bawah dijepit ke pita nol", () => {
    expect(bandIndexOf(usd(1n), grid)).toBe(0);
  });

  it("posisi harga dilaporkan apa adanya walau pitanya dijepit", () => {
    expect(pricePosition(usd(600n), grid)).toBe("INSIDE");
    expect(pricePosition(usd(499n), grid)).toBe("BELOW");
    expect(pricePosition(usd(701n), grid)).toBe("ABOVE");
    expect(pricePosition(usd(700n), grid)).toBe("ABOVE");
  });
});

describe("batas breakout", () => {
  const t = DEFAULT_GRID_THRESHOLDS;

  it("buffer atas 2% dari $700 adalah $714", () => {
    expect(softUpperBase(grid, t)).toBe(usd(714n));
  });

  it("breakout keras atas 10% dari $700 adalah $770", () => {
    expect(hardUpperBase(grid, t)).toBe(usd(770n));
  });

  it("buffer bawah 2% dari $500 adalah $490", () => {
    expect(softLowerBase(grid, t)).toBe(usd(490n));
  });

  it("breakout keras bawah 10% dari $500 adalah $450", () => {
    expect(hardLowerBase(grid, t)).toBe(usd(450n));
  });

  it("batas bawah dibulatkan ke ATAS supaya breakout terdeteksi lebih awal, bukan lebih lambat", () => {
    // 3 * 9800 / 10000 = 2.94 -> 3, not 2
    expect(softLowerBase({ ...grid, lowerBase: 3n, upperBase: 9n }, t)).toBe(3n);
  });
});
