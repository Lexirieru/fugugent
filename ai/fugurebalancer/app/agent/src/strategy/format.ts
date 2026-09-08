/**
 * SATU-SATUNYA pintu keluar angka domain menuju manusia (dan menuju prompt LLM).
 *
 * Angka mentah tidak pernah boleh tampil apa adanya. `12345678` dalam basis 8
 * desimal terbaca manusia sebagai "dua belas juta" padahal artinya dua belas
 * sen — selisih 10^8 pada angka yang dipakai orang untuk memutuskan uangnya.
 *
 * Semua fungsi di sini murni aritmetika bigint. `Number()` sengaja tidak
 * dipakai: nilai di lapisan ini bisa melampaui Number.MAX_SAFE_INTEGER dan
 * konversi ke float akan diam-diam menghilangkan digit terakhir.
 *
 * Pemformatan dipusatkan di satu file supaya mustahil ada dua versi kebenaran
 * tentang angka yang sama: kalimat di `Decision.reason` dan angka yang masuk ke
 * penjelasan LLM harus berasal dari fungsi yang persis sama.
 */
import { USD8_ONE, WAD } from "./types.js";

/** Pemisah ribuan gaya Indonesia: 1234567n -> "1.234.567". */
function grupRibuan(n: bigint): string {
  const s = n.toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ".";
    out += s[i];
  }
  return out;
}

/**
 * Nilai uang basis 8 desimal -> dolar terbaca. Pecahan sen DIPOTONG, bukan
 * dibulatkan: nilai tidak pernah terlihat lebih besar daripada aslinya.
 */
export function formatUsd8(v: bigint): string {
  const negatif = v < 0n;
  const abs = negatif ? -v : v;
  const dolar = abs / USD8_ONE;
  const sen = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negatif ? "-" : ""}$${grupRibuan(dolar)},${sen.toString().padStart(2, "0")}`;
}

/**
 * Jumlah token 18 desimal -> string enam desimal.
 *
 * Enam desimal, bukan delapan belas: delapan belas digit tidak bisa dibaca
 * manusia dan justru menyembunyikan besaran. Sisanya DIPOTONG, sehingga jumlah
 * yang ditampilkan tidak pernah melebihi jumlah yang sebenarnya dipindahkan.
 * Konsekuensinya jumlah yang sangat kecil tampil sebagai "0,000000"; itu jujur
 * pada enam desimal, dan lapisan pemanggil yang perlu presisi penuh harus
 * memakai nilai bigint-nya, bukan string ini.
 */
export function formatToken18(v: bigint): string {
  const negatif = v < 0n;
  const abs = negatif ? -v : v;
  const bulat = abs / WAD;
  const pecahan = ((abs % WAD) * 1_000_000n) / WAD;
  return `${negatif ? "-" : ""}${grupRibuan(bulat)},${pecahan.toString().padStart(6, "0")}`;
}

/** bps -> persen satu desimal, mis. 2000n -> "20,0". */
export function formatPercentFromBps(bps: bigint): string {
  const negatif = bps < 0n;
  const abs = negatif ? -bps : bps;
  const persepuluh = abs / 10n;
  return `${negatif ? "-" : ""}${persepuluh / 10n},${persepuluh % 10n}`;
}

/**
 * bps ditulis apa adanya dengan satuannya. Dipakai untuk ambang biaya, di mana
 * menuliskannya sebagai persen ("0,5") lebih mudah tertukar dengan bps ("50")
 * daripada membantu.
 */
export function formatBps(bps: bigint): string {
  return `${bps.toString()} bps`;
}

/** Bobot dalam bps -> persen, mis. 5000n -> "50,0%". */
export function formatWeight(bps: bigint): string {
  return `${formatPercentFromBps(bps)}%`;
}
