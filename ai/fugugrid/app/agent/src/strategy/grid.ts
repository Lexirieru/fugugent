/**
 * Geometri grid dan aritmetika ongkos. Seluruhnya bigint murni untuk nilai uang;
 * `Number` hanya dipakai untuk indeks pita dan jumlah level, yang memang
 * hitungan kecil dan tidak pernah menyentuh nilai uang.
 *
 * ARAH PEMBULATAN, dan alasannya:
 *  - jarak antar-garis (`minStepBps`) dipotong ke BAWAH -> grid tidak pernah
 *    terlihat lebih menguntungkan daripada aslinya;
 *  - ongkos (`roundTripCostBps`) dibulatkan ke ATAS -> ongkos tidak pernah
 *    diremehkan;
 *  - batas breakout ATAS dipotong ke bawah dan batas breakout BAWAH dibulatkan
 *    ke atas -> keduanya bergerak MENDEKAT ke rentang grid, sehingga breakout
 *    terdeteksi lebih awal. Keluar terlalu cepat berarti kehilangan beberapa
 *    putaran dan membayar gas keluar; keluar terlalu lambat berarti memegang
 *    posisi berarah tanpa rencana, dan kerugiannya tidak dibatasi apa pun.
 */
import { BPS_ONE, GridError, type CostModel, type GridConfig, type GridThresholds } from "./types.js";

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Jumlah interval (= jumlah lot). Garis grid dikurangi satu. */
export function intervalsOf(config: GridConfig): number {
  return config.levels - 1;
}

/** Lebar satu interval dalam dolar, dipotong ke bawah. */
export function stepBase(config: GridConfig): bigint {
  return (config.upperBase - config.lowerBase) / BigInt(intervalsOf(config));
}

/**
 * Harga garis grid ke-`i`, dari 0 (batas bawah) sampai `intervals` (batas atas).
 *
 * Dihitung sebagai `lower + (upper - lower) × i / intervals`, bukan sebagai
 * `lower + step × i`. Bedanya penting: cara kedua menumpuk galat pembulatan
 * `step` sebanyak i kali, sehingga garis teratas meleset dari batas atas dan
 * pita terakhir diam-diam menjadi lebih lebar daripada yang lain.
 */
export function levelPriceBase(config: GridConfig, i: number): bigint {
  const intervals = intervalsOf(config);
  if (!Number.isInteger(i) || i < 0 || i > intervals) {
    throw new GridError(`Indeks garis grid ${i} di luar rentang 0..${intervals}.`);
  }
  return config.lowerBase + ((config.upperBase - config.lowerBase) * BigInt(i)) / BigInt(intervals);
}

/**
 * Jarak antar-garis di titik PALING SEMPIT secara persentase, yaitu di batas
 * atas. Pada grid aritmetik, jarak dolar tetap tetapi jarak persentase mengecil
 * seiring naiknya harga; putaran yang paling tipis marginnya adalah yang di
 * puncak. Memakai jarak rata-rata di sini akan meloloskan grid yang separuh
 * atasnya berdagang di bawah ongkos.
 */
export function minStepBps(config: GridConfig): bigint {
  return (stepBase(config) * BPS_ONE) / config.upperBase;
}

/** Nilai satu lot dalam quote, dipotong ke bawah. */
export function lotValueBase(config: GridConfig): bigint {
  return config.capitalBase / BigInt(intervalsOf(config));
}

/**
 * Ongkos satu putaran penuh beli-lalu-jual, dinyatakan dalam bps terhadap nilai
 * lot.
 *
 * Gas MASUK ke dalam angka ini, dibagi nilai lot. Inilah sebabnya menambah
 * level tanpa menambah modal berbahaya: setiap lot mengecil, gas per lot tetap,
 * dan ongkos putaran membengkak sampai melampaui jarak antar-garis. Grid yang
 * seperti itu kehilangan uang pada setiap perdagangan yang "berhasil".
 */
export function roundTripCostBps(lotValue: bigint, cost: CostModel): bigint {
  if (lotValue <= 0n) {
    throw new GridError(
      `Nilai lot ${lotValue} tidak positif: modal grid terlalu kecil untuk jumlah level yang diminta.`,
    );
  }
  const proporsional = 2n * (cost.swapFeeBps + cost.slippageBps);
  const gas = ceilDiv(2n * cost.gasCostBase * BPS_ONE, lotValue);
  return proporsional + gas;
}

/** Jarak antar-garis minimum yang membuat satu putaran layak dikerjakan. */
export function minProfitableStepBps(
  lotValue: bigint,
  cost: CostModel,
  minProfitMultipleBps: bigint,
): bigint {
  return ceilDiv(roundTripCostBps(lotValue, cost) * minProfitMultipleBps, BPS_ONE);
}

export type PricePosition = "BELOW" | "INSIDE" | "ABOVE";

/** Di mana harga berada relatif terhadap rentang grid, tanpa penjepitan. */
export function pricePosition(priceBase: bigint, config: GridConfig): PricePosition {
  if (priceBase < config.lowerBase) return "BELOW";
  if (priceBase >= config.upperBase) return "ABOVE";
  return "INSIDE";
}

/**
 * Pita tempat harga berada, DIJEPIT ke 0..interval-1.
 *
 * Penjepitan disengaja: harga di luar rentang tetap memetakan ke pita tepi
 * sehingga lot terakhir di tepi itu tetap sempat ditransaksikan ketika harga
 * melompat keluar dalam satu langkah. Tanpa penjepitan, lompatan harga akan
 * meninggalkan persediaan yang tidak pernah dijual.
 */
export function bandIndexOf(priceBase: bigint, config: GridConfig): number {
  const intervals = intervalsOf(config);
  if (priceBase <= config.lowerBase) return 0;
  if (priceBase >= config.upperBase) return intervals - 1;
  const i = ((priceBase - config.lowerBase) * BigInt(intervals)) / (config.upperBase - config.lowerBase);
  return Number(i);
}

/** Batas atas + buffer. Dipotong ke bawah -> breakout terdeteksi lebih awal. */
export function softUpperBase(config: GridConfig, t: GridThresholds): bigint {
  return (config.upperBase * (BPS_ONE + t.breakoutBufferBps)) / BPS_ONE;
}

/** Batas atas + breakout keras. Dipotong ke bawah, alasan yang sama. */
export function hardUpperBase(config: GridConfig, t: GridThresholds): bigint {
  return (config.upperBase * (BPS_ONE + t.hardBreakoutBps)) / BPS_ONE;
}

/** Batas bawah − buffer. Dibulatkan ke ATAS -> breakout terdeteksi lebih awal. */
export function softLowerBase(config: GridConfig, t: GridThresholds): bigint {
  return ceilDiv(config.lowerBase * (BPS_ONE - t.breakoutBufferBps), BPS_ONE);
}

/** Batas bawah − breakout keras. Dibulatkan ke ATAS, alasan yang sama. */
export function hardLowerBase(config: GridConfig, t: GridThresholds): bigint {
  return ceilDiv(config.lowerBase * (BPS_ONE - t.hardBreakoutBps), BPS_ONE);
}

export { ceilDiv };
