/**
 * Paying one due charge, inside the powers of the agent that claims it.
 *
 * Three layers stand between a schedule and money leaving the wallet, and it is worth being
 * exact about which is which, because only two of them are ours and only one of them is
 * enforced somewhere an attacker cannot reach.
 *
 *   1. The limited key, enforced by the account contract on the blockchain. It caps the
 *      whole key and cannot tell one of our agents from another.
 *   2. The scope, enforced here. It is what makes several agents on one wallet mean anything.
 *   3. The budget and the record of what has been paid, also enforced here.
 *
 * This module never touches the network. The clock and the paying function are handed in, so
 * every rule below can be tested with no network at all.
 *
 * ## The rules, in the order they are applied
 *
 *  1. The stop switch is on -> pay nothing. First, absolute, beats everything.
 *  2. This period is already recorded as paid, or as being paid -> pay nothing.
 *  3. The charge is outside the scope of the agent that claims it -> pay nothing.
 *  4. The agent's own daily budget cannot cover it -> pay nothing. Its OWN budget, never the
 *     wallet's: one agent must not be able to spend another's allowance.
 *  5. Not enough time since this agent's last payment -> pay nothing.
 *  6. The key has run out or is about to -> pay nothing.
 *  7. The record and the budget are written BEFORE the payment goes out, and saved first
 *     when a save function was handed in.
 *
 * ## Why a failed payment still counts
 *
 * The lesson Fugu Guardian paid for. Waiting for a result can time out after the transaction
 * already landed. If the record and the budget only moved on success, the next cycle would
 * see the same period unpaid and pay it again. So the record goes in first as "being paid",
 * the budget moves first, and a failure carries that state out to the caller. The only
 * exception is an error that says it never reached the network. An error that says nothing is
 * treated as "this may already have gone out".
 */
import { assertNotExpired, EXPIRY_SAFETY_MARGIN_SECONDS, type SessionPermissions } from "./session.js";
import {
  entryFor,
  markInFlight,
  markPaid,
  type Ledger,
} from "./ledger.js";
import { assertWithinScope, ScopeViolationError, type ScopeRegistry } from "./scope.js";
import type { DueCharge } from "./types.js";

const SECONDS_PER_DAY = 86_400;

/** One agent's own spending record. Kept per agent, never shared. */
export interface AgentBudget {
  readonly spentTodayUsd8: bigint;
  readonly dayStartedAt: number;
  /** The second of this agent's last payment. Zero means never. */
  readonly lastPaymentAt: number;
}

export interface ExecuteState {
  /** The owner's stop switch, for the whole wallet. */
  readonly killed: boolean;
  /**
   * One budget per agent, kept apart on purpose.
   *
   * A single shared budget would let the agent that pays for computing time eat the whole
   * allowance and leave the one that pays the rent with nothing, and neither of them would
   * have done anything wrong. Separate budgets are what make the scopes mean something in
   * money as well as in permissions.
   */
  readonly agents: Readonly<Record<string, AgentBudget>>;
  readonly ledger: Ledger;
}

export interface PaymentTiming {
  /** The least time between one payment and the next, per agent, in seconds. */
  readonly minIntervalSeconds: number;
}

export interface ExecuteResult {
  readonly paid: boolean;
  readonly reason: string;
  readonly amountPaidUsd8: bigint;
  readonly txHash: `0x${string}` | null;
  readonly state: ExecuteState;
}

export interface ExecuteDeps {
  /** Sends one payment. Handed in, so this module never touches the network. */
  readonly pay: (charge: DueCharge) => Promise<`0x${string}`>;
  /** The clock in seconds. Handed in so tests control time exactly. */
  readonly now: () => number;
  readonly sessionPermissions: SessionPermissions;
  readonly expirySafetyMarginSeconds?: number;
  /**
   * Saves the state BEFORE the payment goes out.
   *
   * IT FAILS CLOSED. If saving fails, nothing is paid and the error says it never reached the
   * network. A payment sent with no record that could hold it back is somebody's money gone;
   * a payment not sent is one late bill.
   */
  readonly persistBeforeSend?: (state: ExecuteState) => Promise<void> | void;
}

export function initialExecuteState(): ExecuteState {
  return { killed: false, agents: {}, ledger: {} };
}

export function budgetFor(state: ExecuteState, agentId: string, nowSeconds: number): AgentBudget {
  return state.agents[agentId] ?? { spentTodayUsd8: 0n, dayStartedAt: nowSeconds, lastPaymentAt: 0 };
}

export class NeverSentError extends Error {
  readonly neverSent = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NeverSentError";
  }
}

/** Does this error say it never reached the network? False unless it says so. */
export function wasNeverSent(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { neverSent?: unknown }).neverSent === true
  );
}

/**
 * The payment threw after, or possibly after, it reached the network. It carries the state
 * the caller has to use next: the record already says the period is being paid and the
 * agent's budget has already moved.
 */
export class PaymentFailedError extends Error {
  /**
   * A marker on the object, not a class check. Something upstream will eventually wrap this
   * call, and a wrapper that throws a different error makes a class check fail silently. The
   * caller then keeps the old state and the same period is paid again.
   */
  readonly paymentFailure = true as const;
  readonly stateAfterSend: ExecuteState;
  constructor(message: string, stateAfterSend: ExecuteState, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PaymentFailedError";
    this.stateAfterSend = stateAfterSend;
  }
}

const MAX_CAUSE_DEPTH = 8;

function looksLikeExecuteState(value: unknown): value is ExecuteState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<ExecuteState>;
  return typeof s.killed === "boolean" && typeof s.ledger === "object" && s.ledger !== null;
}

export function asPaymentFailure(err: unknown): { stateAfterSend: ExecuteState } | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && current !== null && current !== undefined; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "object") {
      const c = current as { paymentFailure?: unknown; stateAfterSend?: unknown; cause?: unknown };
      if (c.paymentFailure === true && looksLikeExecuteState(c.stateAfterSend)) {
        return { stateAfterSend: c.stateAfterSend };
      }
      current = c.cause;
      continue;
    }
    break;
  }
  return null;
}

function notPaid(reason: string, state: ExecuteState): ExecuteResult {
  return { paid: false, reason, amountPaidUsd8: 0n, txHash: null, state };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function payCharge(
  charge: DueCharge,
  registry: ScopeRegistry,
  timing: PaymentTiming,
  state: ExecuteState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.now();

  // 1. The stop switch.
  if (state.killed) {
    return notPaid("The stop switch is on, so nothing at all is paid.", state);
  }

  // 2. Already dealt with, in either sense. Being paid counts as much as paid.
  const existing = entryFor(state.ledger, charge.subscriptionId, charge.periodIndex);
  if (existing !== undefined) {
    return notPaid(
      existing.status === "PAID"
        ? `Period ${charge.periodIndex} of "${charge.subscriptionId}" was already paid, with ` +
          `transaction ${existing.txHash}. Nothing is paid twice.`
        : `Period ${charge.periodIndex} of "${charge.subscriptionId}" was started at second ` +
          `${existing.startedAt} and has not been proven finished. Holding off until somebody ` +
          "has looked, because trying again risks paying twice.",
      state,
    );
  }

  // 3. Inside the scope of the agent that claims it. This is the whole separation between
  // the agents sharing this wallet.
  let scope;
  try {
    scope = assertWithinScope(registry, {
      agentId: charge.agentId,
      payee: charge.payee,
      amountUsd8: charge.amountUsd8,
      call: charge.call,
    });
  } catch (err) {
    if (err instanceof ScopeViolationError) return notPaid(err.message, state);
    throw err;
  }

  // 4. The agent's OWN daily budget. The day is rolled over here so the check uses a
  // refreshed budget.
  const budget = budgetFor(state, charge.agentId, now);
  const dayElapsed = now - budget.dayStartedAt >= SECONDS_PER_DAY;
  const effectiveSpentToday = dayElapsed ? 0n : budget.spentTodayUsd8;
  const remainingToday = scope.maxPerDayUsd8 - effectiveSpentToday;
  if (charge.amountUsd8 > remainingToday) {
    return notPaid(
      `"${charge.agentId}" has ${remainingToday} left of its own ${scope.maxPerDayUsd8} for ` +
        `today and this payment is ${charge.amountUsd8}. Nothing is paid until the day rolls ` +
        "over. Another agent on this wallet having room makes no difference.",
      state,
    );
  }

  // 5. Enough time since this agent's last payment.
  const sinceLast = now - budget.lastPaymentAt;
  if (sinceLast < timing.minIntervalSeconds) {
    return notPaid(
      `Only ${sinceLast} seconds have passed since "${charge.agentId}" last paid and at least ` +
        `${timing.minIntervalSeconds} have to pass.`,
      state,
    );
  }

  // 6. The key still works, checked HERE rather than only when the agent started.
  try {
    assertNotExpired(
      deps.sessionPermissions,
      now,
      deps.expirySafetyMarginSeconds ?? EXPIRY_SAFETY_MARGIN_SECONDS,
    );
  } catch (err) {
    return notPaid(messageOf(err), state);
  }

  // 7. Record and budget move before the payment goes out.
  const stateAfterSend: ExecuteState = {
    killed: state.killed,
    agents: {
      ...state.agents,
      [charge.agentId]: {
        spentTodayUsd8: effectiveSpentToday + charge.amountUsd8,
        dayStartedAt: dayElapsed ? now : budget.dayStartedAt,
        lastPaymentAt: now,
      },
    },
    ledger: markInFlight(state.ledger, {
      subscriptionId: charge.subscriptionId,
      periodIndex: charge.periodIndex,
      amountUsd8: charge.amountUsd8,
      agentId: charge.agentId,
      startedAt: now,
    }),
  };

  if (deps.persistBeforeSend) {
    try {
      await deps.persistBeforeSend(stateAfterSend);
    } catch (err) {
      throw new NeverSentError(
        "The record of this payment could not be saved first, so nothing was paid. Paying with " +
          "no record that could hold back a second payment is worse than one late bill. " +
          `The underlying problem: ${messageOf(err)}`,
        { cause: err },
      );
    }
  }

  let txHash: `0x${string}`;
  try {
    txHash = await deps.pay(charge);
  } catch (err) {
    if (wasNeverSent(err)) throw err;
    throw new PaymentFailedError(
      `Paying period ${charge.periodIndex} of "${charge.subscriptionId}" failed after it may ` +
        "have reached the network. The budget has moved and the period is recorded as being " +
        `paid. The underlying problem: ${messageOf(err)}`,
      stateAfterSend,
      { cause: err },
    );
  }

  return {
    paid: true,
    reason: `Paid ${charge.amountUsd8} to ${charge.payee} for period ${charge.periodIndex} of "${charge.subscriptionId}".`,
    amountPaidUsd8: charge.amountUsd8,
    txHash,
    state: {
      ...stateAfterSend,
      ledger: markPaid(stateAfterSend.ledger, charge.subscriptionId, charge.periodIndex, txHash),
    },
  };
}
