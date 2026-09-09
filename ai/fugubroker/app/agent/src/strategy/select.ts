/**
 * The filters, the period arithmetic, and the ranking.
 *
 * PURE: no network, no clock, no `process.env`, no I/O. Each rule is one exported
 * function or one named branch with its own rejection code, so that a rule which stops
 * working stops a test rather than quietly widening what this agent is willing to pay
 * for.
 */
import {
  BPS_ONE,
  type CatalogListing,
  type HireQuote,
  type HiringPolicy,
  type HiringRequest,
  type RejectedListing,
  type RejectionRule,
} from "./types.js";
import { formatDuration, formatUsd8Exact } from "./format.js";

/** Address comparison. Addresses differ in letter case between sources; values do not. */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * How many whole periods cover `workSeconds`, rounded UP.
 *
 * Rounded up, never down: a rental that ends before the work does is a rental that has
 * to be bought again half way through, and the second purchase happens at whatever the
 * price is then. Zero seconds of work still costs one period, because the catalog sells
 * periods and there is no fraction of one to buy.
 */
export function periodsForWork(workSeconds: bigint, periodSeconds: bigint): bigint {
  if (periodSeconds <= 0n) {
    throw new RangeError(`A period of ${periodSeconds} seconds cannot cover any work.`);
  }
  if (workSeconds <= 0n) return 1n;
  return (workSeconds + periodSeconds - 1n) / periodSeconds;
}

/**
 * The ceiling actually in force: the smallest of the three that exist.
 *
 *   1. what the caller allows for this hire;
 *   2. what this agent allows for any one hire;
 *   3. what is left of what this agent allows across the window.
 *
 * The smallest wins, always. A caller cannot raise a limit by asking for more, and a
 * policy cannot force a spend the caller did not want. The third one is the only one that
 * can reach zero on its own, and when it does every listing becomes unaffordable at once,
 * which is exactly what a spent budget should look like.
 */
export function effectiveBudgetUsd8(request: HiringRequest, policy: HiringPolicy): bigint {
  const caller = request.budgetUsd8 < 0n ? 0n : request.budgetUsd8;
  const spent = request.alreadySpentUsd8 ?? 0n;
  const windowLeft = policy.windowBudgetUsd8 - (spent < 0n ? 0n : spent);
  const remaining = windowLeft < 0n ? 0n : windowLeft;

  let budget = caller;
  if (policy.maxTotalUsd8 < budget) budget = policy.maxTotalUsd8;
  if (remaining < budget) budget = remaining;
  return budget;
}

/** How much of the window ceiling is left, never below zero. */
export function windowRemainingUsd8(request: HiringRequest, policy: HiringPolicy): bigint {
  const spent = request.alreadySpentUsd8 ?? 0n;
  const left = policy.windowBudgetUsd8 - (spent < 0n ? 0n : spent);
  return left < 0n ? 0n : left;
}

/**
 * How much of the ceiling a total uses, in bps, rounded UP.
 *
 * Rounded up so the number that drives the puff level never understates the commitment.
 * A zero ceiling reports the maximum: spending anything at all when nothing is allowed
 * is fully loaded, not undefined.
 */
export function budgetUsedBps(totalUsd8: bigint, budgetUsd8: bigint): bigint {
  if (totalUsd8 <= 0n) return 0n;
  if (budgetUsd8 <= 0n) return BPS_ONE;
  return (totalUsd8 * BPS_ONE + budgetUsd8 - 1n) / budgetUsd8;
}

function reject(listingId: bigint, rule: RejectionRule, detail: string): RejectedListing {
  return { listingId, rule, detail };
}

export interface ScreenResult {
  quotes: HireQuote[];
  rejected: RejectedListing[];
}

/**
 * Runs every listing past every rule, and prices the survivors.
 *
 * The order of the rules is chosen so that the CHEAPEST checks that are also the most
 * absolute run first: a listing in the wrong category or switched off can never be
 * hired, whatever the money says, and there is no reason to price it. The money rules
 * run last, so the rejection a caller sees for an affordable-but-wrong listing names the
 * real problem instead of the price.
 *
 * Every listing produces either one quote or one rejection. Nothing is dropped in
 * silence: a catalog entry that vanishes without a reason is how a filter bug looks from
 * the outside.
 */
export function screenCatalog(
  catalog: readonly CatalogListing[],
  request: HiringRequest,
  policy: HiringPolicy,
  self: { owner?: `0x${string}`; agentWallet?: `0x${string}` } = {},
): ScreenResult {
  const budget = effectiveBudgetUsd8(request, policy);
  const excluded = (request.excludeOwners ?? []).map((a) => a.toLowerCase());

  const quotes: HireQuote[] = [];
  const rejected: RejectedListing[] = [];

  for (const listing of catalog) {
    // Rule CATEGORY. An agent hired for the wrong capability is money spent on work
    // nobody asked for, and it looks like a success from every angle except the result.
    if (listing.category !== request.category) {
      rejected.push(
        reject(
          listing.listingId,
          "CATEGORY",
          `offers ${listing.category}, and ${request.category} was asked for`,
        ),
      );
      continue;
    }

    // Rule INACTIVE. The payment contract refuses an inactive listing, so choosing one
    // guarantees a failed transaction that still costs a fee to attempt.
    if (!listing.active) {
      rejected.push(reject(listing.listingId, "INACTIVE", "the listing is switched off"));
      continue;
    }

    // Rule SELF. Paying ourselves moves money out, takes the platform fee off it, and
    // returns the rest. It is a loss dressed up as activity.
    if (
      (self.owner !== undefined && sameAddress(listing.owner, self.owner)) ||
      (self.agentWallet !== undefined && sameAddress(listing.agentWallet, self.agentWallet))
    ) {
      rejected.push(
        reject(listing.listingId, "SELF", "this agent would be paying itself"),
      );
      continue;
    }

    // Rule EXCLUDED_OWNER. The caller named someone they will not pay.
    if (excluded.includes(listing.owner.toLowerCase())) {
      rejected.push(
        reject(
          listing.listingId,
          "EXCLUDED_OWNER",
          `${listing.owner} is on the caller's refuse list`,
        ),
      );
      continue;
    }

    // Rule NOT_CURATED. Anyone may add a listing, and the vetting mark is the only claim
    // in the catalog that someone other than the seller made.
    if (request.requireCurated === true && !listing.curated) {
      rejected.push(
        reject(listing.listingId, "NOT_CURATED", "no reviewer has vetted this listing"),
      );
      continue;
    }

    // Rule NO_ONCHAIN_EXECUTION. Some listings decide and explain; some also act. A
    // caller who needs the work done cannot use one that only advises.
    if (request.requireOnchainExecution === true && !listing.onchainExecution) {
      rejected.push(
        reject(
          listing.listingId,
          "NO_ONCHAIN_EXECUTION",
          "this listing gives advice and does not carry out the work itself",
        ),
      );
      continue;
    }

    // Rule PERIOD_LENGTH. Outside this band the arithmetic below stops describing
    // anything sensible: a one-second period needs millions of periods for a day of
    // work, and a one-year period means one payment covers a year of behaviour that has
    // not happened yet.
    if (
      listing.periodSeconds < policy.minPeriodSeconds ||
      listing.periodSeconds > policy.maxPeriodSeconds
    ) {
      rejected.push(
        reject(
          listing.listingId,
          "PERIOD_LENGTH",
          `rents in blocks of ${formatDuration(listing.periodSeconds)}, and this agent rents in ` +
            `blocks between ${formatDuration(policy.minPeriodSeconds)} and ` +
            `${formatDuration(policy.maxPeriodSeconds)}`,
        ),
      );
      continue;
    }

    // Rule PRICE_PER_PERIOD. A seller can change a price with one transaction. The total
    // ceiling alone would answer a tenfold rise by buying fewer periods; this rule
    // answers it by stopping.
    if (listing.priceUsd8PerPeriod > policy.maxPricePerPeriodUsd8) {
      rejected.push(
        reject(
          listing.listingId,
          "PRICE_PER_PERIOD",
          `asks ${formatUsd8Exact(listing.priceUsd8PerPeriod)} for one block of time, and this ` +
            `agent pays at most ${formatUsd8Exact(policy.maxPricePerPeriodUsd8)}`,
        ),
      );
      continue;
    }

    const periods = periodsForWork(request.workSeconds, listing.periodSeconds);

    // Rule TOO_MANY_PERIODS. This agent refuses to buy less time than the work needs, so
    // when the cap cannot cover the work the answer is no, not a shorter rental. A
    // rental that runs out half way through has to be renewed at the seller's price.
    if (periods > policy.maxPeriods) {
      rejected.push(
        reject(
          listing.listingId,
          "TOO_MANY_PERIODS",
          `covering ${formatDuration(request.workSeconds)} would need ${periods} blocks of ` +
            `${formatDuration(listing.periodSeconds)}, and this agent pays for at most ` +
            `${policy.maxPeriods} at a time`,
        ),
      );
      continue;
    }

    const totalUsd8 = listing.priceUsd8PerPeriod * periods;

    // Rule OVER_BUDGET. Last, so that the reason a caller reads is the money only when
    // money is genuinely the reason.
    if (totalUsd8 > budget) {
      rejected.push(
        reject(
          listing.listingId,
          "OVER_BUDGET",
          `would cost ${formatUsd8Exact(totalUsd8)} and the limit for this hire is ` +
            `${formatUsd8Exact(budget)}`,
        ),
      );
      continue;
    }

    quotes.push({
      listingId: listing.listingId,
      name: listing.name,
      category: listing.category,
      owner: listing.owner,
      agentWallet: listing.agentWallet,
      curated: listing.curated,
      onchainExecution: listing.onchainExecution,
      pricePerPeriodUsd8: listing.priceUsd8PerPeriod,
      periodSeconds: listing.periodSeconds,
      periods,
      coveredSeconds: periods * listing.periodSeconds,
      totalUsd8,
    });
  }

  return { quotes, rejected };
}

/**
 * The ranking, in three keys, and it is TOTAL: no two catalog entries can tie.
 *
 *   1. the smaller total cost, because money is what this agent is spending;
 *   2. then a vetted listing over an unvetted one, because the vetting mark is the only
 *      claim in the catalog that did not come from the seller;
 *   3. then the lower listing id, which is unique, so the order never depends on the
 *      order the catalog happened to be read in.
 *
 * NOT CONFIDENT about the order of the first two. Putting the vetting mark first would
 * be defensible too, since the money gate has already run and every survivor is
 * affordable by construction. Cost is first here because an agent that spends money
 * should have to justify spending MORE, and a caller who wants vetting can demand it
 * with `requireCurated`, which is a hard rule rather than a preference. Key 3 is not a
 * judgement, it is what makes the result reproducible.
 */
export function compareQuotes(a: HireQuote, b: HireQuote): number {
  if (a.totalUsd8 !== b.totalUsd8) return a.totalUsd8 < b.totalUsd8 ? -1 : 1;
  if (a.curated !== b.curated) return a.curated ? -1 : 1;
  if (a.listingId !== b.listingId) return a.listingId < b.listingId ? -1 : 1;
  return 0;
}

/** The survivors in decision order. A copy: the caller's array is never reordered. */
export function rankQuotes(quotes: readonly HireQuote[]): HireQuote[] {
  return [...quotes].sort(compareQuotes);
}
