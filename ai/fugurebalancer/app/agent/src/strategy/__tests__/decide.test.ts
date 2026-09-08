import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  type Asset,
  type CostModel,
  type Portfolio,
} from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const AKUN = "0x0000000000000000000000000000000000000001" as const;

function portfolio(assets: Asset[]): Portfolio {
  return { account: AKUN, assets, blockNumber: 1n };
}

/** Two assets targeting 50/50, with values chosen by the caller. */
function duaAset(a: bigint, b: bigint): Portfolio {
  return portfolio([
    { symbol: "WBNB", valueBase: a, targetWeightBps: 5_000n },
    { symbol: "USDT", valueBase: b, targetWeightBps: 5_000n },
  ]);
}

const murah: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 30_000_000n };

describe("decide — kemurnian dan gerbang penyimpangan", () => {
  it("portofolio tepat pada target tidak melakukan apa pun", () => {
    const d = decide(duaAset(usd(5_000n), usd(5_000n)), murah);
    expect(d.action).toBe("NONE");
    expect(d.trades).toEqual([]);
    expect(d.maxDeviationBps).toBe(0n);
  });

  it("penyimpangan di bawah pita pengamatan tetap NONE", () => {
    // 5100/4900 -> a 100 bps deviation
    const d = decide(duaAset(usd(5_100n), usd(4_900n)), murah);
    expect(d.action).toBe("NONE");
    expect(d.maxDeviationBps).toBe(100n);
  });

  it("penyimpangan tepat di pita pengamatan memicu WATCH", () => {
    // 5250/4750 -> 250 bps
    const d = decide(duaAset(usd(5_250n), usd(4_750n)), murah);
    expect(d.action).toBe("WATCH");
    expect(d.maxDeviationBps).toBe(DEFAULT_THRESHOLDS.watchBandBps);
  });

  it("WATCH tidak pernah mengusulkan transaksi", () => {
    expect(decide(duaAset(usd(5_300n), usd(4_700n)), murah).trades).toEqual([]);
  });

  it("penyimpangan tepat di pita rebalance sudah memicu rebalance", () => {
    // 5500/4500 -> 500 bps
    const d = decide(duaAset(usd(5_500n), usd(4_500n)), murah);
    expect(d.action).toBe("REBALANCE");
    expect(d.maxDeviationBps).toBe(DEFAULT_THRESHOLDS.rebalanceBandBps);
  });

  it("rebalance menghasilkan transaksi jual lalu beli dengan nilai seimbang", () => {
    const d = decide(duaAset(usd(6_000n), usd(4_000n)), murah);
    expect(d.action).toBe("REBALANCE");
    expect(d.trades).toEqual([
      { symbol: "WBNB", side: "SELL", valueBase: usd(1_000n) },
      { symbol: "USDT", side: "BUY", valueBase: usd(1_000n) },
    ]);
    expect(d.turnoverBase).toBe(usd(1_000n));
  });

  it("fungsi murni: dua panggilan dengan input sama menghasilkan hasil identik", () => {
    const p = duaAset(usd(6_000n), usd(4_000n));
    expect(decide(p, murah)).toEqual(decide(p, murah));
  });

  it("tidak memutasi portofolio masukan", () => {
    const p = duaAset(usd(6_000n), usd(4_000n));
    const salinan = JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    decide(p, murah);
    expect(JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))).toEqual(salinan);
  });
});

describe("decide — gerbang biaya", () => {
  it("penyimpangan besar pada portofolio kecil ditolak karena gas melahap turnover", () => {
    // $100 total, $10 turnover; the $0.30 of gas alone is already 300 bps of turnover
    const d = decide(duaAset(usd(60n), usd(40n)), murah);
    expect(d.action).toBe("BLOCKED_BY_COST");
    expect(d.estimatedCostBps).toBeGreaterThan(DEFAULT_THRESHOLDS.maxRebalanceCostBps);
  });

  it("BLOCKED_BY_COST tidak mengembalikan transaksi apa pun — pemanggil tidak boleh punya apa yang bisa dieksekusi", () => {
    expect(decide(duaAset(usd(60n), usd(40n)), murah).trades).toEqual([]);
  });

  it("BLOCKED_BY_COST tetap melaporkan turnover dan biaya supaya keputusannya bisa diaudit", () => {
    const d = decide(duaAset(usd(60n), usd(40n)), murah);
    expect(d.turnoverBase).toBe(usd(10n));
    expect(d.estimatedCostBase).toBeGreaterThan(0n);
  });

  it("portofolio yang sama menjadi ekonomis ketika gas turun", () => {
    const d = decide(duaAset(usd(60n), usd(40n)), { ...murah, gasCostBase: 0n });
    expect(d.action).toBe("REBALANCE");
  });

  it("biaya tepat di ambang maksimum masih dieksekusi", () => {
    // gas chosen so costBps lands exactly on 50: $1,000 of turnover -> 15 bps
    // proportional, so the remaining 35 bps must come from gas = 35/10000 * 1e11 = 350_000_000
    const d = decide(duaAset(usd(6_000n), usd(4_000n)), { ...murah, gasCostBase: 350_000_000n });
    expect(d.estimatedCostBps).toBe(50n);
    expect(d.action).toBe("REBALANCE");
  });

  it("satu unit basis gas lebih mahal sudah cukup untuk menolak", () => {
    const d = decide(duaAset(usd(6_000n), usd(4_000n)), { ...murah, gasCostBase: 350_000_001n });
    expect(d.action).toBe("BLOCKED_BY_COST");
  });
});

describe("decide — penjelasan", () => {
  it("alasan selalu terisi dan tidak pernah memuat angka mentah basis 8 desimal", () => {
    const d = decide(duaAset(usd(6_000n), usd(4_000n)), murah);
    expect(d.reason.length).toBeGreaterThan(10);
    expect(d.reason).toContain("$");
    expect(d.reason).not.toContain("100000000000");
  });

  it("alasan BLOCKED_BY_COST menyebut anggaran biaya", () => {
    const d = decide(duaAset(usd(60n), usd(40n)), murah);
    expect(d.reason).toContain("50");
  });
});

describe("decide — gagal keras pada masukan tak masuk akal", () => {
  it("bobot target yang tidak berjumlah 10.000 bps ditolak", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: 5_000n },
      { symbol: "B", valueBase: usd(5_000n), targetWeightBps: 4_000n },
    ]);
    expect(() => decide(p, murah)).toThrow(PortfolioError);
  });

  it("portofolio satu aset bukan portofolio — tidak ada yang bisa diseimbangkan", () => {
    const p = portfolio([{ symbol: "A", valueBase: usd(1n), targetWeightBps: 10_000n }]);
    expect(() => decide(p, murah)).toThrow(PortfolioError);
  });

  it("simbol duplikat ditolak karena bobotnya menjadi ambigu", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: 5_000n },
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: 5_000n },
    ]);
    expect(() => decide(p, murah)).toThrow(PortfolioError);
  });

  it("nilai aset negatif ditolak", () => {
    expect(() => decide(duaAset(-1n, usd(10_000n)), murah)).toThrow(PortfolioError);
  });

  it("portofolio bernilai nol ditolak, bukan dianggap seimbang sempurna", () => {
    expect(() => decide(duaAset(0n, 0n), murah)).toThrow(PortfolioError);
  });

  it("bobot target negatif ditolak", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(5_000n), targetWeightBps: -1n },
      { symbol: "B", valueBase: usd(5_000n), targetWeightBps: 10_001n },
    ]);
    expect(() => decide(p, murah)).toThrow(PortfolioError);
  });

  it("pita pengamatan yang lebih lebar daripada pita rebalance ditolak", () => {
    expect(() =>
      decide(duaAset(usd(6_000n), usd(4_000n)), murah, {
        watchBandBps: 600n,
        rebalanceBandBps: 500n,
        maxRebalanceCostBps: 50n,
      }),
    ).toThrow(PortfolioError);
  });

  it("anggaran biaya yang lebih kecil daripada biaya proporsional ditolak — tidak ada rebalance yang pernah lolos", () => {
    expect(() =>
      decide(duaAset(usd(6_000n), usd(4_000n)), murah, {
        ...DEFAULT_THRESHOLDS,
        maxRebalanceCostBps: 15n,
      }),
    ).toThrow(PortfolioError);
  });

  it("biaya swap negatif ditolak", () => {
    expect(() => decide(duaAset(usd(6_000n), usd(4_000n)), { ...murah, swapFeeBps: -1n })).toThrow(
      PortfolioError,
    );
  });

  it("model biaya default lolos validasi", () => {
    expect(() => decide(duaAset(usd(6_000n), usd(4_000n)), DEFAULT_COST_MODEL)).not.toThrow();
  });
});

describe("decide — portofolio tiga aset", () => {
  it("menyeimbangkan tiga aset dengan target tidak sama", () => {
    const p = portfolio([
      { symbol: "WBNB", valueBase: usd(6_000n), targetWeightBps: 4_000n },
      { symbol: "BTCB", valueBase: usd(2_000n), targetWeightBps: 4_000n },
      { symbol: "USDT", valueBase: usd(2_000n), targetWeightBps: 2_000n },
    ]);
    const d = decide(p, murah);
    expect(d.action).toBe("REBALANCE");
    expect(d.trades).toEqual([
      { symbol: "WBNB", side: "SELL", valueBase: usd(2_000n) },
      { symbol: "BTCB", side: "BUY", valueBase: usd(2_000n) },
    ]);
    expect(d.turnoverBase).toBe(usd(2_000n));
  });

  it("nilai jual dan beli seimbang sampai sisa debu di bawah satu unit basis per aset", () => {
    const p = portfolio([
      { symbol: "A", valueBase: usd(500n), targetWeightBps: 3_333n },
      { symbol: "B", valueBase: usd(250n), targetWeightBps: 3_333n },
      { symbol: "C", valueBase: usd(250n), targetWeightBps: 3_334n },
    ]);
    const d = decide(p, murah);
    expect(d.action).toBe("REBALANCE");
    const jual = d.trades.filter((t) => t.side === "SELL").reduce((a, t) => a + t.valueBase, 0n);
    const beli = d.trades.filter((t) => t.side === "BUY").reduce((a, t) => a + t.valueBase, 0n);
    expect(jual - beli).toBeLessThan(BigInt(p.assets.length));
    expect(jual - beli).toBeGreaterThanOrEqual(0n);
  });
});
