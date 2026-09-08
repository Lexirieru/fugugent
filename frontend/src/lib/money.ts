/**
 * Uang di Fugugent selalu `bigint` basis 8 desimal (USD8). Modul ini adalah
 * **satu-satunya** tempat nilai itu boleh berubah menjadi teks.
 *
 * Kenapa keras begini: `12345678` berarti $0.12. Satu `Number()` yang lolos di
 * jalur ini akan menampilkan "12.345.678" kepada seseorang yang sedang memutuskan
 * apakah akan membayar. Tidak ada satu pun fungsi di sini yang menerima `number`
 * sebagai nilai uang.
 */

/** 10^8 — satu dolar dalam basis USD8. */
export const USD8 = 100_000_000n;

/** Bagi dengan pembulatan ke atas. Ongkos selalu dibulatkan ke sisi yang merugikan kita. */
function divCeil(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("pembagi nol");
  return (a + b - 1n) / b;
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * Format USD8 menjadi teks dolar.
 *
 * Dua desimal untuk nilai biasa. Kalau nilainya bukan nol tetapi membulat menjadi
 * `$0.00`, presisinya ditambah sampai angkanya terlihat — menampilkan "$0.00" untuk
 * harga yang sebenarnya ada adalah kebohongan yang paling mudah dilakukan di sini.
 */
export function formatUsd8(value: bigint, opts: { minDecimals?: number } = {}): string {
  const min = opts.minDecimals ?? 2;
  const negative = value < 0n;
  const v = abs(value);

  for (let decimals = min; decimals <= 8; decimals += 1) {
    const scale = 10n ** BigInt(8 - decimals);
    const scaled = scale === 1n ? v : v / scale;
    if (scaled === 0n && v > 0n && decimals < 8) continue;

    const whole = scaled / 10n ** BigInt(decimals);
    const frac = scaled % 10n ** BigInt(decimals);
    const wholeText = whole.toLocaleString("en-US");
    const fracText = decimals === 0 ? "" : `.${frac.toString().padStart(decimals, "0")}`;
    return `${negative ? "-" : ""}$${wholeText}${fracText}`;
  }
  return "$0.00";
}

/** Durasi periode langganan dalam kata-kata. Detik masuk, kalimat keluar. */
export function formatPeriod(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown period";
  const units: Array<[number, string]> = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? `1 ${name}` : `${n} ${name}s`;
    }
  }
  return `${seconds} seconds`;
}

/** Harga per periode, siap ditempel di kartu: `$0.10 / 2 minutes`. */
export function formatPricePerPeriod(priceUsd8: bigint, periodSeconds: number): string {
  return `${formatUsd8(priceUsd8)} / ${formatPeriod(periodSeconds)}`;
}

export interface CostEstimate {
  periods: number;
  /** Total dalam USD8. Perkalian bigint — tidak pernah lewat `number`. */
  totalUsd8: bigint;
  /** Lama langganan dalam detik. */
  durationSeconds: number;
  /** Setara per hari, USD8, dibulatkan ke atas. */
  perDayUsd8: bigint;
}

/**
 * Estimasi biaya SEBELUM hire — bukan sekadar peringatan.
 * `periods` adalah bilangan bulat; sisanya aritmetika bigint.
 */
export function estimateCost(
  priceUsd8PerPeriod: bigint,
  periodSeconds: number,
  periods: number,
): CostEstimate {
  const n = Math.max(1, Math.floor(periods));
  const totalUsd8 = priceUsd8PerPeriod * BigInt(n);
  const durationSeconds = periodSeconds * n;
  const perDayUsd8 =
    periodSeconds > 0
      ? divCeil(priceUsd8PerPeriod * 86_400n, BigInt(periodSeconds))
      : 0n;
  return { periods: n, totalUsd8, durationSeconds, perDayUsd8 };
}

/** Durasi total dalam kalimat: "10 periods ≈ 20 minutes". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0 seconds";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts: string[] = [];
  if (days) parts.push(days === 1 ? "1 day" : `${days} days`);
  if (hours) parts.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (minutes && !days) parts.push(minutes === 1 ? "1 minute" : `${minutes} minutes`);
  if (!parts.length) parts.push(`${seconds} seconds`);
  return parts.join(" ");
}
