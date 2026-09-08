/**
 * The units bridge: USD on the 8-decimal basis <-> token units.
 *
 * The entire strategy layer computes in Aave's 8-decimal basis (`*Base`,
 * `suggestedRepayBase`, `maxPerDayUsd8`). The chain computes in token units (18 decimals
 * for every BSC token, stablecoins included — see CLAUDE.md #2). The conversion between
 * the two is the single most decisive piece of arithmetic in the whole chain: being off
 * by one order of magnitude means the agent pays a tenth or ten times what it reports,
 * and every other assertion still passes.
 *
 * Until now the only implementation lived inside `scripts/e2e-guardian.ts` — with no unit
 * tests, not reusable, and anyone wiring up the runtime would have copied it out of a
 * demo script.
 *
 * ## About the "round-trip check" that used to be in that script
 *
 * The old script verified its conversion by computing back:
 *
 *     tokenAmount  = amountUsd8 * 10^d / p
 *     backToUsd8   = tokenAmount * p / 10^d   ~= amountUsd8
 *
 * and its comment claimed this catches a `d` that read as 17, or a `p` from the wrong
 * feed. That claim is false: the SAME `d` and `p` are used in both directions, so they
 * cancel out and the equality holds for ANY `d` and `p`. That check could never fail for
 * the reason it named — all it measured was rounding.
 *
 * What actually catches those mistakes is comparing **two different sources** for the
 * same number, and that is what `assertTokenDecimalsAgree` (the pool's asset config vs
 * the token's own `decimals()`) and `assertFeedIsUsd8` (a feed that is not 8 decimals
 * must not be read as USD on the 8-decimal basis) do.
 */

/** 1 USD in Aave's 8-decimal basis (`*Base`). */
export const USD8_ONE = 100_000_000n;

/** The upper bound on a plausible token decimals value; above this it is certainly a misread. */
const MAX_TOKEN_DECIMALS = 36;

/** The decimals a price feed MUST have before its answer may be read as USD on the 8-decimal basis. */
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
      `Token decimals ${tokenDecimals} make no sense (must be an integer in 0..${MAX_TOKEN_DECIMALS}).`,
    );
  }
}

function assertPrice(priceUsd8: bigint): void {
  if (priceUsd8 <= 0n) {
    throw new UnitConversionError(
      `Price ${priceUsd8} (USD on the 8-decimal basis) is not a positive number; the conversion is refused.`,
    );
  }
}

/**
 * USD on the 8-decimal basis -> token units.
 *
 * It rounds DOWN, deliberately: the result is the amount actually sent to the chain, and
 * the agent must never send more than the strategy layer decided.
 */
export function usd8ToTokenUnits(
  amountUsd8: bigint,
  tokenDecimals: number,
  priceUsd8: bigint,
): bigint {
  assertDecimals(tokenDecimals);
  assertPrice(priceUsd8);
  if (amountUsd8 < 0n) {
    throw new UnitConversionError(`Amount ${amountUsd8} is negative; the conversion is refused.`);
  }
  return (amountUsd8 * 10n ** BigInt(tokenDecimals)) / priceUsd8;
}

/**
 * Token units -> USD on the 8-decimal basis. Used to REPORT the value of a token amount
 * (e.g. a balance), not to verify `usd8ToTokenUnits` — verifying it with this is a
 * tautology (see the note at the top of this module).
 */
export function tokenUnitsToUsd8(
  units: bigint,
  tokenDecimals: number,
  priceUsd8: bigint,
): bigint {
  assertDecimals(tokenDecimals);
  assertPrice(priceUsd8);
  if (units < 0n) {
    throw new UnitConversionError(`Unit amount ${units} is negative; the conversion is refused.`);
  }
  return (units * priceUsd8) / 10n ** BigInt(tokenDecimals);
}

/**
 * Demands that two independent sources agree on a token's decimals: `tokenDecimals` in
 * the pool's asset config, and the token contract's own `decimals()`. This is the check
 * that really catches "decimals read as 17" — two numbers from two different contracts,
 * not one number compared against itself.
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
      `The decimals for asset ${asset} are inconsistent: the pool configuration says ${fromPoolConfig}, ` +
        `while the token contract itself says ${fromTokenContract}. One of them is wrong, and ` +
        `using the wrong one makes the amount sent miss by ` +
        `a factor of 10^${Math.abs(fromPoolConfig - fromTokenContract)}.`,
    );
  }
}

/**
 * Demands that a price feed really is 8 decimals before its answer is read as USD on the
 * 8-decimal basis. `MockPriceFeed` takes `decimals_` as a constructor parameter, so a 6-
 * or 18-decimal feed is not hypothetical — and a raw `latestRoundData()` read normalizes
 * nothing.
 */
export function assertFeedIsUsd8(feedDecimals: number, asset: `0x${string}`): void {
  if (!Number.isInteger(feedDecimals) || feedDecimals !== FEED_DECIMALS_USD8) {
    throw new UnitConversionError(
      `The price feed for asset ${asset} reports ${feedDecimals} decimals, not ` +
        `${FEED_DECIMALS_USD8}. This whole layer reads its answer as USD on the 8-decimal ` +
        `basis; using it as-is would miss by a factor of 10^${Math.abs(feedDecimals - FEED_DECIMALS_USD8)}.`,
    );
  }
}
