/**
 * The data shapes shared across the whole Fugugent backend — **one source of
 * truth**.
 *
 * `AgentRecord` is the shape shared by:
 * - **Task 2 (sources)** — 8004scan and the on-chain read are both normalized to it.
 * - **Task 3 (DB cache)** — `id` + `chainId`/`tokenId` are its stable identity,
 *   `fetchedAt` is the age of its data.
 * - **Task 4 (classifier)** — `name`, `description`, `tags`, `categories`,
 *   `skills`/`domains` (OASF), and `supportedProtocols` are its inputs;
 *   `classification` is its output.
 * - **Task 6 (presentation)** — the rest is what the user sees.
 *
 * ## Rules baked into these types
 *
 * 1. **Every on-chain value is a `bigint`** (`FuguListing`). Never a `number`
 *    for money. The consequence is that `AgentRecord` is **not**
 *    JSON-serializable as-is — the layer writing to the DB or to HTTP must turn
 *    bigints into decimal strings explicitly.
 * 2. `tokenId` is a **decimal string**, not a `number`. A `uint256` does not fit
 *    in a `number`, and 8004scan itself returns it as a string.
 * 3. Unknown fields are `null`, not omitted. A reader should not have to
 *    distinguish "absent" from "not filled in".
 * 4. `source` and `fetchedAt` are **always** populated. Every record knows where
 *    it came from and when it was fetched — that is what makes the resilience
 *    claims checkable rather than merely asserted.
 */

/**
 * The nine Fugugent product categories, in THE SAME order as the `Category` enum in
 * Solidity (`contracts/src/types/FuguTypes.sol`).
 *
 * **This array is append-only. Never reorder it, never insert into the middle, never
 * delete from it.** Position in this array IS the on-chain enum index, and that index is
 * what is stored inside every listing in the `FuguRegistry` proxy on BSC testnet
 * (`0xb2f36070E6eae3353E8e755172B477DF213ae248`). Moving an entry does not fail loudly:
 * it silently relabels listings that already exist, so a health-factor agent starts
 * showing up as something else.
 *
 * The first four were live before 2026-09-09 and their indices are frozen. The last five
 * were appended when the catalog was widened; the contract upgrade that added them is
 * proved not to have moved the old four by `contracts/test/CategoryUpgradeSafety.t.sol`.
 */
export const CATEGORIES = [
  "REBALANCING",
  "GRID",
  "YIELD",
  "HEALTH_FACTOR",
  // --- appended 2026-09-09 ---
  "HIRING",
  "COMMERCE",
  "AUTONOMOUS",
  "STREAMING",
  "TREASURY",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Maps the on-chain enum index -> category.
 * `contracts/src/types/FuguTypes.sol`: `REBALANCING=0, GRID=1, YIELD=2, HEALTH_FACTOR=3,
 * HIRING=4, COMMERCE=5, AUTONOMOUS=6, STREAMING=7, TREASURY=8`.
 * Never reorder `CATEGORIES` without changing the contract.
 */
export function categoryFromOnchainIndex(index: number): Category | null {
  return CATEGORIES[index] ?? null;
}

/**
 * Where a record came from. This is what is shown to the user (and the judges)
 * so it is clear whether the numbers they see come from upstream, from a stale
 * cache, or from the on-chain safety net.
 *
 * `registry` is a direct read of the ERC-8004 IdentityRegistry contract itself
 * (`src/sources/registry.ts`): no indexer and no third party between the chain
 * and the card. It is the primary source in production.
 */
export type AgentSource = "registry" | "scan8004" | "cache" | "onchain" | "seed";

/**
 * How an agent's `agentURI` resolved to a registration file.
 *
 * The URI is written by whoever registered the agent, so it is anything from a
 * base64 `data:` URI to a bare word like `"my-twin"`. Every outcome is named
 * rather than collapsed into "no metadata", because "the owner never published a
 * description" and "the owner's server is down" are different facts about the
 * agent and the page says which one it is.
 */
export type MetadataStatus =
  /** Decoded from the URI itself (`data:` or raw JSON). Nothing was fetched. */
  | "inline"
  /** Fetched over HTTPS or through an IPFS gateway, and parsed. */
  | "fetched"
  /** The registry holds an empty `agentURI`. */
  | "empty"
  /** Neither a URL we fetch nor inline JSON: `"my-twin"`, `http://…`, `ar://…`. */
  | "unsupported"
  /** A URL we refuse to fetch from a server: private network, IP literal, redirect loop. */
  | "refused"
  /** The URL did not answer in time or answered with an error status. */
  | "unreachable"
  /** It answered, but not with a JSON object. */
  | "invalid";

/** One service endpoint an agent declares in its registration file. */
export interface AgentEndpoint {
  /** `"A2A"`, `"MCP"`, `"web"`, `"OASF"`, … exactly as declared. */
  name: string;
  endpoint: string;
  version: string | null;
}

/**
 * The transaction that minted an agent's identity, **checked against the chain**.
 *
 * The hash is found through 8004scan (the chain offers no index from token id to
 * transaction, and public RPCs refuse historical `eth_getLogs`), but it is only
 * ever reported after its receipt was fetched from our own RPC and shown to
 * contain `Registered(agentId)` emitted by this registry. A hint that fails that
 * check is dropped, never shown as "unverified".
 */
export interface RegistrationProof {
  txHash: `0x${string}`;
  /** Decimal string: a block number is a `uint64`. */
  blockNumber: string;
  /** ISO 8601 of that block, UTC. */
  registeredAt: string | null;
  /** Always `"8004scan"` today: where the hash was learned, not what proves it. */
  hintedBy: "8004scan";
}

/**
 * What the ERC-8004 IdentityRegistry itself says about one agent, with enough
 * detail for a reader to repeat the read.
 */
export interface RegistryEvidence {
  /** The IdentityRegistry the record was read from. */
  registryAddress: Address;
  /** The block the whole snapshot was read at, as a decimal string. */
  blockNumber: string;
  /** ISO 8601 of the read. The age a card shows is computed from this. */
  readAt: string;
  /** `tokenURI(agentId)` verbatim, truncated to 512 characters. */
  agentURI: string;
  metadataStatus: MetadataStatus;
  /** Why the metadata could not be used, when it could not. */
  metadataReason: string | null;
  endpoints: AgentEndpoint[];
  /** `null` until it has been found and checked; see {@link RegistrationProof}. */
  registration: RegistrationProof | null;
}

/** Publisher certification tier on 8004scan. */
export type PublisherTier = "OFFICIAL" | "VERIFIED" | "COMMUNITY";

/** An EVM address in checksummed/lowercase `0x...` form. */
export type Address = `0x${string}`;

/** Reputation signals. All nullable: a brand-new agent has none of them yet. */
export interface AgentReputation {
  /** 8004scan v5 composite score, 0–100. */
  totalScore: number | null;
  /** 8004scan health-check score, 0–100. */
  healthScore: number | null;
  totalFeedbacks: number;
  /** Average feedback score, 0–100. */
  averageScore: number | null;
  starCount: number;
}

/**
 * A first-party listing in `FuguRegistry`. `null` for agents that exist only on
 * 8004scan and have never been registered on our marketplace.
 *
 * **Every numeric value here is on-chain, hence `bigint`.**
 */
export interface FuguListing {
  /** The listing id in our registry. Starts at 1 — 0 means none. */
  listingId: bigint;
  /** The ERC-8004 identity this listing claims. */
  erc8004AgentId: bigint;
  /** The listing owner — the subscription **payee**. */
  owner: Address;
  /** The agent's operational wallet. **Never receives payment**, purely metadata. */
  agentWallet: Address;
  category: Category;
  /** Price per period in USD with 8 decimals (e.g. `1_500_000_000n` = $15). */
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  /** Flagged by a trusted curator. The UI should highlight the `true` ones. */
  curated: boolean;
  metadataURI: string;
}

/** Classifier output (Task 4). `null` when confidence is below the threshold. */
export interface AgentClassification {
  category: Category | null;
  /** 0–1. */
  confidence: number;
  /** A human-readable reason — surfaced so the classification can be audited. */
  reason: string;
}

/**
 * One agent, normalized from whichever source.
 *
 * Its stable key is `id` = `` `${chainId}:${tokenId}` ``. Do not use the
 * 8004scan `agentId` as the primary key — it embeds a registry address that can
 * differ between deployments, and it is absent on records produced by the
 * on-chain read.
 */
export interface AgentRecord {
  // --- stable identity (used by the Task 3 DB cache and the Task 6 detail URL) ---
  /** `` `${chainId}:${tokenId}` ``. The primary key in every layer. */
  id: string;
  chainId: number;
  /** Decimal, as a string. A `uint256` does not fit in a `number`. */
  tokenId: string;
  /** The registry address this record came from (ERC-8004 or FuguRegistry). */
  registryAddress: Address | null;
  /** The 8004scan composite id `"56:0x8004…:49637"`, when the record came from there. */
  agentId: string | null;

  // --- classifier inputs (Task 4) + presentation (Task 6) ---
  name: string;
  description: string;
  imageUrl: string | null;
  /** E.g. `"prediction"`, `"trading"` — from the ERC-8004 registration file. */
  agentType: string | null;
  tags: string[];
  /** Free-form categories from upstream. **Not** our `Category` — do not confuse them. */
  categories: string[];
  /** OASF skills. One of the main inputs to the classifier's second layer. */
  skills: string[];
  /** OASF domains. */
  domains: string[];
  /** E.g. `["MCP", "A2A", "Web"]`. */
  supportedProtocols: string[];

  // --- ownership ---
  ownerAddress: Address | null;
  ownerUsername: string | null;
  ownerPublisherTier: PublisherTier | null;
  agentWallet: Address | null;

  // --- trust signals (badges on the agent card) ---
  isActive: boolean;
  isVerified: boolean;
  isEndpointVerified: boolean;
  x402Supported: boolean;
  reputation: AgentReputation;

  // --- classification result; `null` until Task 4 fills it in ---
  classification: AgentClassification | null;

  // --- first-party listing; `null` when the agent is not in FuguRegistry yet ---
  fuguListing: FuguListing | null;

  // --- provenance: from where and when ---
  source: AgentSource;
  /** ISO 8601 UTC. Data age is computed from this. */
  fetchedAt: string;
  /** ISO 8601 from upstream, when present. */
  createdAt: string | null;
  updatedAt: string | null;
  /** Similarity score, populated only on `semanticSearch` results. */
  similarityScore: number | null;
  /**
   * The registry read behind this record. Present only on `source: "registry"`
   * records; the cache does not store it, so a record served from the cache
   * says so by having none.
   */
  evidence?: RegistryEvidence | null;
  /**
   * The raw upstream payload, for debugging and the classifier's LLM layer.
   * The cache layer may drop it — nothing may depend on it.
   */
  raw?: unknown;
}

/**
 * One page of results from a source. **Never throws** to the caller: a failure
 * is represented by `healthy: false` + `reason`, not by an exception.
 */
export interface AgentListPage {
  items: AgentRecord[];
  /** The total upstream (not the length of `items`). */
  total: number;
  limit: number;
  offset: number;
  source: AgentSource;
  /**
   * `false` when the source failed OR answered with a shape we do not recognize.
   * A legitimately empty list is still `healthy: true`, and so is a
   * "not found" answer — an agent that genuinely does not exist is not a sign
   * of a sick upstream.
   */
  healthy: boolean;
  /**
   * A description of the source's state. Never contains credentials.
   *
   * May be populated even when `healthy: true` — e.g. `readFuguListings`
   * skipping a single reverting listing, or a detail that was not found.
   * `healthy` is the verdict; `reason` only explains.
   */
  reason: string | null;
  /** ISO 8601 UTC — when this page was fetched. */
  fetchedAt: string;
}

/** The result of fetching a single agent. Like `AgentListPage`: never throws. */
export interface AgentDetailResult {
  agent: AgentRecord | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
}

/** The status of one data source, for `/api/health` (Task 6) and the `source_health` table (Task 3). */
export interface SourceHealth {
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  checkedAt: string;
}

/** An agent's stable key. Used consistently across every layer. */
export function makeAgentKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

/** An empty page marking the source as unhealthy. */
export function unhealthyPage(
  source: AgentSource,
  reason: string,
  fetchedAt: string,
  limit: number,
  offset: number,
): AgentListPage {
  return { items: [], total: 0, limit, offset, source, healthy: false, reason, fetchedAt };
}
