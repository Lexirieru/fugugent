/**
 * ============================================================================
 * KETERBATASAN JUJUR — BACA SEBELUM MEMAKAI ANGKA DARI MODUL INI
 * ============================================================================
 * Harness ini menjalankan `decide` candle demi candle di atas deret harga yang
 * diberikan, lalu membandingkan nilai akhirnya dengan SATU pembanding:
 * alokasi awal yang sama persis, dibiarkan tidak disentuh sampai candle
 * terakhir (`holdValueBase`). Pembanding itu dipilih karena ia satu-satunya
 * yang jujur: grid dan pembandingnya berangkat dari portofolio yang identik.
 *
 * Yang sengaja TIDAK dimodelkan:
 *   - dampak harga yang tidak linear; slippage dimodelkan sebagai persentase
 *     tetap, sehingga lot besar di pool dangkal jauh lebih mahal daripada ini
 *   - transaksi gagal, revert, RPC mati, sesi Altana kedaluwarsa
 *   - gas yang berubah-ubah; `gasCostBase` tetap sepanjang simulasi
 *   - pergerakan harga DI ANTARA dua candle. Ini yang paling berat untuk grid:
 *     grid nyata diisi oleh limit order yang tersentuh oleh sumbu lilin,
 *     sedangkan model ini hanya melihat satu harga per candle dan karena itu
 *     MELEWATKAN putaran yang di dunia nyata akan terisi. Arah bias ini
 *     MELAWAN grid, jadi keuntungan yang dilaporkan di sini adalah batas bawah
 *     untuk sisi itu — sekaligus alasan mengapa hasilnya tidak boleh dibaca
 *     sebagai ramalan.
 *   - antrean order, pembatalan, dan front-running
 *
 * Gas dimodelkan dibayar dari saldo NATIVE terpisah (tBNB), bukan dari kaki
 * quote grid, karena begitulah kenyataannya di BSC. Totalnya dikurangkan sekali
 * di akhir. Kalau saldo native habis, agent berhenti bertransaksi sama sekali —
 * keadaan itu TIDAK dimodelkan di sini dan harus diuji di lapisan eksekusi.
 *
 * Deret harga adalah masukan, bukan sesuatu yang dibangkitkan di dalam modul
 * ini: seluruh fungsi di sini murni dan deterministik.
 * ============================================================================
 */
import { decide } from "./decide.js";
import { bandIndexOf, ceilDiv, intervalsOf, lotValueBase } from "./grid.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  WAD,
  type CostModel,
  type GridConfig,
  type GridState,
  type GridThresholds,
} from "./types.js";

export interface GridBacktestInput {
  config: GridConfig;
  /** Harga aset dasar per candle, USD basis 8 desimal. */
  priceSeriesBase: bigint[];
  cost?: CostModel;
  thresholds?: GridThresholds;
}

export interface GridBacktestResult {
  candles: number;
  buys: number;
  sells: number;
  /** Fee proporsional + gas, USD basis 8 desimal. */
  totalCostBase: bigint;
  /** Nilai akhir grid: quote + persediaan dinilai pada harga terakhir, dikurangi gas. */
  finalValueBase: bigint;
  /** Alokasi awal yang sama, dibiarkan tidak disentuh sampai candle terakhir. */
  holdValueBase: bigint;
  gridBeatsHold: boolean;
  /** Indeks candle saat grid keluar; null bila tidak pernah keluar. */
  exitedAtCandle: number | null;
  exitSide: "ABOVE" | "BELOW" | null;
}

/**
 * Fungsi MURNI: tanpa jaringan, jam, atau environment.
 *
 * Persediaan disimpan sebagai TUMPUKAN jumlah token per lot (18 desimal), dan
 * penjualan mengambil dari puncak tumpukan (LIFO). Bukan pilihan sembarangan:
 * pada grid, lot yang paling baru dibeli adalah lot yang dibeli satu garis di
 * bawah harga jual sekarang — memasangkan keduanya adalah definisi satu putaran
 * grid. FIFO akan memasangkan penjualan dengan lot tertua dan melaporkan laba
 * yang bukan laba putaran ini.
 */
export function runBacktest(input: GridBacktestInput): GridBacktestResult {
  const { config, priceSeriesBase: series } = input;
  const cost = input.cost ?? DEFAULT_COST_MODEL;
  const thresholds = input.thresholds ?? DEFAULT_GRID_THRESHOLDS;

  if (series.length === 0) {
    throw new GridError("Deret harga kosong: tidak ada yang bisa disimulasikan.");
  }
  for (const [i, p] of series.entries()) {
    if (p <= 0n) {
      throw new GridError(
        `Harga pada candle ${i} bernilai ${p}. Itu pembacaan rusak, bukan aset yang menjadi gratis.`,
      );
    }
  }

  const lot = lotValueBase(config);
  const intervals = intervalsOf(config);
  const hargaAwal = series[0]!;
  const hargaAkhir = series[series.length - 1]!;

  /**
   * Grid dimulai seimbang di sekitar harga awal: satu lot persediaan untuk
   * setiap garis DI ATAS harga (supaya ada yang bisa dijual saat harga naik),
   * sisa modal disimpan sebagai quote (supaya ada yang bisa dipakai membeli
   * saat harga turun). Grid yang dimulai 100% pada salah satu kaki hanya bisa
   * berdagang ke satu arah sampai harga kebetulan berbalik.
   */
  const bandAwal = bandIndexOf(hargaAwal, config);
  const lotsAwal = intervals - bandAwal;

  let state: GridState = {
    bandIndex: bandAwal,
    lotsHeld: lotsAwal,
    consecutiveOutside: 0,
    outsideSide: null,
  };

  const tokenPerLotAwal = (lot * WAD) / hargaAwal;
  const tumpukan: bigint[] = Array.from({ length: lotsAwal }, () => tokenPerLotAwal);
  let quoteBase = config.capitalBase - BigInt(lotsAwal) * lot;

  let buys = 0;
  let sells = 0;
  let feeBase = 0n;
  let gasBase = 0n;
  let exitedAtCandle: number | null = null;
  let exitSide: "ABOVE" | "BELOW" | null = null;

  /** Fee proporsional satu swap atas `notional`, dibulatkan ke atas. */
  const feeOf = (notional: bigint): bigint =>
    ceilDiv(notional * (cost.swapFeeBps + cost.slippageBps), BPS_ONE);

  for (const [i, price] of series.entries()) {
    const d = decide(config, state, { priceBase: price, blockNumber: BigInt(i) }, cost, thresholds);

    if (d.action === "BUY" && d.lots > 0) {
      const belanja = BigInt(d.lots) * lot;
      const fee = feeOf(belanja);
      // Fee proporsional tertanam di dalam swap: dolar yang dibelanjakan tetap
      // `belanja`, tetapi token yang diterima berkurang sebesar fee itu.
      const tokenTotal = ((belanja - fee) * WAD) / price;
      // Dibagi rata per lot supaya penjualan LIFO nanti melepas jumlah yang
      // sama besar. Sisa bagi (< jumlah lot wei, yaitu di bawah 1e-18 token)
      // hangus; mengejarnya akan menambah wei ke satu lot secara sewenang-wenang.
      const tokenPerLot = tokenTotal / BigInt(d.lots);
      quoteBase -= belanja;
      for (let k = 0; k < d.lots; k++) tumpukan.push(tokenPerLot);
      feeBase += fee;
      gasBase += cost.gasCostBase;
      buys += 1;
    } else if (d.action === "SELL" && d.lots > 0) {
      let token = 0n;
      for (let k = 0; k < d.lots; k++) token += tumpukan.pop()!;
      const kotor = (token * price) / WAD;
      const fee = feeOf(kotor);
      quoteBase += kotor - fee;
      feeBase += fee;
      gasBase += cost.gasCostBase;
      sells += 1;
    } else if (d.action === "EXIT_ABOVE" || d.action === "EXIT_BELOW") {
      let token = 0n;
      while (tumpukan.length > 0) token += tumpukan.pop()!;
      if (token > 0n) {
        const kotor = (token * price) / WAD;
        const fee = feeOf(kotor);
        quoteBase += kotor - fee;
        feeBase += fee;
        gasBase += cost.gasCostBase;
        sells += 1;
      }
      exitedAtCandle = i;
      exitSide = d.action === "EXIT_ABOVE" ? "ABOVE" : "BELOW";
      state = d.nextState;
      // Setelah keluar, grid memegang quote saja dan nilainya tidak berubah lagi.
      // Pembandingnya tetap dinilai pada harga candle TERAKHIR, sehingga
      // perbandingannya jujur: keduanya diukur pada akhir periode yang sama.
      break;
    }

    state = d.nextState;
  }

  let sisaToken = 0n;
  for (const t of tumpukan) sisaToken += t;

  const finalValueBase = quoteBase + (sisaToken * hargaAkhir) / WAD - gasBase;

  const holdToken = (BigInt(lotsAwal) * lot * WAD) / hargaAwal;
  const holdValueBase =
    config.capitalBase - BigInt(lotsAwal) * lot + (holdToken * hargaAkhir) / WAD;

  return {
    candles: series.length,
    buys,
    sells,
    totalCostBase: feeBase + gasBase,
    finalValueBase,
    holdValueBase,
    gridBeatsHold: finalValueBase > holdValueBase,
    exitedAtCandle,
    exitSide,
  };
}
