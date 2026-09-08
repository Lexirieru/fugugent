/**
 * Bounded execution: the second line of defense before a repay transaction goes out
 * through an Altana session key. The session key caps spending on the chain side, but the
 * safety of a user's money must not rest on one layer alone — the limits in this module
 * are the second layer, and the kill switch is the user's way out.
 *
 * This module itself is I/O-free: the current time, the asset address, and sending the
 * transaction are all injected through `deps`, so every rule can be tested without
 * touching the network at all and without a single chain address embedded here.
 *
 * The seven rules below are enforced BEFORE a transaction is sent, in exactly this order:
 *   1. `state.killed` -> never send anything. Absolute, checked first, beats everything.
 *   2. `state.pendingRepay` not yet reconciled -> send nothing.
 *      See "Why a failed send DEDUCTS the budget" below.
 *   3. A `NONE`/`WARN` action -> do not send (it needs no execution).
 *   4. The amount exceeds `maxPerActionUsd8` -> capped to that limit, not rejected;
 *      recorded via `cappedPerAction`.
 *   5. The amount exceeds what is left of `maxPerDayUsd8` -> capped to the remainder via
 *      `cappedPerDay`; when the remainder is zero, do not send.
 *   6. Still inside `minIntervalSeconds` since `lastActionAt` -> do not send (cooldown).
 *   7. The budget, the cooldown, and the `pendingRepay` record are all written BEFORE
 *      `sendRepay` is called — and, when `deps.persistBeforeSend` is provided, SAVED first
 *      as well, so a process that dies while waiting for a receipt still leaves a trace.
 *      `pendingRepay` is cleared only when `sendRepay` actually returns a hash.
 *
 * ## Why a failed send DEDUCTS the budget
 *
 * Until the previous round this module only changed state AFTER `sendRepay` succeeded, and
 * `guard.ts` returned the old state as soon as `sendRepay` threw. For a pure function that
 * is correct; for a NETWORK SEND it is backwards. A `waitForTransactionReceipt` that times
 * out, an RPC that drops, or a receipt coming from a stale node all throw AFTER the
 * transaction landed in a block. Under the old rule, the daily budget and `lastActionAt`
 * did not move, the next cycle saw a position that was (possibly) still at risk, and the
 * agent paid AGAIN — over and over until the session cap ran out. Every one of those
 * payments is real money.
 *
 * The correct rule for a network send: **"failed" does not mean "did not happen".** So:
 *
 *   - The budget, `lastActionAt`, and a `pendingRepay` record are all assembled BEFORE
 *     `sendRepay` is called.
 *   - If `sendRepay` throws, this module throws a `RepaySendError` that CARRIES that state
 *     (`stateAfterSend`), so the caller passes it into the next cycle instead of
 *     pretending nothing happened.
 *   - While `pendingRepay` is unresolved, rule 2 refuses to send anything. Guardian
 *     chooses silence over paying twice.
 *
 * The only exception is an error that CERTAINLY has not touched the network
 * (`NeverSentError`): asset/amount validation and on-chain reads that fail before the
 * batch goes out. What marks it is `chain/session.ts`, the only module that knows exactly
 * where the network boundary is. An error that is NOT marked is always treated as "may
 * already have been sent" — an expensive assumption in the safe direction, rather than in
 * the direction that pays twice.
 */
import type { Action, Decision, Position } from "./types.js";

const SECONDS_PER_DAY = 86_400;

/** Actions that by definition require a payment (see decide.ts). */
const ACTIONS_REQUIRING_REPAY: ReadonlySet<Action> = new Set([
  "PARTIAL_REPAY",
  "DELEVERAGE",
  "EMERGENCY",
]);

export interface ExecuteLimits {
  /** The dollar cap (8-decimal basis, same as Position.collateralBase) per single action. */
  maxPerActionUsd8: bigint;
  /** The total dollar cap that may be spent within one rolling day. */
  maxPerDayUsd8: bigint;
  /** The minimum gap in seconds since the last action before the next one may be sent. */
  minIntervalSeconds: number;
}

export interface ExecuteDeps {
  /**
   * The address of the debt token being repaid. INJECTED, no longer a module constant:
   * this module is pure and must not be tied to one asset on one chain. Its testnet address
   * lives in `chain/testnet.ts` alongside the other chain addresses.
   */
  repayAsset: `0x${string}`;
  /** Sends the real repay transaction; injected so this module never touches the network. */
  sendRepay: (asset: `0x${string}`, amount: bigint) => Promise<`0x${string}`>;
  /** The current clock in epoch seconds; injected so time is fully controllable in tests. */
  now: () => number;
  /**
   * Persists state BEFORE `sendRepay` is called — including its `pendingRepay` record.
   *
   * Without this hook, the pending record only reaches disk after the cycle finishes,
   * while `waitForTransactionReceipt` waits up to 180 seconds. A process that dies inside
   * that 180-second window leaves behind a PRE-CYCLE state file: the old budget, the old
   * `lastActionAt`, `pendingRepay: null` — and the next restart pays again. That is bug C2
   * through a narrower door, and this hook closes it.
   *
   * FAILS CLOSED: if persisting fails, the transaction is NOT sent at all and the error is
   * marked `neverSent` — better not to pay than to pay with no trace that could hold back a
   * second payment.
   *
   * The window that remains, stated openly: the process can die after persisting succeeds
   * but before the network call departs. What is left behind is a pending record for a
   * transaction that never existed — Guardian holds off until an operator calls
   * `clearPendingRepay`. That failure direction is deliberate.
   */
  persistBeforeSend?: (state: ExecuteState) => Promise<void> | void;
}

/**
 * The record of one repay that has been attempted but not yet proven complete.
 * While this is not null, `executeDecision` refuses to send anything.
 */
export interface PendingRepay {
  readonly asset: `0x${string}`;
  /** The amount attempted, on the 8-decimal basis. */
  readonly amountUsd8: bigint;
  /** The epoch second at which `sendRepay` was called. */
  readonly startedAt: number;
  /** The hash if it became known; null when the failure happened before any hash existed. */
  readonly txHash: `0x${string}` | null;
  /** `debtBase` immediately before sending — the reconciliation anchor (see `reconcilePendingRepay`). */
  readonly debtBaseBeforeSend: bigint;
  /** The position's block immediately before sending — the second anchor. */
  readonly blockNumberBeforeSend: bigint;
}

export interface ExecuteState {
  /** The total spent since `dayStartedAt`, on the 8-decimal basis. */
  spentTodayUsd8: bigint;
  /** The epoch second at which the current budget day started. */
  dayStartedAt: number;
  /** The epoch second of the last successfully sent action; 0 means never. */
  lastActionAt: number;
  /** The user's kill switch. While true, no action whatsoever may be sent. */
  killed: boolean;
  /**
   * A repay that has been attempted but not yet proven to have landed. null means nothing
   * is pending and Guardian is free to act.
   */
  pendingRepay: PendingRepay | null;
}

export interface ExecuteResult {
  sent: boolean;
  /** A short explanation of why it was or was not sent. */
  reason: string;
  /** The amount actually sent, on the 8-decimal basis. 0n when nothing was sent. */
  amountSentUsd8: bigint;
  /** true when the amount was capped by the per-action limit. */
  cappedPerAction: boolean;
  /** true when the amount was capped by what is left of the daily budget. */
  cappedPerDay: boolean;
  /** The transaction hash when sent, null when not. */
  txHash: `0x${string}` | null;
  /** The new state the caller must persist — this module never mutates the `state` it was given. */
  state: ExecuteState;
}

/**
 * An error GUARANTEED to have happened before anything touched the network, so it is safe
 * to treat as "did not happen": no budget is deducted and no `pendingRepay` is left behind.
 *
 * The only thing allowed to mark an error like this is the module that knows exactly where
 * the network boundary lies — `chain/session.ts`. It is marked via a property
 * (`neverSent`), not `instanceof`, so errors belonging to other modules
 * (e.g. `SessionPermissionError`) can declare it too without inheriting a class from here.
 */
export class NeverSentError extends Error {
  readonly neverSent = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NeverSentError";
  }
}

/**
 * Does `err` declare that it never touched the network at all?
 * The default is ALWAYS false: an error that declares nothing is treated as "may already
 * have been sent". The direction of this assumption is what decides whether the agent pays
 * twice.
 */
export function wasNeverSent(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { neverSent?: unknown }).neverSent === true
  );
}

/**
 * `sendRepay` threw after — or possibly after — the transaction touched the network. It
 * carries the state the caller MUST use for the next cycle: the budget is already deducted
 * and `pendingRepay` is already recorded.
 */
export class RepaySendError extends Error {
  /**
   * A duck-typed marker, deliberately the same shape as `neverSent`.
   *
   * `guard.ts` recognizes this error via `asRepaySendFailure()`, NOT `instanceof`. The
   * reason is not stylistic: the backend will wrap `executeDecision` (telemetry, retry,
   * tracing), and a wrapper that rethrows a different error — or two copies of this module
   * in the dependency tree — would make `instanceof` fail SILENTLY. What happens next is
   * that `guard.ts` falls into the "old state" branch, the budget does not move, and bug C2
   * comes back without a single test shouting.
   */
  readonly repaySendFailure = true as const;
  readonly stateAfterSend: ExecuteState;
  constructor(message: string, stateAfterSend: ExecuteState, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepaySendError";
    this.stateAfterSend = stateAfterSend;
  }
}

/** The maximum depth to walk the `cause` chain — reasonable wrappers do not nest this deep. */
const MAX_CAUSE_DEPTH = 8;

function looksLikeExecuteState(value: unknown): value is ExecuteState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<ExecuteState>;
  return typeof s.spentTodayUsd8 === "bigint" && typeof s.lastActionAt === "number";
}

/**
 * Finds a failure-after-send inside `err` OR inside its `cause` chain, and returns the
 * state the next cycle must use.
 *
 * The `cause` chain is walked because a correct wrapper (`new Error(msg, { cause })`) is
 * the most natural way for the backend to add context — and losing `stateAfterSend` there
 * means paying twice. `null` means "this is not a failure after send", and the caller must
 * treat the old state as the one in force.
 */
export function asRepaySendFailure(err: unknown): { stateAfterSend: ExecuteState } | null {
  const terlihat = new Set<unknown>();
  let current: unknown = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && current !== null && current !== undefined; i++) {
    if (terlihat.has(current)) break;
    terlihat.add(current);
    if (typeof current === "object") {
      const c = current as { repaySendFailure?: unknown; stateAfterSend?: unknown; cause?: unknown };
      if (c.repaySendFailure === true && looksLikeExecuteState(c.stateAfterSend)) {
        return { stateAfterSend: c.stateAfterSend };
      }
      current = c.cause;
      continue;
    }
    break;
  }
  return null;
}

function notSent(reason: string, state: ExecuteState): ExecuteResult {
  return {
    sent: false,
    reason,
    amountSentUsd8: 0n,
    cappedPerAction: false,
    cappedPerDay: false,
    txHash: null,
    state,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The amount-matching tolerance used during reconciliation, in USD on the 8-decimal basis.
 *
 * 2 units = $0.00000002. The number is not slack, it is the consequence of two independent
 * roundings DOWN: USD8 -> token units when sending, and token units -> USD8 when the pool
 * values the debt. Each loses less than one unit. This is the same tolerance the E2E script
 * uses to match the claimed amount against the on-chain debt delta, and there the real
 * difference measured **0**.
 */
export const RECONCILE_TOLERANCE_USD8 = 2n;

/**
 * Clears `pendingRepay` when the LATEST position proves its repay landed.
 *
 * Both pieces of proof are required, and both are read from the chain, not from intent:
 *   1. the position was read at a block newer than the block before sending, and
 *   2. the debt fell **by exactly what we paid** — not merely fell.
 *
 * The second condition is deliberately strict. "The debt fell" alone is not proof that OUR
 * transaction landed: the user can pay from their own wallet while our tx is stuck in the
 * mempool, a third party can partially liquidate, and `debtBase` is a USD value so a drop
 * in the debt asset's price shrinks it too. All three would clear our record too early,
 * free Guardian to act, and then the first tx lands — two payments, exactly the failure
 * this mechanism exists to prevent.
 *
 * The match is TWO-SIDED (`|delta - amountUsd8| <= RECONCILE_TOLERANCE_USD8`), and the
 * upper side is deliberate too: a drop LARGER than what we paid means someone else paid
 * into the same position, and at that point we can no longer separate "ours landed as
 * well" from "only theirs did". The failure direction is safe — the record stays pending,
 * Guardian holds off, and an operator clears it via `clearPendingRepay` after looking at
 * the chain.
 *
 * If the debt has not fallen, `pendingRepay` is deliberately LEFT ALONE. A transaction
 * still in the mempool can land at any moment, so "not seen yet" never means "will not
 * happen", and clearing it out of impatience brings back exactly the bug this rule exists
 * to prevent.
 *
 * The consequence, stated openly: a repay that truly NEVER lands makes Guardian stop
 * acting until an operator clears it (`clearPendingRepay`). A silent Guardian is a visible
 * failure; an agent that pays twice is an invisible failure until the money is gone.
 *
 * A budget already deducted is NEVER refunded here — if the transaction did land after
 * all, that refund would open the very same double-pay path.
 */
export function reconcilePendingRepay(state: ExecuteState, pos: Position): ExecuteState {
  const pending = state.pendingRepay;
  // `== null`, not `=== null`: state can come from an older store version that does not
  // have this field at all, and an `undefined` here must not make reconciliation throw.
  if (pending == null) return state;
  if (pos.blockNumber <= pending.blockNumberBeforeSend) return state;
  const turun = pending.debtBaseBeforeSend - pos.debtBase;
  const beda = turun > pending.amountUsd8 ? turun - pending.amountUsd8 : pending.amountUsd8 - turun;
  if (beda > RECONCILE_TOLERANCE_USD8) return state;
  return { ...state, pendingRepay: null };
}

/**
 * The operator's way out for a `pendingRepay` that can never be proven to have landed.
 * Deliberately explicit and deliberately NOT automatic: it states a human decision ("I
 * have checked the chain, that transaction does not exist"), not a timeout.
 */
export function clearPendingRepay(state: ExecuteState): ExecuteState {
  return { ...state, pendingRepay: null };
}

export async function executeDecision(
  d: Decision,
  pos: Position,
  limits: ExecuteLimits,
  inputState: ExecuteState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.now();

  // 0. Reconcile first: if the chain already proves the previous repay landed, its pending
  // record is cleared before any rule is read.
  const state = reconcilePendingRepay(inputState, pos);

  // 1. The absolute kill switch — checked first, beats everything.
  if (state.killed) {
    return notSent("Kill switch aktif: eksekusi dihentikan total.", state);
  }

  // 2. A repay not yet proven complete blocks ALL new sends.
  if (state.pendingRepay != null) {
    const p = state.pendingRepay;
    return notSent(
      `Ada repay yang belum terbukti selesai (${p.amountUsd8} basis 8 desimal, dicoba pada ` +
        `${p.startedAt}, tx ${p.txHash ?? "tidak diketahui"}). Menahan diri sampai rantai ` +
        "menunjukkan hutang berkurang — mengirim ulang berisiko membayar dua kali.",
      state,
    );
  }

  // 3. An action that needs no payment never sends.
  if (!ACTIONS_REQUIRING_REPAY.has(d.action)) {
    return notSent(`Aksi ${d.action} tidak memerlukan eksekusi transaksi.`, state);
  }

  let amount = d.suggestedRepayBase;
  let cappedPerAction = false;
  let cappedPerDay = false;

  // 4. Cap to the per-action limit, do not reject.
  if (amount > limits.maxPerActionUsd8) {
    amount = limits.maxPerActionUsd8;
    cappedPerAction = true;
  }

  // 5. Cap to what is left of the daily budget. The daily reset is evaluated here so the
  // limit check uses an already-refreshed budget.
  const dayElapsed = now - state.dayStartedAt >= SECONDS_PER_DAY;
  const effectiveSpentToday = dayElapsed ? 0n : state.spentTodayUsd8;
  const remainingToday = limits.maxPerDayUsd8 - effectiveSpentToday;

  if (remainingToday <= 0n) {
    return notSent("Sisa anggaran harian nol: eksekusi ditahan sampai hari berikutnya.", state);
  }
  if (amount > remainingToday) {
    amount = remainingToday;
    cappedPerDay = true;
  }

  if (amount <= 0n) {
    return notSent("Tidak ada jumlah tersisa untuk dieksekusi setelah pemotongan.", state);
  }

  // 6. Cooldown since the last action.
  const sinceLastAction = now - state.lastActionAt;
  if (sinceLastAction < limits.minIntervalSeconds) {
    return notSent(
      `Masih dalam cooldown: ${sinceLastAction}s sejak aksi terakhir, ` +
        `minimal ${limits.minIntervalSeconds}s.`,
      state,
    );
  }

  // 7. The budget, the cooldown, and the pending record are assembled BEFORE sending.
  // This is the core of the C2 fix: the moment `sendRepay` is called, the money must be
  // treated as already moved until the chain proves otherwise.
  const stateAfterSend: ExecuteState = {
    spentTodayUsd8: effectiveSpentToday + amount,
    dayStartedAt: dayElapsed ? now : state.dayStartedAt,
    lastActionAt: now,
    killed: state.killed,
    pendingRepay: {
      asset: deps.repayAsset,
      amountUsd8: amount,
      startedAt: now,
      txHash: null,
      debtBaseBeforeSend: pos.debtBase,
      blockNumberBeforeSend: pos.blockNumber,
    },
  };

  if (deps.persistBeforeSend) {
    try {
      await deps.persistBeforeSend(stateAfterSend);
    } catch (err) {
      // FAIL CLOSED. Sending with no trace that could hold back a second payment is worse
      // than not sending at all: the first ends with the user's money paid twice, the second
      // with one missed cycle. Marked `neverSent` because nothing has in fact been sent.
      throw new NeverSentError(
        `Catatan repay menggantung gagal disimpan sebelum kirim; menolak mengirim apa pun. ` +
          `Galat asli: ${messageOf(err)}`,
        { cause: err },
      );
    }
  }

  let txHash: `0x${string}`;
  try {
    txHash = await deps.sendRepay(deps.repayAsset, amount);
  } catch (err) {
    if (wasNeverSent(err)) {
      // The only path on which "failed" really does mean "did not happen": the sending
      // module declares for itself that the network was never touched.
      throw err;
    }
    throw new RepaySendError(
      `Pengiriman repay gagal SETELAH mungkin menyentuh jaringan; anggaran dan cooldown ` +
        `tetap dipotong dan repay dicatat menggantung. Galat asli: ${messageOf(err)}`,
      stateAfterSend,
      { cause: err },
    );
  }

  // A hash in hand means the relay has confirmed inclusion (the sender is the one that
  // waits for the receipt), so nothing is pending any more.
  const newState: ExecuteState = { ...stateAfterSend, pendingRepay: null };

  return {
    sent: true,
    reason: `Terkirim untuk posisi ${pos.account}.`,
    amountSentUsd8: amount,
    cappedPerAction,
    cappedPerDay,
    txHash,
    state: newState,
  };
}
