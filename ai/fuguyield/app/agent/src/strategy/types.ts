/**
 * Tipe dan ambang untuk strategi YIELD.
 *
 * SATUAN — seragam di seluruh paket ini:
 *  - nilai uang: basis 8 desimal (`*Base`), 100_000_000n = $1,00
 *  - jumlah token: 18 desimal (`WAD`) — SELURUH token di BSC 18 desimal,
 *    termasuk USDT dan USDC
 *  - APY dan persentase: basis point (`*Bps`), 10_000n = 100%
 *
 * Modul ini murni: tanpa jaringan, jam, atau environment. Umur data APY masuk
 * lewat `Pool.apyAgeSeconds`, BUKAN dihitung dari `Date.now()` — kalau modul
 * ini membaca jam, keputusan yang sama tidak bisa diputar ulang dan tidak bisa
 * di-backtest.
 */

export const USD8_ONE = 100_000_000n;
export const BPS_ONE = 10_000n;
export const WAD = 10n ** 18n;

/** Protokol lending memakai basis 365 hari untuk APY, bukan 360. */
export const DAYS_PER_YEAR = 365n;

export interface Pool {
  poolId: string;
  protocol: string;
  /** APY dalam bps. 500n = 5,00% setahun. */
  apyBps: bigint;
  /** Total value locked pool, USD basis 8 desimal. */
  tvlBase: bigint;
  /**
   * Skor risiko 0..100 dari allowlist/riset kita sendiri. Modul ini TIDAK
   * menghitungnya dan tidak berpura-pura bisa: risiko protokol adalah penilaian
   * manusia (audit, umur, rekam jejak, kualitas oracle) yang masuk sebagai data.
   */
  riskScore: number;
  /** false bila pool dijeda, dihentikan, atau ditandai deprecated protokolnya. */
  isActive: boolean;
  /** Umur pembacaan APY dalam detik pada saat pengamatan ini diambil. */
  apyAgeSeconds: number;
}

export interface YieldPosition {
  /** Pokok yang dikelola, USD basis 8 desimal. */
  principalBase: bigint;
  current: Pool;
}

export interface YieldObservation {
  position: YieldPosition;
  /** Pool alternatif. Pool yang sama dengan posisi sekarang diabaikan. */
  candidates: Pool[];
  /**
   * Berapa pengamatan BERTURUT-TURUT kandidat terbaik yang sama sudah memenuhi
   * ambang selisih. Dihitung oleh pemanggil (penjadwal), bukan oleh modul ini —
   * modul ini murni dan tidak punya ingatan. Aturan menghitungnya tegas:
   * naikkan bila `spreadQualifies` true DAN `targetPoolId` sama dengan
   * pengamatan sebelumnya; selain itu setel ke nol.
   */
  consecutiveFavorable: number;
  blockNumber: bigint;
}

export interface SwitchCostModel {
  /** Fee pool DEX untuk menukar aset saat berpindah. */
  swapFeeBps: bigint;
  /** Dampak harga + toleransi slippage. */
  slippageBps: bigint;
  /** Gas SELURUH rangkaian pindah (tarik, tukar, setor), USD basis 8 desimal. */
  gasCostBase: bigint;
}

export type YieldAction = "STAY" | "MIGRATE" | "EXIT";

export type YieldReasonCode =
  | "NO_CANDIDATE"
  | "NO_BETTER_POOL"
  | "SPREAD_BELOW_BREAKEVEN"
  | "SPREAD_NOT_CONFIRMED"
  | "MIGRATION_ECONOMIC"
  | "CURRENT_POOL_UNSAFE"
  | "NO_ELIGIBLE_POOL"
  | "CURRENT_DATA_STALE";

export type RejectReason =
  | "SAME_POOL"
  | "INACTIVE"
  | "RISK_SCORE"
  | "POOL_SHARE"
  | "IMPLAUSIBLE_APY"
  | "STALE_DATA";

export interface RejectedPool {
  poolId: string;
  why: RejectReason;
}

export interface YieldDecision {
  action: YieldAction;
  reasonCode: YieldReasonCode;
  /** Kandidat terbaik yang lolos gerbang risiko; null bila tidak ada. */
  targetPoolId: string | null;
  currentApyBps: bigint;
  bestApyBps: bigint | null;
  /** APY kandidat terbaik dikurangi APY sekarang; 0 bila tidak ada kandidat. */
  spreadBps: bigint;
  /** Selisih APY yang persis menutup ongkos pindah selama horizon. */
  breakEvenSpreadBps: bigint;
  /** Ambang impas dikali pengali keamanan. */
  requiredSpreadBps: bigint;
  /** true bila `spreadBps >= requiredSpreadBps`. Dipakai pemanggil untuk menghitung konfirmasi. */
  spreadQualifies: boolean;
  switchCostBase: bigint;
  /** Taksiran keuntungan bersih selama horizon; bisa negatif. */
  netGainBase: bigint;
  rejected: RejectedPool[];
  reason: string;
}

export interface YieldThresholds {
  expectedHoldingDays: bigint;
  spreadSafetyMultipleBps: bigint;
  maxPoolShareBps: bigint;
  maxPlausibleApyBps: bigint;
  maxRiskScore: number;
  maxApyAgeSeconds: number;
  minConsecutiveFavorable: number;
}

/**
 * ============================ ALASAN ANGKA-ANGKA INI ============================
 *
 * `expectedHoldingDays = 30`
 *   Kenapa ada: ambang "selisih APY minimum yang membenarkan perpindahan" TIDAK
 *   BISA dihitung tanpa horizon. Ongkos pindah dibayar sekali; selisih APY
 *   dibayar per hari. Tanpa asumsi berapa lama posisi akan bertahan, pertanyaan
 *   "apakah pindah ini sepadan" tidak punya jawaban.
 *   Kenapa 30: kira-kira selama itu APY pasar lending bertahan sebelum
 *   re-rating besar, dan cukup pendek untuk tidak melebih-lebihkan.
 *   Kalau salah: horizon terlalu PANJANG membuat ambang impas kecil sehingga
 *   agent berpindah untuk selisih tipis yang belum tentu bertahan selama itu —
 *   ini arah yang berbahaya karena kerugiannya nyata dan keuntungannya
 *   hipotetis. Horizon terlalu PENDEK membuat ambang begitu tinggi sehingga
 *   agent tidak pernah pindah dan tidak melakukan apa-apa.
 *   TIDAK YAKIN: ini asumsi, dan asumsi ini yang paling menentukan seluruh
 *   perilaku strategi. Ia harus diuji ulang terhadap berapa lama posisi
 *   BENAR-BENAR bertahan di produksi; kalau ternyata rata-ratanya 7 hari,
 *   angka ini harus 7 dan ambangnya melonjak dari ratusan ke ribuan bps.
 *
 * `spreadSafetyMultipleBps = 20_000` (2,00x ambang impas)
 *   Kenapa ada: APY bukan janji, melainkan potret sesaat. Ia turun begitu modal
 *   masuk (deposit kita sendiri ikut menurunkannya), sebagiannya sering berupa
 *   emisi token hadiah yang harganya sendiri jatuh, dan ia dihitung dari
 *   utilisasi yang berubah setiap blok. Pindah tepat di titik impas berarti
 *   bertaruh bahwa angka rapuh itu bertahan persis.
 *   Kenapa 2,00x: perpindahan tetap sepadan walau selisih yang benar-benar
 *   terealisasi hanya setengah dari yang dikutip.
 *   Kalau salah: terlalu kecil -> agent berpindah mengejar angka yang menguap
 *   sebelum ongkosnya kembali; terlalu besar -> agent tidak pernah pindah dan
 *   membiarkan selisih nyata lewat.
 *   TIDAK YAKIN: 2,00x keputusan produk, bukan turunan.
 *
 * `maxPoolShareBps = 1_000` (pokok maksimal 10% dari TVL pool)
 *   Kenapa ada: APY tertinggi biasanya ada di pool terkecil, dan itu bukan
 *   kebetulan — APY dihitung dari utilisasi, dan pool kecil mudah terlihat
 *   memikat. Menyetor ke pool yang kita kuasai berarti APY yang kita kejar
 *   berubah menjadi pantulan modal kita sendiri, dan saat ingin keluar tidak
 *   ada likuiditas keluar selain diri kita.
 *   Kenapa 10%: diikat ke POKOK, bukan ke angka dolar absolut, sehingga ia ikut
 *   menyesuaikan diri saat modal bertambah.
 *   Kalau salah: terlalu longgar -> agent menjadi likuiditas keluar bagi orang
 *   lain; terlalu ketat -> hanya pool raksasa yang lolos dan imbal hasilnya
 *   nyaris sama dengan diam saja.
 *
 * `maxPlausibleApyBps = 100_000` (1.000% setahun)
 *   Kenapa ada: angka di atas ini hampir selalu emisi hadiah yang tidak
 *   berkelanjutan, kesalahan desimal di indexer, atau pool yang sengaja dibuat
 *   untuk memancing. Menolaknya sebagai DATA RUSAK lebih benar daripada
 *   mengejarnya.
 *   Kalau salah: terlalu rendah -> peluang nyata tapi jarang ikut tertolak;
 *   terlalu tinggi -> agent mengejar fatamorgana.
 *   TIDAK YAKIN: batas ini heuristik, bukan hasil pengukuran distribusi APY.
 *
 * `maxRiskScore = 50`
 *   Titik tengah skala 0..100 yang datang dari riset manusia. Modul ini tidak
 *   menghitung skornya; ia hanya menolak yang melampaui ambang.
 *   Kalau salah: terlalu longgar -> agent menaruh uang di protokol yang belum
 *   diaudit demi beberapa ratus bps; terlalu ketat -> hanya satu-dua protokol
 *   yang lolos dan strategi ini kehilangan alasan keberadaannya.
 *
 * `maxApyAgeSeconds = 3_600` (satu jam)
 *   Kenapa ada: APY pasar lending bergerak mengikuti utilisasi, yang berubah
 *   setiap blok. Bertindak atas angka satu jam lalu adalah bertindak atas angka
 *   yang sudah berubah. Menolak data basi lebih baik daripada memindahkan uang
 *   berdasarkan angka yang sudah tidak berlaku.
 *   Kalau salah: terlalu ketat -> data hampir tidak pernah cukup segar dan
 *   agent lumpuh; terlalu longgar -> perpindahan dibayar untuk selisih yang
 *   sudah tidak ada.
 *
 * `minConsecutiveFavorable = 3`
 *   Kenapa ada: satu lonjakan APY biasanya adalah satu pinjaman besar yang baru
 *   mendarat dan akan diarbitrase dalam hitungan menit. Menuntut selisih itu
 *   BERTAHAN mencegah agent bolak-balik antara dua pool (setiap bolak-balik
 *   membayar ongkos penuh dua kali).
 *   Kalau salah: terlalu kecil -> mengejar lonjakan sesaat; terlalu besar ->
 *   peluang nyata sudah habis diambil orang lain sebelum konfirmasi selesai.
 *   TIDAK YAKIN: sama seperti pada Grid, nilai yang benar terikat pada CADENS
 *   penjadwal yang tidak diketahui modul ini. Tiga pengamatan per jam adalah
 *   tiga jam; per hari adalah tiga hari.
 *
 * `DEFAULT_SWITCH_COST`
 *   TIDAK YAKIN: taksiran, bukan pengukuran. `gasCostBase = $1` mewakili
 *   rangkaian tarik + tukar + setor di BSC. Wajib diganti dengan angka nyata
 *   dari lapisan chain sebelum memutuskan uang.
 * ==============================================================================
 */
export const DEFAULT_YIELD_THRESHOLDS: YieldThresholds = {
  expectedHoldingDays: 30n,
  spreadSafetyMultipleBps: 20_000n,
  maxPoolShareBps: 1_000n,
  maxPlausibleApyBps: 100_000n,
  maxRiskScore: 50,
  maxApyAgeSeconds: 3_600,
  minConsecutiveFavorable: 3,
};

export const DEFAULT_SWITCH_COST: SwitchCostModel = {
  swapFeeBps: 5n,
  slippageBps: 10n,
  gasCostBase: 100_000_000n,
};

export class YieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YieldError";
  }
}
