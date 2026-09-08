/**
 * Number formatting for human consumption. The ONLY place a domain number is turned
 * into text.
 *
 * `formatHf` and `formatPercentFromBps` used to be duplicated in `decide.ts` and
 * `explain.ts`. Duplicates like that are dangerous quietly: if one copy changes
 * (rounding, decimal count, separator), the number in `Decision.reason` and the number
 * in the LLM prompt can differ for the exact same position — the user sees two versions
 * of the truth about their own money. Putting them here makes that difference
 * structurally impossible.
 *
 * Every function here is pure bigint arithmetic. `Number()` is deliberately NOT used:
 * money values at this layer can exceed Number.MAX_SAFE_INTEGER, and converting to float
 * silently loses precision on the last digit — exactly the digit that decides how many
 * dollars get paid.
 */
import { HF_ONE } from "./types.js";
// One source for the unit constants: `units.ts` already owns them, because it is what
// converts USD8 <-> token units. A local copy existed here once and must not come back —
// two definitions of "one dollar" are the quietest way to make the number in the log
// differ from the number that was sent.
import { USD8_ONE } from "./units.js";

/**
 * Formats a health factor (1e18 basis) into a two-decimal string, e.g.
 * 1_300_000_000_000_000_000n -> "1.30". Truncated (floored), not rounded: an HF of 1.299
 * shows as "1.29", not "1.30" — the safe direction, because a position never looks
 * healthier than it really is.
 */
export function formatHf(hf: bigint): string {
  const whole = hf / HF_ONE;
  const remainder = hf % HF_ONE;
  const decimals = (remainder * 100n) / HF_ONE;
  return `${whole}.${decimals.toString().padStart(2, "0")}`;
}

/**
 * Formats basis points (10_000 = 100%) into a percentage with one decimal, e.g.
 * 2000n -> "20.0".
 */
export function formatPercentFromBps(bps: bigint): string {
  const tenthsOfPercent = bps / 10n; // bps/10 = the percentage times 10
  const whole = tenthsOfPercent / 10n;
  const decimals = tenthsOfPercent % 10n;
  return `${whole}.${decimals}`;
}

/** Insert English-style thousands separators: 1234567n -> "1,234,567". */
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
 * Formats a money value on Aave's 8-decimal basis (every `*Base` field on `Position`,
 * plus `Decision.suggestedRepayBase`) into a readable US dollar string:
 * 12_345_678n -> "$0.12" and 100_000_000n -> "$1.00".
 *
 * This is NOT cosmetic. The raw value 12345678 reads to a human as "twelve million" when
 * it means twelve cents — a factor of 10^8 on the number a user relies on to decide
 * whether to repay a debt. Every time a `*Base` value goes out to a human (an LLM prompt,
 * the UI, a log a person reads), it must pass through this function.
 *
 * Fractions of a cent are truncated, not rounded, and the decimal separator is a period,
 * following the English convention used by `formatHf`/`formatPercentFromBps`.
 */
export function formatUsd8(v: bigint): string {
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const dollars = abs / USD8_ONE;
  const cents = ((abs % USD8_ONE) * 100n) / USD8_ONE;
  return `${negative ? "-" : ""}$${groupThousands(dollars)}.${cents.toString().padStart(2, "0")}`;
}
