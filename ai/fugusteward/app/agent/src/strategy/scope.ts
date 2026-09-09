/**
 * Several agents, one wallet, different powers.
 *
 * This is the piece the whole product rests on. One wallet paying several kinds of
 * recurring bill is only a good idea if the agent that pays the office rent cannot also pay
 * the one that buys computing time, and cannot pay a stranger, and cannot pay ten times what
 * it was set up to pay. Without that separation, "several agents on one wallet" is just one
 * agent with several names, and the names are decoration.
 *
 * ## What a scope is
 *
 * A named set of powers: which people may be paid, which contract and method the payment may
 * go through, and how much may go out in one payment and in one day. Every scope belongs to
 * exactly one agent, and every payment names the agent it is claiming to be.
 *
 * ## The rule that matters most
 *
 * A power belonging to another agent on the same wallet is worth exactly as much to this
 * agent as a power belonging to nobody. Being allowed for somebody is not being allowed. The
 * check below therefore never looks at the whole wallet, only at the one scope named, and
 * that is the difference between separation and the appearance of it.
 *
 * ## Where this sits next to the limited key
 *
 * The limited key caps things on the blockchain, and it caps them for the WHOLE key. It
 * cannot tell one of our agents from another, because from the account contract's point of
 * view they are the same signer. So the separation between agents can only be enforced here,
 * in this repo, and that is precisely why it is written down and tested rather than assumed.
 * Said plainly, so nobody mistakes it for more than it is: an attacker who runs our process
 * can ignore this file. What they cannot ignore is the key's own limits. Two layers, and
 * only one of them is ours.
 */
import type { BoundCall } from "./types.js";

export interface Scope {
  readonly agentId: string;
  /** Who this agent may pay. Nobody else, whatever the schedule says. */
  readonly allowedPayees: readonly `0x${string}`[];
  /** Which contract and method it may go through. Both halves, always. */
  readonly allowedCalls: readonly BoundCall[];
  /** The most this agent may send in one payment. */
  readonly maxPerPaymentUsd8: bigint;
  /** The most this agent may send in one rolling day. Its own budget, not the wallet's. */
  readonly maxPerDayUsd8: bigint;
}

/** Every scope on one wallet, looked up by the agent's name. */
export type ScopeRegistry = ReadonlyMap<string, Scope>;

/**
 * A payment tried to do something its scope does not allow. It always means "send nothing",
 * and it is raised before anything touches the network.
 */
export class ScopeViolationError extends Error {
  readonly neverSent = true as const;
  readonly agentId: string;
  constructor(message: string, agentId: string) {
    super(message);
    this.name = "ScopeViolationError";
    this.agentId = agentId;
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Checks a scope before it is ever used to allow anything. */
export function assertScopeIsSane(scope: Scope): void {
  if (scope.agentId.length === 0) {
    throw new ScopeViolationError("A scope with no agent name cannot be looked up.", scope.agentId);
  }
  if (scope.allowedPayees.length === 0) {
    throw new ScopeViolationError(
      `The scope for "${scope.agentId}" names nobody it may pay. An empty list here means it ` +
        "can do nothing, which is safe, but it is almost always a mistake rather than an " +
        "intention, so it is refused loudly instead of failing quietly at payment time.",
      scope.agentId,
    );
  }
  if (scope.allowedCalls.length === 0) {
    throw new ScopeViolationError(
      `The scope for "${scope.agentId}" names no contract and method it may use.`,
      scope.agentId,
    );
  }
  for (const call of scope.allowedCalls) {
    if (!call.to || !call.signature) {
      throw new ScopeViolationError(
        `The scope for "${scope.agentId}" has an entry naming only one half of a permission. ` +
          "Every entry has to name both the contract and the method.",
        scope.agentId,
      );
    }
  }
  if (scope.maxPerPaymentUsd8 <= 0n) {
    throw new ScopeViolationError(
      `The scope for "${scope.agentId}" allows ${scope.maxPerPaymentUsd8} per payment, which is ` +
        "not a positive amount.",
      scope.agentId,
    );
  }
  if (scope.maxPerDayUsd8 <= 0n) {
    throw new ScopeViolationError(
      `The scope for "${scope.agentId}" allows ${scope.maxPerDayUsd8} per day, which is not a ` +
        "positive amount.",
      scope.agentId,
    );
  }
  if (scope.maxPerPaymentUsd8 > scope.maxPerDayUsd8) {
    throw new ScopeViolationError(
      `The scope for "${scope.agentId}" allows ${scope.maxPerPaymentUsd8} in one payment but ` +
        `only ${scope.maxPerDayUsd8} in a whole day. One of the two numbers is wrong, and ` +
        "guessing which would be guessing about money.",
      scope.agentId,
    );
  }
}

/** Builds the registry, checking every scope and refusing two agents with the same name. */
export function createScopeRegistry(scopes: readonly Scope[]): ScopeRegistry {
  const map = new Map<string, Scope>();
  for (const scope of scopes) {
    assertScopeIsSane(scope);
    if (map.has(scope.agentId)) {
      throw new ScopeViolationError(
        `There are two scopes both called "${scope.agentId}". One of them would silently win, ` +
          "and which one would decide what the agent is allowed to do.",
        scope.agentId,
      );
    }
    map.set(scope.agentId, scope);
  }
  return map;
}

/** What one payment is claiming to be allowed to do. */
export interface ScopedRequest {
  readonly agentId: string;
  readonly payee: `0x${string}`;
  readonly amountUsd8: bigint;
  readonly call: BoundCall;
}

/**
 * Demands that the payment is inside the scope of the agent it names. Throws otherwise, and
 * the throw always means nothing was sent.
 *
 * Note what this function never does: look at any scope other than the one named. A payee
 * allowed for another agent on the same wallet is not allowed here, and neither is a method
 * another agent may use. That is the entire separation, and it is one line of discipline
 * rather than a mechanism.
 */
export function assertWithinScope(registry: ScopeRegistry, request: ScopedRequest): Scope {
  const scope = registry.get(request.agentId);
  if (scope === undefined) {
    throw new ScopeViolationError(
      `There is no scope called "${request.agentId}" on this wallet. An agent with no scope is ` +
        "allowed nothing at all, which is the only safe reading of a name nobody set up.",
      request.agentId,
    );
  }

  if (!scope.allowedPayees.some((p) => sameAddress(p, request.payee))) {
    throw new ScopeViolationError(
      `"${request.agentId}" may not pay ${request.payee}. The only people it may pay are: ` +
        `${scope.allowedPayees.join(", ")}. Somebody else on this wallet being allowed to pay ` +
        "them makes no difference here.",
      request.agentId,
    );
  }

  const allowed = scope.allowedCalls.some(
    (c) => sameAddress(c.to, request.call.to) && c.signature === request.call.signature,
  );
  if (!allowed) {
    throw new ScopeViolationError(
      `"${request.agentId}" may not use ${request.call.to} ${request.call.signature}. What it ` +
        `may use: ${scope.allowedCalls.map((c) => `${c.to} ${c.signature}`).join(", ")}.`,
      request.agentId,
    );
  }

  if (request.amountUsd8 <= 0n) {
    throw new ScopeViolationError(
      `A payment of ${request.amountUsd8} is not a positive amount, so it is refused before ` +
        "anything else is considered.",
      request.agentId,
    );
  }

  if (request.amountUsd8 > scope.maxPerPaymentUsd8) {
    throw new ScopeViolationError(
      `"${request.agentId}" may send at most ${scope.maxPerPaymentUsd8} in one payment and this ` +
        `one is ${request.amountUsd8}. It is refused rather than trimmed: a repeating payment ` +
        "that is paid short leaves the rest owed, and nobody decided that.",
      request.agentId,
    );
  }

  return scope;
}

/** True when the request is inside its scope. The throwing version above carries the reason. */
export function isWithinScope(registry: ScopeRegistry, request: ScopedRequest): boolean {
  try {
    assertWithinScope(registry, request);
    return true;
  } catch {
    return false;
  }
}
