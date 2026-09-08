import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  DEFAULT_YIELD_THRESHOLDS,
  YieldError,
  type Pool,
  type SwitchCostModel,
  type YieldObservation,
} from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const POKOK = usd(10_000n);
const biaya: SwitchCostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: usd(1n) };

/** Ambang wajib untuk pokok $10.000: impas 195 bps, dikali 2,00x = 390 bps. */
const AMBANG = 390n;

function pool(over: Partial<Pool> & { poolId: string }): Pool {
  return {
    protocol: "venus",
    apyBps: 500n,
    tvlBase: usd(1_000_000n),
    riskScore: 10,
    isActive: true,
    apyAgeSeconds: 60,
    ...over,
  };
}

function obs(over: Partial<YieldObservation> = {}): YieldObservation {
  return {
    position: { principalBase: POKOK, current: pool({ poolId: "venus-usdt", apyBps: 500n }) },
    candidates: [],
    consecutiveFavorable: 3,
    blockNumber: 1n,
    ...over,
  };
}

describe("decide — ambang selisih APY minimum", () => {
  it("tanpa kandidat, tetap di tempat", () => {
    const d = decide(obs(), biaya);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("NO_CANDIDATE");
    expect(d.targetPoolId).toBeNull();
  });

  it("melaporkan ambang impas dan ambang wajib yang diturunkan dari ongkos, bukan ditebak", () => {
    const d = decide(obs(), biaya);
    expect(d.switchCostBase).toBe(usd(16n));
    expect(d.breakEvenSpreadBps).toBe(195n);
    expect(d.requiredSpreadBps).toBe(AMBANG);
  });

  it("kandidat dengan APY lebih rendah tidak pernah menarik", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 400n })] }), biaya);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("NO_BETTER_POOL");
  });

  it("APY tertinggi TIDAK cukup: selisih di bawah ambang wajib ditolak", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 880n })] }), biaya);
    expect(d.spreadBps).toBe(380n);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("SPREAD_BELOW_BREAKEVEN");
    expect(d.spreadQualifies).toBe(false);
  });

  it("selisih tepat di ambang wajib sudah cukup", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 500n + AMBANG })] }), biaya);
    expect(d.spreadQualifies).toBe(true);
    expect(d.action).toBe("MIGRATE");
  });

  it("selisih besar dan terkonfirmasi menghasilkan perpindahan", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })] }), biaya);
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("MIGRATION_ECONOMIC");
    expect(d.targetPoolId).toBe("aave-usdt");
    expect(d.netGainBase).toBeGreaterThan(0n);
  });

  it("selisih yang sama pada pokok kecil TIDAK cukup — gas tetap melahapnya", () => {
    const kecil = obs({
      position: { principalBase: usd(200n), current: pool({ poolId: "venus-usdt", apyBps: 500n }) },
      candidates: [pool({ poolId: "aave-usdt", apyBps: 900n, tvlBase: usd(1_000_000n) })],
    });
    const d = decide(kecil, biaya);
    expect(d.requiredSpreadBps).toBeGreaterThan(400n);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("SPREAD_BELOW_BREAKEVEN");
  });
});

describe("decide — konfirmasi mencegah mengejar lonjakan sesaat", () => {
  it("selisih layak tetapi baru satu pengamatan belum cukup", () => {
    const d = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 1 }),
      biaya,
    );
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("SPREAD_NOT_CONFIRMED");
    expect(d.spreadQualifies).toBe(true);
  });

  it("dua pengamatan masih belum cukup, tiga cukup", () => {
    const dua = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 2 }),
      biaya,
    );
    const tiga = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 3 }),
      biaya,
    );
    expect(dua.action).toBe("STAY");
    expect(tiga.action).toBe("MIGRATE");
  });

  it("targetPoolId tetap dilaporkan walau belum dikonfirmasi, supaya pemanggil tahu apa yang dihitungnya", () => {
    const d = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 0 }),
      biaya,
    );
    expect(d.targetPoolId).toBe("aave-usdt");
  });
});

describe("decide — gerbang risiko berjalan SEBELUM gerbang imbal hasil", () => {
  it("APY tertinggi di pool yang terlalu kecil ditolak — deposit kita sendiri akan meruntuhkan APY-nya", () => {
    const d = decide(
      obs({
        candidates: [
          pool({ poolId: "kecil", apyBps: 5_000n, tvlBase: usd(50_000n) }),
          pool({ poolId: "besar", apyBps: 900n }),
        ],
      }),
      biaya,
    );
    expect(d.targetPoolId).toBe("besar");
    expect(d.rejected.find((r) => r.poolId === "kecil")?.why).toBe("POOL_SHARE");
  });

  it("APY yang mustahil ditolak sebagai data rusak, bukan dikejar", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "mirage", apyBps: 500_000n })] }), biaya);
    expect(d.action).toBe("STAY");
    expect(d.rejected[0]!.why).toBe("IMPLAUSIBLE_APY");
  });

  it("skor risiko di atas ambang ditolak berapa pun APY-nya", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "bahaya", apyBps: 9_000n, riskScore: 80 })] }), biaya);
    expect(d.action).toBe("STAY");
    expect(d.rejected[0]!.why).toBe("RISK_SCORE");
  });

  it("pool yang tidak aktif ditolak", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "beku", apyBps: 9_000n, isActive: false })] }), biaya);
    expect(d.rejected[0]!.why).toBe("INACTIVE");
  });

  it("APY basi ditolak — bertindak atas angka satu jam lalu adalah bertindak atas angka yang sudah berubah", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "basi", apyBps: 9_000n, apyAgeSeconds: 7_200 })] }), biaya);
    expect(d.rejected[0]!.why).toBe("STALE_DATA");
  });

  it("pool yang sama dengan posisi sekarang tidak pernah jadi kandidat pindah", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "venus-usdt", apyBps: 900n })] }), biaya);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("NO_CANDIDATE");
  });
});

describe("decide — keselamatan mengalahkan ekonomi", () => {
  it("pool sekarang dibekukan: pindah walaupun selisihnya kecil", () => {
    const d = decide(
      obs({
        position: { principalBase: POKOK, current: pool({ poolId: "venus-usdt", apyBps: 500n, isActive: false }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 510n })],
      }),
      biaya,
    );
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("CURRENT_POOL_UNSAFE");
    expect(d.targetPoolId).toBe("aave-usdt");
  });

  it("pool sekarang menyusut sampai pangsa kita terlalu besar: pindah", () => {
    const d = decide(
      obs({
        position: { principalBase: POKOK, current: pool({ poolId: "venus-usdt", tvlBase: usd(20_000n) }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 500n })],
      }),
      biaya,
    );
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("CURRENT_POOL_UNSAFE");
  });

  it("pool sekarang tidak aman dan tidak ada tujuan yang lolos: keluar sepenuhnya", () => {
    const d = decide(
      obs({
        position: { principalBase: POKOK, current: pool({ poolId: "venus-usdt", isActive: false }) },
        candidates: [pool({ poolId: "juga-bahaya", riskScore: 90 })],
      }),
      biaya,
    );
    expect(d.action).toBe("EXIT");
    expect(d.reasonCode).toBe("NO_ELIGIBLE_POOL");
    expect(d.targetPoolId).toBeNull();
  });

  it("perpindahan darurat tidak menunggu konfirmasi", () => {
    const d = decide(
      obs({
        position: { principalBase: POKOK, current: pool({ poolId: "venus-usdt", isActive: false }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 500n })],
        consecutiveFavorable: 0,
      }),
      biaya,
    );
    expect(d.action).toBe("MIGRATE");
  });

  it("data APY posisi sekarang basi: menolak menghitung selisih dan tetap diam", () => {
    const d = decide(
      obs({
        position: { principalBase: POKOK, current: pool({ poolId: "venus-usdt", apyAgeSeconds: 7_200 }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })],
      }),
      biaya,
    );
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("CURRENT_DATA_STALE");
  });

  it("tidak aman mengalahkan basi: pool yang dibekukan tetap ditinggalkan walau datanya basi", () => {
    const d = decide(
      obs({
        position: {
          principalBase: POKOK,
          current: pool({ poolId: "venus-usdt", isActive: false, apyAgeSeconds: 7_200 }),
        },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 500n })],
      }),
      biaya,
    );
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("CURRENT_POOL_UNSAFE");
  });
});

describe("decide — determinisme dan kemurnian", () => {
  it("dua panggilan identik menghasilkan keputusan identik", () => {
    const o = obs({ candidates: [pool({ poolId: "a", apyBps: 900n }), pool({ poolId: "b", apyBps: 900n })] });
    expect(decide(o, biaya)).toEqual(decide(o, biaya));
  });

  it("APY seri dipecah oleh poolId secara alfabetis, bukan oleh urutan masukan", () => {
    const naik = decide(
      obs({ candidates: [pool({ poolId: "aaa", apyBps: 900n }), pool({ poolId: "zzz", apyBps: 900n })] }),
      biaya,
    );
    const turun = decide(
      obs({ candidates: [pool({ poolId: "zzz", apyBps: 900n }), pool({ poolId: "aaa", apyBps: 900n })] }),
      biaya,
    );
    expect(naik.targetPoolId).toBe("aaa");
    expect(turun.targetPoolId).toBe("aaa");
  });

  it("tidak memutasi pengamatan masukan", () => {
    const o = obs({ candidates: [pool({ poolId: "z", apyBps: 900n }), pool({ poolId: "a", apyBps: 400n })] });
    const urutanAwal = o.candidates.map((c) => c.poolId);
    decide(o, biaya);
    expect(o.candidates.map((c) => c.poolId)).toEqual(urutanAwal);
  });
});

describe("decide — penjelasan", () => {
  it("alasan memakai angka terformat, bukan basis 8 desimal mentah", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })] }), biaya);
    expect(d.reason).toContain("%");
    expect(d.reason).not.toContain("1000000000000");
  });

  it("alasan menolak pindah menyebut ambang yang tidak tercapai", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 880n })] }), biaya);
    expect(d.reason).toContain("390");
  });
});

describe("decide — gagal keras pada masukan tak masuk akal", () => {
  it("pokok nol ditolak", () => {
    expect(() => decide(obs({ position: { principalBase: 0n, current: pool({ poolId: "x" }) } }), biaya)).toThrow(YieldError);
  });

  it("APY negatif ditolak", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", apyBps: -1n })] }), biaya)).toThrow(YieldError);
  });

  it("TVL nol ditolak", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", tvlBase: 0n })] }), biaya)).toThrow(YieldError);
  });

  it("skor risiko di luar 0..100 ditolak", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", riskScore: 101 })] }), biaya)).toThrow(YieldError);
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", riskScore: -1 })] }), biaya)).toThrow(YieldError);
  });

  it("umur data negatif ditolak", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", apyAgeSeconds: -1 })] }), biaya)).toThrow(YieldError);
  });

  it("poolId kandidat yang duplikat ditolak — pilihan menjadi ambigu", () => {
    expect(() =>
      decide(obs({ candidates: [pool({ poolId: "x" }), pool({ poolId: "x", apyBps: 900n })] }), biaya),
    ).toThrow(YieldError);
  });

  it("hitungan konfirmasi negatif ditolak", () => {
    expect(() => decide(obs({ consecutiveFavorable: -1 }), biaya)).toThrow(YieldError);
  });

  it("horizon nol hari ditolak — seluruh ambang impas dibagi angka itu", () => {
    expect(() =>
      decide(obs(), biaya, { ...DEFAULT_YIELD_THRESHOLDS, expectedHoldingDays: 0n }),
    ).toThrow(YieldError);
  });

  it("pengali keamanan di bawah 1,00x ditolak — itu meresmikan pindah yang merugi", () => {
    expect(() =>
      decide(obs(), biaya, { ...DEFAULT_YIELD_THRESHOLDS, spreadSafetyMultipleBps: 9_999n }),
    ).toThrow(YieldError);
  });

  it("pangsa pool maksimum 100% ditolak — menjadi seluruh pool berarti APY-nya cerminan diri sendiri", () => {
    expect(() =>
      decide(obs(), biaya, { ...DEFAULT_YIELD_THRESHOLDS, maxPoolShareBps: 10_000n }),
    ).toThrow(YieldError);
  });

  it("biaya pindah negatif ditolak", () => {
    expect(() => decide(obs(), { ...biaya, gasCostBase: -1n })).toThrow(YieldError);
  });
});
