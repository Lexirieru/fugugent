/**
 * Paying through a delegated key that the wallet contract itself keeps inside a boundary.
 *
 * The wallet grants this agent a key that may only call a named list of methods on a
 * named list of contracts, may only spend up to a set amount per day, and stops working
 * on a set date. Those three limits are enforced by the wallet contract on the
 * blockchain, not by code in this repository. If this process is taken over, the key it
 * holds still cannot call anything outside the list.
 *
 * There is one trap, and it has already cost other people money: an EMPTY list of allowed
 * methods means UNLIMITED permission, not "nothing is allowed". So the first thing this
 * module does, before the wallet library is even called, is refuse a key whose list is
 * empty or missing.
 *
 * This module contains no strategy. It checks the boundary, composes the two calls, and
 * hands them to a sender the caller injects, which is what lets every rule below be
 * tested with no network at all.
 *
 * The secret part of the key file is never read, parsed, printed, or copied anywhere in
 * this module. The key only arrives here as an already-bound sending function.
 */
import type { PaymentIntent } from "../plan.js";

/**
 * One rule in the allowed list. The shape mirrors the wallet library's own: `{ to }`
 * alone means "every method on that contract", `{ signature }` alone means "that method
 * on any contract". Both are too loose for this agent and both are refused.
 */
export type SessionCallPermission =
  | { readonly to: `0x${string}`; readonly signature: string }
  | { readonly to: `0x${string}` }
  | { readonly signature: string };

/** A spending cap for one rolling period. */
export interface SessionSpendPermission {
  readonly limit: bigint;
  readonly period: string;
  /** Left out means the chain's own coin, which is what pays the delivery cost. */
  readonly token?: `0x${string}`;
}

export interface SessionPermissions {
  readonly calls?: readonly SessionCallPermission[] | null;
  readonly spend?: readonly SessionSpendPermission[] | null;
}

/** One allowed entry that names both a contract AND a method. */
export interface BoundCallPermission {
  readonly to: `0x${string}`;
  readonly signature: string;
}

/** The one method this agent uses to rent an agent and pay for it. */
export const SUBSCRIBE_SIGNATURE = "subscribe(uint256,uint32,address,uint256,uint256)";

/** The method that lets the payment contract take the agreed amount, and no more. */
export const APPROVE_SIGNATURE = "approve(address,uint256)";

export class SessionPermissionError extends Error {
  /**
   * Whether this failure happened BEFORE anything touched the network. Only this module
   * knows where that line is: everything up to the moment the batch is handed to the
   * sender provably has not been sent, and nothing after it can claim that. The default
   * is false, so silence means "it may already have gone out", the assumption that errs
   * toward not paying twice.
   */
  readonly neverSent: boolean;
  constructor(message: string, options: { neverSent?: boolean } = {}) {
    super(message);
    this.name = "SessionPermissionError";
    this.neverSent = options.neverSent ?? false;
  }
}

/**
 * The smallest allowed list this agent can work with: renting on the payment contract,
 * and letting that contract take the agreed amount of one token. Nothing else.
 *
 * Used both when the key is granted and when it is re-checked before a payment, so the
 * two can never describe different boundaries.
 *
 * The wallet's boundary stops at contract and method; it does not bind the VALUES passed
 * to them. This key can therefore, as far as the wallet is concerned, call
 * `token.approve(anyone, any amount)` and rent any listing. Three things hold it back and
 * only two of them are ours: the per-token spending cap, which the wallet contract
 * enforces; the code below, which only ever composes an approval for the payment contract
 * and for the exact amount of one decision, and which is gone the moment this process is
 * taken over; and the wallet's own guarded runner, which returns token approvals to zero
 * at the end of the same operation. If binding the values ever becomes necessary, its
 * place is a small contract in the middle, not this file.
 */
export function requiredSessionCalls(
  subscription: `0x${string}`,
  payToken: `0x${string}`,
): readonly BoundCallPermission[] {
  return [
    { to: subscription, signature: SUBSCRIBE_SIGNATURE },
    { to: payToken, signature: APPROVE_SIGNATURE },
  ];
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
 * Refuses a key that is looser than `required`, BEFORE the wallet library is called.
 *
 * Five refusals, in order:
 *   1. the list is missing, which in this wallet means unlimited permission;
 *   2. the list is empty, which means the same thing, and is the trap people fall into;
 *   3. an entry naming only a contract or only a method, which is half a rule;
 *   4. an entry outside `required`, so the key can do more than this agent needs;
 *   5. an entry of `required` that is missing, so the key cannot do the job at all.
 */
export function assertBoundedAllowlist(
  permissions: SessionPermissions,
  required: readonly BoundCallPermission[],
): void {
  if (required.length === 0) {
    throw new SessionPermissionError(
      "The list of required calls is empty, so there is nothing to allow explicitly.",
      { neverSent: true },
    );
  }

  const calls = permissions.calls;
  if (calls === undefined || calls === null) {
    throw new SessionPermissionError(
      "This key carries no list of allowed methods at all. In this wallet that means " +
        "UNLIMITED permission: it may call any contract. Grant it again with an explicit list.",
      { neverSent: true },
    );
  }
  if (calls.length === 0) {
    throw new SessionPermissionError(
      "The list of allowed methods is empty. In this wallet an empty list means UNLIMITED " +
        "permission, not 'nothing is allowed'. Grant the key again with an explicit list.",
      { neverSent: true },
    );
  }

  const requiredKeys = new Set(required.map((c) => callKey(c.to, c.signature)));
  const seen = new Set<string>();

  for (const call of calls) {
    const to = "to" in call ? call.to : undefined;
    const signature = "signature" in call ? call.signature : undefined;
    if (!to || !signature) {
      throw new SessionPermissionError(
        `The entry "${describeCall(call)}" names only one side. Every entry must name both the ` +
          `contract and the method.`,
        { neverSent: true },
      );
    }
    const key = callKey(to, signature);
    if (!requiredKeys.has(key)) {
      throw new SessionPermissionError(
        `The entry ${to} ${signature} is more than this agent needs. The only entries allowed ` +
          `are: ${required.map((c) => `${c.to} ${c.signature}`).join(", ")}.`,
        { neverSent: true },
      );
    }
    seen.add(key);
  }

  for (const call of required) {
    if (!seen.has(callKey(call.to, call.signature))) {
      throw new SessionPermissionError(
        `The key does not allow ${call.to} ${call.signature}, so it cannot pay for a rental. ` +
          `Grant it again with the correct list.`,
        { neverSent: true },
      );
    }
  }
}

/**
 * Refuses a key with no cap on the chain's own coin.
 *
 * This is not fussiness. The delivery service that carries the transaction is paid out of
 * the wallet in the chain's own coin, and that cost is charged against this cap. A key
 * with only a token cap fails on the blockchain before it manages to do anything.
 */
export function assertNativeSpendCap(permissions: SessionPermissions): void {
  const spend = permissions.spend;
  if (spend === undefined || spend === null || spend.length === 0) {
    throw new SessionPermissionError(
      "This key carries no spending caps at all. Without a cap on the chain's own coin the " +
        "cost of delivering the transaction has no source and every attempt fails before it " +
        "reaches a block.",
      { neverSent: true },
    );
  }
  const native = spend.find((entry) => entry.token === undefined || entry.token === null);
  if (native === undefined) {
    throw new SessionPermissionError(
      "This key has no cap on the chain's own coin. That cap also pays for delivering the " +
        "transaction, so without it nothing can be sent.",
      { neverSent: true },
    );
  }
  if (native.limit <= 0n) {
    throw new SessionPermissionError(
      `The cap on the chain's own coin is ${native.limit}, which is not a positive amount, so ` +
        `the transaction can never be delivered.`,
      { neverSent: true },
    );
  }
}

/**
 * Refuses to start a payment the key's own cap cannot cover.
 *
 * Without this check the payment goes out, the wallet contract refuses it, and the money
 * is not spent but the attempt still cost the delivery fee and the caller reads a
 * decoded contract error instead of a sentence. The cap is a rolling one, so passing this
 * check is not a promise: earlier spending in the same period can still exhaust it. What
 * it rules out is the case that could never have worked.
 */
export function assertTokenSpendCap(
  permissions: SessionPermissions,
  token: `0x${string}`,
  needed: bigint,
): void {
  const spend = permissions.spend ?? [];
  const entry = spend.find(
    (e) => e.token !== undefined && e.token !== null && e.token.toLowerCase() === token.toLowerCase(),
  );
  if (entry === undefined) {
    throw new SessionPermissionError(
      `This key has no spending cap for ${token}, so it may not move that token at all.`,
      { neverSent: true },
    );
  }
  if (entry.limit < needed) {
    throw new SessionPermissionError(
      `This payment needs up to ${needed} units of ${token} and the key's cap for the period is ` +
        `${entry.limit}. Nothing was sent.`,
      { neverSent: true },
    );
  }
}

/** One contract call inside a batch. */
export interface SessionCall {
  readonly address: `0x${string}`;
  readonly abi: readonly unknown[];
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/** The outcome of one batch. A `status` of 1 means the transaction succeeded. */
export interface SessionSendResult {
  readonly transactionHash: `0x${string}`;
  readonly status: number;
}

/** The two methods this agent calls, written out as the single source for both the
 * allowed list above and the calls below, so the two cannot drift apart. */
const SUBSCRIPTION_ABI = [
  {
    type: "function",
    name: "subscribe",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "periods", type: "uint32" },
      { name: "payToken", type: "address" },
      { name: "maxAmount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "subId", type: "uint256" }],
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface SessionHireDeps {
  /** The wallet the payment comes from. */
  readonly walletAddress: `0x${string}`;
  /** The payment contract this key may call. */
  readonly subscription: `0x${string}`;
  /** The one token this key may pay in. */
  readonly payToken: `0x${string}`;
  /** The key's limits, exactly as they came from the key file. */
  readonly permissions: SessionPermissions;
  /**
   * Sends ONE batch of calls as a single indivisible operation and waits for the result.
   *
   * A batch, and not two transactions, because the wallet's guarded runner returns token
   * approvals to zero at the end of the same operation. That behaviour is correct, an
   * approval left behind by a leaked key must not outlive its transaction, and the
   * consequence is that the approval has to travel with the payment that uses it.
   */
  readonly sendCalls: (
    calls: readonly SessionCall[],
    description: string,
  ) => Promise<SessionSendResult>;
  readonly log?: (message: string) => void;
}

/**
 * Builds the "pay for this rental" function.
 *
 * The key's limits are checked when this function is BUILT, not when the first payment is
 * attempted: a key that is too loose has to be visible before the agent starts working,
 * not after it has already decided to spend.
 */
export function createSessionHire(
  deps: SessionHireDeps,
): (intent: PaymentIntent) => Promise<SessionSendResult> {
  assertBoundedAllowlist(deps.permissions, requiredSessionCalls(deps.subscription, deps.payToken));
  assertNativeSpendCap(deps.permissions);

  const log = deps.log ?? (() => {});

  return async (intent: PaymentIntent): Promise<SessionSendResult> => {
    if (intent.payToken.toLowerCase() !== deps.payToken.toLowerCase()) {
      throw new SessionPermissionError(
        `This payment is in ${intent.payToken} and this key may only pay in ${deps.payToken}. ` +
          `Nothing was sent.`,
        { neverSent: true },
      );
    }
    if (intent.maxAmountWad <= 0n) {
      throw new SessionPermissionError(
        `The payment ceiling is ${intent.maxAmountWad}, so there is nothing to pay. Nothing was sent.`,
        { neverSent: true },
      );
    }
    assertTokenSpendCap(deps.permissions, deps.payToken, intent.maxAmountWad);

    // The approval is for exactly the ceiling of this one payment, and it travels in the
    // same operation as the payment. It is not an open-ended approval and it does not
    // survive the transaction.
    const calls: SessionCall[] = [
      {
        address: intent.payToken,
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [deps.subscription, intent.maxAmountWad],
      },
      {
        address: deps.subscription,
        abi: SUBSCRIPTION_ABI,
        functionName: "subscribe",
        args: [
          intent.listingId,
          Number(intent.periods),
          intent.payToken,
          intent.maxAmountWad,
          intent.deadlineUnix,
        ],
      },
    ];

    const label =
      `allow up to ${intent.maxAmountWad} and rent listing ${intent.listingId} for ` +
      `${intent.periods} block${intent.periods === 1n ? "" : "s"} of time`;
    const result = await deps.sendCalls(calls, label);
    if (result.status !== 1) {
      // Deliberately without `neverSent`: by this point the batch has a transaction hash.
      // A status other than 1 can mean the transaction was rejected, and it can also mean
      // the result was read from a node that has not caught up, which ends with the
      // transaction landing anyway. The caller has to treat it as "it may have happened".
      throw new SessionPermissionError(
        `The rental payment did not succeed (status ${result.status}, transaction ` +
          `${result.transactionHash}).`,
      );
    }
    log(`rental paid, transaction ${result.transactionHash}`);
    return result;
  };
}
