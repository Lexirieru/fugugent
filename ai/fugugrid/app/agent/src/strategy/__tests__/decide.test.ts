import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  type CostModel,
  type GridConfig,
  type GridState,
} from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;

const grid: GridConfig = {
  lowerBase: usd(500n),
  upperBase: usd(700n),
  levels: 11,
  capitalBase: usd(1_000n),
};

const biaya: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 5_000_000n };

function state(over: Partial<GridState> = {}): GridState {
  return { bandIndex: 5, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null, ...over };
}

const lihat = (dolar: bigint, s: GridState = state()) =>
  decide(grid, s, { priceBase: usd(dolar), blockNumber: 1n }, biaya);

describe("decide — perdagangan di dalam rentang", () => {
  it("harga tidak berpindah pita berarti tidak ada yang dilakukan", () => {
    const d = lihat(600n);
    expect(d.action).toBe("IDLE");
    expect(d.lots).toBe(0);
    expect(d.notionalBase).toBe(0n);
  });

  it("harga turun dua pita memicu pembelian dua lot", () => {
    const d = lihat(560n);
    expect(d.action).toBe("BUY");
    expect(d.lots).toBe(2);
    expect(d.notionalBase).toBe(usd(200n));
    expect(d.nextState.lotsHeld).toBe(7);
    expect(d.nextState.bandIndex).toBe(3);
  });

  it("harga naik tiga pita memicu penjualan tiga lot", () => {
    const d = lihat(660n);
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(3);
    expect(d.notionalBase).toBe(usd(300n));
    expect(d.nextState.lotsHeld).toBe(2);
    expect(d.nextState.bandIndex).toBe(8);
  });

  it("fungsi murni: dua panggilan identik menghasilkan keputusan identik", () => {
    expect(lihat(560n)).toEqual(lihat(560n));
  });

  it("tidak memutasi state masukan", () => {
    const s = state();
    const salinan = { ...s };
    lihat(560n, s);
    expect(s).toEqual(salinan);
  });
});

describe("decide — batas modal dan batas persediaan", () => {
  it("tidak bisa membeli lebih banyak lot daripada sisa kapasitas modal", () => {
    const d = lihat(560n, state({ bandIndex: 5, lotsHeld: 9 }));
    expect(d.action).toBe("BUY");
    expect(d.lots).toBe(1);
    expect(d.lotsCapped).toBe(true);
    expect(d.nextState.lotsHeld).toBe(10);
  });

  it("modal habis berarti tidak ada pembelian sama sekali, bukan pembelian sebagian dari nol", () => {
    const d = lihat(560n, state({ bandIndex: 5, lotsHeld: 10 }));
    expect(d.action).toBe("IDLE");
    expect(d.lots).toBe(0);
    expect(d.lotsCapped).toBe(true);
  });

  it("tidak bisa menjual lot yang tidak dipegang", () => {
    const d = lihat(660n, state({ bandIndex: 5, lotsHeld: 1 }));
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(1);
    expect(d.lotsCapped).toBe(true);
    expect(d.nextState.lotsHeld).toBe(0);
  });

  it("pita tetap maju walaupun lot dibatasi — kalau tidak, persilangan yang sama akan memicu lagi selamanya", () => {
    const d = lihat(560n, state({ bandIndex: 5, lotsHeld: 10 }));
    expect(d.nextState.bandIndex).toBe(3);
  });
});

describe("decide — kapan grid berhenti berlaku", () => {
  it("harga di dalam buffer atas belum breakout, hanya diamati", () => {
    const d = lihat(714n, state({ bandIndex: 9, lotsHeld: 0 }));
    expect(d.action).toBe("WATCH_BREAKOUT");
    expect(d.breakout).toBe("WATCHING_ABOVE");
    expect(d.nextState.consecutiveOutside).toBe(1);
  });

  it("breakout atas dikonfirmasi setelah tiga pengamatan berturut-turut", () => {
    const d = lihat(714n, state({ bandIndex: 9, lotsHeld: 2, consecutiveOutside: 2, outsideSide: "ABOVE" }));
    expect(d.action).toBe("EXIT_ABOVE");
    expect(d.nextState.consecutiveOutside).toBe(3);
  });

  it("hitungan konfirmasi direset begitu harga kembali ke dalam rentang", () => {
    const d = lihat(600n, state({ bandIndex: 5, lotsHeld: 5, consecutiveOutside: 2, outsideSide: "ABOVE" }));
    expect(d.nextState.consecutiveOutside).toBe(0);
    expect(d.nextState.outsideSide).toBeNull();
  });

  it("berbalik arah mereset hitungan — dua pelanggaran arah berbeda bukan konfirmasi", () => {
    const d = lihat(490n, state({ bandIndex: 0, lotsHeld: 5, consecutiveOutside: 2, outsideSide: "ABOVE" }));
    expect(d.nextState.outsideSide).toBe("BELOW");
    expect(d.nextState.consecutiveOutside).toBe(1);
    expect(d.action).toBe("WATCH_BREAKOUT");
  });

  it("breakout keras keluar seketika, tanpa menunggu konfirmasi", () => {
    const d = lihat(770n, state({ bandIndex: 9, lotsHeld: 3, consecutiveOutside: 0 }));
    expect(d.action).toBe("EXIT_ABOVE");
  });

  it("breakout keras ke bawah keluar seketika", () => {
    const d = lihat(450n, state({ bandIndex: 0, lotsHeld: 8, consecutiveOutside: 0 }));
    expect(d.action).toBe("EXIT_BELOW");
  });

  it("keluar berarti membongkar SELURUH persediaan — grid di bawah rentangnya 100% long tanpa rencana", () => {
    const d = lihat(450n, state({ bandIndex: 0, lotsHeld: 8 }));
    expect(d.lots).toBe(8);
    expect(d.notionalBase).toBe(usd(800n));
    expect(d.nextState.lotsHeld).toBe(0);
  });

  it("keluar ke atas juga membongkar sisa persediaan supaya tidak ada posisi yatim", () => {
    const d = lihat(770n, state({ bandIndex: 9, lotsHeld: 3 }));
    expect(d.lots).toBe(3);
    expect(d.nextState.lotsHeld).toBe(0);
  });

  it("harga di antara batas atas dan buffer masih boleh menjual sisa lot", () => {
    // $705 di atas $700 tetapi di bawah $714: pita dijepit ke 9, penjualan tetap terjadi
    const d = lihat(705n, state({ bandIndex: 5, lotsHeld: 5 }));
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(4);
    expect(d.breakout).toBe("NONE");
  });

  it("lompatan harga langsung melewati buffer tetap menjual sisa lot sebelum keluar diamati", () => {
    const d = lihat(714n, state({ bandIndex: 5, lotsHeld: 5 }));
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(4);
    expect(d.breakout).toBe("WATCHING_ABOVE");
    expect(d.nextState.consecutiveOutside).toBe(1);
  });
});

describe("decide — penjelasan", () => {
  it("alasan menyebut harga terformat, bukan angka mentah basis 8 desimal", () => {
    const d = lihat(560n);
    expect(d.reason).toContain("$560,00");
    expect(d.reason).not.toContain("56000000000");
  });

  it("alasan keluar menyebut mengapa grid berhenti berlaku", () => {
    const d = lihat(770n, state({ bandIndex: 9, lotsHeld: 1 }));
    expect(d.reason).toContain("$770,00");
    expect(d.reason.length).toBeGreaterThan(20);
  });
});

describe("decide — gagal keras pada konfigurasi yang tidak bisa untung", () => {
  it("grid dengan langkah lebih sempit daripada ongkos putaran ditolak", () => {
    expect(() => decide({ ...grid, levels: 101 }, state({ bandIndex: 50, lotsHeld: 50 }), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("batas atas di bawah batas bawah ditolak", () => {
    expect(() => decide({ ...grid, lowerBase: usd(700n), upperBase: usd(500n) }, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("batas bawah nol ditolak — harga nol bukan harga", () => {
    expect(() => decide({ ...grid, lowerBase: 0n }, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("rentang lebih lebar daripada 3x ditolak karena distorsi grid aritmetik jadi tak terkendali", () => {
    expect(() => decide({ ...grid, upperBase: usd(2_000n) }, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("kurang dari tiga garis bukan grid", () => {
    expect(() => decide({ ...grid, levels: 2 }, state({ bandIndex: 0, lotsHeld: 0 }), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("jumlah level pecahan ditolak", () => {
    expect(() => decide({ ...grid, levels: 10.5 }, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("modal nol ditolak", () => {
    expect(() => decide({ ...grid, capitalBase: 0n }, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("harga nol atau negatif ditolak — itu pembacaan rusak, bukan aset gratis", () => {
    expect(() => decide(grid, state(), { priceBase: 0n, blockNumber: 1n }, biaya)).toThrow(GridError);
    expect(() => decide(grid, state(), { priceBase: -1n, blockNumber: 1n }, biaya)).toThrow(GridError);
  });

  it("lot dipegang melebihi jumlah interval ditolak", () => {
    expect(() => lihat(600n, state({ lotsHeld: 11 }))).toThrow(GridError);
  });

  it("indeks pita di luar rentang ditolak", () => {
    expect(() => lihat(600n, state({ bandIndex: 10 }))).toThrow(GridError);
    expect(() => lihat(600n, state({ bandIndex: -1 }))).toThrow(GridError);
  });

  it("hitungan pengamatan luar tanpa arah adalah state yang mustahil", () => {
    expect(() => lihat(600n, state({ consecutiveOutside: 2, outsideSide: null }))).toThrow(GridError);
  });

  it("buffer breakout yang lebih lebar daripada breakout keras ditolak", () => {
    expect(() =>
      decide(grid, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya, {
        ...DEFAULT_GRID_THRESHOLDS,
        breakoutBufferBps: 2_000n,
      }),
    ).toThrow(GridError);
  });

  it("pengali profit di bawah 1,00x ditolak — itu meresmikan grid yang merugi", () => {
    expect(() =>
      decide(grid, state(), { priceBase: usd(600n), blockNumber: 1n }, biaya, {
        ...DEFAULT_GRID_THRESHOLDS,
        minProfitMultipleBps: 9_999n,
      }),
    ).toThrow(GridError);
  });
});
