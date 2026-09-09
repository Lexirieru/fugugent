/**
 * The ONLY exit for domain numbers toward people (and toward LLM prompts).
 *
 * A raw number must never be shown as it is stored. `12345678` on the 8-decimal basis
 * reads to a person as "twelve million" when it means twelve cents, a factor of 10^8 on
 * the number someone uses to decide about their money.
 *
 * Every function here is pure bigint arithmetic. `Number()` is deliberately unused:
 * values at this layer can exceed Number.MAX_SAFE_INTEGER, and converting to a float
 * silently drops the last digit.
 *
 * Formatting lives in one file so that two versions of the truth about the same number
 * are impossible: the sentence in `HireDecision.reason` and the field beside it come
 * from the same function.
 */
import { USD8_ONE, WAD } from "./types.js";

/** English-style thousands separator: 1234567n becomes "1,234,567". */
function groupThousands(n: bigint): string {
  const s = n.toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

/**
 * Money on the 8-decimal basis, written as dollars and cents.
 *
 * Fractions of a cent are TRUNCATED, not rounded, so a value never looks larger than it
 * really is. The listings in this catalog cost five and ten cents, so two decimals are
 * enough to tell them apart, and `formatUsd8Exact` exists for the cases where they are
 * not.
 */
export function formatUsd8(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / USD8_ONE;
  const cents = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negative ? "-" : ""}$${groupThousands(dollars)}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Money on the 8-decimal basis with all eight decimals kept.
 *
 * Used where a truncated cent would hide the difference between two numbers, which is
 * exactly where a price comparison lives.
 */
export function formatUsd8Exact(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / USD8_ONE;
  const fraction = abs % USD8_ONE;
  return `${negative ? "-" : ""}$${groupThousands(dollars)}.${fraction.toString().padStart(8, "0")}`;
}

/**
 * An 18-decimal token amount written with six decimals.
 *
 * Six, not eighteen: eighteen digits hide the size of a number rather than showing it.
 * The rest is TRUNCATED, so the amount shown never exceeds the amount actually moved. A
 * very small amount therefore shows as "0.000000", which is honest at six decimals; a
 * caller that needs full precision must use the bigint, not this string.
 */
export function formatToken18(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / WAD;
  const fraction = ((abs % WAD) * 1_000_000n) / WAD;
  return `${negative ? "-" : ""}${groupThousands(whole)}.${fraction.toString().padStart(6, "0")}`;
}

/** bps as a percentage with one decimal, e.g. 2000n becomes "20.0". */
export function formatPercentFromBps(bps: bigint): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const tenths = abs / 10n;
  return `${negative ? "-" : ""}${tenths / 10n}.${tenths % 10n}`;
}

/** bps written as it is, with its unit. */
export function formatBps(bps: bigint): string {
  return `${bps.toString()} bps`;
}

/** A share in bps written as a percentage, e.g. 5000n becomes "50.0%". */
export function formatShare(bps: bigint): string {
  return `${formatPercentFromBps(bps)}%`;
}

/**
 * A whole number of seconds written the way a person would say it.
 *
 * Only the two largest units are kept. "2 days 3 hours" is a length someone can picture;
 * "2 days 3 hours 4 minutes 5 seconds" is a number to be re-read, not understood. The
 * remainder is dropped, so the text is never longer than the real length.
 */
export function formatDuration(seconds: bigint): string {
  if (seconds < 0n) return `-${formatDuration(-seconds)}`;
  if (seconds === 0n) return "0 seconds";

  const units: readonly (readonly [bigint, string])[] = [
    [86_400n, "day"],
    [3_600n, "hour"],
    [60n, "minute"],
    [1n, "second"],
  ];

  const parts: string[] = [];
  let rest = seconds;
  for (const [size, name] of units) {
    if (parts.length === 2) break;
    const count = rest / size;
    if (count === 0n) continue;
    parts.push(`${count} ${name}${count === 1n ? "" : "s"}`);
    rest -= count * size;
  }
  return parts.join(" ");
}
