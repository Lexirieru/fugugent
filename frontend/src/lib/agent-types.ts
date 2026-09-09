/**
 * A **mirror** of `backend/src/types.ts`, the single source of truth lives in the
 * backend, this file is only a copy so the frontend can be built before the backend is
 * finished. If the backend changes the shape, this file is the one that follows, never
 * the other way round.
 *
 * The two rules from the source that are easiest to break and most expensive to get wrong:
 *
 * 1. **Money is never a `number`.** `priceUsd8PerPeriod` is a `bigint` in 8-decimal
 *    base: `12345678n` means $0.12, not twelve million. That is why `AgentRecord` is
 *    not JSON-serializable as it stands, see `lib/data/wire.ts`.
 * 2. **An unknown field is `null`, not omitted.**
 */

/**
 * The order is the on-chain enum order and nothing may move: a value's position IS
 * its number in `FuguTypes.sol`, so inserting one in the middle would silently
 * relabel every listing already recorded on the blockchain. New values are appended.
 */
export const CATEGORIES = [
  "REBALANCING",
  "GRID",
  "YIELD",
  "HEALTH_FACTOR",
  "HIRING",
  "COMMERCE",
  "AUTONOMOUS",
  "STREAMING",
  "TREASURY",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * `contracts/src/types/FuguTypes.sol`: REBALANCING=0, GRID=1, YIELD=2,
 * HEALTH_FACTOR=3, HIRING=4, COMMERCE=5, AUTONOMOUS=6, STREAMING=7, TREASURY=8.
 */
export function categoryFromOnchainIndex(index: number): Category | null {
  return CATEGORIES[index] ?? null;
}

export type AgentSource = "scan8004" | "cache" | "onchain" | "seed";

export type PublisherTier = "OFFICIAL" | "VERIFIED" | "COMMUNITY";

export type Address = `0x${string}`;

export interface AgentReputation {
  totalScore: number | null;
  healthScore: number | null;
  totalFeedbacks: number;
  averageScore: number | null;
  starCount: number;
}

export interface FuguListing {
  listingId: bigint;
  erc8004AgentId: bigint;
  owner: Address;
  agentWallet: Address;
  category: Category;
  /** USD in 8-decimal base. `1_500_000_000n` = $15. */
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

export interface AgentClassification {
  category: Category | null;
  confidence: number;
  reason: string;
}

export interface AgentRecord {
  id: string;
  chainId: number;
  tokenId: string;
  registryAddress: Address | null;
  agentId: string | null;

  name: string;
  description: string;
  imageUrl: string | null;
  agentType: string | null;
  tags: string[];
  categories: string[];
  skills: string[];
  domains: string[];
  supportedProtocols: string[];

  ownerAddress: Address | null;
  ownerUsername: string | null;
  ownerPublisherTier: PublisherTier | null;
  agentWallet: Address | null;

  isActive: boolean;
  isVerified: boolean;
  isEndpointVerified: boolean;
  x402Supported: boolean;
  reputation: AgentReputation;

  classification: AgentClassification | null;
  fuguListing: FuguListing | null;

  source: AgentSource;
  fetchedAt: string;
  createdAt: string | null;
  updatedAt: string | null;
  similarityScore: number | null;
  raw?: unknown;
}

export interface AgentListPage {
  items: AgentRecord[];
  total: number;
  limit: number;
  offset: number;
  source: AgentSource;
  /**
   * `false` when the source failed OR replied with a shape we do not recognise.
   * A legitimately empty list is still `healthy: true`, and so is a "not found"
   * answer, an agent that genuinely does not exist is no sign of a sick upstream.
   */
  healthy: boolean;
  /**
   * A note on the state of the source; never carries credentials. It may be filled in
   * even when `healthy: true`. `healthy` decides, `reason` only explains.
   */
  reason: string | null;
  fetchedAt: string;
}

export interface AgentDetailResult {
  agent: AgentRecord | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
}

export interface SourceHealth {
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  checkedAt: string;
}

export function makeAgentKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

export function unhealthyPage(
  source: AgentSource,
  reason: string,
  fetchedAt: string,
  limit: number,
  offset: number,
): AgentListPage {
  return {
    items: [],
    total: 0,
    limit,
    offset,
    source,
    healthy: false,
    reason,
    fetchedAt,
  };
}
