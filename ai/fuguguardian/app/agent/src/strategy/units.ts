/**
 * Jembatan satuan: USD basis 8 desimal ↔ unit token.
 *
 * Seluruh lapisan strategi berhitung dalam basis 8 desimal Aave (`*Base`,
 * `suggestedRepayBase`, `maxPerDayUsd8`). Rantai berhitung dalam unit token
 * (18 desimal untuk semua token BSC, termasuk stablecoin — lihat CLAUDE.md #2).
 * Konversi di antara keduanya adalah aritmetika paling menentukan di seluruh
 * rantai: meleset satu orde berarti agent membayar sepersepuluh atau sepuluh
 * kali lipat dari yang dilaporkannya, dan semua assert lain tetap lolos.
 *
 * Sampai sekarang satu-satunya implementasinya hidup di dalam `scripts/e2e-guardian.ts`
 * — tidak punya unit test, tidak bisa dipakai ulang, dan siapa pun yang
 * menyambungkan runtime akan menyalinnya dari sebuah skrip demo.
 *
 * ## Soal "cek bolak-balik" yang dulu ada di skrip itu
 *
 * Skrip lama memeriksa konversinya dengan menghitung balik:
 *
 *     jumlahToken  = amountUsd8 * 10^d / p
 *     balikanUsd8  = jumlahToken * p / 10^d   ≈ amountUsd8
 *
 * dan komentarnya mengklaim ini menangkap `d` yang terbaca 17 atau `p` dari
 * feed yang salah. Klaim itu tidak benar: `d` dan `p` yang SAMA dipakai di
 * kedua arah, jadi keduanya saling meniadakan dan kesamaan itu berlaku untuk
 * `d` dan `p` APA PUN. Cek tersebut tidak pernah bisa gagal karena alasan yang
 * disebutkannya — ia hanya mengukur pembulatan.
 *
 * Yang benar-benar bisa menangkap kesalahan itu adalah membandingkan **dua
 * sumber berbeda** untuk angka yang sama, dan itulah `assertTokenDecimalsAgree`
 * (konfigurasi pool vs `decimals()` token itu sendiri) dan `assertFeedIsUsd8`
 * (feed yang bukan 8 desimal tidak boleh dibaca sebagai USD basis 8).
 */

/** 1 USD dalam basis 8 desimal Aave (`*Base`). */
export const USD8_ONE = 100_000_000n;

/** Batas atas desimal token yang masuk akal; di atas ini pasti salah baca. */
const MAX_TOKEN_DECIMALS = 36;

/** Desimal yang WAJIB dimiliki feed harga agar jawabannya boleh dibaca sebagai USD basis 8. */
const FEED_DECIMALS_USD8 = 8;

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitConversionError";
  }
}

function assertDecimals(tokenDecimals: number): void {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > MAX_TOKEN_DECIMALS) {
    throw new UnitConversionError(
      `Desimal token ${tokenDecimals} tidak masuk akal (harus bilangan bulat 0..${MAX_TOKEN_DECIMALS}).`,
    );
  }
}

function assertPrice(priceUsd8: bigint): void {
  if (priceUsd8 <= 0n) {
    throw new UnitConversionError(
      `Harga ${priceUsd8} (USD basis 8 desimal) bukan angka positif; konversi ditolak.`,
    );
  }
}

/**
 * USD basis 8 desimal → unit token.
 *
 * Pembulatan KE BAWAH dan itu disengaja: hasilnya adalah jumlah yang
 * benar-benar dikirim ke rantai, dan agent tidak boleh pernah mengirim lebih
 * banyak daripada yang diputuskan lapisan strategi.
 */
export function usd8ToTokenUnits(
  amountUsd8: bigint,
  tokenDecimals: number,
  priceUsd8: bigint,
): bigint {
  assertDecimals(tokenDecimals);
  assertPrice(priceUsd8);
  if (amountUsd8 < 0n) {
    throw new UnitConversionError(`Jumlah ${amountUsd8} negatif; konversi ditolak.`);
  }
  return (amountUsd8 * 10n ** BigInt(tokenDecimals)) / priceUsd8;
}

/**
 * Unit token → USD basis 8 desimal. Dipakai untuk MELAPORKAN nilai sebuah
 * jumlah token (mis. saldo), bukan untuk memeriksa `usd8ToTokenUnits` —
 * memeriksanya dengan ini adalah tautologi (lihat catatan di kepala modul).
 */
export function tokenUnitsToUsd8(
  units: bigint,
  tokenDecimals: number,
  priceUsd8: bigint,
): bigint {
  assertDecimals(tokenDecimals);
  assertPrice(priceUsd8);
  if (units < 0n) {
    throw new UnitConversionError(`Jumlah unit ${units} negatif; konversi ditolak.`);
  }
  return (units * priceUsd8) / 10n ** BigInt(tokenDecimals);
}

/**
 * Menuntut dua sumber independen sepakat soal desimal sebuah token:
 * `tokenDecimals` pada konfigurasi aset di pool, dan `decimals()` milik kontrak
 * token itu sendiri. Inilah cek yang benar-benar menangkap "desimal terbaca 17"
 * — dua angka dari dua kontrak berbeda, bukan satu angka dibandingkan dengan
 * dirinya sendiri.
 */
export function assertTokenDecimalsAgree(
  fromPoolConfig: number,
  fromTokenContract: number,
  asset: `0x${string}`,
): void {
  assertDecimals(fromPoolConfig);
  assertDecimals(fromTokenContract);
  if (fromPoolConfig !== fromTokenContract) {
    throw new UnitConversionError(
      `Desimal aset ${asset} tidak konsisten: konfigurasi pool menyebut ${fromPoolConfig}, ` +
        `kontrak tokennya sendiri menyebut ${fromTokenContract}. Salah satunya salah, dan ` +
        `memakai yang keliru membuat jumlah yang dikirim meleset ` +
        `10^${Math.abs(fromPoolConfig - fromTokenContract)} kali lipat.`,
    );
  }
}

/**
 * Menuntut feed harga benar-benar 8 desimal sebelum jawabannya dibaca sebagai
 * USD basis 8. `MockPriceFeed` menerima `decimals_` sebagai parameter
 * konstruktor, jadi feed 6 atau 18 desimal bukan hipotesis — dan `latestRoundData()`
 * yang dibaca mentah tidak menormalkan apa pun.
 */
export function assertFeedIsUsd8(feedDecimals: number, asset: `0x${string}`): void {
  if (!Number.isInteger(feedDecimals) || feedDecimals !== FEED_DECIMALS_USD8) {
    throw new UnitConversionError(
      `Feed harga untuk aset ${asset} melaporkan ${feedDecimals} desimal, bukan ` +
        `${FEED_DECIMALS_USD8}. Seluruh lapisan ini membaca jawabannya sebagai USD basis 8 ` +
        `desimal; memakainya apa adanya akan meleset 10^${Math.abs(feedDecimals - FEED_DECIMALS_USD8)} kali lipat.`,
    );
  }
}
