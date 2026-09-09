/**
 * The buying half: ask, be told the price, decide, pay, ask again.
 *
 * The signing step is INJECTED. In production it is a delegated key with a spending cap
 * and an expiry date that the wallet contract enforces; in a test it is an ordinary key
 * signing the same authorisation. Both produce the same envelope, so the flow below can
 * be proven end to end with no network and no money, and the production path differs only
 * in who holds the key.
 *
 * Two rules here are the whole reason this is a module rather than four lines at a call
 * site. The decision to pay is made by `decidePurchase`, which is deterministic code and
 * never a model. And a payment is attempted AT MOST ONCE per request: a seller that
 * answers a paid request with another demand gets no second payment, because a loop of
 * pay-and-retry is a loop that spends real money at whatever rate the network allows.
 */
import { parsePriceDemand } from "../strategy/challenge.js";
import { decidePurchase } from "../strategy/decide.js";
import {
  DEFAULT_POLICY,
  type ChosenPayment,
  type PriceDemand,
  type PurchaseDecision,
  type PurchasePolicy,
  type SpendLedger,
} from "../strategy/types.js";

/** What the signer is asked for: an envelope ready to be put in a header. */
export interface SignedPayment {
  /** The `X-PAYMENT` header value: the envelope, base64 encoded. */
  header: string;
}

export interface BuyOptions {
  url: string;
  init?: RequestInit;
  /** Injected so the flow can be driven without a network. */
  fetchImpl: typeof fetch;
  /**
   * Signs the chosen payment. It is handed the decision and the seller's demand, never a
   * free choice: what to sign was already decided by deterministic code.
   */
  sign: (chosen: ChosenPayment, demand: PriceDemand) => Promise<SignedPayment>;
  policy?: PurchasePolicy;
  ledger?: SpendLedger;
  /** The address the caller expects to be paid, when they know it. */
  expectedPayee?: `0x${string}`;
}

export type BuyOutcome =
  | {
      /** The request needed no payment at all. */
      kind: "free";
      response: Response;
      decision: null;
    }
  | {
      /** A price was demanded and this agent refused it. Nothing was signed. */
      kind: "refused";
      response: Response;
      decision: PurchaseDecision;
    }
  | {
      /** A price was demanded, paid, and the request was made again. */
      kind: "paid";
      response: Response;
      decision: PurchaseDecision;
      /** True when the seller demanded payment a second time. No second payment is made. */
      demandedAgain: boolean;
    };

const PAYMENT_REQUIRED = 402;

/**
 * Asks for something that may cost money, and pays for it once if the price passes.
 *
 * A reply that is not a demand for payment is returned untouched, including an error. A
 * seller that is simply broken must not look like a seller that wants money.
 */
export async function buyOnce(opts: BuyOptions): Promise<BuyOutcome> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const ledger = opts.ledger ?? { spentUnits: 0n, windowStartedAt: 0n };

  const first = await opts.fetchImpl(opts.url, opts.init);
  if (first.status !== PAYMENT_REQUIRED) {
    return { kind: "free", response: first, decision: null };
  }

  // The body is read once and kept: a Response body can only be read once, and a refusal
  // has to be able to hand the original reply back to the caller.
  const raw = await first.clone().json().catch(() => null);
  const demand = parsePriceDemand(raw);
  const decision = decidePurchase(demand, policy, ledger, {
    ...(opts.expectedPayee === undefined ? {} : { expectedPayee: opts.expectedPayee }),
  });

  if (decision.action !== "PAY" || decision.chosen === null) {
    return { kind: "refused", response: first, decision };
  }

  const signed = await opts.sign(decision.chosen, demand);

  const headers = new Headers(opts.init?.headers);
  headers.set("X-PAYMENT", signed.header);
  const second = await opts.fetchImpl(opts.url, { ...opts.init, headers });

  return {
    kind: "paid",
    response: second,
    decision,
    // Deliberately reported rather than acted on. A second demand after a payment means
    // the payment was refused or the seller is asking twice, and either way the answer is
    // to stop and tell the caller, not to pay again.
    demandedAgain: second.status === PAYMENT_REQUIRED,
  };
}

/** What one completed purchase adds to the running total. */
export function ledgerAfter(ledger: SpendLedger, outcome: BuyOutcome): SpendLedger {
  if (outcome.kind !== "paid" || outcome.decision.chosen === null) return ledger;
  // A payment that came back with another demand is still money that was signed away, so
  // it counts. Counting only successful purchases would let a failing seller be paid over
  // and over without ever moving the running total.
  return {
    spentUnits: ledger.spentUnits + outcome.decision.chosen.amountUnits,
    windowStartedAt: ledger.windowStartedAt,
  };
}
