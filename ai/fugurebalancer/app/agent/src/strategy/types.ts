/**
 * Tipe dan ambang untuk strategi REBALANCING.
 *
 * SATUAN — dipegang seragam di seluruh paket ini:
 *  - nilai uang: basis 8 desimal (`*Base`), 100_000_000n = $1,00
 *  - jumlah token: 18 desimal (`WAD`), karena SELURUH token di BSC 18 desimal,
 *    termasuk USDT dan USDC (bukan 6 seperti di Ethereum mainnet)
 *  - persentase: basis point (`*Bps`), 10_000n = 100%
 *
 * Modul ini tidak boleh mengimpor apa pun yang menyentuh jaringan, jam, atau
 * environment. Keputusan finansial di Fugugent tidak pernah lewat LLM.
 */

/** $1,00 dalam basis 8 desimal. */
export const USD8_ONE = 100_000_000n;

/** 100% dalam basis point. */
export const BPS_ONE = 10_000n;

/** 1 token dalam 18 desimal. Semua token BSC 18 desimal, termasuk USDT. */
export const WAD = 10n ** 18n;

/** Aksi yang boleh diambil Rebalancer, dari paling pasif ke paling aktif. */
export type RebalanceAction = "NONE" | "WATCH" | "REBALANCE" | "BLOCKED_BY_COST";

export type TradeSide = "SELL" | "BUY";

export interface Trade {
  symbol: string;
  side: TradeSide;
  /** Nilai kaki transaksi dalam USD basis 8 desimal. */
  valueBase: bigint;
}

export interface Asset {
  symbol: string;
  /** Nilai posisi saat ini dalam USD basis 8 desimal. */
  valueBase: bigint;
  /** Bobot target dalam bps. Jumlah seluruh aset wajib tepat 10_000. */
  targetWeightBps: bigint;
}

export interface Portfolio {
  account: `0x${string}`;
  assets: Asset[];
  blockNumber: bigint;
}

/**
 * Model biaya satu kali rebalance.
 *
 * `gasCostBase` sengaja dinyatakan dalam USD basis 8 desimal, bukan gwei:
 * gerbang biaya membandingkannya dengan turnover yang juga dalam USD, dan
 * konversi gwei→USD adalah urusan lapisan chain, bukan mesin keputusan yang
 * harus tetap murni.
 */
export interface CostModel {
  /** Fee pool DEX. PancakeSwap v3 tier 0,05% = 5 bps. */
  swapFeeBps: bigint;
  /** Dampak harga + toleransi slippage yang dipasang di kalender eksekusi. */
  slippageBps: bigint;
  /** Ongkos gas SELURUH rangkaian transaksi rebalance, USD basis 8 desimal. */
  gasCostBase: bigint;
}

export interface RebalanceThresholds {
  /**
   * Pita pengamatan. Di bawah ini portofolio dianggap tepat sasaran.
   */
  watchBandBps: bigint;
  /**
   * Pita no-trade. Rebalance baru dipertimbangkan bila penyimpangan bobot
   * absolut terbesar mencapai ambang ini.
   */
  rebalanceBandBps: bigint;
  /**
   * Anggaran biaya satu rebalance, relatif terhadap turnover yang dipindahkan.
   */
  maxRebalanceCostBps: bigint;
}

export interface RebalanceDecision {
  action: RebalanceAction;
  totalValueBase: bigint;
  /** Penyimpangan bobot absolut terbesar, dipotong ke bawah. */
  maxDeviationBps: bigint;
  /** Nilai yang harus dipindahkan (hanya kaki jual, tidak dihitung dua kali). */
  turnoverBase: bigint;
  estimatedCostBase: bigint;
  /** Biaya relatif terhadap turnover, dibulatkan ke atas. */
  estimatedCostBps: bigint;
  /** Kosong kecuali `action === "REBALANCE"`. */
  trades: Trade[];
  reason: string;
}

/**
 * ============================ ALASAN ANGKA-ANGKA INI ============================
 *
 * `watchBandBps = 250` (2,5%)
 *   Kenapa segitu: setengah dari pita rebalance. Perannya bukan memicu apa pun,
 *   melainkan memberi satu tingkat peringatan sebelum tindakan — sama seperti
 *   WARN pada Guardian — sehingga operator melihat portofolio mulai melenceng
 *   sebelum agent membelanjakan uang.
 *   Kalau salah: terlalu sempit membuat WATCH menyala hampir selalu dan kehilangan
 *   arti; terlalu lebar membuat WATCH tidak pernah menyala dan tingkat ini sia-sia.
 *   Tidak ada uang yang berpindah karena angka ini, jadi risikonya kecil.
 *
 * `rebalanceBandBps = 500` (5% penyimpangan bobot absolut)
 *   Kenapa segitu: pita toleransi 5% adalah titik yang berulang kali muncul di
 *   literatur rebalancing portofolio (mis. Masters 2003, dan studi-studi Vanguard
 *   soal "rebalancing bands") sebagai wilayah di mana sebagian besar manfaat
 *   pengendalian risiko sudah tertangkap sementara frekuensi transaksi turun
 *   drastis dibanding rebalance kalender atau pita nol.
 *   TIDAK YAKIN: angka itu dikalibrasi untuk portofolio saham/obligasi. Aset
 *   kripto jauh lebih volatil, sehingga pita 5% akan tersentuh JAUH lebih sering
 *   di sini daripada di portofolio tradisional. Ia harus dikalibrasi ulang lewat
 *   `runBacktest` pada deret harga pasangan yang benar-benar dipakai.
 *   Kalau salah: terlalu sempit -> agent bertransaksi terus dan kalah oleh ongkos
 *   (persis kegagalan yang gerbang biaya dirancang untuk menahan); terlalu lebar
 *   -> portofolio boleh melenceng jauh dari profil risiko yang dipilih user, dan
 *   "rebalancer" itu berubah menjadi buy-and-hold yang mahal.
 *
 * `maxRebalanceCostBps = 50` (0,5% dari turnover)
 *   Kenapa segitu: manfaat rebalancing yang terukur di literatur berskala puluhan
 *   bps per TAHUN. Membayar lebih dari 50 bps dalam SATU rebalance berarti
 *   menghabiskan manfaat beberapa tahun sekaligus. Angka ini juga harus lebih
 *   besar daripada `swapFeeBps + slippageBps`, kalau tidak tidak ada ukuran
 *   turnover mana pun yang bisa lolos (lihat `minEconomicTurnoverBase`), dan
 *   `decide` menolak konfigurasi seperti itu secara keras.
 *   TIDAK YAKIN: ini keputusan produk, bukan konstanta yang diturunkan. Yang bisa
 *   dipertanggungjawabkan adalah bentuknya (biaya diukur relatif terhadap nilai
 *   yang dipindahkan, bukan nominal absolut), bukan nilai persisnya.
 *   Kalau salah: terlalu longgar -> portofolio kecil menghabiskan modalnya untuk
 *   gas; terlalu ketat -> agent tidak pernah menyeimbangkan dan bobotnya hanyut.
 *
 * `DEFAULT_COST_MODEL`
 *   `swapFeeBps = 5` adalah tier 0,05% PancakeSwap v3 untuk pasangan berkorelasi.
 *   `slippageBps = 10` (0,1%) adalah toleransi yang lazim untuk ukuran kecil di
 *   pool dalam. `gasCostBase = 30_000_000` = $0,30 adalah taksiran kasar untuk
 *   satu rangkaian swap di BSC.
 *   TIDAK YAKIN: ketiganya taksiran, bukan pengukuran. Ketiganya WAJIB diganti
 *   dengan angka nyata dari lapisan chain sebelum dipakai memutuskan uang; nilai
 *   default ini hanya supaya test dan backtest punya titik awal yang masuk akal.
 * ==============================================================================
 */
export const DEFAULT_THRESHOLDS: RebalanceThresholds = {
  watchBandBps: 250n,
  rebalanceBandBps: 500n,
  maxRebalanceCostBps: 50n,
};

export const DEFAULT_COST_MODEL: CostModel = {
  swapFeeBps: 5n,
  slippageBps: 10n,
  gasCostBase: 30_000_000n,
};

export class PortfolioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioError";
  }
}
