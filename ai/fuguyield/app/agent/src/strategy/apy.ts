/**
 * Aritmetika imbal hasil dan ongkos berpindah. Bigint murni: nilai uang di
 * lapisan ini bisa melampaui Number.MAX_SAFE_INTEGER dan konversi ke float akan
 * diam-diam menghilangkan digit terakhir.
 *
 * ARAH PEMBULATAN, dan alasannya:
 *  - ongkos pindah dan ambang selisih dibulatkan ke ATAS   -> menuntut lebih;
 *  - imbal hasil yang diharapkan dipotong ke BAWAH          -> menjanjikan kurang;
 *  - pangsa pool dibulatkan ke ATAS                         -> kita tidak pernah
 *    terlihat lebih kecil di dalam pool daripada aslinya.
 * Ketiganya menuju sisi yang sama: TETAP DI TEMPAT. Diam adalah pilihan yang
 * bisa dibatalkan pada pengamatan berikutnya; perpindahan sudah membayar gas
 * dan slippage dan tidak bisa ditarik kembali.
 *
 * Bunga dihitung SEDERHANA (tidak majemuk). Penyederhanaan ini meremehkan kedua
 * sisi perbandingan, tetapi meremehkan sisi ber-APY tinggi sedikit lebih
 * banyak — artinya ia membuat perpindahan tampak sedikit KURANG menarik
 * daripada aslinya, arah yang sama dengan seluruh modul ini.
 */
import { BPS_ONE, DAYS_PER_YEAR, YieldError, type SwitchCostModel } from "./types.js";

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Ongkos satu kali berpindah pool: proporsional atas pokok + gas tetap. */
export function switchCostBase(principalBase: bigint, cost: SwitchCostModel): bigint {
  if (principalBase <= 0n) {
    throw new YieldError(`Pokok ${principalBase} tidak positif: tidak ada yang bisa dipindahkan.`);
  }
  return ceilDiv(principalBase * (cost.swapFeeBps + cost.slippageBps), BPS_ONE) + cost.gasCostBase;
}

/**
 * SELISIH APY MINIMUM yang persis menutup ongkos pindah selama `days` hari.
 * Ini konstanta terpenting di seluruh strategi, dan ia DITURUNKAN, bukan
 * ditebak: ongkos dibayar sekali, selisih dibayar per hari, jadi
 *
 *     ongkos = pokok × selisihBps × hari / (10000 × 365)
 *  => selisihBps = ongkos × 10000 × 365 / (pokok × hari)
 *
 * Konsekuensi yang harus dipahami sebelum menyetel apa pun: ambang ini
 * berbanding TERBALIK dengan pokok dan dengan horizon. Memindahkan $200 butuh
 * selisih puluhan kali lebih besar daripada memindahkan $200.000, dan horizon
 * seminggu menuntut sekitar empat kali lipat horizon sebulan. "APY tertinggi"
 * karena itu bukan jawaban — jawabannya bergantung pada berapa besar uangnya
 * dan berapa lama ia akan tinggal.
 */
export function breakEvenSpreadBps(
  principalBase: bigint,
  switchCost: bigint,
  days: bigint,
): bigint {
  if (principalBase <= 0n) {
    throw new YieldError(`Pokok ${principalBase} tidak positif.`);
  }
  if (days <= 0n) {
    throw new YieldError(
      `Horizon ${days} hari tidak positif: pertanyaan "apakah pindah ini sepadan" tidak punya jawaban tanpa horizon.`,
    );
  }
  return ceilDiv(switchCost * BPS_ONE * DAYS_PER_YEAR, principalBase * days);
}

/** Ambang impas dikali pengali keamanan, dibulatkan ke atas. */
export function requiredSpreadBps(breakEvenBps: bigint, safetyMultipleBps: bigint): bigint {
  return ceilDiv(breakEvenBps * safetyMultipleBps, BPS_ONE);
}

/** Imbal hasil sederhana (tidak majemuk) selama `days` hari, dipotong ke bawah. */
export function yieldOverPeriodBase(principalBase: bigint, apyBps: bigint, days: bigint): bigint {
  return (principalBase * apyBps * days) / (BPS_ONE * DAYS_PER_YEAR);
}

/** Keuntungan bersih perpindahan selama horizon; negatif bila tidak sepadan. */
export function netGainBase(
  principalBase: bigint,
  spreadBps: bigint,
  days: bigint,
  switchCost: bigint,
): bigint {
  return yieldOverPeriodBase(principalBase, spreadBps, days) - switchCost;
}

/** Pangsa kita di dalam pool, dibulatkan ke atas. */
export function poolShareBps(principalBase: bigint, tvlBase: bigint): bigint {
  if (tvlBase <= 0n) {
    throw new YieldError(`TVL ${tvlBase} tidak positif: itu bukan pool, itu pembacaan yang gagal.`);
  }
  return ceilDiv(principalBase * BPS_ONE, tvlBase);
}

export { ceilDiv };
