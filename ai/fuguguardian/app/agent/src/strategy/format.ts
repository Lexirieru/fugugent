/**
 * Pemformatan angka untuk konsumsi manusia. SATU-SATUNYA tempat angka domain
 * diubah menjadi teks.
 *
 * Sebelumnya `formatHf` dan `formatPercentFromBps` diduplikasi di `decide.ts`
 * dan `explain.ts`. Duplikat seperti itu berbahaya secara diam-diam: kalau
 * salah satu salinan berubah (pembulatan, jumlah desimal, pemisah), angka di
 * `Decision.reason` dan angka di prompt LLM bisa berbeda untuk posisi yang
 * sama persis — user melihat dua versi kebenaran tentang uangnya sendiri.
 * Menaruhnya di sini membuat perbedaan itu mustahil secara struktural.
 *
 * Semua fungsi di sini murni aritmetika bigint. `Number()` sengaja TIDAK
 * dipakai: nilai uang di lapisan ini bisa melebihi Number.MAX_SAFE_INTEGER
 * dan konversi ke float akan diam-diam kehilangan presisi pada digit
 * terakhir — persis digit yang menentukan berapa rupiah/dolar dibayar.
 */
import { HF_ONE } from "./types.js";

/** 1 USD dalam basis 8 desimal Aave (`*Base`). */
const USD8_ONE = 100_000_000n;

/**
 * Format health factor (basis 1e18) menjadi string dua desimal dengan koma,
 * mis. 1_300_000_000_000_000_000n -> "1,30". Dipotong (floor), tidak
 * dibulatkan: HF 1,299 ditampilkan sebagai "1,29", bukan "1,30" — arah yang
 * aman, karena posisi tidak pernah terlihat lebih sehat daripada aslinya.
 */
export function formatHf(hf: bigint): string {
  const bulat = hf / HF_ONE;
  const sisa = hf % HF_ONE;
  const desimal = (sisa * 100n) / HF_ONE;
  return `${bulat},${desimal.toString().padStart(2, "0")}`;
}

/**
 * Format basis point (basis 10_000 = 100%) menjadi persen satu desimal
 * dengan koma, mis. 2000n -> "20,0".
 */
export function formatPercentFromBps(bps: bigint): string {
  const persepuluhPersen = bps / 10n; // bps/10 = persentase dikali 10
  const bulat = persepuluhPersen / 10n;
  const desimal = persepuluhPersen % 10n;
  return `${bulat},${desimal}`;
}

/** Sisipkan pemisah ribuan gaya Indonesia: 1234567n -> "1.234.567". */
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
 * Format nilai uang basis 8 desimal Aave (semua field `*Base` pada `Position`
 * dan `Decision.suggestedRepayBase`) menjadi string dolar AS yang terbaca:
 * 12_345_678n -> "$0,12" dan 100_000_000n -> "$1,00".
 *
 * Ini BUKAN kosmetik. Nilai mentah 12345678 terbaca oleh manusia sebagai
 * "dua belas juta" padahal artinya dua belas sen — selisih 10^8 pada angka
 * yang dipakai user untuk memutuskan membayar hutang. Setiap kali nilai
 * `*Base` keluar ke manusia (prompt LLM, UI, log yang dibaca orang), ia harus
 * melewati fungsi ini.
 *
 * Pecahan sen dipotong, bukan dibulatkan, dan pemisah desimalnya koma
 * mengikuti konvensi Indonesia yang dipakai `formatHf`/`formatPercentFromBps`.
 */
export function formatUsd8(v: bigint): string {
  const negatif = v < 0n;
  const abs = negatif ? -v : v;
  const dolar = abs / USD8_ONE;
  const sen = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negatif ? "-" : ""}$${grupRibuan(dolar)},${sen.toString().padStart(2, "0")}`;
}
