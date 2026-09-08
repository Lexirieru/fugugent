/**
 * The ONLY exit for domain numbers toward humans (and toward LLM prompts).
 * Every function is pure bigint arithmetic; `Number()` is unused because values at this
 * layer can exceed Number.MAX_SAFE_INTEGER and converting to float silently drops the
 * last digit.
 */
import { USD8_ONE, WAD } from "./types.js";

function groupThousands(n: bigint): string {
  const s = n.toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

/** A money value on the 8-decimal basis -> dollars with two decimals. Fractions of a cent are TRUNCATED. */
export function formatUsd8(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / USD8_ONE;
  const cents = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negative ? "-" : ""}$${groupThousands(dollars)}.${cents.toString().padStart(2, "0")}`;
}

/**
 * A PRICE on the 8-decimal basis -> dollars with as many decimals as needed (2 to 8).
 *
 * Prices get their own formatter because `formatUsd8` truncates at two decimals, and a
 * grid on a token priced at $0.00012345 would render EVERY one of its lines as "$0.00"
 * — the whole decision becomes unreadable. Trailing zeros are trimmed so large prices
 * stay compact, but at least two decimals are kept so "$600" is never read as an
 * already-rounded integer.
 */
export function formatPriceUsd8(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / USD8_ONE;
  let fraction = (abs % USD8_ONE).toString().padStart(8, "0");
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return `${negative ? "-" : ""}$${groupThousands(dollars)}.${fraction}`;
}

/**
 * An 18-decimal token amount -> six decimals, the remainder TRUNCATED so the amount
 * shown never exceeds the amount that actually moves.
 */
export function formatToken18(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const whole = abs / WAD;
  const fraction = ((abs % WAD) * 1_000_000n) / WAD;
  return `${negative ? "-" : ""}${groupThousands(whole)}.${fraction.toString().padStart(6, "0")}`;
}

/** bps -> a percentage with one decimal. */
export function formatPercentFromBps(bps: bigint): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  const tenths = abs / 10n;
  return `${negative ? "-" : ""}${tenths / 10n}.${tenths % 10n}`;
}

/** bps as-is with its unit, so it is never confused with a percentage. */
export function formatBps(bps: bigint): string {
  return `${bps.toString()} bps`;
}
