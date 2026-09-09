/**
 * Replaying the purchase engine over a recorded sequence of price demands.
 *
 * PURE: no network, no clock, no I/O. Each step carries the demand exactly as a seller
 * sent it, and the engine decides again from scratch. Two runs over the same steps give
 * the same answers in the same order, down to the last unit.
 *
 * What this is for. The failure that matters here cannot be seen one payment at a time. A
 * single one-cent payment is correct, cheap and well inside every limit. A thousand of
 * them are a thousand correct decisions and an empty wallet, and the only thing standing
 * between those two sentences is the running total, which is exactly what this replay
 * threads from step to step.
 *
 * What this is NOT. It measures what was spent and what was refused. It cannot measure
 * whether what was bought was worth buying, because nothing in a price demand says what
 * the data was worth. A green report here is not evidence of a profitable agent.
 */
import { decidePurchase } from "./decide.js";
import { parsePriceDemand } from "./challenge.js";
import {
  DEFAULT_POLICY,
  PurchaseError,
  puffFromWindowBps,
  type PurchaseAction,
  type PurchaseDecision,
  type PurchasePolicy,
  type PuffLevel,
  type SpendLedger,
} from "./types.js";

export interface PurchaseStep {
  /** A label, so a failing case can be named in a report. */
  label: string;
  /** The seller's reply body, exactly as it arrived. */
  demandBody: unknown;
  /** The address the caller expected to be paid, when they knew it. */
  expectedPayee?: `0x${string}`;
}

export interface PurchaseOutcome {
  label: string;
  action: PurchaseAction;
  spentUnits: bigint;
  runningTotalUnits: bigint;
  puffLevel: PuffLevel;
  reason: string;
}

export interface PurchaseReport {
  steps: PurchaseOutcome[];
  paid: number;
  refusalsByAction: Record<string, number>;
  refusalsByRule: Record<string, number>;
  totalSpentUnits: bigint;
  largestPaymentUnits: bigint;
  worstPuffLevel: PuffLevel;
  windowUsedBps: bigint;
}

/**
 * Runs the engine over the steps, carrying the running total forward.
 *
 * The check at the end is not decoration. If the total ever exceeds the window ceiling,
 * a gate is leaking across steps, and a leak of that shape is invisible in a per-step
 * test because every step passed its own check. It throws rather than reporting, because
 * a report has to be read by a person and an exception does not.
 */
export function runPurchaseBacktest(
  steps: readonly PurchaseStep[],
  policy: PurchasePolicy = DEFAULT_POLICY,
  startingLedger: SpendLedger = { spentUnits: 0n, windowStartedAt: 0n },
): PurchaseReport {
  const outcomes: PurchaseOutcome[] = [];
  const refusalsByAction: Record<string, number> = {};
  const refusalsByRule: Record<string, number> = {};
  let ledger: SpendLedger = { ...startingLedger };
  let paid = 0;
  let largest = 0n;
  let worstPuff: PuffLevel = 0;

  for (const step of steps) {
    const decision: PurchaseDecision = decidePurchase(
      parsePriceDemand(step.demandBody),
      policy,
      ledger,
      step.expectedPayee === undefined ? {} : { expectedPayee: step.expectedPayee },
    );

    const spent =
      decision.action === "PAY" && decision.chosen !== null ? decision.chosen.amountUnits : 0n;
    ledger = { ...ledger, spentUnits: ledger.spentUnits + spent };

    if (spent > 0n) {
      paid += 1;
      if (spent > largest) largest = spent;
    } else {
      refusalsByAction[decision.action] = (refusalsByAction[decision.action] ?? 0) + 1;
      for (const r of decision.refused) {
        refusalsByRule[r.rule] = (refusalsByRule[r.rule] ?? 0) + 1;
      }
    }
    if (decision.puffLevel > worstPuff) worstPuff = decision.puffLevel;

    outcomes.push({
      label: step.label,
      action: decision.action,
      spentUnits: spent,
      runningTotalUnits: ledger.spentUnits,
      puffLevel: decision.puffLevel,
      reason: decision.reason,
    });
  }

  const spentInRun = ledger.spentUnits - startingLedger.spentUnits;
  if (ledger.spentUnits > policy.windowBudgetUnits) {
    throw new PurchaseError(
      `The replay spent ${ledger.spentUnits} against a window ceiling of ` +
        `${policy.windowBudgetUnits}. Every single step passed its own checks, so a gate is ` +
        `leaking across steps rather than inside one.`,
    );
  }

  const windowUsed =
    policy.windowBudgetUnits <= 0n
      ? 10_000n
      : (ledger.spentUnits * 10_000n) / policy.windowBudgetUnits;

  return {
    steps: outcomes,
    paid,
    refusalsByAction,
    refusalsByRule,
    totalSpentUnits: spentInRun,
    largestPaymentUnits: largest,
    worstPuffLevel: worstPuff,
    windowUsedBps: windowUsed,
  };
}

/** The puff level for a whole run, from how much of the window ceiling it used. */
export function runPuffLevel(report: PurchaseReport): PuffLevel {
  return puffFromWindowBps(report.windowUsedBps);
}
