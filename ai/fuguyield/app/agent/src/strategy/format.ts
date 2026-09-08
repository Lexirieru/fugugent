/**
 * The ONLY exit for domain numbers toward humans (and toward LLM prompts).
 * Every function is pure bigint arithmetic; `Number()` is unused because values at this
 * layer can exceed Number.MAX_SAFE_INTEGER.
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
 * An APY in bps -> a percentage with TWO decimals.
 *
 * Two decimals, not one: this whole strategy's argument plays out at the scale of tens
 * of bps (the break-even threshold for $10,000 is 195 bps = 1.95%). Rounding to one
 * decimal would make 1.95% and 1.99% look identical, when one of them covers the
 * migration cost and the other does not.
 */
export function formatApyBps(bps: bigint): string {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  return `${negative ? "-" : ""}${groupThousands(abs / 100n)}.${(abs % 100n).toString().padStart(2, "0")}%`;
}

/** An 18-decimal token amount -> six decimals, the remainder TRUNCATED. */
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
