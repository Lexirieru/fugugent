/**
 * The Broker decision engine.
 *
 * PURE: no network, no `Date.now()`, no `process.env`, no I/O. The whole outside world
 * arrives through arguments. Financial decisions never pass through an LLM. The
 * explanation layer may re-word the sentence in `reason`; it may never change a number
 * in it, and it may never turn a refusal into a hire.
 *
 * The question this engine answers is narrow on purpose: given a catalog someone else
 * wrote, which single listing should be paid, for how many blocks of time, and what does
 * that cost. Everything that follows, the payment itself, is arithmetic on that answer.
 *
 * There are two ways to be wrong here and they are not symmetric. Refusing a good hire
 * costs a caller a delay and produces a sentence explaining why. Making a bad hire moves
 * money to somebody else and cannot be undone by this agent. Every rule leans toward the
 * first mistake.
 */
import {
  budgetUsedBps,
  effectiveBudgetUsd8,
  rankQuotes,
  screenCatalog,
  windowRemainingUsd8,
} from "./select.js";
import { formatDuration, formatUsd8Exact } from "./format.js";
import {
  DEFAULT_POLICY,
  HiringError,
  puffFromBudgetBps,
  type CatalogListing,
  type HireDecision,
  type HireQuote,
  type HiringPolicy,
  type HiringRequest,
  type RejectedListing,
} from "./types.js";

/**
 * A policy whose parts contradict each other must fail at the door.
 *
 * The dangerous case is not a value that is too large or too small; it is a policy under
 * which NO listing can ever be chosen. An agent like that looks like it is working, is
 * green in every test, and quietly never hires anything.
 */
function validatePolicy(policy: HiringPolicy): void {
  if (policy.maxTotalUsd8 <= 0n) {
    throw new HiringError(
      `maxTotalUsd8 is ${policy.maxTotalUsd8}. A limit of zero or less means this agent can ` +
        `never hire anything, which is a switched-off agent written as a number.`,
    );
  }
  if (policy.maxPricePerPeriodUsd8 <= 0n) {
    throw new HiringError(
      `maxPricePerPeriodUsd8 is ${policy.maxPricePerPeriodUsd8}; no priced listing can clear it. ` +
        `The catalog contract refuses a price of zero, so nothing is left to choose from.`,
    );
  }
  if (policy.maxPricePerPeriodUsd8 > policy.maxTotalUsd8) {
    throw new HiringError(
      `maxPricePerPeriodUsd8 (${formatUsd8Exact(policy.maxPricePerPeriodUsd8)}) is above ` +
        `maxTotalUsd8 (${formatUsd8Exact(policy.maxTotalUsd8)}). One block of time would be ` +
        `allowed by one limit and refused by the other, so the per-block limit could never ` +
        `be the reason for a refusal and would be dead weight.`,
    );
  }
  if (policy.windowBudgetUsd8 < policy.maxTotalUsd8) {
    throw new HiringError(
      `windowBudgetUsd8 (${formatUsd8Exact(policy.windowBudgetUsd8)}) is below maxTotalUsd8 ` +
        `(${formatUsd8Exact(policy.maxTotalUsd8)}). The per-hire limit could then never be the ` +
        `reason for a refusal, so it would look like a control while doing nothing.`,
    );
  }
  if (policy.maxPeriods <= 0n) {
    throw new HiringError(
      `maxPeriods is ${policy.maxPeriods}. Every hire needs at least one block of time.`,
    );
  }
  if (policy.minPeriodSeconds <= 0n || policy.maxPeriodSeconds < policy.minPeriodSeconds) {
    throw new HiringError(
      `The block-length band is empty: ${policy.minPeriodSeconds}..${policy.maxPeriodSeconds} ` +
        `seconds. The correct ordering is 0 < minPeriodSeconds <= maxPeriodSeconds.`,
    );
  }
  if (policy.slippageBps < 0n) {
    throw new HiringError(
      `slippageBps is ${policy.slippageBps}. A negative allowance would set a payment ceiling ` +
        `below the price that was quoted, so every payment would be refused.`,
    );
  }
  if (policy.intentTtlSeconds <= 0n) {
    throw new HiringError(
      `intentTtlSeconds is ${policy.intentTtlSeconds}. A decision that is already expired when ` +
        `it is made can never be acted on.`,
    );
  }
}

/**
 * A request that makes no sense must fail hard, not turn quietly into a hire.
 *
 * A negative amount of work is the example. Rounded up, it becomes one block of time,
 * and the agent pays real money to rent an agent for a job whose length the caller got
 * wrong. Refusing is the cheap outcome.
 */
function validateRequest(request: HiringRequest): void {
  if (request.workSeconds < 0n) {
    throw new HiringError(
      `workSeconds is ${request.workSeconds}. Work cannot take a negative amount of time, and ` +
        `rounding that up to one block would pay real money for a request that is wrong.`,
    );
  }
  if (request.budgetUsd8 < 0n) {
    throw new HiringError(
      `budgetUsd8 is ${request.budgetUsd8}; a limit cannot be negative.`,
    );
  }
}

function catalogSanity(catalog: readonly CatalogListing[]): void {
  const seen = new Set<string>();
  for (const listing of catalog) {
    const key = listing.listingId.toString();
    if (seen.has(key)) {
      throw new HiringError(
        `Listing ${key} appears twice in the catalog. Two entries with the same id make the ` +
          `ranking depend on which copy was read first, and a hire has to be reproducible.`,
      );
    }
    seen.add(key);
    if (listing.priceUsd8PerPeriod <= 0n) {
      throw new HiringError(
        `Listing ${key} carries a price of ${listing.priceUsd8PerPeriod}. The catalog contract ` +
          `refuses a price of zero, so this reading is wrong rather than free.`,
      );
    }
    if (listing.periodSeconds <= 0n) {
      throw new HiringError(
        `Listing ${key} rents in blocks of ${listing.periodSeconds} seconds. The catalog ` +
          `contract refuses a block of zero, so this reading is wrong.`,
      );
    }
  }
}

/**
 * The reason a caller reads. It always names the number that decided the outcome, so
 * that "no" is as useful as "yes".
 */
function buildReason(
  action: HireDecision["action"],
  request: HiringRequest,
  budgetUsd8: bigint,
  chosen: HireQuote | null,
  rejected: readonly RejectedListing[],
  considered: number,
): string {
  switch (action) {
    case "HIRE": {
      const q = chosen as HireQuote;
      const who = q.name.length > 0 ? q.name : `listing ${q.listingId}`;
      return (
        `Hiring ${who} for ${q.periods} block${q.periods === 1n ? "" : "s"} of ` +
        `${formatDuration(q.periodSeconds)}, which covers ${formatDuration(q.coveredSeconds)} of ` +
        `the ${formatDuration(request.workSeconds)} asked for, at ` +
        `${formatUsd8Exact(q.totalUsd8)} in total against a limit of ${formatUsd8Exact(budgetUsd8)}. ` +
        `The money is paid up front and is released to the seller as the time passes.`
      );
    }
    case "OVER_BUDGET": {
      const cheapest = rejected
        .filter((r) => r.rule === "OVER_BUDGET")
        .map((r) => r.detail)
        .join("; ");
      return (
        `Every agent that can do this work costs more than the ${formatUsd8Exact(budgetUsd8)} ` +
        `limit for this hire. Nothing was paid. ${cheapest}`
      );
    }
    case "BLOCKED_BY_POLICY":
      return (
        `Agents offering ${request.category} were found, but all of them were put aside by a ` +
        `rule this agent will not bend: ${summariseRules(rejected)}. Nothing was paid.`
      );
    case "NO_MATCH":
      return (
        `No agent in the catalog offers ${request.category}. ${considered} listing` +
        `${considered === 1 ? " was" : "s were"} looked at and nothing was paid.`
      );
    case "WINDOW_EXHAUSTED":
      return (
        `This agent has already spent everything it is allowed to spend on hiring in this ` +
        `window. Nothing was paid, and nothing will be until the window resets.`
      );
  }
}

function summariseRules(rejected: readonly RejectedListing[]): string {
  const counts = new Map<string, number>();
  for (const r of rejected) {
    if (r.rule === "CATEGORY") continue;
    counts.set(r.rule, (counts.get(r.rule) ?? 0) + 1);
  }
  if (counts.size === 0) return "none recorded";
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([rule, n]) => `${rule} x${n}`)
    .join(", ");
}

/**
 * Chooses at most one listing to hire, and prices it.
 *
 * The action tells apart three different kinds of "no", because they need three
 * different things from the caller:
 *   NO_MATCH           nobody offers this capability, so wait or ask for something else;
 *   BLOCKED_BY_POLICY  somebody offers it and a rule refused them, so change the request;
 *   OVER_BUDGET        somebody offers it at a price above the limit, so raise the limit.
 * Collapsing them into one "no" would leave a caller guessing which lever to pull.
 */
export function decide(
  catalog: readonly CatalogListing[],
  request: HiringRequest,
  policy: HiringPolicy = DEFAULT_POLICY,
  self: { owner?: `0x${string}`; agentWallet?: `0x${string}` } = {},
): HireDecision {
  validatePolicy(policy);
  validateRequest(request);
  catalogSanity(catalog);

  // Checked before the catalog is even looked at. When there is nothing left to spend,
  // every listing is unaffordable for the same single reason, and reporting that reason
  // once is more useful than reporting it once per listing.
  if (windowRemainingUsd8(request, policy) <= 0n) {
    return {
      action: "WINDOW_EXHAUSTED",
      chosen: null,
      runnerUp: null,
      considered: catalog.length,
      rejected: [],
      budgetUsd8: 0n,
      budgetUsedBps: 0n,
      puffLevel: 4,
      reason: buildReason("WINDOW_EXHAUSTED", request, 0n, null, [], catalog.length),
    };
  }

  const budgetUsd8 = effectiveBudgetUsd8(request, policy);
  const { quotes, rejected } = screenCatalog(catalog, request, policy, self);
  const ranked = rankQuotes(quotes);
  const considered = catalog.length;

  if (ranked.length === 0) {
    const inCategory = rejected.filter((r) => r.rule !== "CATEGORY");
    const overBudgetOnly =
      inCategory.length > 0 && inCategory.every((r) => r.rule === "OVER_BUDGET");
    const action = inCategory.length === 0
      ? "NO_MATCH"
      : overBudgetOnly
        ? "OVER_BUDGET"
        : "BLOCKED_BY_POLICY";
    return {
      action,
      chosen: null,
      runnerUp: null,
      considered,
      rejected,
      budgetUsd8,
      budgetUsedBps: 0n,
      puffLevel: 0,
      reason: buildReason(action, request, budgetUsd8, null, rejected, considered),
    };
  }

  const chosen = ranked[0] as HireQuote;
  const usedBps = budgetUsedBps(chosen.totalUsd8, budgetUsd8);

  return {
    action: "HIRE",
    chosen,
    runnerUp: ranked.length > 1 ? (ranked[1] as HireQuote) : null,
    considered,
    rejected,
    budgetUsd8,
    budgetUsedBps: usedBps,
    puffLevel: puffFromBudgetBps(usedBps),
    reason: buildReason("HIRE", request, budgetUsd8, chosen, rejected, considered),
  };
}
