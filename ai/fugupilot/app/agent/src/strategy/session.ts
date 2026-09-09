/**
 * The limited key this agent signs with, and the three things that have to be true about
 * it before anything is sent.
 *
 * A limited key is a second key the owner hands the agent. It is not the owner's main key:
 * the account contract on the blockchain only lets it call a named list of contracts and
 * methods, only up to a spending limit, and only until a date. All three of those are
 * enforced by the account contract itself, not by this repo, so an agent whose machine is
 * taken over still cannot call anything outside that list.
 *
 * This module is where the checks live, and it deliberately does three things and nothing
 * else:
 *
 *   1. refuses a key whose permission list is missing or empty. In Altana an empty list
 *      means UNLIMITED, not "nothing allowed". That is the trap that has already caught
 *      people on this project, and it is checked here before the SDK is ever called.
 *   2. refuses a key with no spending limit in the network's own coin. That limit also pays
 *      the relay cost, and without it every send fails before it is even included.
 *   3. refuses a key that has run out, or is about to. See `assertNotExpired` for why
 *      "about to" matters as much as "has".
 *
 * The signing half of the key file is never read, printed, logged or copied anywhere in
 * this module. The key only ever arrives already bound into a `sendCalls` function.
 */

/**
 * One permission line. The shape mirrors the SDK exactly: `{ to }` on its own means every
 * method on that contract, `{ signature }` on its own means that method on any contract.
 * Both are far too loose for an agent that holds money, and both are refused below.
 */
export type SessionCallPermission =
  | { readonly to: `0x${string}`; readonly signature: string }
  | { readonly to: `0x${string}` }
  | { readonly signature: string };

/** A spending limit for one token over one rolling period. */
export interface SessionSpendPermission {
  readonly limit: bigint;
  readonly period: string;
  /** Left out means the network's own coin, which is what pays the relay cost. */
  readonly token?: `0x${string}`;
}

/** As much of a key's permissions as this module looks at. */
export interface SessionPermissions {
  readonly calls?: readonly SessionCallPermission[] | null;
  readonly spend?: readonly SessionSpendPermission[] | null;
  /**
   * The second the key stops working, counted from the start of 1970. Undefined means the
   * caller did not tell us, and `assertNotExpired` treats that as a reason to stop rather
   * than as permission to continue.
   */
  readonly expiresAt?: number;
}

/** One permission line that names both a contract and a method. The only shape allowed. */
export interface BoundCallPermission {
  readonly to: `0x${string}`;
  readonly signature: string;
}

/**
 * Something is wrong with the key. It always means "send nothing".
 *
 * `neverSent` says whether this happened before anything touched the network. Every check
 * in this module runs before the first call goes out, so they all set it to true. The
 * default is false everywhere else in the codebase on purpose: silence has to mean "this
 * may already have been sent", because that is the assumption that errs towards not paying
 * twice.
 */
export class SessionError extends Error {
  readonly neverSent: boolean;
  constructor(message: string, options: { neverSent?: boolean } = {}) {
    super(message);
    this.name = "SessionError";
    this.neverSent = options.neverSent ?? true;
  }
}

function callKey(to: string, signature: string): string {
  return `${to.toLowerCase()}:${signature}`;
}

function describeCall(call: SessionCallPermission): string {
  const to = "to" in call ? call.to : "(any contract)";
  const signature = "signature" in call ? call.signature : "(any method)";
  return `${to} ${signature}`;
}

/**
 * Refuses a permission list looser than `required`, before the SDK is called at all.
 *
 * Five refusals, in this order:
 *   1. there is no list -> in Altana that is unlimited permission.
 *   2. the list is empty -> the same thing, and this is the one people fall into.
 *   3. a line naming only a contract, or only a method -> half a permission is not a
 *      permission.
 *   4. a line that is not in `required` -> the key can do more than this agent needs.
 *   5. a line in `required` that is missing -> the key cannot do the job it was made for.
 *
 * Refusal 4 is the one that gets argued about. A key that can do more than the job is not
 * "harmlessly generous": it is the difference between a break in that costs one payment
 * and a break in that costs everything the key can reach.
 */
export function assertBoundedAllowlist(
  permissions: SessionPermissions,
  required: readonly BoundCallPermission[],
): void {
  if (required.length === 0) {
    throw new SessionError(
      "The list of calls this agent needs is empty, so there is nothing to allow. A key " +
        "granted against an empty list would be a key with no boundary.",
    );
  }

  const calls = permissions.calls;
  if (calls === undefined || calls === null) {
    throw new SessionError(
      "The key carries no permission list at all. In Altana that means unlimited " +
        "permission: it could call any contract. Grant it again with an explicit list.",
    );
  }
  if (calls.length === 0) {
    throw new SessionError(
      "The key's permission list is empty. In Altana an empty list means unlimited " +
        "permission, not 'nothing is allowed'. Grant it again with an explicit list.",
    );
  }

  const requiredKeys = new Set(required.map((c) => callKey(c.to, c.signature)));
  const seen = new Set<string>();

  for (const call of calls) {
    const to = "to" in call ? call.to : undefined;
    const signature = "signature" in call ? call.signature : undefined;
    if (!to || !signature) {
      throw new SessionError(
        `The permission line "${describeCall(call)}" names only one half. Every line has to ` +
          "name both the contract and the method.",
      );
    }
    const key = callKey(to, signature);
    if (!requiredKeys.has(key)) {
      throw new SessionError(
        `The permission line ${to} ${signature} is more than this agent needs. The only lines ` +
          `it may carry are: ${required.map((c) => `${c.to} ${c.signature}`).join(", ")}.`,
      );
    }
    seen.add(key);
  }

  for (const call of required) {
    if (!seen.has(callKey(call.to, call.signature))) {
      throw new SessionError(
        `The key's permission list is missing ${call.to} ${call.signature}, so it cannot do ` +
          "the job it was made for. Grant it again with the right list.",
      );
    }
  }
}

/**
 * Refuses a key with no spending limit in the network's own coin.
 *
 * This is not fussiness. The relay cost of every send comes out of that limit, so a key
 * with only a token limit fails on the blockchain before it manages to do anything at all,
 * and the failure looks like a mystery rather than like a missing setting.
 */
export function assertNativeSpendCap(permissions: SessionPermissions): void {
  const spend = permissions.spend;
  if (spend === undefined || spend === null || spend.length === 0) {
    throw new SessionError(
      "The key has no spending limits at all. Without a limit in the network's own coin the " +
        "cost of sending has no source and every send fails before it is included.",
    );
  }
  const native = spend.find((entry) => entry.token === undefined || entry.token === null);
  if (native === undefined) {
    throw new SessionError(
      "The key has no limit in the network's own coin, only in tokens. That coin is what pays " +
        "the cost of sending, so without it nothing can be sent.",
    );
  }
  if (native.limit <= 0n) {
    throw new SessionError(
      `The key's limit in the network's own coin is ${native.limit}, which is not a positive ` +
        "number, so it cannot pay the cost of sending.",
    );
  }
}

/**
 * How long before the key runs out this agent stops using it, in seconds.
 *
 * Not zero, and the reason is the part that matters. A send is not instant: the batch is
 * built, handed to the relay, included in a block. A key that is valid when the decision is
 * made can be expired by the time the account contract checks it, and the send then fails
 * after it has already been charged against the budget. Stopping early turns that into a
 * clean refusal, which is a cheap outcome, instead of a failed send, which is not.
 */
export const EXPIRY_SAFETY_MARGIN_SECONDS = 60;

/**
 * Refuses a key that has run out, or that runs out within the safety margin.
 *
 * A key with no stated end date is refused too. "Nobody told us when this stops working" is
 * not the same as "it never stops working", and treating the first as the second is how an
 * agent ends up holding a key nobody can account for.
 */
export function assertNotExpired(
  permissions: SessionPermissions,
  nowSeconds: number,
  marginSeconds: number = EXPIRY_SAFETY_MARGIN_SECONDS,
): void {
  const expiresAt = permissions.expiresAt;
  if (expiresAt === undefined || expiresAt === null) {
    throw new SessionError(
      "The key does not say when it stops working. An end date that nobody stated is not the " +
        "same as no end date, and this agent will not sign with a key it cannot account for.",
    );
  }
  if (!Number.isFinite(expiresAt)) {
    throw new SessionError(`The key's end date, ${expiresAt}, is not a real point in time.`);
  }
  if (nowSeconds >= expiresAt) {
    throw new SessionError(
      `The key stopped working at second ${expiresAt} and it is now second ${nowSeconds}. ` +
        "Nothing is sent. Ask the owner for a new key.",
    );
  }
  const secondsLeft = expiresAt - nowSeconds;
  if (secondsLeft <= marginSeconds) {
    throw new SessionError(
      `The key stops working in ${secondsLeft} seconds, which is inside the ${marginSeconds} ` +
        "second margin this agent keeps. A send started now could be checked after the key " +
        "has already stopped, so nothing is sent. Ask the owner for a new key.",
    );
  }
}

/** Runs all three checks in the order they should be run. */
export function assertSessionUsable(
  permissions: SessionPermissions,
  required: readonly BoundCallPermission[],
  nowSeconds: number,
  marginSeconds: number = EXPIRY_SAFETY_MARGIN_SECONDS,
): void {
  assertBoundedAllowlist(permissions, required);
  assertNativeSpendCap(permissions);
  assertNotExpired(permissions, nowSeconds, marginSeconds);
}
