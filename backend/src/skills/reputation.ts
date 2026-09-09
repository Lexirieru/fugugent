/**
 * Auditor reputation, read from the contract that already exists.
 *
 * `FuguReputation` is live on BSC testnet at
 * `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400`. It stores, per `listingId`, an
 * average score (x100) and a review count, and it only accepts a review from a
 * wallet that has actually paid the listing. An auditor is an agent with a
 * listing, so its reputation maps onto that contract rather than onto a second,
 * ungated scoreboard invented for this feature. Anyone can check a number we
 * publish:
 *
 * ```bash
 * cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
 *   0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400 \
 *   'averageScoreX100(uint256)(uint256)' <LISTING_ID>
 * ```
 *
 * ## The rule this module exists to enforce
 *
 * **`reputation.source` is `"onchain"` only when a chain read genuinely
 * succeeded.** Three outcomes, kept apart:
 *
 * - no reader wired, or the auditor has no listing → `unavailable` (a
 *   configuration, not a failure — the same distinction the fallback ladder
 *   draws between `unavailable` and `unhealthy`);
 * - a reader is wired and the call failed → `unhealthy`, with the reason;
 * - the call returned → `onchain`, with the numbers.
 *
 * A missing reputation is never rendered as a zero score. Zero means "reviewed
 * and rated zero", which is a claim; `null` means we did not read it.
 */

import type { Address } from "../types.js";
import type { AuditorRecord, AuditorReputation } from "./types.js";

/** The two view functions this module needs. Nothing else is called. */
export const FUGU_REPUTATION_ABI = [
  {
    type: "function",
    name: "averageScoreX100",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "reviewCount",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** One reputation read. Never throws — a failure is a shape, not an exception. */
export interface ReputationReading {
  averageScoreX100: number | null;
  reviewCount: number | null;
  healthy: boolean;
  reason: string | null;
}

/**
 * The reputation reader as a port.
 *
 * Injected, so no test in this feature touches a real RPC endpoint, and so a
 * backend with no chain access still answers `/api/auditors` with
 * `source: "unavailable"` instead of failing.
 */
export interface AuditorReputationSource {
  contract: Address;
  read(listingId: bigint): Promise<ReputationReading>;
}

/** A minimal view of viem's `PublicClient` — only what is used here. */
export interface ReputationChainClient {
  readContract(args: {
    address: Address;
    abi: typeof FUGU_REPUTATION_ABI;
    functionName: "averageScoreX100" | "reviewCount";
    args: readonly [bigint];
  }): Promise<unknown>;
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.split("\n")[0]}`;
  return `unknown failure: ${String(error)}`;
}

/**
 * A `uint256` from the contract → a `number`.
 *
 * Safe here and only here: both values are bounded by the contract's own
 * `uint128` accumulators divided down, and a score of 500 or a review count in
 * the thousands is not money. Anything beyond `Number.MAX_SAFE_INTEGER` is
 * reported as `null` rather than silently rounded — an unreadable count is not
 * a count.
 */
function toCount(value: unknown): number | null {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return null;
}

export function createReputationSource(
  client: ReputationChainClient,
  contract: Address,
): AuditorReputationSource {
  return {
    contract,
    async read(listingId: bigint): Promise<ReputationReading> {
      try {
        const [average, count] = await Promise.all([
          client.readContract({
            address: contract,
            abi: FUGU_REPUTATION_ABI,
            functionName: "averageScoreX100",
            args: [listingId],
          }),
          client.readContract({
            address: contract,
            abi: FUGU_REPUTATION_ABI,
            functionName: "reviewCount",
            args: [listingId],
          }),
        ]);
        return {
          averageScoreX100: toCount(average),
          reviewCount: toCount(count),
          healthy: true,
          reason: null,
        };
      } catch (error) {
        return {
          averageScoreX100: null,
          reviewCount: null,
          healthy: false,
          reason: describe(error),
        };
      }
    },
  };
}

/**
 * Attach a reputation reading to one auditor.
 *
 * Never throws, and never upgrades a failure into a number. The auditor record
 * comes back unchanged apart from its `reputation` field, so a caller cannot
 * accidentally lose the rest of the record on a failed read.
 */
export async function attachReputation(
  auditor: AuditorRecord,
  source: AuditorReputationSource | undefined,
  now: Date,
): Promise<AuditorRecord> {
  if (source === undefined) {
    return withReputation(auditor, {
      averageScoreX100: null,
      reviewCount: null,
      source: "unavailable",
      reason: "no on-chain reputation reader is wired into this instance",
      contract: null,
      fetchedAt: null,
    });
  }

  if (auditor.reputationListingId === null) {
    return withReputation(auditor, {
      averageScoreX100: null,
      reviewCount: null,
      source: "unavailable",
      reason:
        "this auditor has no FuguRegistry listing yet, so it has no on-chain reputation to read",
      contract: source.contract,
      fetchedAt: null,
    });
  }

  // The port promises not to throw. Wrapping it anyway is the same rule
  // `src/service/agents.ts` follows: somebody else's promise is not a reason to
  // skip your own net, and what is being protected here is `/api/auditors`, not
  // the tidiness of a layer. A reader that throws must cost one row's
  // reputation, never the endpoint.
  let reading: ReputationReading;
  try {
    reading = await source.read(auditor.reputationListingId);
  } catch (error) {
    reading = {
      averageScoreX100: null,
      reviewCount: null,
      healthy: false,
      reason: `reputation reader threw instead of reporting a failure: ${describe(error)}`,
    };
  }
  if (!reading.healthy) {
    return withReputation(auditor, {
      averageScoreX100: null,
      reviewCount: null,
      source: "unhealthy",
      reason: reading.reason,
      contract: source.contract,
      fetchedAt: now.toISOString(),
    });
  }

  return withReputation(auditor, {
    averageScoreX100: reading.averageScoreX100,
    reviewCount: reading.reviewCount,
    source: "onchain",
    reason:
      reading.reviewCount === 0
        ? "read from FuguReputation: this auditor has no reviews yet"
        : null,
    contract: source.contract,
    fetchedAt: now.toISOString(),
  });
}

function withReputation(auditor: AuditorRecord, reputation: AuditorReputation): AuditorRecord {
  return { ...auditor, reputation };
}
