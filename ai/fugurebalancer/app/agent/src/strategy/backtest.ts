/**
 * ============================================================================
 * KETERBATASAN JUJUR — BACA SEBELUM MEMAKAI ANGKA DARI MODUL INI
 * ============================================================================
 * Harness ini menjalankan tiga kebijakan di atas deret harga yang SAMA:
 *   - `banded` : kebijakan yang sesungguhnya (`decide`), pita + gerbang biaya
 *   - `always` : rebalance ke target pada SETIAP candle, apa pun ongkosnya
 *   - `never`  : beli lalu diamkan (buy and hold)
 * Tujuannya satu: menunjukkan secara terukur bahwa menyeimbangkan setiap kali
 * menyimpang sedikit MERUGI karena ongkos, dan bahwa pita itu bukan hiasan.
 *
 * Yang sengaja TIDAK dimodelkan:
 *   - dampak harga yang tidak linear: biaya dimodelkan sebagai persentase tetap
 *     dari turnover ditambah gas tetap. Transaksi besar di pool dangkal jauh
 *     lebih mahal daripada itu, sehingga backtest ini MEREMEHKAN ongkos
 *     kebijakan yang bertransaksi besar/sering — artinya keunggulan `banded`
 *     atas `always` di dunia nyata paling banter sebesar yang dilaporkan di
 *     sini, dan umumnya lebih besar.
 *   - transaksi gagal, revert, RPC mati, nonce race, sesi Altana kedaluwarsa
 *   - gas yang berubah-ubah: `gasCostBase` tetap sepanjang simulasi
 *   - pergerakan harga DI ANTARA dua candle; hanya harga di tiap candle dilihat
 *   - imbal hasil, rebate, atau biaya pendanaan dari memegang aset
 *   - pajak dan pelaporan
 *   - eksekusi parsial: rebalance dianggap terisi penuh pada harga candle itu
 *
 * Satu penyederhanaan yang TIDAK netral: biaya dipotong dari nilai total
 * portofolio pada saat rebalance, lalu bobot ditetapkan tepat ke target. Di
 * dunia nyata ongkos itu dibayar dari salah satu kaki dan menyisakan bobot yang
 * sedikit meleset. Distorsi ini menguntungkan kebijakan yang sering
 * bertransaksi (yaitu `always`), jadi arahnya melawan kesimpulan yang ingin
 * ditunjukkan — bukan mendukungnya.
 *
 * TEMUAN YANG HARUS DIBACA BERSAMA HASILNYA (diukur lewat __tests__/backtest.test.ts):
 * pita TIDAK selalu mengungguli rebalance-selalu. Pada pasar yang berayun dengan
 * amplitudo jauh lebih besar daripada biaya, rebalance-selalu memanen volatilitas
 * (menjual yang naik, membeli yang turun) lebih banyak daripada ongkos yang
 * dibayarnya, dan pita melewatkan panen itu. Keunggulan pita muncul justru di
 * tempat yang berlawanan: portofolio kecil (gas tetap melahap turnover) dan
 * ayunan kecil (tidak ada yang layak dipanen). Keduanya diuji, keduanya ada di
 * suite. Siapa pun yang memasang `rebalanceBandBps` untuk pasangan token baru
 * wajib menjalankan backtest ini pada deret harga pasangan itu sendiri, bukan
 * mengasumsikan pita selalu menang.
 *
 * Deret harga adalah masukan, bukan sesuatu yang dibangkitkan di dalam modul
 * ini: seluruh fungsi di sini murni dan deterministik.
 * ============================================================================
 */
import { decide } from "./decide.js";
import {
  estimateCostBase,
  maxAbsDeviationBps,
  targetValueBase,
  totalValueBase,
  turnoverBase,
  computeTrades,
} from "./weights.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  type Asset,
  type CostModel,
  type RebalanceThresholds,
} from "./types.js";

export interface BacktestAsset {
  symbol: string;
  startValueBase: bigint;
  targetWeightBps: bigint;
}

export interface BacktestInput {
  startAssets: BacktestAsset[];
  /**
   * `priceSeriesBps[candle][indeksAset]` — harga relatif terhadap harga awal,
   * dalam bps. 10_000n berarti harga sama dengan saat mulai, 12_000n berarti
   * naik 20%. Panjang setiap baris wajib sama dengan jumlah aset.
   */
  priceSeriesBps: bigint[][];
  cost?: CostModel;
  thresholds?: RebalanceThresholds;
}

export interface PolicyResult {
  finalValueBase: bigint;
  rebalances: number;
  totalCostBase: bigint;
  /** Penyimpangan bobot terbesar yang pernah dialami sepanjang simulasi. */
  maxDeviationBps: bigint;
}

export interface BacktestResult {
  candles: number;
  banded: PolicyResult;
  always: PolicyResult;
  never: PolicyResult;
  /**
   * Perbandingan nilai akhir `banded` vs `always` pada SATU lintasan harga.
   * Ini bukan bukti statistik: satu lintasan hanya satu sampel. Klaim seperti
   * "pita mengungguli rebalance-selalu" baru sah bila dihitung dari banyak
   * lintasan yang berbeda.
   */
  bandedBeatsAlways: boolean;
}

const AKUN = "0x0000000000000000000000000000000000000000" as const;

/**
 * Posisi dinyatakan sebagai "unit pada harga awal": nilai pada candle t adalah
 * unit × harga_t / 10000. Menyimpan unit (bukan nilai) berarti pergerakan harga
 * tidak pernah diakumulasi lewat pembagian berantai yang errornya menumpuk;
 * setiap candle dihitung ulang dari harga awal. Pembulatan ke bawah terjadi
 * sekali per konversi, besarnya di bawah satu unit basis (1e-8 dolar).
 */
interface Holding {
  symbol: string;
  targetWeightBps: bigint;
  units: bigint;
}

const unitsFromValue = (valueBase: bigint, priceBps: bigint): bigint => (valueBase * BPS_ONE) / priceBps;
const valueFromUnits = (units: bigint, priceBps: bigint): bigint => (units * priceBps) / BPS_ONE;

function snapshot(holdings: readonly Holding[], prices: readonly bigint[]): Asset[] {
  return holdings.map((h, i) => ({
    symbol: h.symbol,
    valueBase: valueFromUnits(h.units, prices[i]!),
    targetWeightBps: h.targetWeightBps,
  }));
}

/** Menetapkan ulang seluruh bobot ke target setelah membayar `costBase`. */
function applyRebalance(holdings: Holding[], assets: readonly Asset[], prices: readonly bigint[], costBase: bigint): void {
  const totalSetelahBiaya = totalValueBase(assets) - costBase;
  if (totalSetelahBiaya <= 0n) {
    throw new PortfolioError(
      `Biaya rebalance ${costBase} menghabiskan seluruh nilai portofolio. Model biaya tidak masuk akal.`,
    );
  }
  for (let i = 0; i < holdings.length; i++) {
    const target = targetValueBase(totalSetelahBiaya, holdings[i]!.targetWeightBps);
    holdings[i]!.units = unitsFromValue(target, prices[i]!);
  }
}

function validate(input: BacktestInput): void {
  if (input.startAssets.length < 2) {
    throw new PortfolioError(`Backtest butuh minimal 2 aset, diberi ${input.startAssets.length}.`);
  }
  if (input.priceSeriesBps.length === 0) {
    throw new PortfolioError("Deret harga kosong: tidak ada yang bisa disimulasikan.");
  }
  for (const [i, baris] of input.priceSeriesBps.entries()) {
    if (baris.length !== input.startAssets.length) {
      throw new PortfolioError(
        `Baris harga ke-${i} berisi ${baris.length} harga untuk ${input.startAssets.length} aset.`,
      );
    }
    for (const [j, p] of baris.entries()) {
      if (p <= 0n) {
        throw new PortfolioError(
          `Harga ke-${j} pada candle ${i} bernilai ${p}. Harga nol atau negatif adalah data rusak, ` +
            `bukan aset yang kehilangan seluruh nilainya.`,
        );
      }
    }
  }
}

/**
 * Fungsi MURNI: tanpa jaringan, jam, atau environment. Seluruh keluaran
 * ditentukan sepenuhnya oleh argumen.
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  validate(input);

  const cost = input.cost ?? DEFAULT_COST_MODEL;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const series = input.priceSeriesBps;
  const hargaAwal = series[0]!;

  const buatHoldings = (): Holding[] =>
    input.startAssets.map((a, i) => ({
      symbol: a.symbol,
      targetWeightBps: a.targetWeightBps,
      units: unitsFromValue(a.startValueBase, hargaAwal[i]!),
    }));

  type Mode = "banded" | "always" | "never";

  const jalankan = (mode: Mode): PolicyResult => {
    const holdings = buatHoldings();
    let rebalances = 0;
    let totalCostBase = 0n;
    let maxDeviationBps = 0n;

    for (const prices of series) {
      const assets = snapshot(holdings, prices);
      const total = totalValueBase(assets);
      if (total <= 0n) continue;

      const dev = maxAbsDeviationBps(assets, total);
      if (dev > maxDeviationBps) maxDeviationBps = dev;

      if (mode === "never") continue;

      if (mode === "banded") {
        const d = decide({ account: AKUN, assets, blockNumber: 0n }, cost, thresholds);
        if (d.action !== "REBALANCE") continue;
        rebalances += 1;
        totalCostBase += d.estimatedCostBase;
        applyRebalance(holdings, assets, prices, d.estimatedCostBase);
        continue;
      }

      // mode "always": rebalance tanpa gerbang apa pun, persis kesalahan yang
      // ingin dibuktikan mahal. Turnover nol berarti portofolio sudah tepat
      // pada target dan tidak ada transaksi yang dikirim — bukan pengecualian
      // kebijakan, hanya ketiadaan sesuatu untuk dikirim.
      const turnover = turnoverBase(computeTrades(assets, total));
      if (turnover <= 0n) continue;
      const biaya = estimateCostBase(turnover, cost);
      rebalances += 1;
      totalCostBase += biaya;
      applyRebalance(holdings, assets, prices, biaya);
    }

    const hargaAkhir = series[series.length - 1]!;
    return {
      finalValueBase: totalValueBase(snapshot(holdings, hargaAkhir)),
      rebalances,
      totalCostBase,
      maxDeviationBps,
    };
  };

  const banded = jalankan("banded");
  const always = jalankan("always");
  const never = jalankan("never");

  return {
    candles: series.length,
    banded,
    always,
    never,
    bandedBeatsAlways: banded.finalValueBase > always.finalValueBase,
  };
}
