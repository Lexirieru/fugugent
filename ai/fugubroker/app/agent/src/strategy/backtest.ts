/**
 * Replaying the hiring engine over a recorded sequence.
 *
 * PURE: no network, no clock, no I/O. Each step carries the catalog as it stood and the
 * request as it was made, and the engine decides again from scratch. Two runs over the
 * same steps must give the same answer, in the same order, down to the last cent.
 *
 * What this is for. Every rule in `decide.ts` is defensible on its own, and that is not
 * the same as the whole set being safe over time. The failure this replay is built to
 * catch is the one that cannot be seen in a single decision: a run where every hire is
 * correct, cheap and within limits, and the total across the run is money nobody meant to
 * spend. The running total is threaded from step to step for exactly that reason.
 *
 * What this is NOT. It measures spending and refusals. It cannot measure whether a hired
 * agent was worth its price, because nothing in the catalog records what the work was
 * worth. Anyone reading a green report here should read that sentence twice.
 */
import { decide } from "./decide.js";
import {
  DEFAULT_POLICY,
  HiringError,
  puffFromBudgetBps,
  type CatalogListing,
  type HireAction,
  type HireDecision,
  type HiringPolicy,
  type HiringRequest,
  type PuffLevel,
} from "./types.js";

export interface BacktestStep {
  /** A label for the step, so a failing case can be named in a report. */
  label: string;
  catalog: readonly CatalogListing[];
  /**
   * The request as it was made. Any `alreadySpentUsd8` written here is IGNORED and
   * replaced with the running total the replay itself keeps, because the point of the
   * replay is to test what the running total does.
   */
  request: HiringRequest;
}

export interface BacktestOutcome {
  label: string;
  action: HireAction;
  listingId: bigint | null;
  spentUsd8: bigint;
  runningTotalUsd8: bigint;
  puffLevel: PuffLevel;
  reason: string;
}

export interface BacktestReport {
  steps: BacktestOutcome[];
  hires: number;
  /** How many times each kind of refusal happened. */
  refusalsByAction: Record<string, number>;
  totalSpentUsd8: bigint;
  /** The largest single hire in the run. */
  largestHireUsd8: bigint;
  /** The highest puff level reached, which is the run's worst moment. */
  worstPuffLevel: PuffLevel;
  /** How much of the window ceiling the whole run used, in bps. */
  windowUsedBps: bigint;
}

/**
 * Runs the engine over the steps, carrying the running total forward.
 *
 * The invariant at the end is not decoration. If the total spent ever exceeds the window
 * ceiling, one of the gates leaks, and a leak of that kind is invisible in a per-step
 * test because each step passed its own check. The replay throws rather than reporting
 * it, because a report is something a person has to read and an exception is not.
 */
export function runBacktest(
  steps: readonly BacktestStep[],
  policy: HiringPolicy = DEFAULT_POLICY,
  self: { owner?: `0x${string}`; agentWallet?: `0x${string}` } = {},
): BacktestReport {
  const outcomes: BacktestOutcome[] = [];
  const refusalsByAction: Record<string, number> = {};
  let runningTotal = 0n;
  let hires = 0;
  let largest = 0n;
  let worstPuff: PuffLevel = 0;

  for (const step of steps) {
    const decision: HireDecision = decide(
      step.catalog,
      { ...step.request, alreadySpentUsd8: runningTotal },
      policy,
      self,
    );

    const spent = decision.action === "HIRE" && decision.chosen !== null
      ? decision.chosen.totalUsd8
      : 0n;
    runningTotal += spent;
    if (spent > 0n) {
      hires += 1;
      if (spent > largest) largest = spent;
    } else {
      refusalsByAction[decision.action] = (refusalsByAction[decision.action] ?? 0) + 1;
    }
    if (decision.puffLevel > worstPuff) worstPuff = decision.puffLevel;

    outcomes.push({
      label: step.label,
      action: decision.action,
      listingId: decision.chosen?.listingId ?? null,
      spentUsd8: spent,
      runningTotalUsd8: runningTotal,
      puffLevel: decision.puffLevel,
      reason: decision.reason,
    });
  }

  if (runningTotal > policy.windowBudgetUsd8) {
    throw new HiringError(
      `The replay spent ${runningTotal} against a window ceiling of ${policy.windowBudgetUsd8}. ` +
        `Every single step passed its own checks, so a gate is leaking across steps rather ` +
        `than inside one.`,
    );
  }

  const windowUsedBps =
    policy.windowBudgetUsd8 <= 0n
      ? 10_000n
      : (runningTotal * 10_000n) / policy.windowBudgetUsd8;

  return {
    steps: outcomes,
    hires,
    refusalsByAction,
    totalSpentUsd8: runningTotal,
    largestHireUsd8: largest,
    worstPuffLevel: worstPuff,
    windowUsedBps,
  };
}

/** The puff level for a whole run, from how much of the window ceiling it used. */
export function runPuffLevel(report: BacktestReport): PuffLevel {
  return puffFromBudgetBps(report.windowUsedBps);
}
