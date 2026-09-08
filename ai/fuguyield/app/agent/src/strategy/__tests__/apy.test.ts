import { describe, expect, it } from "vitest";
import {
  breakEvenSpreadBps,
  netGainBase,
  poolShareBps,
  requiredSpreadBps,
  switchCostBase,
  yieldOverPeriodBase,
} from "../apy.js";
import { YieldError, type SwitchCostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const POKOK = usd(10_000n);
const biaya: SwitchCostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: usd(1n) };

describe("switchCostBase", () => {
  it("biaya proporsional atas pokok ditambah gas tetap", () => {
    // 15 bps dari $10.000 = $15, ditambah gas $1 = $16
    expect(switchCostBase(POKOK, biaya)).toBe(usd(16n));
  });

  it("dibulatkan ke ATAS supaya ongkos pindah tidak pernah diremehkan", () => {
    expect(switchCostBase(1n, { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 0n })).toBe(1n);
  });

  it("pokok nol tidak masuk akal untuk dipindahkan", () => {
    expect(() => switchCostBase(0n, biaya)).toThrow(YieldError);
  });
});

describe("breakEvenSpreadBps — inti seluruh strategi ini", () => {
  it("memindahkan $10.000 dengan ongkos $16 butuh 195 bps selama 30 hari untuk impas", () => {
    expect(breakEvenSpreadBps(POKOK, usd(16n), 30n)).toBe(195n);
  });

  it("horizon lebih pendek menuntut selisih JAUH lebih besar", () => {
    // Ongkos yang sama harus terbayar dalam waktu lebih singkat.
    expect(breakEvenSpreadBps(POKOK, usd(16n), 7n)).toBeGreaterThan(
      breakEvenSpreadBps(POKOK, usd(16n), 30n),
    );
    expect(breakEvenSpreadBps(POKOK, usd(16n), 7n)).toBe(835n);
  });

  it("pokok lebih besar menuntut selisih lebih kecil — gas tetap makin tidak berarti", () => {
    expect(breakEvenSpreadBps(usd(100_000n), switchCostBase(usd(100_000n), biaya), 30n)).toBeLessThan(
      breakEvenSpreadBps(POKOK, switchCostBase(POKOK, biaya), 30n),
    );
  });

  it("dibulatkan ke ATAS supaya ambang pindah tidak pernah terlalu longgar", () => {
    expect(breakEvenSpreadBps(usd(1_000_000n), 1n, 365n)).toBe(1n);
  });

  it("horizon nol hari adalah pertanyaan tanpa jawaban", () => {
    expect(() => breakEvenSpreadBps(POKOK, usd(16n), 0n)).toThrow(YieldError);
  });

  it("pokok nol ditolak", () => {
    expect(() => breakEvenSpreadBps(0n, usd(16n), 30n)).toThrow(YieldError);
  });
});

describe("requiredSpreadBps", () => {
  it("pengali 2,00x menggandakan ambang impas", () => {
    expect(requiredSpreadBps(195n, 20_000n)).toBe(390n);
  });

  it("pengali 1,00x mengembalikan ambang impas apa adanya", () => {
    expect(requiredSpreadBps(195n, 10_000n)).toBe(195n);
  });

  it("dibulatkan ke atas", () => {
    expect(requiredSpreadBps(1n, 15_000n)).toBe(2n);
  });
});

describe("yieldOverPeriodBase", () => {
  it("5% setahun atas $10.000 selama 365 hari adalah $500", () => {
    expect(yieldOverPeriodBase(POKOK, 500n, 365n)).toBe(usd(500n));
  });

  it("dipotong ke bawah supaya imbal hasil tidak pernah dilebih-lebihkan", () => {
    expect(yieldOverPeriodBase(POKOK, 500n, 1n)).toBe(136_986_301n);
  });

  it("APY nol menghasilkan nol", () => {
    expect(yieldOverPeriodBase(POKOK, 0n, 30n)).toBe(0n);
  });
});

describe("netGainBase", () => {
  it("selisih 400 bps selama 30 hari atas $10.000 melebihi ongkos $16", () => {
    expect(netGainBase(POKOK, 400n, 30n, usd(16n))).toBeGreaterThan(0n);
  });

  it("selisih tepat di ambang impas menghasilkan sekitar nol, tidak pernah positif besar", () => {
    const impas = breakEvenSpreadBps(POKOK, usd(16n), 30n);
    const g = netGainBase(POKOK, impas, 30n, usd(16n));
    expect(g).toBeGreaterThanOrEqual(0n);
    expect(g).toBeLessThan(usd(1n));
  });

  it("selisih di bawah ambang impas merugi", () => {
    expect(netGainBase(POKOK, 100n, 30n, usd(16n))).toBeLessThan(0n);
  });
});

describe("poolShareBps", () => {
  it("pokok $10.000 di pool $100.000 adalah 1000 bps", () => {
    expect(poolShareBps(POKOK, usd(100_000n))).toBe(1_000n);
  });

  it("dibulatkan ke ATAS supaya pangsa kita tidak pernah terlihat lebih kecil", () => {
    expect(poolShareBps(1n, usd(100_000n))).toBe(1n);
  });

  it("pool bernilai nol bukan pool", () => {
    expect(() => poolShareBps(POKOK, 0n)).toThrow(YieldError);
  });
});
