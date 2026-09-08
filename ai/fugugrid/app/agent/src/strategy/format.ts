/**
 * SATU-SATUNYA pintu keluar angka domain menuju manusia (dan menuju prompt LLM).
 * Semua fungsi murni aritmetika bigint; `Number()` tidak dipakai karena nilai di
 * lapisan ini bisa melampaui Number.MAX_SAFE_INTEGER dan konversi ke float akan
 * diam-diam menghilangkan digit terakhir.
 */
import { USD8_ONE, WAD } from "./types.js";

function grupRibuan(n: bigint): string {
  const s = n.toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ".";
    out += s[i];
  }
  return out;
}

/** Nilai uang basis 8 desimal -> dolar dua desimal. Pecahan sen DIPOTONG. */
export function formatUsd8(v: bigint): string {
  const negatif = v < 0n;
  const abs = negatif ? -v : v;
  const dolar = abs / USD8_ONE;
  const sen = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negatif ? "-" : ""}$${grupRibuan(dolar)},${sen.toString().padStart(2, "0")}`;
}

/**
 * HARGA basis 8 desimal -> dolar dengan desimal secukupnya (2 sampai 8).
 *
 * Harga punya formatter sendiri karena `formatUsd8` memotong pada dua desimal,
 * dan grid pada token berharga $0,00012345 akan menampilkan SELURUH garisnya
 * sebagai "$0,00" — seluruh keputusan menjadi tidak terbaca. Nol di belakang
 * dipangkas supaya harga besar tetap ringkas, tetapi minimal dua desimal
 * dipertahankan supaya "$600" tidak pernah terbaca sebagai bilangan bulat yang
 * sudah dibulatkan.
 */
export function formatPriceUsd8(v: bigint): string {
  const negatif = v < 0n;
  const abs = negatif ? -v : v;
  const dolar = abs / USD8_ONE;
  let pecahan = (abs % USD8_ONE).toString().padStart(8, "0");
  while (pecahan.length > 2 && pecahan.endsWith("0")) pecahan = pecahan.slice(0, -1);
  return `${negatif ? "-" : ""}$${grupRibuan(dolar)},${pecahan}`;
}

/**
 * Jumlah token 18 desimal -> enam desimal, sisanya DIPOTONG sehingga jumlah
 * yang ditampilkan tidak pernah melebihi jumlah yang benar-benar berpindah.
 */
export function formatToken18(v: bigint): string {
  const negatif = v < 0n;
  const abs = negatif ? -v : v;
  const bulat = abs / WAD;
  const pecahan = ((abs % WAD) * 1_000_000n) / WAD;
  return `${negatif ? "-" : ""}${grupRibuan(bulat)},${pecahan.toString().padStart(6, "0")}`;
}

/** bps -> persen satu desimal. */
export function formatPercentFromBps(bps: bigint): string {
  const negatif = bps < 0n;
  const abs = negatif ? -bps : bps;
  const persepuluh = abs / 10n;
  return `${negatif ? "-" : ""}${persepuluh / 10n},${persepuluh % 10n}`;
}

/** bps apa adanya dengan satuannya, supaya tidak tertukar dengan persen. */
export function formatBps(bps: bigint): string {
  return `${bps.toString()} bps`;
}
