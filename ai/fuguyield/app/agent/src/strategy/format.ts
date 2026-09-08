/**
 * SATU-SATUNYA pintu keluar angka domain menuju manusia (dan menuju prompt LLM).
 * Semua fungsi murni aritmetika bigint; `Number()` tidak dipakai karena nilai di
 * lapisan ini bisa melampaui Number.MAX_SAFE_INTEGER.
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
 * APY dalam bps -> persen DUA desimal.
 *
 * Dua desimal, bukan satu: seluruh perdebatan strategi ini berlangsung pada
 * skala puluhan bps (ambang impas $10.000 adalah 195 bps = 1,95%). Membulatkan
 * ke satu desimal akan membuat 1,95% dan 1,99% terlihat sama, padahal salah
 * satunya menutup ongkos pindah dan satunya tidak.
 */
export function formatApyBps(bps: bigint): string {
  const negatif = bps < 0n;
  const abs = negatif ? -bps : bps;
  return `${negatif ? "-" : ""}${grupRibuan(abs / 100n)},${(abs % 100n).toString().padStart(2, "0")}%`;
}

/** Jumlah token 18 desimal -> enam desimal, sisanya DIPOTONG. */
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
