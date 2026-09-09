/**
 * Paying a bill, inside limits, with nobody approving each payment one at a time.
 *
 * That last part is the whole product and also the whole danger. A person approving each
 * payment is a check that catches almost everything; taking it away means every other check
 * has to be written down and tested, because there is nothing else left.
 *
 * The limited key already caps spending on the blockchain, in a place this repo cannot
 * reach. The limits here are the second layer and the stop switch is the owner's way out.
 * The point of two layers is that a mistake in one is not a mistake in both.
 *
 * This module never touches the network. The clock and the paying function are handed in,
 * so every rule below can be tested with no network at all.
 *
 * ## The rules, in the order they are applied
 *
 *  1. The stop switch is on -> pay nothing. First, absolute, beats everything.
 *  2. A payment has not been proven finished -> pay nothing. See below.
 *  3. The bill is empty -> there is nothing to pay. Nothing used means no payment, not a
 *     payment of zero and not a minimum charge.
 *  4. The bill covers a stretch of time already paid for -> pay nothing.
 *  5. The bill is larger than one payment is allowed to be -> pay NOTHING and say so.
 *  6. The bill is larger than what is left of today -> pay NOTHING and say so.
 *  7. Not enough time since the last payment -> pay nothing.
 *  8. The key has run out or is about to -> pay nothing.
 *  9. Budget, watermark, clock mark and the in flight record are all written BEFORE the
 *     payment goes out, and saved first when a save function was handed in.
 *
 * ## Why rules 5 and 6 refuse instead of paying what they can
 *
 * Fugu Pilot cuts an oversized trade down to the limit, because half a trade is still a
 * sensible trade. A bill is not like that. Paying part of a bill leaves the rest owed, and
 * the next cycle sees a bill for the remainder plus whatever was used since, so the shortfall
 * follows the account around and nobody ever decided to let it. A bill that does not fit
 * inside the limits is a thing a person should look at, and this agent says so and stops.
 *
 * ## Why a failed payment still spends the budget
 *
 * The lesson Fugu Guardian paid for, and it applies here in full because this agent pays
 * over and over. Waiting for a result can time out after the transaction already landed. If
 * the budget does not move on a failure, the next cycle sees the same bill unpaid and pays
 * it again. So: budget, watermark and an in flight record are all assembled before the
 * payment goes out; if the payment throws, the error CARRIES that state; and while the in
 * flight record is unresolved, rule 2 refuses everything. The one exception is an error
 * marked as never having reached the network. An unmarked error is always treated as "this
 * may already have gone out", which is expensive in the safe direction rather than cheap in
 * the dangerous one.
 */
import { assertNotExpired, EXPIRY_SAFETY_MARGIN_SECONDS, type SessionPermissions } from "./session.js";
import type { Invoice } from "./types.js";

const SECONDS_PER_DAY = 86_400;

export interface PaymentLimits {
  /** The most that may go out in one payment, on the 8 decimal dollar basis. */
  readonly maxPerPaymentUsd8: bigint;
  /** The most that may go out in one rolling day. */
  readonly maxPerDayUsd8: bigint;
  /** The least time between one payment and the next, in seconds. */
  readonly minIntervalSeconds: number;
}

/** A payment that was started and has not been proven finished. */
export interface PendingPayment {
  readonly amountUsd8: bigint;
  readonly windowFromSeconds: number;
  readonly windowToSeconds: number;
  readonly startedAt: number;
  readonly txHash: `0x${string}` | null;
}

export interface ExecuteState {
  readonly spentTodayUsd8: bigint;
  readonly dayStartedAt: number;
  /** The second of the last payment that went out. Zero means never. */
  readonly lastPaymentAt: number;
  readonly killed: boolean;
  readonly pendingPayment: PendingPayment | null;
  /**
   * Everything up to this second has been billed already.
   *
   * This is the mark that survives a restart. Without it a process that comes back up would
   * count the same seconds again and pay for them a second time, and nothing else in this
   * module would notice, because the second bill is a perfectly valid bill.
   */
  readonly billedThroughSeconds: number;
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
  readonly pay: (amountUsd8: bigint, invoice: Invoice) => Promise<`0x${string}`>;
  /** The clock in seconds. Handed in so tests control time exactly. */
  readonly now: () => number;
  /** The permissions of the key that will sign, checked again right before paying. */
  readonly sessionPermissions: SessionPermissions;
  readonly expirySafetyMarginSeconds?: number;
  /**
   * Saves the state BEFORE the payment goes out, including the in flight record and the
   * mark of what has been billed.
   *
   * IT FAILS CLOSED. If saving fails, nothing is paid, and the error says it never reached
   * the network. Not paying is one missed cycle. Paying with no record that could hold back
   * a second payment is somebody's money gone.
   */
  readonly persistBeforeSend?: (state: ExecuteState) => Promise<void> | void;
}

/** A clean starting state. `billedThroughSeconds` starts where the meter starts counting. */
export function initialExecuteState(nowSeconds: number): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: nowSeconds,
    lastPaymentAt: 0,
    killed: false,
    pendingPayment: null,
    billedThroughSeconds: nowSeconds,
  };
}

export class NeverSentError extends Error {
  readonly neverSent = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NeverSentError";
  }
}

/**
 * Does this error say it never reached the network? False unless it says so. An error that
 * says nothing is treated as "this may already have gone out", and which way that default
 * points is the whole question of whether the agent pays twice.
 */
export function wasNeverSent(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { neverSent?: unknown }).neverSent === true
  );
}

/**
 * The payment threw after, or possibly after, it reached the network. It carries the state
 * the caller has to use next: the budget is already spent, the mark is already moved and the
 * in flight record is already written.
 */
export class PaymentFailedError extends Error {
  /**
   * A marker on the object, not a class check, and deliberately so. Something upstream will
   * eventually wrap this call for logging or retries, and a wrapper that throws a different
   * error makes a class check fail silently. The caller then keeps the old state, the budget
   * does not move, and the double payment bug is back with no test complaining.
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
  return typeof s.spentTodayUsd8 === "bigint" && typeof s.billedThroughSeconds === "number";
}

/** Finds a failure after paying inside an error or anywhere in its chain of causes. */
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

/**
 * A person says "I looked at the blockchain, that payment does not exist". Explicit and
 * deliberately not automatic: a timer that clears an in flight record is a timer that
 * eventually pays twice.
 */
export function clearPendingPayment(state: ExecuteState): ExecuteState {
  return { ...state, pendingPayment: null };
}

function notPaid(reason: string, state: ExecuteState): ExecuteResult {
  return { paid: false, reason, amountPaidUsd8: 0n, txHash: null, state };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function payInvoice(
  invoice: Invoice,
  limits: PaymentLimits,
  state: ExecuteState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.now();

  // 1. The stop switch.
  if (state.killed) {
    return notPaid("The stop switch is on, so nothing at all is paid.", state);
  }

  // 2. A payment that has not been proven finished blocks every new one.
  if (state.pendingPayment != null) {
    const p = state.pendingPayment;
    return notPaid(
      `A payment of ${p.amountUsd8} for the time from ${p.windowFromSeconds} to ` +
        `${p.windowToSeconds}, started at second ${p.startedAt}, has not been proven finished ` +
        `(transaction ${p.txHash ?? "not known"}). Holding off until the blockchain shows it ` +
        "done, because paying again risks paying twice.",
      state,
    );
  }

  // 3. Nothing was used.
  if (invoice.empty || invoice.totalUsd8 <= 0n) {
    return notPaid(
      "Nothing was used in this stretch of time, so there is nothing to pay. This agent does " +
        "not pay for something that did not happen.",
      state,
    );
  }

  // 4. This stretch of time has already been billed.
  if (invoice.window.toSeconds <= state.billedThroughSeconds) {
    return notPaid(
      `The time up to second ${state.billedThroughSeconds} has already been paid for, and this ` +
        `bill only covers up to ${invoice.window.toSeconds}. Nothing is paid twice.`,
      state,
    );
  }
  if (invoice.window.fromSeconds < state.billedThroughSeconds) {
    return notPaid(
      `This bill starts at second ${invoice.window.fromSeconds}, which is inside the time up to ` +
        `${state.billedThroughSeconds} that has already been paid for. An overlapping bill is ` +
        "refused rather than partly paid, because working out which part is new is guesswork.",
      state,
    );
  }

  // 5. One payment is too large. Refused rather than trimmed. See the note at the top.
  if (invoice.totalUsd8 > limits.maxPerPaymentUsd8) {
    return notPaid(
      `This bill comes to ${invoice.totalUsd8} and one payment is allowed to be at most ` +
        `${limits.maxPerPaymentUsd8}. Paying part of it would leave the rest owed and nobody ` +
        "decided that, so nothing is paid and a person should look at it.",
      state,
    );
  }

  // 6. Today is too small for it. The day is rolled over here so the check uses a refreshed
  // budget.
  const dayElapsed = now - state.dayStartedAt >= SECONDS_PER_DAY;
  const effectiveSpentToday = dayElapsed ? 0n : state.spentTodayUsd8;
  const remainingToday = limits.maxPerDayUsd8 - effectiveSpentToday;
  if (invoice.totalUsd8 > remainingToday) {
    return notPaid(
      `This bill comes to ${invoice.totalUsd8} and only ${remainingToday} is left of today's ` +
        `${limits.maxPerDayUsd8}. Nothing is paid until the day rolls over.`,
      state,
    );
  }

  // 7. Enough time since the last payment.
  const sinceLast = now - state.lastPaymentAt;
  if (sinceLast < limits.minIntervalSeconds) {
    return notPaid(
      `Only ${sinceLast} seconds have passed since the last payment and at least ` +
        `${limits.minIntervalSeconds} have to pass.`,
      state,
    );
  }

  // 8. The key still works, checked HERE rather than only when the agent started. A cycle
  // that began while the key was fine can reach this line after it stopped working, and
  // this is the last moment where that can be caught for free.
  try {
    assertNotExpired(
      deps.sessionPermissions,
      now,
      deps.expirySafetyMarginSeconds ?? EXPIRY_SAFETY_MARGIN_SECONDS,
    );
  } catch (err) {
    return notPaid(messageOf(err), state);
  }

  // 9. Budget, mark, clock mark and in flight record are all written before the payment.
  const amount = invoice.totalUsd8;
  const stateAfterSend: ExecuteState = {
    spentTodayUsd8: effectiveSpentToday + amount,
    dayStartedAt: dayElapsed ? now : state.dayStartedAt,
    lastPaymentAt: now,
    killed: state.killed,
    pendingPayment: {
      amountUsd8: amount,
      windowFromSeconds: invoice.window.fromSeconds,
      windowToSeconds: invoice.window.toSeconds,
      startedAt: now,
      txHash: null,
    },
    // Moved before the payment on purpose. If the process dies here, the seconds this bill
    // covers are already marked as billed, so the next start cannot count them again.
    billedThroughSeconds: invoice.window.toSeconds,
  };

  if (deps.persistBeforeSend) {
    try {
      await deps.persistBeforeSend(stateAfterSend);
    } catch (err) {
      throw new NeverSentError(
        "The record of this payment could not be saved first, so nothing was paid. Paying with " +
          "no record that could hold back a second payment is worse than missing one cycle. " +
          `The underlying problem: ${messageOf(err)}`,
        { cause: err },
      );
    }
  }

  let txHash: `0x${string}`;
  try {
    txHash = await deps.pay(amount, invoice);
  } catch (err) {
    if (wasNeverSent(err)) throw err;
    throw new PaymentFailedError(
      "The payment failed after it may have reached the network. The budget and the mark of " +
        "what has been billed are still moved, and the payment is recorded as in flight. " +
        `The underlying problem: ${messageOf(err)}`,
      stateAfterSend,
      { cause: err },
    );
  }

  return {
    paid: true,
    reason: `Paid ${amount} for the time from ${invoice.window.fromSeconds} to ${invoice.window.toSeconds}.`,
    amountPaidUsd8: amount,
    txHash,
    state: { ...stateAfterSend, pendingPayment: null },
  };
}
