/**
 * Mesin keputusan Yield.
 *
 * MURNI: tanpa jaringan, tanpa `Date.now()`, tanpa `process.env`, tanpa I/O.
 * Umur data APY masuk sebagai angka di dalam `Pool`, bukan dibaca dari jam,
 * supaya setiap keputusan bisa diputar ulang persis dan di-backtest.
 *
 * Urutan gerbang, dan urutan ini adalah inti desainnya:
 *   1. KESELAMATAN posisi sekarang — kalau tempat kita berdiri sudah tidak aman,
 *      kita pergi, berapa pun selisih APY-nya. Keselamatan mengalahkan ekonomi.
 *   2. KESEGARAN data posisi sekarang — tanpa APY sekarang yang tepercaya,
 *      selisih tidak bisa dihitung; menolak menghitung lebih baik daripada
 *      menghitung salah.
 *   3. RISIKO kandidat — pool disaring SEBELUM APY-nya dilihat, sehingga APY
 *      tinggi tidak pernah bisa "membeli" kelonggaran risiko.
 *   4. EKONOMI — selisih APY harus melampaui ambang yang DITURUNKAN dari ongkos
 *      pindah, pokok, dan horizon.
 *   5. KONFIRMASI — selisih itu harus bertahan beberapa pengamatan.
 *
 * APY tertinggi bukan jawaban yang benar, dan modul ini disusun supaya angka
 * tertinggi tidak pernah bisa melewati gerbang 1 sampai 3.
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
 * Pool yang bentuknya tidak masuk akal harus gagal keras, bukan diperlakukan
 * sebagai pool berisiko. Bedanya penting: `riskScore: 200` bukan pool yang
 * sangat berisiko, itu pembacaan yang rusak, dan memperlakukannya sebagai
 * "sangat berisiko" berarti diam-diam menerima data yang tidak dipahami.
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
 * Gerbang risiko. Dijalankan SEBELUM APY dibandingkan, sehingga APY setinggi
 * apa pun tidak pernah bisa membeli kelonggaran di sini.
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
 * Gerbang keselamatan untuk posisi yang SEDANG dipegang. Sengaja tidak memakai
 * `rejectionOf` apa adanya: data APY yang basi bukan alasan untuk meninggalkan
 * pool yang sehat (uangnya sudah di sana, tidak ada yang berubah karena
 * angkanya terlambat), sedangkan pool yang dibekukan atau menyusut adalah
 * alasan untuk pergi sekarang juga.
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

  // --- gerbang 3: saring kandidat berdasarkan risiko, sebelum melihat APY ---
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

  // Urutan deterministik: APY menurun, lalu poolId menaik. Tanpa pemecah seri
  // yang tegas, dua pool ber-APY sama akan dipilih menurut urutan masukan —
  // dan urutan masukan datang dari indexer, yang tidak dijamin stabil. Keputusan
  // uang tidak boleh bergantung pada urutan baris yang kebetulan.
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

  // --- gerbang 1: keselamatan posisi sekarang mengalahkan seluruh ekonomi ---
  if (currentPoolIsUnsafe(current, principal, thresholds)) {
    if (best === null) return hasil("EXIT", "NO_ELIGIBLE_POOL", null);
    // Tanpa menunggu konfirmasi: menunggu berarti membiarkan uang tetap berada
    // di tempat yang sudah dinilai tidak aman selama beberapa pengamatan lagi.
    return hasil("MIGRATE", "CURRENT_POOL_UNSAFE", best.poolId);
  }

  // --- gerbang 2: data posisi sekarang harus cukup segar untuk dibandingkan ---
  if (current.apyAgeSeconds > thresholds.maxApyAgeSeconds) {
    return hasil("STAY", "CURRENT_DATA_STALE", best?.poolId ?? null);
  }

  if (best === null) return hasil("STAY", "NO_CANDIDATE", null);
  if (spread <= 0n) return hasil("STAY", "NO_BETTER_POOL", best.poolId);

  // --- gerbang 4: ekonomi ---
  if (!spreadQualifies) return hasil("STAY", "SPREAD_BELOW_BREAKEVEN", best.poolId);

  // --- gerbang 5: konfirmasi ---
  if (consecutiveFavorable < thresholds.minConsecutiveFavorable) {
    return hasil("STAY", "SPREAD_NOT_CONFIRMED", best.poolId);
  }

  return hasil("MIGRATE", "MIGRATION_ECONOMIC", best.poolId);
}
