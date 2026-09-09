/**
 * The Trader decision engine: is this one paid request worth paying for?
 *
 * PURE: no network, no `Date.now()`, no `process.env`, no I/O. The whole outside world
 * arrives through arguments. Decisions about money never pass through an LLM. The model
 * may read the sentence in `reason` out loud; it may never change a number in it and
 * never turn a refusal into a payment.
 *
 * The shape of the risk here is different from an ordinary trade. There is no price to be
 * wrong about and no direction to be wrong in. There is a stranger's reply that names a
 * price, a token and an address, and a signature this agent is about to put on it. Every
 * rule below exists because one of those four things can be substituted for another
 * without the payment looking any different.
 */
import { formatToken18 } from "./format.js";
import {
  BPS_ONE,
  DEFAULT_POLICY,
  PurchaseError,
  assertToken18,
  puffFromWindowBps,
  type ChosenPayment,
  type PaymentOption,
  type PriceDemand,
  type PurchaseDecision,
  type PurchasePolicy,
  type RefusalRule,
  type RefusedOption,
  type SpendLedger,
  type TokenChoice,
} from "./types.js";

/**
 * A policy under which nothing could ever be paid must fail at the door.
 *
 * The dangerous case is not a limit that is too tight, it is a policy that silently never
 * pays. An agent like that looks like it is working, is green in every test, and quietly
 * buys nothing while a caller waits for data.
 */
function validatePolicy(policy: PurchasePolicy): void {
  if (!Number.isInteger(policy.chainId) || policy.chainId <= 0) {
    throw new PurchaseError(
      `chainId is ${policy.chainId}, which is not a chain. Without one, an option for any ` +
        `chain would be acceptable, including the one where the money is real.`,
    );
  }
  if (policy.tokens.length === 0) {
    throw new PurchaseError(
      "No tokens are configured, so no payment option can ever match. An agent that can pay " +
        "with nothing is switched off, and should say so rather than refusing every seller.",
    );
  }
  for (const token of policy.tokens) assertToken18(token);
  if (policy.rails.length === 0) {
    throw new PurchaseError(
      "No way of authorising a payment is configured, so nothing can be signed.",
    );
  }
  if (policy.maxPricePerCallUnits <= 0n) {
    throw new PurchaseError(
      `maxPricePerCallUnits is ${policy.maxPricePerCallUnits}. A cap of zero refuses every ` +
        `seller, including free ones, because a free call is never paid for at all.`,
    );
  }
  if (policy.windowBudgetUnits < policy.maxPricePerCallUnits) {
    throw new PurchaseError(
      `windowBudgetUnits (${policy.windowBudgetUnits}) is below maxPricePerCallUnits ` +
        `(${policy.maxPricePerCallUnits}). The per-call cap could then never be the reason for ` +
        `a refusal, so it would look like a control while doing nothing.`,
    );
  }
  if (!Number.isInteger(policy.maxTimeoutSeconds) || policy.maxTimeoutSeconds <= 0) {
    throw new PurchaseError(
      `maxTimeoutSeconds is ${policy.maxTimeoutSeconds}. An authorisation valid for no time at ` +
        `all can never be settled, so every payment would be wasted.`,
    );
  }
}

function refuse(index: number, rule: RefusalRule, detail: string): RefusedOption {
  return { index, rule, detail };
}

function tokenFor(policy: PurchasePolicy, asset: `0x${string}`): TokenChoice | undefined {
  return policy.tokens.find((t) => t.address.toLowerCase() === asset.toLowerCase());
}

/** What is left of the window ceiling, never below zero. */
export function windowRemainingUnits(ledger: SpendLedger, policy: PurchasePolicy): bigint {
  const spent = ledger.spentUnits < 0n ? 0n : ledger.spentUnits;
  const left = policy.windowBudgetUnits - spent;
  return left < 0n ? 0n : left;
}

/** How much of the window ceiling a total uses, in bps, rounded up. */
export function windowUsedBps(totalUnits: bigint, policy: PurchasePolicy): bigint {
  if (totalUnits <= 0n) return 0n;
  if (policy.windowBudgetUnits <= 0n) return BPS_ONE;
  return (totalUnits * BPS_ONE + policy.windowBudgetUnits - 1n) / policy.windowBudgetUnits;
}

/**
 * Every option against every rule, in an order chosen so that the reason a caller reads
 * is the real one.
 *
 * The identity rules run first: what chain, what token, who gets paid. They are absolute,
 * they are cheap, and a caller told "too expensive" about an option that was also for the
 * wrong chain has been told the less useful of two true things. The money rules run last.
 */
function screen(
  demand: PriceDemand,
  policy: PurchasePolicy,
  ledger: SpendLedger,
  expectedPayee: `0x${string}` | undefined,
): { candidates: { option: PaymentOption; token: TokenChoice }[]; refused: RefusedOption[] } {
  const remaining = windowRemainingUnits(ledger, policy);
  const candidates: { option: PaymentOption; token: TokenChoice }[] = [];
  const refused: RefusedOption[] = [];

  for (const option of demand.options) {
    // Rule SCHEME. Only one scheme exists on this wire, and an option naming another is
    // asking for a signature over something this agent has never read.
    if (option.scheme !== "exact") {
      refused.push(
        refuse(option.index, "SCHEME", `asks for a "${option.scheme}" payment, which this agent does not make`),
      );
      continue;
    }

    // Rule CHAIN. The same token address exists on more than one chain, and one of those
    // chains has real money on it. An option whose chain cannot be read is refused here
    // too, because "unknown chain" and "any chain" are the same thing when signing.
    if (option.chainId === null || option.chainId !== policy.chainId) {
      refused.push(
        refuse(
          option.index,
          "CHAIN",
          `is for chain ${option.chainId ?? "unknown"}, and this agent only pays on chain ${policy.chainId}`,
        ),
      );
      continue;
    }

    // Rule RAIL. What is signed differs completely between the two, so an unreadable
    // method is a signature over an unknown thing.
    if (option.rail === null || !policy.rails.includes(option.rail)) {
      refused.push(
        refuse(
          option.index,
          "RAIL",
          `authorises payment by "${option.rail ?? "an unnamed method"}", and this agent signs ` +
            `only ${policy.rails.join(" or ")}`,
        ),
      );
      continue;
    }

    // Rule TOKEN. The seller names the token, so without a list this agent would sign
    // away whichever token the seller preferred it to spend.
    const token = option.asset === null ? undefined : tokenFor(policy, option.asset);
    if (token === undefined) {
      refused.push(
        refuse(
          option.index,
          "TOKEN",
          `asks to be paid in ${option.asset ?? "an unreadable token"}, which is not one of the ` +
            `tokens this agent pays with`,
        ),
      );
      continue;
    }

    // Rule PAYEE. The recipient is bound into the signature, so it is the one field that
    // decides where the money actually goes.
    if (option.payTo === null) {
      refused.push(refuse(option.index, "PAYEE", "does not say who gets paid"));
      continue;
    }
    if (expectedPayee !== undefined && option.payTo.toLowerCase() !== expectedPayee.toLowerCase()) {
      refused.push(
        refuse(
          option.index,
          "PAYEE",
          `pays ${option.payTo}, and the caller expected ${expectedPayee}`,
        ),
      );
      continue;
    }

    // Rule AMOUNT. An unreadable amount is not free. Treating it as zero is how an agent
    // signs a blank authorisation.
    if (option.amount === null || option.amount <= 0n) {
      refused.push(
        refuse(
          option.index,
          "AMOUNT",
          option.amount === null
            ? "does not name an amount this agent can read"
            : "names an amount of zero, which is not a price",
        ),
      );
      continue;
    }

    // Rule TIMEOUT_WINDOW. The window is how long a signed authorisation stays money the
    // seller can take.
    if (option.maxTimeoutSeconds !== null && option.maxTimeoutSeconds > policy.maxTimeoutSeconds) {
      refused.push(
        refuse(
          option.index,
          "TIMEOUT_WINDOW",
          `wants the authorisation to stay usable for ${option.maxTimeoutSeconds} seconds, and ` +
            `this agent signs for at most ${policy.maxTimeoutSeconds}`,
        ),
      );
      continue;
    }

    // Rule PRICE_CAP. The seller sets the price with no upper bound in the format, so
    // this is the only thing standing between the agent and whatever it is asked for.
    if (option.amount > policy.maxPricePerCallUnits) {
      refused.push(
        refuse(
          option.index,
          "PRICE_CAP",
          `asks ${formatToken18(option.amount)} ${token.symbol} for one call, and this agent pays ` +
            `at most ${formatToken18(policy.maxPricePerCallUnits)}`,
        ),
      );
      continue;
    }

    // Rule WINDOW. Last, because it is the only rule whose answer changes as the agent
    // works rather than because of anything in this reply.
    if (option.amount > remaining) {
      refused.push(
        refuse(
          option.index,
          "WINDOW",
          `asks ${formatToken18(option.amount)} ${token.symbol} and only ` +
            `${formatToken18(remaining)} is left of what this agent may spend in this window`,
        ),
      );
      continue;
    }

    candidates.push({ option, token });
  }

  return { candidates, refused };
}

/**
 * The order among options that all passed. TOTAL: no two can tie.
 *
 *   1. the rail this agent prefers, in the order the policy lists them;
 *   2. then the smaller amount;
 *   3. then the position the seller put it in, which is unique.
 *
 * The rail comes first rather than the price because the two rails are not
 * interchangeable: one works for any approved token and has its signature checked by the
 * settling contract, and the other only works for tokens whose transfer authorisation
 * understands contract signatures. Choosing a cheaper option on a rail this wallet cannot
 * actually use buys nothing at a lower price. Key 3 is not a judgement, it is what makes
 * the answer reproducible.
 */
export function compareCandidates(
  a: { option: PaymentOption },
  b: { option: PaymentOption },
  policy: PurchasePolicy,
): number {
  const rankA = policy.rails.indexOf(a.option.rail as never);
  const rankB = policy.rails.indexOf(b.option.rail as never);
  if (rankA !== rankB) return rankA - rankB;
  const amountA = a.option.amount as bigint;
  const amountB = b.option.amount as bigint;
  if (amountA !== amountB) return amountA < amountB ? -1 : 1;
  return a.option.index - b.option.index;
}

function buildReason(
  action: PurchaseDecision["action"],
  chosen: ChosenPayment | null,
  refused: readonly RefusedOption[],
  remaining: bigint,
): string {
  switch (action) {
    case "PAY": {
      const c = chosen as ChosenPayment;
      return (
        `Paying ${formatToken18(c.amountUnits)} ${c.symbol} to ${c.payTo} for this one call, ` +
        `authorised for ${c.timeoutSeconds} seconds and no longer. Nothing else this agent ` +
        `holds is signed away by it.`
      );
    }
    case "WINDOW_EXHAUSTED":
      return (
        "This agent has already spent everything it is allowed to spend in this window, so it " +
        "will not pay for anything until the window resets. Nothing was signed."
      );
    case "REFUSED": {
      if (refused.length === 0) {
        return (
          "The seller asked for payment but offered no way to pay that this agent could read. " +
          "Nothing was signed."
        );
      }
      const counts = new Map<string, number>();
      for (const r of refused) counts.set(r.rule, (counts.get(r.rule) ?? 0) + 1);
      const summary = [...counts.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([rule, n]) => `${rule} x${n}`)
        .join(", ");
      return (
        `Every way the seller offered to be paid was put aside by a rule this agent will not ` +
        `bend: ${summary}. Nothing was signed, and ${formatToken18(remaining)} is still ` +
        `available in this window.`
      );
    }
  }
}

/**
 * Decides whether to pay one seller's demand, and with which of the options it offered.
 *
 * The two refusals are told apart because they need different things from a caller.
 * WINDOW_EXHAUSTED means this agent is finished for the window and no seller will change
 * that. REFUSED means this particular demand did not pass, and a different seller might.
 */
export function decidePurchase(
  demand: PriceDemand,
  policy: PurchasePolicy = DEFAULT_POLICY,
  ledger: SpendLedger = { spentUnits: 0n, windowStartedAt: 0n },
  opts: { expectedPayee?: `0x${string}` } = {},
): PurchaseDecision {
  validatePolicy(policy);

  const remaining = windowRemainingUnits(ledger, policy);
  if (remaining <= 0n) {
    return {
      action: "WINDOW_EXHAUSTED",
      chosen: null,
      refused: [],
      windowRemainingUnits: 0n,
      windowUsedBps: BPS_ONE,
      puffLevel: 4,
      reason: buildReason("WINDOW_EXHAUSTED", null, [], 0n),
    };
  }

  const { candidates, refused } = screen(demand, policy, ledger, opts.expectedPayee);

  if (candidates.length === 0) {
    return {
      action: "REFUSED",
      chosen: null,
      refused,
      windowRemainingUnits: remaining,
      windowUsedBps: windowUsedBps(ledger.spentUnits, policy),
      puffLevel: puffFromWindowBps(windowUsedBps(ledger.spentUnits, policy)),
      reason: buildReason("REFUSED", null, refused, remaining),
    };
  }

  const best = [...candidates].sort((a, b) => compareCandidates(a, b, policy))[0]!;
  const option = best.option;
  const amount = option.amount as bigint;

  // The validity window this agent signs is the seller's, and the rule above has already
  // refused any seller asking for one longer than this agent allows, so what is left here
  // can only be shorter or equal. A seller that says nothing gets this agent's own
  // maximum. There is deliberately no second cap here: a `Math.min` at this point would be
  // a branch that can never be taken, which reads as a safeguard while testing nothing.
  const timeoutSeconds = option.maxTimeoutSeconds ?? policy.maxTimeoutSeconds;

  const usedAfter = windowUsedBps(ledger.spentUnits + amount, policy);

  const chosen: ChosenPayment = {
    index: option.index,
    rail: option.rail as NonNullable<PaymentOption["rail"]>,
    asset: option.asset as `0x${string}`,
    symbol: best.token.symbol,
    payTo: option.payTo as `0x${string}`,
    amountUnits: amount,
    timeoutSeconds,
  };

  return {
    action: "PAY",
    chosen,
    refused,
    windowRemainingUnits: remaining,
    windowUsedBps: usedAfter,
    puffLevel: puffFromWindowBps(usedAfter),
    reason: buildReason("PAY", chosen, refused, remaining),
  };
}
