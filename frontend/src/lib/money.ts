/**
 * Money in Fugugent is always a `bigint` in 8-decimal base (USD8). This module is the
 * **only** place such a value is allowed to become text.
 *
 * Why so strict: `12345678` means $0.12. A single `Number()` slipping through this path
 * would show "12,345,678" to somebody who is deciding whether to pay. Not one function
 * here accepts a `number` as a money value.
 */

/** 10^8, one dollar in USD8 base. */
export const USD8 = 100_000_000n;

/** Divide, rounding up. A cost is always rounded towards the side that costs us. */
function divCeil(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  return (a + b - 1n) / b;
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * Format USD8 as dollar text.
 *
 * Two decimals for ordinary values. When a value is non-zero but rounds to `$0.00`,
 * the precision is increased until the figure becomes visible, showing "$0.00" for a
 * price that really exists is the easiest lie to tell here.
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

/** The subscription period in words. Seconds in, a phrase out. */
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

/** The price per period, ready to drop on a card: `$0.10 / 2 minutes`. */
export function formatPricePerPeriod(priceUsd8: bigint, periodSeconds: number): string {
  return `${formatUsd8(priceUsd8)} / ${formatPeriod(periodSeconds)}`;
}

export interface CostEstimate {
  periods: number;
  /** The total in USD8. Bigint multiplication, never through `number`. */
  totalUsd8: bigint;
  /** How long the subscription lasts, in seconds. */
  durationSeconds: number;
  /** The per-day equivalent, USD8, rounded up. */
  perDayUsd8: bigint;
}

/**
 * A cost estimate BEFORE hiring, not merely a warning.
 * `periods` is an integer; everything else is bigint arithmetic.
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
    periodSeconds > 0 ? divCeil(priceUsd8PerPeriod * 86_400n, BigInt(periodSeconds)) : 0n;
  return { periods: n, totalUsd8, durationSeconds, perDayUsd8 };
}

/** The total duration as a phrase: "10 periods ≈ 20 minutes". */
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

/**
 * A USD8 value off the wire.
 *
 * The backend sends money as a **decimal string** precisely so that it never travels
 * through a JSON `number`, whose 53 significant bits cannot hold a USD8 amount safely.
 * Anything that is not a plain integer string comes back `null`, the caller then has to
 * say "we do not have this figure" rather than print a zero it invented. A missing
 * price and a price of zero are different facts.
 */
export function parseUsd8(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}
