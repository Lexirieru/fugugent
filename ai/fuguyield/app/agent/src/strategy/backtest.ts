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
 * `run()` below, otherwise production behavior will differ from what this backtest
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
    throw new YieldError(`The starting principal ${input.startPrincipalBase} is not positive.`);
  }
  if (input.daysPerCandle <= 0n) {
    throw new YieldError(`daysPerCandle=${input.daysPerCandle} is not positive.`);
  }
  if (input.pools.length === 0) {
    throw new YieldError("The pool list is empty.");
  }
  if (input.apySeriesBps.length === 0) {
    throw new YieldError("Empty APY series: there is nothing to simulate.");
  }

  const known = new Set(input.pools.map((p) => p.poolId));
  if (known.size !== input.pools.length) {
    throw new YieldError("Duplicate poolId inside the pool list.");
  }
  if (!known.has(input.startPoolId)) {
    throw new YieldError(`startPoolId "${input.startPoolId}" is not in the pool list.`);
  }

  for (const [i, row] of input.apySeriesBps.entries()) {
    const seen = new Set<string>();
    for (const point of row) {
      if (!known.has(point.poolId)) {
        throw new YieldError(`Candle ${i} names an unknown pool "${point.poolId}".`);
      }
      if (seen.has(point.poolId)) {
        throw new YieldError(`Candle ${i} names pool "${point.poolId}" twice.`);
      }
      seen.add(point.poolId);
    }
    if (seen.size !== known.size) {
      throw new YieldError(
        `Candle ${i} carries ${seen.size} pools, and should carry ${known.size}. ` +
          `Every candle must name the APY of EVERY pool, including the one currently held — ` +
          `without that the spread cannot be computed.`,
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
    for (const point of input.apySeriesBps[candle]!) {
      const p = meta.get(point.poolId)!;
      m.set(point.poolId, {
        poolId: p.poolId,
        protocol: p.protocol,
        apyBps: point.apyBps,
        tvlBase: p.tvlBase,
        riskScore: p.riskScore,
        isActive: true,
        apyAgeSeconds: 0,
      });
    }
    return m;
  };

  type Mode = "disciplined" | "chaser" | "passive";

  const run = (mode: Mode): PolicyResult => {
    let principal = input.startPrincipalBase;
    let poolId = input.startPoolId;
    let migrations = 0;
    let totalCostBase = 0n;
    let firstMigrationCandle: number | null = null;

    // The confirmation memory. `decide` is pure and does not store it; the production
    // scheduler MUST use exactly the same rule as this block.
    let favorite: string | null = null;
    let consecutive = 0;

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
          consecutive = probe.targetPoolId === favorite ? consecutive + 1 : 1;
          favorite = probe.targetPoolId;
        } else {
          consecutive = 0;
          favorite = null;
        }

        const d = decide(
          { position: { principalBase: principal, current }, candidates, consecutiveFavorable: consecutive, blockNumber: BigInt(i) },
          cost,
          thresholds,
        );
        if (d.action === "MIGRATE") target = d.targetPoolId;
        // EXIT never appears in this backtest: every pool is always `isActive` and its
        // metadata is fixed, so the safety gate never fires. That is part of the
        // limitations written at the top of this file.
      } else if (mode === "chaser") {
        let best: Pool | null = null;
        for (const c of candidates) {
          if (best === null || c.apyBps > best.apyBps || (c.apyBps === best.apyBps && c.poolId < best.poolId)) {
            best = c;
          }
        }
        if (best !== null && best.apyBps > current.apyBps) target = best.poolId;
      }

      if (target !== null) {
        const switchCost = switchCostBase(principal, cost);
        principal -= switchCost;
        totalCostBase += switchCost;
        migrations += 1;
        if (firstMigrationCandle === null) firstMigrationCandle = i;
        poolId = target;
        // After migrating, the confirmation count no longer applies to the new pool.
        consecutive = 0;
        favorite = null;
      }

      const currentApy = poolsAt(i).get(poolId)!.apyBps;
      principal += yieldOverPeriodBase(principal, currentApy, input.daysPerCandle);
    }

    return { finalPrincipalBase: principal, migrations, totalCostBase, firstMigrationCandle };
  };

  const disciplined = run("disciplined");
  const chaser = run("chaser");
  const passive = run("passive");

  return {
    candles: input.apySeriesBps.length,
    disciplined,
    chaser,
    passive,
    disciplinedBeatsChaser: disciplined.finalPrincipalBase > chaser.finalPrincipalBase,
  };
}
