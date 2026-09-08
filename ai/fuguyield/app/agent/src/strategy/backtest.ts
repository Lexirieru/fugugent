/**
 * ============================================================================
 * HONEST LIMITATIONS — READ BEFORE USING ANY NUMBER FROM THIS MODULE
 * ============================================================================
 * This harness runs three policies over the SAME APY series:
 *   - `disciplined` : the real policy (`decide`) — risk gates, a spread threshold
 *                     derived from cost, and confirmation
 *   - `chaser`      : always move to the highest APY, with no gate at all
 *   - `passive`     : never move
 * It has one purpose: to show measurably that chasing the highest APY is a way to lose,
 * and that "the minimum APY spread that justifies a migration" is not a formality.
 *
 * What is deliberately NOT modeled:
 *   - the APY CHANGING because our own deposit arrives. This simplification FAVORS
 *     `chaser`: in the real world the pool being chased drops its APY the moment capital
 *     lands, especially the small pools that most often top the list. `chaser`'s losses
 *     as measured here are therefore a LOWER BOUND on its losses.
 *   - compounding within a single candle, and reward reinvestment
 *   - reward-token prices: an emissions-based APY is treated as being just as real as an
 *     APY backed by loan interest, when the first one can evaporate
 *   - failed transactions, reverts, dead RPC, expired Altana sessions
 *   - lock-ups, cooldowns, or withdrawal queues; a migration is assumed instant
 *   - risk that actually materializes (exploits, depegs, bad debt). `riskScore` only
 *     filters here, it never produces a loss in this simulation — so the value of the
 *     risk gates is NOT visible in any number here. That is this module's biggest
 *     limitation.
 *   - taxes
 *
 * The APY series is an input; every function here is pure and deterministic.
 *
 * HOW CONFIRMATION IS COUNTED lives here too, and that is deliberate: `decide` is pure
 * and has no memory, so the scheduler in `backend/` MUST use exactly the same rule as
 * `jalankan()` below, otherwise production behavior will differ from what this backtest
 * proves.
 * ============================================================================
 */
import { decide } from "./decide.js";
import { switchCostBase, yieldOverPeriodBase } from "./apy.js";
import {
  DEFAULT_SWITCH_COST,
  DEFAULT_YIELD_THRESHOLDS,
  YieldError,
  type Pool,
  type SwitchCostModel,
  type YieldThresholds,
} from "./types.js";

export interface BacktestPool {
  poolId: string;
  protocol: string;
  tvlBase: bigint;
  riskScore: number;
}

export interface ApyPoint {
  poolId: string;
  apyBps: bigint;
}

export interface YieldBacktestInput {
  startPrincipalBase: bigint;
  startPoolId: string;
  pools: BacktestPool[];
  /** `apySeriesBps[candle]` must carry exactly one entry for every pool. */
  apySeriesBps: ApyPoint[][];
  /** How many days one candle represents. */
  daysPerCandle: bigint;
  cost?: SwitchCostModel;
  thresholds?: YieldThresholds;
}

export interface PolicyResult {
  finalPrincipalBase: bigint;
  migrations: number;
  totalCostBase: bigint;
  /** The candle index of the first migration; null if it never migrated. */
  firstMigrationCandle: number | null;
}

export interface YieldBacktestResult {
  candles: number;
  disciplined: PolicyResult;
  chaser: PolicyResult;
  passive: PolicyResult;
  disciplinedBeatsChaser: boolean;
}

function validate(input: YieldBacktestInput): void {
  if (input.startPrincipalBase <= 0n) {
    throw new YieldError(`Pokok awal ${input.startPrincipalBase} tidak positif.`);
  }
  if (input.daysPerCandle <= 0n) {
    throw new YieldError(`daysPerCandle=${input.daysPerCandle} tidak positif.`);
  }
  if (input.pools.length === 0) {
    throw new YieldError("Daftar pool kosong.");
  }
  if (input.apySeriesBps.length === 0) {
    throw new YieldError("Deret APY kosong: tidak ada yang bisa disimulasikan.");
  }

  const dikenal = new Set(input.pools.map((p) => p.poolId));
  if (dikenal.size !== input.pools.length) {
    throw new YieldError("poolId duplikat di dalam daftar pool.");
  }
  if (!dikenal.has(input.startPoolId)) {
    throw new YieldError(`startPoolId "${input.startPoolId}" tidak ada di dalam daftar pool.`);
  }

  for (const [i, baris] of input.apySeriesBps.entries()) {
    const terlihat = new Set<string>();
    for (const titik of baris) {
      if (!dikenal.has(titik.poolId)) {
        throw new YieldError(`Candle ${i} menyebut pool tak dikenal "${titik.poolId}".`);
      }
      if (terlihat.has(titik.poolId)) {
        throw new YieldError(`Candle ${i} menyebut pool "${titik.poolId}" dua kali.`);
      }
      terlihat.add(titik.poolId);
    }
    if (terlihat.size !== dikenal.size) {
      throw new YieldError(
        `Candle ${i} memuat ${terlihat.size} pool, seharusnya ${dikenal.size}. ` +
          `Setiap candle wajib menyebut APY SELURUH pool, termasuk pool yang sedang ditempati — ` +
          `tanpa itu selisih tidak bisa dihitung.`,
      );
    }
  }
}

/**
 * A PURE function: no network, clock, or environment.
 */
export function runBacktest(input: YieldBacktestInput): YieldBacktestResult {
  validate(input);

  const cost = input.cost ?? DEFAULT_SWITCH_COST;
  const thresholds = input.thresholds ?? DEFAULT_YIELD_THRESHOLDS;
  const meta = new Map(input.pools.map((p) => [p.poolId, p]));

  /** The complete pool set at one candle. Data is always treated as fresh in a backtest. */
  const poolsAt = (candle: number): Map<string, Pool> => {
    const m = new Map<string, Pool>();
    for (const titik of input.apySeriesBps[candle]!) {
      const p = meta.get(titik.poolId)!;
      m.set(titik.poolId, {
        poolId: p.poolId,
        protocol: p.protocol,
        apyBps: titik.apyBps,
        tvlBase: p.tvlBase,
        riskScore: p.riskScore,
        isActive: true,
        apyAgeSeconds: 0,
      });
    }
    return m;
  };

  type Mode = "disciplined" | "chaser" | "passive";

  const jalankan = (mode: Mode): PolicyResult => {
    let principal = input.startPrincipalBase;
    let poolId = input.startPoolId;
    let migrations = 0;
    let totalCostBase = 0n;
    let firstMigrationCandle: number | null = null;

    // The confirmation memory. `decide` is pure and does not store it; the production
    // scheduler MUST use exactly the same rule as this block.
    let favorit: string | null = null;
    let berturut = 0;

    for (let i = 0; i < input.apySeriesBps.length; i++) {
      const pools = poolsAt(i);
      const current = pools.get(poolId)!;
      const candidates = [...pools.values()].filter((p) => p.poolId !== poolId);

      let target: string | null = null;

      if (mode === "disciplined") {
        // The first call only finds out whether the spread meets the threshold and which
        // pool it refers to; the confirmation count is updated from that answer, and only
        // then is the real decision taken.
        const probe = decide(
          { position: { principalBase: principal, current }, candidates, consecutiveFavorable: 0, blockNumber: BigInt(i) },
          cost,
          thresholds,
        );
        if (probe.spreadQualifies && probe.targetPoolId !== null) {
          berturut = probe.targetPoolId === favorit ? berturut + 1 : 1;
          favorit = probe.targetPoolId;
        } else {
          berturut = 0;
          favorit = null;
        }

        const d = decide(
          { position: { principalBase: principal, current }, candidates, consecutiveFavorable: berturut, blockNumber: BigInt(i) },
          cost,
          thresholds,
        );
        if (d.action === "MIGRATE") target = d.targetPoolId;
        // EXIT never appears in this backtest: every pool is always `isActive` and its
        // metadata is fixed, so the safety gate never fires. That is part of the
        // limitations written at the top of this file.
      } else if (mode === "chaser") {
        let terbaik: Pool | null = null;
        for (const c of candidates) {
          if (terbaik === null || c.apyBps > terbaik.apyBps || (c.apyBps === terbaik.apyBps && c.poolId < terbaik.poolId)) {
            terbaik = c;
          }
        }
        if (terbaik !== null && terbaik.apyBps > current.apyBps) target = terbaik.poolId;
      }

      if (target !== null) {
        const biaya = switchCostBase(principal, cost);
        principal -= biaya;
        totalCostBase += biaya;
        migrations += 1;
        if (firstMigrationCandle === null) firstMigrationCandle = i;
        poolId = target;
        // After migrating, the confirmation count no longer applies to the new pool.
        berturut = 0;
        favorit = null;
      }

      const apySekarang = poolsAt(i).get(poolId)!.apyBps;
      principal += yieldOverPeriodBase(principal, apySekarang, input.daysPerCandle);
    }

    return { finalPrincipalBase: principal, migrations, totalCostBase, firstMigrationCandle };
  };

  const disciplined = jalankan("disciplined");
  const chaser = jalankan("chaser");
  const passive = jalankan("passive");

  return {
    candles: input.apySeriesBps.length,
    disciplined,
    chaser,
    passive,
    disciplinedBeatsChaser: disciplined.finalPrincipalBase > chaser.finalPrincipalBase,
  };
}
