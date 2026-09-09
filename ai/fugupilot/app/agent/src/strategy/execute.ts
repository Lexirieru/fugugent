/**
 * Bounded execution: the last thing between a plan and money leaving the wallet.
 *
 * The limited key already caps what can be spent, on the blockchain, in a place this repo
 * cannot reach. The limits in this file are the second layer, and the stop switch is the
 * owner's way out. Neither layer is enough alone; the point of having two is that a mistake
 * in one is not a mistake in both.
 *
 * This module never touches the network. The clock and the sending function are both handed
 * in, so every rule below can be tested with no network at all.
 *
 * ## The rules, in the order they are applied
 *
 *  1. The stop switch is on -> send nothing. Absolute, checked first, beats everything.
 *  2. A previous send has not been proven finished -> send nothing. See the section below.
 *  3. The plan is empty -> there is nothing to send.
 *  4. The step is worth more than the per step limit -> cut down to the limit, not refused.
 *  5. The step is worth more than what is left of today's limit -> cut down to what is left;
 *     when nothing is left, send nothing.
 *  6. Not enough time has passed since the last send -> send nothing.
 *  7. The key has run out or is about to -> send nothing.
 *  8. The budget, the clock mark and the record of "a send is in flight" are all written
 *     BEFORE the send goes out, and saved first when a save function was handed in.
 *
 * ## Why a failed send still spends the budget
 *
 * This is the expensive lesson Fugu Guardian paid for, and it applies here in full because
 * this agent sends over and over.
 *
 * The tempting rule is: only count the money once the send succeeded. For a calculation
 * that is right. For a send over a network it is backwards. Waiting for the result can time
 * out after the transaction already landed in a block. An RPC can drop the connection. A
 * stale node can answer as if nothing happened. Under the tempting rule the daily budget
 * does not move, the clock mark does not move, the next cycle sees the same job still
 * undone, and the agent does it again. And again. Every one of those is real money.
 *
 * So the rule here is: **failed does not mean it did not happen.**
 *
 *   - budget, clock mark and an in flight record are all assembled before the send.
 *   - if the send throws, this module throws a `SendFailedError` that CARRIES that state,
 *     so the caller passes it into the next cycle instead of pretending nothing happened.
 *   - while that in flight record is unresolved, rule 2 refuses everything. Silence is
 *     chosen over paying twice.
 *
 * The single exception is an error that certainly never reached the network. Those are
 * marked `neverSent` by the module that knows where the network boundary is. An error that
 * is not marked is always treated as "this may already have gone out". That assumption is
 * expensive in the safe direction rather than cheap in the dangerous one.
 */
import type { PilotPlan, PlannedAction } from "./types.js";
import { assertNotExpired, EXPIRY_SAFETY_MARGIN_SECONDS, type SessionPermissions } from "./session.js";

const SECONDS_PER_DAY = 86_400;

export interface ExecuteLimits {
  /** The most that may be sent in one step, on the 8 decimal dollar basis. */
  readonly maxPerActionUsd8: bigint;
  /** The most that may be sent in one rolling day. */
  readonly maxPerDayUsd8: bigint;
  /** The least time that has to pass between one send and the next, in seconds. */
  readonly minIntervalSeconds: number;
}

/** A send that was started and has not been proven finished. */
export interface PendingSend {
  readonly kind: string;
  readonly venueId: string;
  readonly assetId: string;
  readonly amountUsd8: bigint;
  /** The second the send was started. */
  readonly startedAt: number;
  /** The transaction hash if one was ever seen, null when the failure came first. */
  readonly txHash: `0x${string}` | null;
  /** The block the plan was built from. The anchor used to prove the send landed. */
  readonly blockNumberBeforeSend: bigint;
}

export interface ExecuteState {
  /** Spent since `dayStartedAt`, on the 8 decimal dollar basis. */
  readonly spentTodayUsd8: bigint;
  /** The second the current day of the budget started. */
  readonly dayStartedAt: number;
  /** The second of the last send that went out. Zero means never. */
  readonly lastActionAt: number;
  /** The owner's stop switch. While this is on, nothing at all is sent. */
  readonly killed: boolean;
  /** A send started and not yet proven finished. Null means the agent is free to act. */
  readonly pendingSend: PendingSend | null;
}

export interface ExecuteResult {
  readonly sent: boolean;
  /** Why it was sent, was not sent, or was cut down. In words a person can read. */
  readonly reason: string;
  readonly amountSentUsd8: bigint;
  readonly cappedPerAction: boolean;
  readonly cappedPerDay: boolean;
  readonly txHash: `0x${string}` | null;
  /** The step that was acted on, or null when nothing was. */
  readonly action: PlannedAction | null;
  /** The new state the caller has to keep. This module never changes the state it was given. */
  readonly state: ExecuteState;
}

export interface ExecuteDeps {
  /** Sends one step. Handed in, so this module never touches the network. */
  readonly send: (action: PlannedAction, amountUsd8: bigint) => Promise<`0x${string}`>;
  /** The clock in seconds since the start of 1970. Handed in so tests control time exactly. */
  readonly now: () => number;
  /** The permissions of the key that will sign, checked again right before sending. */
  readonly sessionPermissions: SessionPermissions;
  /** How close to the key's end date this agent stops using it. */
  readonly expirySafetyMarginSeconds?: number;
  /**
   * Saves the state BEFORE the send goes out, including the in flight record.
   *
   * Without this the in flight record only reaches disk after the cycle finishes, while
   * waiting for a result can take minutes. A process that dies inside that window leaves
   * behind the state from before the cycle: the old budget, the old clock mark, no in
   * flight record. The next start then does the whole thing again. This closes that door.
   *
   * IT FAILS CLOSED. If saving fails the send does not happen at all, and the error is
   * marked as never sent. Not paying is one missed cycle; paying with no record that could
   * hold back a second payment is somebody's money gone.
   *
   * The window that remains, said plainly: the process can die after the save succeeds and
   * before the send leaves. What is left behind is an in flight record for something that
   * never happened, and the agent holds off until a person clears it with
   * `clearPendingSend`. That direction of failure is the one we chose.
   */
  readonly persistBeforeSend?: (state: ExecuteState) => Promise<void> | void;
}

/** A clean starting state. Used only when there genuinely is not one stored. */
export function initialExecuteState(nowSeconds: number): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: nowSeconds,
    lastActionAt: 0,
    killed: false,
    pendingSend: null,
  };
}

/**
 * An error guaranteed to have happened before anything touched the network, so it is safe
 * to treat as "did not happen": no budget spent, no in flight record left behind.
 *
 * Marked by a property rather than by its class, so errors belonging to other modules can
 * declare the same thing without inheriting from here.
 */
export class NeverSentError extends Error {
  readonly neverSent = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NeverSentError";
  }
}

/**
 * Does this error say it never reached the network?
 *
 * The answer is false unless the error says otherwise. An error that says nothing is
 * treated as "this may already have gone out". Which way that default points is the whole
 * question of whether the agent pays twice.
 */
export function wasNeverSent(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { neverSent?: unknown }).neverSent === true
  );
}

/**
 * The send threw after, or possibly after, it reached the network. It carries the state the
 * caller has to use for the next cycle: the budget is already spent and the in flight
 * record is already written.
 */
export class SendFailedError extends Error {
  /**
   * A marker on the object, deliberately not a class check.
   *
   * The caller recognises this error through `asSendFailure`, never through `instanceof`.
   * That is not a style choice. Something upstream will eventually wrap this call for
   * logging or retries, and a wrapper that throws a different error, or two copies of this
   * module in the dependency tree, makes `instanceof` fail silently. The caller then falls
   * into the "keep the old state" branch, the budget does not move, and the double payment
   * bug is back with not one test complaining.
   */
  readonly sendFailure = true as const;
  readonly stateAfterSend: ExecuteState;
  constructor(message: string, stateAfterSend: ExecuteState, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SendFailedError";
    this.stateAfterSend = stateAfterSend;
  }
}

/** How deep to follow a chain of wrapped errors. Sensible wrappers do not nest this far. */
const MAX_CAUSE_DEPTH = 8;

function looksLikeExecuteState(value: unknown): value is ExecuteState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<ExecuteState>;
  return typeof s.spentTodayUsd8 === "bigint" && typeof s.lastActionAt === "number";
}

/**
 * Finds a failure after sending inside `err` or anywhere in its chain of causes, and
 * returns the state the next cycle has to use.
 *
 * The chain is followed because wrapping an error to add context is the most natural thing
 * for the layer above to do, and losing the state there means paying twice. A null answer
 * means this was not a failure after sending, and the caller keeps the state it had.
 */
export function asSendFailure(err: unknown): { stateAfterSend: ExecuteState } | null {
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let i = 0; i < MAX_CAUSE_DEPTH && current !== null && current !== undefined; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "object") {
      const c = current as { sendFailure?: unknown; stateAfterSend?: unknown; cause?: unknown };
      if (c.sendFailure === true && looksLikeExecuteState(c.stateAfterSend)) {
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
 * A person says "I looked at the blockchain, that send does not exist". Deliberately
 * explicit and deliberately not automatic: a timer that clears an in flight record is a
 * timer that eventually pays twice.
 */
export function clearPendingSend(state: ExecuteState): ExecuteState {
  return { ...state, pendingSend: null };
}

/**
 * Clears the in flight record once a newer block proves the send landed.
 *
 * The proof required is that the snapshot was read at a block newer than the one the send
 * was built from AND that the caller says the step is done. "Newer block" alone is not
 * proof of anything, so both are needed. When there is no proof the record is left exactly
 * where it is: something still waiting in the queue can land at any moment, so "not seen
 * yet" never means "will not happen", and clearing it out of impatience brings back the
 * exact bug this record exists to prevent.
 *
 * The consequence, said plainly: a send that truly never lands makes this agent stop until
 * a person clears it. A quiet agent is a visible failure. An agent that pays twice is an
 * invisible one, until the money is gone.
 */
export function reconcilePendingSend(
  state: ExecuteState,
  observedBlockNumber: bigint,
  stepIsDone: boolean,
): ExecuteState {
  const pending = state.pendingSend;
  // Loose equality on purpose: state can come from an older stored version that has no such
  // field, and an undefined there must not make this throw.
  if (pending == null) return state;
  if (observedBlockNumber <= pending.blockNumberBeforeSend) return state;
  if (!stepIsDone) return state;
  return { ...state, pendingSend: null };
}

function notSent(reason: string, state: ExecuteState): ExecuteResult {
  return {
    sent: false,
    reason,
    amountSentUsd8: 0n,
    cappedPerAction: false,
    cappedPerDay: false,
    txHash: null,
    action: null,
    state,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Acts on ONE step of the plan, the first one, and no more than one per cycle.
 *
 * One at a time on purpose. The per step limit only has a clear meaning when a step is what
 * gets measured, and the waiting time between sends only paces anything when it is applied
 * between steps rather than between batches. A plan with four steps therefore takes four
 * cycles, and the owner can stop it after any of them.
 */
export async function executePlan(
  plan: PilotPlan,
  limits: ExecuteLimits,
  inputState: ExecuteState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.now();
  const state = inputState;

  // 1. The stop switch. First, and it beats everything.
  if (state.killed) {
    return notSent("The stop switch is on, so nothing at all is sent.", state);
  }

  // 2. A send that has not been proven finished blocks every new one.
  if (state.pendingSend != null) {
    const p = state.pendingSend;
    return notSent(
      `A send of ${p.amountUsd8} on ${p.venueId} started at second ${p.startedAt} has not been ` +
        `proven finished (transaction ${p.txHash ?? "not known"}). Holding off until the ` +
        "blockchain shows it done, because sending again risks paying twice.",
      state,
    );
  }

  // 3. Nothing to do.
  if (plan.actions.length === 0) {
    return notSent(`There is nothing to do. ${plan.reason}`, state);
  }

  const action = plan.actions[0]!;
  let amount = action.amountUsd8;
  let cappedPerAction = false;
  let cappedPerDay = false;

  if (amount <= 0n) {
    return notSent(`The first step is worth ${amount}, so there is nothing to send.`, state);
  }

  // 4. Cut down to the per step limit rather than refusing.
  if (amount > limits.maxPerActionUsd8) {
    amount = limits.maxPerActionUsd8;
    cappedPerAction = true;
  }

  // 5. Cut down to what is left of today. The day is rolled over here so the check below
  // is made against an already refreshed budget.
  const dayElapsed = now - state.dayStartedAt >= SECONDS_PER_DAY;
  const effectiveSpentToday = dayElapsed ? 0n : state.spentTodayUsd8;
  const remainingToday = limits.maxPerDayUsd8 - effectiveSpentToday;

  if (remainingToday <= 0n) {
    return notSent(
      "Today's limit is used up. Nothing more is sent until the day rolls over.",
      state,
    );
  }
  if (amount > remainingToday) {
    amount = remainingToday;
    cappedPerDay = true;
  }
  if (amount <= 0n) {
    return notSent("Once the limits were applied there was nothing left to send.", state);
  }

  // 6. Enough time since the last send.
  const sinceLastAction = now - state.lastActionAt;
  if (sinceLastAction < limits.minIntervalSeconds) {
    return notSent(
      `Only ${sinceLastAction} seconds have passed since the last send and at least ` +
        `${limits.minIntervalSeconds} have to pass.`,
      state,
    );
  }

  // 7. The key still works, checked here rather than only at startup. A cycle that started
  // while the key was fine can reach this point after it stopped working.
  try {
    assertNotExpired(
      deps.sessionPermissions,
      now,
      deps.expirySafetyMarginSeconds ?? EXPIRY_SAFETY_MARGIN_SECONDS,
    );
  } catch (err) {
    return notSent(messageOf(err), state);
  }

  // 8. Budget, clock mark and in flight record are all written before the send. From the
  // moment `send` is called the money is treated as gone until the blockchain says
  // otherwise.
  const stateAfterSend: ExecuteState = {
    spentTodayUsd8: effectiveSpentToday + amount,
    dayStartedAt: dayElapsed ? now : state.dayStartedAt,
    lastActionAt: now,
    killed: state.killed,
    pendingSend: {
      kind: action.kind,
      venueId: action.venueId,
      assetId: action.assetId,
      amountUsd8: amount,
      startedAt: now,
      txHash: null,
      blockNumberBeforeSend: 0n,
    },
  };

  if (deps.persistBeforeSend) {
    try {
      await deps.persistBeforeSend(stateAfterSend);
    } catch (err) {
      throw new NeverSentError(
        "The record of this send could not be saved first, so nothing was sent. Sending with " +
          "no record that could hold back a second payment is worse than missing one cycle. " +
          `The underlying problem: ${messageOf(err)}`,
        { cause: err },
      );
    }
  }

  let txHash: `0x${string}`;
  try {
    txHash = await deps.send(action, amount);
  } catch (err) {
    if (wasNeverSent(err)) {
      // The one case where failed really does mean it did not happen: the sending module
      // states for itself that the network was never touched.
      throw err;
    }
    throw new SendFailedError(
      "The send failed after it may have reached the network. The budget and the waiting " +
        `time are still counted and the send is recorded as in flight. The underlying ` +
        `problem: ${messageOf(err)}`,
      stateAfterSend,
      { cause: err },
    );
  }

  // A hash in hand means the relay confirmed inclusion, so nothing is in flight any more.
  const newState: ExecuteState = { ...stateAfterSend, pendingSend: null };

  return {
    sent: true,
    reason:
      `${action.kind} on ${action.venueId} for ${amount}` +
      (cappedPerAction ? ", cut down to the per step limit" : "") +
      (cappedPerDay ? ", cut down to what was left of today" : "") +
      ".",
    amountSentUsd8: amount,
    cappedPerAction,
    cappedPerDay,
    txHash,
    action,
    state: newState,
  };
}
