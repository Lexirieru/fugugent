/**
 * The ONLY exit for domain numbers toward people (and toward LLM prompts).
 *
 * A raw number must never be shown as it is stored. A payment of one cent is written in
 * the token's smallest unit as 10000000000000000, which reads to a person as ten
 * thousand million million, a factor of 10^18 on the number someone uses to decide about
 * their money.
 *
 * Every function here is pure bigint arithmetic. `Number()` is deliberately unused:
 * values at this layer can exceed Number.MAX_SAFE_INTEGER, and converting to a float
 * silently drops the last digit.
 *
 * Formatting lives in one file so that two versions of the truth about the same number
 * are impossible: the sentence in `PurchaseDecision.reason` and the field beside it come
 * from the same function.
 */
import { WAD } from "./types.js";

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
