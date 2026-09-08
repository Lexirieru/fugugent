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
      `Model biaya negatif tidak mungkin: swapFeeBps=${cost.swapFeeBps}, ` +
        `slippageBps=${cost.slippageBps}, gasCostBase=${cost.gasCostBase}.`,
    );
  }
  if (cost.swapFeeBps + cost.slippageBps >= BPS_ONE) {
    throw new YieldError(
      `Biaya proporsional ${cost.swapFeeBps + cost.slippageBps} bps mencapai 100%: ` +
        `perpindahan seperti itu tidak menyisakan pokok.`,
    );
  }
}

function validateThresholds(t: YieldThresholds): void {
  if (t.expectedHoldingDays <= 0n) {
    throw new YieldError(
      `expectedHoldingDays=${t.expectedHoldingDays} tidak positif. Seluruh ambang impas dibagi angka ini; ` +
        `tanpa horizon, "apakah pindah ini sepadan" tidak punya jawaban.`,
    );
  }
  if (t.spreadSafetyMultipleBps < BPS_ONE) {
    throw new YieldError(
      `spreadSafetyMultipleBps=${t.spreadSafetyMultipleBps} di bawah 10000 (1,00x): itu meresmikan ` +
        `perpindahan yang bahkan tidak menutup ongkosnya sendiri.`,
    );
  }
  if (t.maxPoolShareBps <= 0n || t.maxPoolShareBps >= BPS_ONE) {
    throw new YieldError(
      `maxPoolShareBps=${t.maxPoolShareBps} di luar rentang 1..9999. Pangsa 100% berarti APY yang dikejar ` +
        `sepenuhnya pantulan modal kita sendiri.`,
    );
  }
  if (t.maxPlausibleApyBps <= 0n) {
    throw new YieldError(`maxPlausibleApyBps=${t.maxPlausibleApyBps} tidak positif.`);
  }
  if (!Number.isInteger(t.maxRiskScore) || t.maxRiskScore < 0 || t.maxRiskScore > 100) {
    throw new YieldError(`maxRiskScore=${t.maxRiskScore} di luar rentang 0..100.`);
  }
  if (!Number.isInteger(t.maxApyAgeSeconds) || t.maxApyAgeSeconds < 0) {
    throw new YieldError(`maxApyAgeSeconds=${t.maxApyAgeSeconds} harus bilangan bulat >= 0.`);
  }
  if (!Number.isInteger(t.minConsecutiveFavorable) || t.minConsecutiveFavorable < 1) {
    throw new YieldError(`minConsecutiveFavorable=${t.minConsecutiveFavorable} harus bilangan bulat >= 1.`);
  }
}

/**
 * A pool whose shape is nonsensical must fail hard, not be treated as a risky pool. The
 * difference matters: `riskScore: 200` is not a very risky pool, it is a broken reading,
 * and treating it as "very risky" means quietly accepting data we do not understand.
 */
function validatePool(p: Pool, label: string): void {
  if (p.apyBps < 0n) {
    throw new YieldError(`APY negatif pada ${label} "${p.poolId}": ${p.apyBps} bps.`);
  }
  if (p.tvlBase <= 0n) {
    throw new YieldError(`TVL ${p.tvlBase} pada ${label} "${p.poolId}" tidak positif.`);
  }
  if (!Number.isInteger(p.riskScore) || p.riskScore < 0 || p.riskScore > 100) {
    throw new YieldError(`riskScore=${p.riskScore} pada ${label} "${p.poolId}" di luar rentang 0..100.`);
  }
  if (!Number.isInteger(p.apyAgeSeconds) || p.apyAgeSeconds < 0) {
    throw new YieldError(
      `apyAgeSeconds=${p.apyAgeSeconds} pada ${label} "${p.poolId}" harus bilangan bulat >= 0.`,
    );
  }
}

function validateObservation(o: YieldObservation): void {
  if (o.position.principalBase <= 0n) {
    throw new YieldError(`Pokok ${o.position.principalBase} tidak positif: tidak ada posisi untuk dikelola.`);
  }
  validatePool(o.position.current, "posisi sekarang");

  const terlihat = new Set<string>();
  for (const c of o.candidates) {
    if (terlihat.has(c.poolId)) {
      throw new YieldError(`poolId kandidat duplikat "${c.poolId}": pilihan terbaik menjadi ambigu.`);
    }
    terlihat.add(c.poolId);
    validatePool(c, "kandidat");
  }

  if (!Number.isInteger(o.consecutiveFavorable) || o.consecutiveFavorable < 0) {
    throw new YieldError(`consecutiveFavorable=${o.consecutiveFavorable} harus bilangan bulat >= 0.`);
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
  const sekarang = `APY sekarang ${formatApyBps(currentApyBps)}`;
  const terbaik =
    bestApyBps === null ? "" : ` Kandidat terbaik "${targetPoolId}" ${formatApyBps(bestApyBps)}, selisih ${formatBps(spreadBps)}.`;
  const ambang = ` Ambang wajib ${formatBps(requiredBps)} pada ongkos pindah ${formatUsd8(switchCost)} dan horizon ${days} hari.`;

  switch (code) {
    case "NO_CANDIDATE":
      return `${sekarang}. Tidak ada pool alternatif yang diberikan.`;
    case "NO_ELIGIBLE_POOL":
      return `${sekarang}. Pool sekarang tidak lagi aman dan tidak ada tujuan yang lolos gerbang risiko: menarik seluruh posisi.`;
    case "NO_BETTER_POOL":
      return `${sekarang}.${terbaik} Tidak ada yang lebih tinggi; tetap di tempat.`;
    case "SPREAD_BELOW_BREAKEVEN":
      return `${sekarang}.${terbaik}${ambang} Selisihnya belum menutup ongkos pindah, jadi APY yang lebih tinggi itu bukan pilihan yang lebih baik.`;
    case "SPREAD_NOT_CONFIRMED":
      return `${sekarang}.${terbaik}${ambang} Selisihnya cukup tetapi belum bertahan cukup lama; lonjakan sesaat tidak dikejar.`;
    case "MIGRATION_ECONOMIC":
      return `${sekarang}.${terbaik}${ambang} Taksiran keuntungan bersih ${formatUsd8(netGain)} selama horizon: berpindah.`;
    case "CURRENT_POOL_UNSAFE":
      return `${sekarang}. Pool sekarang tidak lagi memenuhi gerbang risiko (dijeda, skor risiko naik, atau TVL menyusut sampai pangsa kita terlalu besar).${terbaik} Berpindah tanpa menunggu ambang selisih: keselamatan mengalahkan ekonomi.`;
    case "CURRENT_DATA_STALE":
      return `${sekarang} sudah terlalu basi untuk dipercaya. Selisih tidak bisa dihitung dengan jujur, jadi tidak ada yang dipindahkan.`;
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

  const biayaPindah = switchCostBase(principal, cost);
  const impas = breakEvenSpreadBps(principal, biayaPindah, thresholds.expectedHoldingDays);
  const wajib = requiredSpreadBps(impas, thresholds.spreadSafetyMultipleBps);

  // --- gate 3: filter candidates on risk, before looking at any APY ---
  const rejected: RejectedPool[] = [];
  const eligible: Pool[] = [];
  for (const c of candidates) {
    if (c.poolId === current.poolId) {
      rejected.push({ poolId: c.poolId, why: "SAME_POOL" });
      continue;
    }
    const alasan = rejectionOf(c, principal, thresholds);
    if (alasan === null) eligible.push(c);
    else rejected.push({ poolId: c.poolId, why: alasan });
  }

  // Deterministic ordering: APY descending, then poolId ascending. Without a strict
  // tiebreaker, two pools with equal APY would be picked by input order — and the input
  // order comes from an indexer, which is not guaranteed to be stable. A decision about
  // money must not depend on which row happened to come first.
  const urut = [...eligible].sort((a, b) =>
    a.apyBps === b.apyBps ? (a.poolId < b.poolId ? -1 : a.poolId > b.poolId ? 1 : 0) : a.apyBps > b.apyBps ? -1 : 1,
  );
  const best = urut[0] ?? null;

  const spread = best === null ? 0n : best.apyBps - current.apyBps;
  const spreadQualifies = best !== null && spread >= wajib;
  const netGain = best === null ? 0n : netGainBase(principal, spread, thresholds.expectedHoldingDays, biayaPindah);

  const hasil = (action: YieldDecision["action"], code: YieldReasonCode, target: string | null): YieldDecision => ({
    action,
    reasonCode: code,
    targetPoolId: target,
    currentApyBps: current.apyBps,
    bestApyBps: best?.apyBps ?? null,
    spreadBps: spread,
    breakEvenSpreadBps: impas,
    requiredSpreadBps: wajib,
    spreadQualifies,
    switchCostBase: biayaPindah,
    netGainBase: netGain,
    rejected,
    reason: buildReason(
      code,
      current.apyBps,
      best?.apyBps ?? null,
      best?.poolId ?? null,
      spread,
      wajib,
      biayaPindah,
      netGain,
      thresholds.expectedHoldingDays,
    ),
  });

  // --- gate 1: the current position's safety beats all economics ---
  if (currentPoolIsUnsafe(current, principal, thresholds)) {
    if (best === null) return hasil("EXIT", "NO_ELIGIBLE_POOL", null);
    // No waiting for confirmation: waiting means leaving the money in a place already
    // judged unsafe for several more observations.
    return hasil("MIGRATE", "CURRENT_POOL_UNSAFE", best.poolId);
  }

  // --- gate 2: the current position's data must be fresh enough to compare against ---
  if (current.apyAgeSeconds > thresholds.maxApyAgeSeconds) {
    return hasil("STAY", "CURRENT_DATA_STALE", best?.poolId ?? null);
  }

  if (best === null) return hasil("STAY", "NO_CANDIDATE", null);
  if (spread <= 0n) return hasil("STAY", "NO_BETTER_POOL", best.poolId);

  // --- gate 4: economics ---
  if (!spreadQualifies) return hasil("STAY", "SPREAD_BELOW_BREAKEVEN", best.poolId);

  // --- gate 5: confirmation ---
  if (consecutiveFavorable < thresholds.minConsecutiveFavorable) {
    return hasil("STAY", "SPREAD_NOT_CONFIRMED", best.poolId);
  }

  return hasil("MIGRATE", "MIGRATION_ECONOMIC", best.poolId);
}
