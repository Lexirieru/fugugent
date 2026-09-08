/**
 * Tipe dan ambang untuk strategi GRID.
 *
 * SATUAN — seragam di seluruh paket ini:
 *  - harga dan nilai uang: basis 8 desimal (`*Base`), 100_000_000n = $1,00
 *  - jumlah token: 18 desimal (`WAD`) — SELURUH token di BSC 18 desimal,
 *    termasuk USDT dan USDC
 *  - persentase: basis point (`*Bps`), 10_000n = 100%
 *
 * Modul ini murni: tanpa jaringan, jam, atau environment. Keputusan finansial
 * di Fugugent tidak pernah lewat LLM.
 */

export const USD8_ONE = 100_000_000n;
export const BPS_ONE = 10_000n;
export const WAD = 10n ** 18n;

/**
 * Konfigurasi satu grid.
 *
 * `levels` adalah jumlah GARIS grid; jumlah interval (dan jumlah lot) adalah
 * `levels - 1`. Membedakan keduanya penting: kesalahan off-by-one di sini
 * membuat setiap lot bernilai salah dan memindahkan seluruh perhitungan ongkos.
 */
export interface GridConfig {
  /** Harga batas bawah, USD basis 8 desimal. */
  lowerBase: bigint;
  /** Harga batas atas, USD basis 8 desimal. */
  upperBase: bigint;
  /** Jumlah garis grid. Interval = levels - 1. */
  levels: number;
  /** Modal yang dialokasikan ke grid ini, USD basis 8 desimal. */
  capitalBase: bigint;
}

/**
 * Seluruh ingatan grid. `decide` adalah reducer murni atas struktur ini:
 * state masuk lewat argumen dan state baru keluar lewat `GridDecision.nextState`.
 * Tidak ada yang disimpan di dalam modul strategi.
 */
export interface GridState {
  /** Pita tempat harga berada pada pengamatan sebelumnya, 0..interval-1. */
  bandIndex: number;
  /** Jumlah lot aset dasar yang sedang dipegang, 0..interval. */
  lotsHeld: number;
  /** Berapa pengamatan BERTURUT-TURUT harga berada di luar buffer breakout. */
  consecutiveOutside: number;
  /** Arah pelanggaran yang sedang dihitung; null bila harga di dalam buffer. */
  outsideSide: "ABOVE" | "BELOW" | null;
}

export interface GridObservation {
  /** Harga aset dasar dalam quote, USD basis 8 desimal. */
  priceBase: bigint;
  blockNumber: bigint;
}

export interface CostModel {
  /** Fee pool DEX. PancakeSwap v3 tier 0,05% = 5 bps. */
  swapFeeBps: bigint;
  /** Dampak harga + toleransi slippage. */
  slippageBps: bigint;
  /** Gas satu swap, USD basis 8 desimal. */
  gasCostBase: bigint;
}

export type GridAction = "IDLE" | "BUY" | "SELL" | "WATCH_BREAKOUT" | "EXIT_ABOVE" | "EXIT_BELOW";

export type BreakoutStatus = "NONE" | "WATCHING_ABOVE" | "WATCHING_BELOW";

export interface GridDecision {
  action: GridAction;
  /** Pita tempat harga berada sekarang, sudah dijepit ke 0..interval-1. */
  bandIndex: number;
  /** Jumlah lot yang benar-benar ditransaksikan setelah dibatasi modal/persediaan. */
  lots: number;
  /** Nilai nominal yang ditransaksikan = lots × nilai lot, USD basis 8 desimal. */
  notionalBase: bigint;
  /** true bila lot yang diinginkan lebih banyak daripada yang bisa dieksekusi. */
  lotsCapped: boolean;
  breakout: BreakoutStatus;
  /** Ongkos satu putaran beli-lalu-jual pada ukuran lot ini, bps. */
  roundTripCostBps: bigint;
  /** Jarak antar-garis di titik paling sempit (batas atas), bps. */
  minStepBps: bigint;
  nextState: GridState;
  reason: string;
}

export interface GridThresholds {
  breakoutBufferBps: bigint;
  breakoutConfirmObservations: number;
  hardBreakoutBps: bigint;
  minProfitMultipleBps: bigint;
  maxRangeRatioBps: bigint;
}

/**
 * ============================ ALASAN ANGKA-ANGKA INI ============================
 *
 * `breakoutBufferBps = 200` (2% di luar batas)
 *   Kenapa segitu: harga yang menembus batas satu-dua unit basis bukan breakout,
 *   itu sumbu lilin di likuiditas tipis atau satu pembacaan oracle yang meleset.
 *   Membongkar grid karena itu berarti membayar gas keluar-masuk untuk kembali
 *   ke keadaan semula.
 *   Kalau salah: terlalu sempit -> grid dibongkar-pasang oleh derau dan setiap
 *   siklus itu membayar gas; terlalu lebar -> grid menganggur di luar rentangnya,
 *   tidak menghasilkan apa-apa sambil memikul risiko arah penuh (di bawah rentang
 *   ia 100% long, di atas rentang ia 100% quote dan melewatkan kenaikan).
 *   TIDAK YAKIN: 2% dipilih karena kira-kira sebesar sumbu lilin lima menit pada
 *   pasangan besar BSC. Ia harus dikalibrasi ulang per pasangan, dan pasangan
 *   yang lebih tipis butuh buffer lebih lebar.
 *
 * `breakoutConfirmObservations = 3`
 *   Kenapa segitu: satu pengamatan di luar batas tidak bisa dibedakan dari RPC
 *   yang mengembalikan data basi atau satu blok dengan likuiditas kosong. Tiga
 *   pengamatan berturut-turut menuntut harga BERTAHAN di luar.
 *   Kalau salah: terlalu kecil -> keluar karena satu pembacaan buruk; terlalu
 *   besar -> penundaan keluar berbanding lurus dengan kerugian yang dibiarkan
 *   membesar pada breakout yang sungguhan.
 *   TIDAK YAKIN: nilai yang benar terikat pada CADENS keeper, yang tidak diketahui
 *   modul ini (dan tidak boleh diketahui — modul ini murni). Tiga pengamatan pada
 *   cadens satu menit adalah tiga menit; pada cadens satu jam adalah tiga jam.
 *   Siapa pun yang menyetel penjadwal WAJIB menyetel angka ini bersamanya.
 *
 * `hardBreakoutBps = 1000` (10% di luar batas)
 *   Kenapa segitu: pada jarak sejauh ini harga tidak lagi bisa disebut sumbu.
 *   Menunggu konfirmasi di sini hanya menambah kerugian, jadi jalur konfirmasi
 *   dilewati sepenuhnya. Ini pengaman terakhir grid, bukan aturan biasa.
 *   Kalau salah: terlalu dekat ke buffer -> jalur konfirmasi tidak pernah terpakai
 *   dan derau bisa langsung membongkar grid; terlalu jauh -> pengaman ini tidak
 *   pernah menyala lebih dulu daripada konfirmasi biasa, jadi percuma.
 *
 * `minProfitMultipleBps = 20_000` (2,00x)
 *   Kenapa segitu: jarak antar-garis grid HARUS lebih besar daripada ongkos satu
 *   putaran beli-lalu-jual, kalau tidak setiap putaran yang "berhasil" justru
 *   merugi. Pengali 1,00x adalah grid impas: mesin yang sibuk membayar biaya
 *   sambil memikul risiko persediaan. 2,00x berarti setengah dari selisih kotor
 *   tersisa sebagai keuntungan.
 *   TIDAK YAKIN: 2,00x keputusan produk, bukan turunan. Yang bisa
 *   dipertanggungjawabkan adalah bentuknya (jarak diukur relatif terhadap ongkos
 *   putaran yang SUDAH memasukkan gas per lot), bukan angkanya.
 *   Kalau salah: terlalu kecil -> grid yang secara matematis merugi lolos
 *   validasi; terlalu besar -> grid yang sebenarnya layak ditolak dan agent
 *   tidak pernah berdagang.
 *
 * `maxRangeRatioBps = 30_000` (batas atas maksimal 3x batas bawah)
 *   Kenapa segitu: grid ini ARITMETIK — garis-garisnya berjarak sama dalam
 *   dolar, bukan dalam persen. Jarak persentase karenanya paling lebar di batas
 *   bawah dan paling sempit di batas atas, dan rasio kedua ekstrem itu PERSIS
 *   sama dengan rasio rentang. Pada 3x, satu putaran di dasar grid menghasilkan
 *   persentase tiga kali lipat putaran di puncaknya. Lebih lebar dari itu dan
 *   pemeriksaan profitabilitas (yang memakai jarak paling sempit) menjadi begitu
 *   konservatif sehingga sebagian besar grid ditolak, atau — kalau
 *   pemeriksaannya dilonggarkan — separuh atas grid berdagang di bawah ongkos.
 *   Grid geometrik (jarak persentase konstan) tidak punya masalah ini, tetapi
 *   membutuhkan akar pangkat-n yang tidak bisa dihitung eksak dengan bigint;
 *   mendekatinya dengan float akan menaruh galat float persis di jalur harga
 *   yang menentukan transaksi. Batas 3x adalah harga yang dibayar untuk
 *   aritmetika yang eksak.
 *
 * `DEFAULT_COST_MODEL`
 *   TIDAK YAKIN: ketiganya taksiran, bukan pengukuran. `swapFeeBps = 5` adalah
 *   tier 0,05% PancakeSwap v3; `slippageBps = 10` toleransi lazim untuk ukuran
 *   kecil; `gasCostBase = 5_000_000` = $0,05 untuk satu swap di BSC. Wajib
 *   diganti dengan angka nyata dari lapisan chain sebelum memutuskan uang.
 * ==============================================================================
 */
export const DEFAULT_GRID_THRESHOLDS: GridThresholds = {
  breakoutBufferBps: 200n,
  breakoutConfirmObservations: 3,
  hardBreakoutBps: 1_000n,
  minProfitMultipleBps: 20_000n,
  maxRangeRatioBps: 30_000n,
};

export const DEFAULT_COST_MODEL: CostModel = {
  swapFeeBps: 5n,
  slippageBps: 10n,
  gasCostBase: 5_000_000n,
};

export class GridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridError";
  }
}
