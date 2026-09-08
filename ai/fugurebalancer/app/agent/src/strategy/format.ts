/**
 * The ONLY exit for domain numbers toward humans (and toward LLM prompts).
 *
 * A raw number must never be shown as-is. `12345678` on the 8-decimal basis reads to
 * a human as "twelve million" when it means twelve cents — a factor of 10^8 on the
 * number someone uses to decide about their money.
 *
 * Every function here is pure bigint arithmetic. `Number()` is deliberately unused:
 * values at this layer can exceed Number.MAX_SAFE_INTEGER and converting to float
 * silently drops the last digit.
 *
 * Formatting is centralized in one file so that two versions of the truth about the
 * same number are impossible: the sentence in `Decision.reason` and the number that
 * goes into the LLM explanation must come from the exact same function.
 */
import { USD8_ONE, WAD } from "./types.js";

/** English-style thousands separator: 1234567n -> "1,234,567". */
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
 * A money value on the 8-decimal basis -> readable dollars. Fractions of a cent are
 * TRUNCATED, not rounded: a value never looks larger than it really is.
 */
export function formatUsd8(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / USD8_ONE;
  const cents = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negative ? "-" : ""}$${groupThousands(dollars)}.${cents.toString().padStart(2, "0")}`;
}

/**
 * An 18-decimal token amount -> a six-decimal string.
 *
 * Six decimals, not eighteen: eighteen digits are unreadable to a human and hide the
 * magnitude rather than showing it. The remainder is TRUNCATED, so the amount shown
 * never exceeds the amount actually moved. The consequence is that a very small
 * amount shows as "0.000000"; that is honest at six decimals, and a calling layer
 * that needs full precision must use the bigint value, not this string.
 */
export function formatToken18(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / WAD;
  const fraction = ((abs % WAD) * 1_000_000n) / WAD;
  return `${negative ? "-" : ""}${groupThousands(whole)}.${fraction.toString().padStart(6, "0")}`;
}

/** bps -> a percentage with one decimal, e.g. 2000n -> "20.0". */
export function formatPercentFromBps(bps: bigint): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const tenths = abs / 10n;
  return `${negative ? "-" : ""}${tenths / 10n}.${tenths % 10n}`;
}

/**
 * bps written as-is with its unit. Used for cost thresholds, where writing it as a
 * percentage ("0.5") is more easily confused with the bps value ("50") than it is
 * helpful.
 */
export function formatBps(bps: bigint): string {
  return `${bps.toString()} bps`;
}

/** A weight in bps -> a percentage, e.g. 5000n -> "50.0%". */
export function formatWeight(bps: bigint): string {
  return `${formatPercentFromBps(bps)}%`;
}
