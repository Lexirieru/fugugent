/**
 * Aritmetika bobot dan biaya. Seluruhnya bigint murni: tanpa `Number()`, tanpa
 * jaringan, tanpa jam. Nilai uang di sini bisa melampaui Number.MAX_SAFE_INTEGER
 * dan konversi ke float akan diam-diam kehilangan digit terakhir — persis digit
 * yang menentukan berapa dolar berpindah.
 *
 * ARAH PEMBULATAN, dan alasannya:
 *  - besaran penyimpangan dibulatkan ke BAWAH  -> penyimpangan tidak pernah
 *    dilebih-lebihkan, sehingga agent tidak terpancing bertransaksi karena
 *    pembulatan;
 *  - biaya dibulatkan ke ATAS -> biaya tidak pernah diremehkan, sehingga
 *    gerbang biaya tidak pernah lolos gara-gara pembulatan.
 * Kedua arah menuju sisi yang sama: TIDAK bertransaksi. Tidak bertransaksi
 * adalah pilihan yang bisa dibatalkan pada candle berikutnya; transaksi yang
 * salah sudah membayar gas dan tidak bisa ditarik.
 */
import { BPS_ONE, PortfolioError, type Asset, type CostModel, type Trade } from "./types.js";

/** Pembagian bigint yang dibulatkan ke atas. `a >= 0`, `b > 0`. */
export const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

export function totalValueBase(assets: readonly Asset[]): bigint {
  let total = 0n;
  for (const a of assets) total += a.valueBase;
  return total;
}

/** Bobot aset dalam bps, dipotong ke bawah. */
export function weightBps(valueBase: bigint, totalBase: bigint): bigint {
  if (totalBase <= 0n) {
    throw new PortfolioError(
      `Bobot tidak terdefinisi pada portofolio bernilai ${totalBase}. Nilai total wajib > 0.`,
    );
  }
  return (valueBase * BPS_ONE) / totalBase;
}

/**
 * Besaran penyimpangan bobot dari target, dalam bps, dipotong ke bawah.
 *
 * Dihitung dari selisih yang sudah diskalakan (`nilai×10000` vs `total×target`)
 * dan BUKAN dari selisih dua bobot yang masing-masing sudah dibulatkan. Kalau
 * dihitung dengan cara kedua, arah pembulatannya berbeda untuk aset kelebihan
 * bobot dan aset kekurangan bobot — yang kekurangan bobot akan terlihat lebih
 * menyimpang daripada aslinya dan bisa memicu transaksi yang tidak perlu.
 */
export function absDeviationBps(valueBase: bigint, targetWeightBps: bigint, totalBase: bigint): bigint {
  if (totalBase <= 0n) {
    throw new PortfolioError(
      `Penyimpangan tidak terdefinisi pada portofolio bernilai ${totalBase}. Nilai total wajib > 0.`,
    );
  }
  const aktual = valueBase * BPS_ONE;
  const target = totalBase * targetWeightBps;
  const selisih = aktual > target ? aktual - target : target - aktual;
  return selisih / totalBase;
}

export function maxAbsDeviationBps(assets: readonly Asset[], totalBase: bigint): bigint {
  let max = 0n;
  for (const a of assets) {
    const d = absDeviationBps(a.valueBase, a.targetWeightBps, totalBase);
    if (d > max) max = d;
  }
  return max;
}

/** Nilai yang seharusnya dipegang aset ini, dipotong ke bawah. */
export function targetValueBase(totalBase: bigint, targetWeightBps: bigint): bigint {
  return (totalBase * targetWeightBps) / BPS_ONE;
}

/**
 * Rangkaian transaksi untuk mengembalikan setiap aset ke bobot targetnya.
 *
 * Kaki JUAL selalu mendahului kaki BELI. Bukan kosmetik: session key Altana
 * mengeksekusi daftar `calls` secara berurutan dalam satu userOp, dan membeli
 * sebelum menjual berarti membutuhkan modal yang belum tersedia.
 *
 * Karena `targetValueBase` dipotong ke bawah, jumlah seluruh nilai target bisa
 * kurang dari total portofolio sebanyak paling banyak (jumlah aset − 1) unit
 * basis, yaitu di bawah 1e-8 dolar per aset. Debu sebesar itu tertinggal di
 * kaki jual dan sengaja tidak dialokasikan: mengejarnya akan menambah satu unit
 * pada suatu aset secara sewenang-wenang tanpa mengubah apa pun yang terlihat.
 *
 * Rebalance selalu menuju target PENUH, bukan ke tepi pita. Rebalance ke tepi
 * pita memang memindahkan lebih sedikit nilai (ongkos lebih murah) tetapi
 * membuat portofolio selalu duduk persis di batas, sehingga guncangan kecil
 * berikutnya langsung memicu rebalance lagi — churn yang justru ingin dihindari.
 */
export function computeTrades(assets: readonly Asset[], totalBase: bigint): Trade[] {
  const jual: Trade[] = [];
  const beli: Trade[] = [];
  for (const a of assets) {
    const target = targetValueBase(totalBase, a.targetWeightBps);
    const delta = a.valueBase - target;
    if (delta > 0n) jual.push({ symbol: a.symbol, side: "SELL", valueBase: delta });
    else if (delta < 0n) beli.push({ symbol: a.symbol, side: "BUY", valueBase: -delta });
  }
  return [...jual, ...beli];
}

/**
 * Nilai yang benar-benar berpindah: hanya kaki JUAL.
 *
 * Menjumlahkan jual + beli akan menghitung dolar yang sama dua kali dan
 * membuat biaya relatif (`costBpsOfTurnover`) tampak setengah dari aslinya —
 * gerbang biaya akan meloloskan rebalance yang seharusnya ditolak.
 */
export function turnoverBase(trades: readonly Trade[]): bigint {
  let t = 0n;
  for (const tr of trades) if (tr.side === "SELL") t += tr.valueBase;
  return t;
}

/**
 * Taksiran biaya satu rebalance dalam USD basis 8 desimal.
 * Bagian proporsional dibulatkan ke ATAS.
 *
 * Turnover nol berarti tidak ada transaksi yang dikirim, sehingga tidak ada gas
 * yang dibayar — bukan "gas gratis", melainkan tidak ada transaksi sama sekali.
 */
export function estimateCostBase(turnover: bigint, cost: CostModel): bigint {
  if (turnover <= 0n) return 0n;
  const proporsional = ceilDiv(turnover * (cost.swapFeeBps + cost.slippageBps), BPS_ONE);
  return proporsional + cost.gasCostBase;
}

/** Biaya relatif terhadap turnover, dibulatkan ke ATAS. */
export function costBpsOfTurnover(costBase: bigint, turnover: bigint): bigint {
  if (turnover <= 0n) {
    throw new PortfolioError(
      "Biaya relatif tidak terdefinisi ketika tidak ada nilai yang dipindahkan (turnover 0).",
    );
  }
  return ceilDiv(costBase * BPS_ONE, turnover);
}

/**
 * Turnover terkecil yang DIJAMIN lolos gerbang biaya `maxCostBps`.
 *
 * Ini konstanta paling berguna di modul ini karena ia bukan angka ajaib: ia
 * diturunkan dari gas dan anggaran biaya. Dengan biaya proporsional r = fee +
 * slippage dan gas g, biaya relatif dari turnover T adalah r + g×10000/T.
 * Syarat r + g×10000/T <= M memberi T >= g×10000/(M − r).
 *
 * Rumus yang dipakai memakai (g + 1), bukan g, karena `estimateCostBase`
 * membulatkan bagian proporsional ke atas sebanyak kurang dari satu unit basis;
 * satu unit tambahan itu menutupi pembulatan tersebut untuk seluruh nilai T.
 * Akibatnya hasilnya adalah batas yang aman (bisa satu-dua unit di atas minimum
 * sejati), bukan minimum eksak — arah yang sama dengan seluruh modul ini:
 * menuntut lebih banyak turnover, bukan lebih sedikit.
 *
 * Mengembalikan `null` bila M <= r: biaya proporsional saja sudah melampaui
 * anggaran, sehingga TIDAK ADA ukuran portofolio yang membuat rebalance
 * ekonomis. Itu bukan kondisi yang boleh lewat diam-diam — `decide` menolak
 * konfigurasi seperti itu.
 */
export function minEconomicTurnoverBase(cost: CostModel, maxCostBps: bigint): bigint | null {
  const proporsionalBps = cost.swapFeeBps + cost.slippageBps;
  if (maxCostBps <= proporsionalBps) return null;
  return ceilDiv((cost.gasCostBase + 1n) * BPS_ONE, maxCostBps - proporsionalBps);
}
