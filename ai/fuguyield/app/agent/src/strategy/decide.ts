/**
 * The Yield decision engine.
 *
 * PURE: no network, no `Date.now()`, no `process.env`, no I/O. The age of the APY data
 * arrives as a number inside `Pool` rather than being read from the clock, so every
 * decision can be replayed exactly and backtested.
 *
 * The order of the gates, and this order is the core of the design:
 *   1. SAFETY of the current position — if where we stand is no longer safe, we leave,
 *      whatever the APY spread is. Safety beats economics.
 *   2. FRESHNESS of the current position's data — without a trustworthy current APY the
 *      spread cannot be computed; refusing to compute is better than computing wrong.
 *   3. RISK of the candidates — pools are filtered BEFORE their APY is looked at, so a
 *      high APY can never "buy" leniency on risk.
 *   4. ECONOMICS — the APY spread must exceed a threshold DERIVED from the migration
 *      cost, the principal, and the horizon.
 *   5. CONFIRMATION — that spread has to persist across several observations.
 *
 * The highest APY is not the right answer, and this module is arranged so the highest
 * number can never get past gates 1 through 3.
 */
import {
  breakEvenSpreadBps,
  netGainBase,
  poolShareBps,
  requiredSpreadBps,
  switchCostBase,
} from "./apy.js";
import { formatApyBps, formatBps, formatUsd8 } from "./format.js";
import {
  BPS_ONE,
  DEFAULT_SWITCH_COST,
  DEFAULT_YIELD_THRESHOLDS,
  YieldError,
  type Pool,
  type RejectReason,
  type RejectedPool,
  type SwitchCostModel,
  type YieldDecision,
  type YieldObservation,
  type YieldReasonCode,
  type YieldThresholds,
} from "./types.js";

function validateCost(cost: SwitchCostModel): void {
  if (cost.swapFeeBps < 0n || cost.slippageBps < 0n || cost.gasCostBase < 0n) {
    throw new YieldError(
      `A negative cost model is impossible: swapFeeBps=${cost.swapFeeBps}, ` +
        `slippageBps=${cost.slippageBps}, gasCostBase=${cost.gasCostBase}.`,
    );
  }
  if (cost.swapFeeBps + cost.slippageBps >= BPS_ONE) {
    throw new YieldError(
      `A proportional cost of ${cost.swapFeeBps + cost.slippageBps} bps reaches 100%: ` +
        `a move like that leaves no principal behind.`,
    );
  }
}

function validateThresholds(t: YieldThresholds): void {
  if (t.expectedHoldingDays <= 0n) {
    throw new YieldError(
      `expectedHoldingDays=${t.expectedHoldingDays} is not positive. The whole break-even threshold is divided by this number; ` +
        `without a horizon, "is this move worth it" has no answer.`,
    );
  }
  if (t.spreadSafetyMultipleBps < BPS_ONE) {
    throw new YieldError(
      `spreadSafetyMultipleBps=${t.spreadSafetyMultipleBps} is below 10000 (1.00x): that formalizes ` +
        `a move that does not even cover its own cost.`,
    );
  }
  if (t.maxPoolShareBps <= 0n || t.maxPoolShareBps >= BPS_ONE) {
    throw new YieldError(
      `maxPoolShareBps=${t.maxPoolShareBps} is outside the range 1..9999. A 100% share means the APY being chased ` +
        `is entirely a reflection of our own capital.`,
    );
  }
  if (t.maxPlausibleApyBps <= 0n) {
    throw new YieldError(`maxPlausibleApyBps=${t.maxPlausibleApyBps} is not positive.`);
  }
  if (!Number.isInteger(t.maxRiskScore) || t.maxRiskScore < 0 || t.maxRiskScore > 100) {
    throw new YieldError(`maxRiskScore=${t.maxRiskScore} is outside the range 0..100.`);
  }
  if (!Number.isInteger(t.maxApyAgeSeconds) || t.maxApyAgeSeconds < 0) {
    throw new YieldError(`maxApyAgeSeconds=${t.maxApyAgeSeconds} must be an integer >= 0.`);
  }
  if (!Number.isInteger(t.minConsecutiveFavorable) || t.minConsecutiveFavorable < 1) {
    throw new YieldError(`minConsecutiveFavorable=${t.minConsecutiveFavorable} must be an integer >= 1.`);
  }
}

/**
 * A pool whose shape is nonsensical must fail hard, not be treated as a risky pool. The
 * difference matters: `riskScore: 200` is not a very risky pool, it is a broken reading,
 * and treating it as "very risky" means quietly accepting data we do not understand.
 */
function validatePool(p: Pool, label: string): void {
  if (p.apyBps < 0n) {
    throw new YieldError(`Negative APY on ${label} "${p.poolId}": ${p.apyBps} bps.`);
  }
  if (p.tvlBase <= 0n) {
    throw new YieldError(`TVL ${p.tvlBase} on ${label} "${p.poolId}" is not positive.`);
  }
  if (!Number.isInteger(p.riskScore) || p.riskScore < 0 || p.riskScore > 100) {
    throw new YieldError(`riskScore=${p.riskScore} on ${label} "${p.poolId}" is outside the range 0..100.`);
  }
  if (!Number.isInteger(p.apyAgeSeconds) || p.apyAgeSeconds < 0) {
    throw new YieldError(
      `apyAgeSeconds=${p.apyAgeSeconds} on ${label} "${p.poolId}" must be an integer >= 0.`,
    );
  }
}

function validateObservation(o: YieldObservation): void {
  if (o.position.principalBase <= 0n) {
    throw new YieldError(`Principal ${o.position.principalBase} is not positive: there is no position to manage.`);
  }
  validatePool(o.position.current, "the current position");

  const seen = new Set<string>();
  for (const c of o.candidates) {
    if (seen.has(c.poolId)) {
      throw new YieldError(`Duplicate candidate poolId "${c.poolId}": the best choice becomes ambiguous.`);
    }
    seen.add(c.poolId);
    validatePool(c, "a candidate");
  }

  if (!Number.isInteger(o.consecutiveFavorable) || o.consecutiveFavorable < 0) {
    throw new YieldError(`consecutiveFavorable=${o.consecutiveFavorable} must be an integer >= 0.`);
  }
}

/**
 * The risk gates. Run BEFORE any APY is compared, so no APY however high can buy
 * leniency here.
 */
function rejectionOf(
  pool: Pool,
  principalBase: bigint,
  t: YieldThresholds,
): RejectReason | null {
  if (!pool.isActive) return "INACTIVE";
  if (pool.riskScore > t.maxRiskScore) return "RISK_SCORE";
  if (pool.apyBps > t.maxPlausibleApyBps) return "IMPLAUSIBLE_APY";
  if (pool.apyAgeSeconds > t.maxApyAgeSeconds) return "STALE_DATA";
  if (poolShareBps(principalBase, pool.tvlBase) > t.maxPoolShareBps) return "POOL_SHARE";
  return null;
}

/**
 * The safety gate for the position we are CURRENTLY holding. It deliberately does not
 * reuse `rejectionOf` as-is: stale APY data is not a reason to leave a healthy pool (the
 * money is already there, nothing changed just because the number arrived late), while a
 * pool that is frozen or shrinking is a reason to leave right now.
 */
function currentPoolIsUnsafe(pool: Pool, principalBase: bigint, t: YieldThresholds): boolean {
  if (!pool.isActive) return true;
  if (pool.riskScore > t.maxRiskScore) return true;
  if (poolShareBps(principalBase, pool.tvlBase) > t.maxPoolShareBps) return true;
  return false;
}

function buildReason(
  code: YieldReasonCode,
  currentApyBps: bigint,
  bestApyBps: bigint | null,
  targetPoolId: string | null,
  spreadBps: bigint,
  requiredBps: bigint,
  switchCost: bigint,
  netGain: bigint,
  days: bigint,
): string {
  const now = `Current APY ${formatApyBps(currentApyBps)}`;
  const best =
    bestApyBps === null ? "" : ` Best candidate "${targetPoolId}" at ${formatApyBps(bestApyBps)}, a spread of ${formatBps(spreadBps)}.`;
  const threshold = ` The required threshold is ${formatBps(requiredBps)} at a migration cost of ${formatUsd8(switchCost)} over a ${days}-day horizon.`;

  switch (code) {
    case "NO_CANDIDATE":
      return `${now}. No alternative pool was given.`;
    case "NO_ELIGIBLE_POOL":
      return `${now}. The current pool is no longer safe and no destination clears the risk gates: withdrawing the entire position.`;
    case "NO_BETTER_POOL":
      return `${now}.${best} Nothing is higher; staying put.`;
    case "SPREAD_BELOW_BREAKEVEN":
      return `${now}.${best}${threshold} The spread does not yet cover the migration cost, so that higher APY is not the better choice.`;
    case "SPREAD_NOT_CONFIRMED":
      return `${now}.${best}${threshold} The spread is large enough but has not persisted long enough; a momentary spike is not chased.`;
    case "MIGRATION_ECONOMIC":
      return `${now}.${best}${threshold} Estimated net gain over the horizon ${formatUsd8(netGain)}: migrating.`;
    case "CURRENT_POOL_UNSAFE":
      return `${now}. The current pool no longer clears the risk gates (paused, its risk score rose, or its TVL shrank until our share is too large).${best} Migrating without waiting for the spread threshold: safety beats economics.`;
    case "CURRENT_DATA_STALE":
      return `${now} is too stale to be trusted. The spread cannot be computed honestly, so nothing is moved.`;
  }
}

export function decide(
  observation: YieldObservation,
  cost: SwitchCostModel = DEFAULT_SWITCH_COST,
  thresholds: YieldThresholds = DEFAULT_YIELD_THRESHOLDS,
): YieldDecision {
  validateCost(cost);
  validateThresholds(thresholds);
  validateObservation(observation);

  const { position, candidates, consecutiveFavorable } = observation;
  const principal = position.principalBase;
  const current = position.current;

  const switchCost = switchCostBase(principal, cost);
  const breakEven = breakEvenSpreadBps(principal, switchCost, thresholds.expectedHoldingDays);
  const required = requiredSpreadBps(breakEven, thresholds.spreadSafetyMultipleBps);

  // --- gate 3: filter candidates on risk, before looking at any APY ---
  const rejected: RejectedPool[] = [];
  const eligible: Pool[] = [];
  for (const c of candidates) {
    if (c.poolId === current.poolId) {
      rejected.push({ poolId: c.poolId, why: "SAME_POOL" });
      continue;
    }
    const why = rejectionOf(c, principal, thresholds);
    if (why === null) eligible.push(c);
    else rejected.push({ poolId: c.poolId, why });
  }

  // Deterministic ordering: APY descending, then poolId ascending. Without a strict
  // tiebreaker, two pools with equal APY would be picked by input order — and the input
  // order comes from an indexer, which is not guaranteed to be stable. A decision about
  // money must not depend on which row happened to come first.
  const sorted = [...eligible].sort((a, b) =>
    a.apyBps === b.apyBps ? (a.poolId < b.poolId ? -1 : a.poolId > b.poolId ? 1 : 0) : a.apyBps > b.apyBps ? -1 : 1,
  );
  const best = sorted[0] ?? null;

  const spread = best === null ? 0n : best.apyBps - current.apyBps;
  const spreadQualifies = best !== null && spread >= required;
  const netGain = best === null ? 0n : netGainBase(principal, spread, thresholds.expectedHoldingDays, switchCost);

  const result = (action: YieldDecision["action"], code: YieldReasonCode, target: string | null): YieldDecision => ({
    action,
    reasonCode: code,
    targetPoolId: target,
    currentApyBps: current.apyBps,
    bestApyBps: best?.apyBps ?? null,
    spreadBps: spread,
    breakEvenSpreadBps: breakEven,
    requiredSpreadBps: required,
    spreadQualifies,
    switchCostBase: switchCost,
    netGainBase: netGain,
    rejected,
    reason: buildReason(
      code,
      current.apyBps,
      best?.apyBps ?? null,
      best?.poolId ?? null,
      spread,
      required,
      switchCost,
      netGain,
      thresholds.expectedHoldingDays,
    ),
  });

  // --- gate 1: the current position's safety beats all economics ---
  if (currentPoolIsUnsafe(current, principal, thresholds)) {
    if (best === null) return result("EXIT", "NO_ELIGIBLE_POOL", null);
    // No waiting for confirmation: waiting means leaving the money in a place already
    // judged unsafe for several more observations.
    return result("MIGRATE", "CURRENT_POOL_UNSAFE", best.poolId);
  }

  // --- gate 2: the current position's data must be fresh enough to compare against ---
  if (current.apyAgeSeconds > thresholds.maxApyAgeSeconds) {
    return result("STAY", "CURRENT_DATA_STALE", best?.poolId ?? null);
  }

  if (best === null) return result("STAY", "NO_CANDIDATE", null);
  if (spread <= 0n) return result("STAY", "NO_BETTER_POOL", best.poolId);

  // --- gate 4: economics ---
  if (!spreadQualifies) return result("STAY", "SPREAD_BELOW_BREAKEVEN", best.poolId);

  // --- gate 5: confirmation ---
  if (consecutiveFavorable < thresholds.minConsecutiveFavorable) {
    return result("STAY", "SPREAD_NOT_CONFIRMED", best.poolId);
  }

  return result("MIGRATE", "MIGRATION_ECONOMIC", best.poolId);
}
