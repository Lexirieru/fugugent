/**
 * The ERC-8004 IdentityRegistry, read directly — **the primary agent source**.
 *
 * The BNB Chain Phase 2 brief is explicit: agents are read from the ERC-8004
 * identity registry on chain 97, not from an indexer's copy of it, and not from
 * a hand-written list. This module is that read.
 *
 * ## Why a full state sweep, not an event index
 *
 * The obvious design is to follow `Registered` / `URIUpdated` events. Measured on
 * 2026-09-25, no free BSC testnet RPC will serve them: the BNB Chain seed nodes
 * answer `limit exceeded` for any range, PublicNode has pruned history before
 * recent blocks, and dRPC's free plan refuses the ranges. The registry deployed
 * at block 84,555,147; following events from there is not an option we have.
 *
 * What every RPC does serve is *current state*. Token ids are sequential from 0,
 * so the whole registry is `ownerOf` / `tokenURI` / `getAgentWallet` for
 * `0, 1, 2, …` until the ids run out — batched through Multicall3, 2,476 agents
 * in about 50 seconds. Every call in one sweep is pinned to the same block, so a
 * snapshot is a statement about one block, not a blur across several.
 *
 * ## Contract with the rest of the backend
 *
 * - **Never throws.** A sweep that fails keeps the previous snapshot and says
 *   why; a partial read is never published as if it were complete.
 * - **Every record carries its evidence** ({@link RegistryEvidence}): the
 *   registry address, the block, when it was read, the `agentURI` verbatim, and
 *   whether that URI could be read. A card never claims more than the chain did.
 * - **Nothing here is curated.** Which agents exist is decided by the registry;
 *   which category they fall in is decided by the deterministic classifier in
 *   `classify.ts`; neither is edited by hand.
 */

import type { Chain, Client, Transport } from "viem";
import { getBlockNumber, multicall } from "viem/actions";
import { classify } from "../classify.js";
import {
  makeAgentKey,
  type Address,
  type AgentDetailResult,
  type AgentListPage,
  type AgentRecord,
  type Category,
  type RegistryEvidence,
} from "../types.js";
import type { MetadataResolver, ResolvedMetadata } from "./registry-metadata.js";

/** ERC-8004 IdentityRegistry on BSC testnet (BNB Agent SDK `NETWORKS["bsc-testnet"]`). */
export const IDENTITY_REGISTRY_TESTNET: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
/** ERC-8004 IdentityRegistry on BSC mainnet, for the migration. */
export const IDENTITY_REGISTRY_MAINNET: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/** The read side of the IdentityRegistry, from `bnbagent-sdk/abis/IdentityRegistry.json`. */
export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Ids per Multicall3 batch: three calls each, well under a public RPC's gas cap. */
export const REGISTRY_BATCH_SIZE = 200;
/**
 * Consecutive missing ids that end a sweep. Ids are sequential, so the first
 * gap is normally the end; a whole batch of misses is the margin for an id
 * burned in the middle.
 */
export const REGISTRY_GAP_LIMIT = 200;
/** A hard stop, so a registry that suddenly holds a million ids cannot pin the process. */
export const REGISTRY_MAX_IDS = 50_000;
/** How often the registry is swept. */
export const REGISTRY_SWEEP_INTERVAL_MS = 5 * 60_000;
/**
 * Above this age a registry snapshot is reported `stale`: two missed sweeps.
 * One missed sweep is noise; two means the sweeper is in trouble.
 */
export const REGISTRY_MAX_AGE_SECONDS = (2 * REGISTRY_SWEEP_INTERVAL_MS) / 1000 + 120;
/** Concurrent metadata fetches. */
export const METADATA_CONCURRENCY = 16;
/** A metadata fetch that failed is retried after this long, not on every sweep. */
export const METADATA_RETRY_MS = 15 * 60_000;
/** A metadata fetch that worked is refetched after this long, to pick up edits. */
export const METADATA_REFRESH_MS = 60 * 60_000;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** One identity as the registry holds it. */
export interface RawIdentity {
  tokenId: bigint;
  owner: Address;
  agentURI: string;
  agentWallet: Address | null;
}

/** The chain access this module needs. Injected so no test touches an RPC. */
export interface IdentityRegistryReader {
  blockNumber(): Promise<bigint>;
  /**
   * Read `ids` at `blockNumber`. An id that does not exist comes back `null`;
   * a transport failure throws, so the caller can refuse to publish a partial
   * snapshot.
   */
  readIds(ids: readonly bigint[], blockNumber: bigint): Promise<(RawIdentity | null)[]>;
}

export function createViemIdentityReader(
  client: Client<Transport, Chain | undefined>,
  registry: Address,
): IdentityRegistryReader {
  return {
    blockNumber: () => getBlockNumber(client, { cacheTime: 0 }),
    async readIds(ids, blockNumber) {
      const contracts = ids.flatMap((id) => [
        { address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "ownerOf", args: [id] } as const,
        { address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "tokenURI", args: [id] } as const,
        { address: registry, abi: IDENTITY_REGISTRY_ABI, functionName: "getAgentWallet", args: [id] } as const,
      ]);
      const results = await multicall(client, { contracts, allowFailure: true, blockNumber });
      return ids.map((tokenId, index) => {
        const [owner, uri, wallet] = results.slice(index * 3, index * 3 + 3);
        // `ownerOf` reverting is how ERC-721 says "no such token".
        if (owner === undefined || owner.status !== "success") return null;
        const walletAddress =
          wallet !== undefined && wallet.status === "success" ? (wallet.result as Address) : null;
        return {
          tokenId,
          owner: owner.result as Address,
          agentURI: uri !== undefined && uri.status === "success" ? (uri.result as string) : "",
          agentWallet:
            walletAddress === null || walletAddress.toLowerCase() === ZERO_ADDRESS ? null : walletAddress,
        };
      });
    },
  };
}

/** What one sweep did. Kept for `/api/health` and the logs. */
export interface RegistrySweepReport {
  ok: boolean;
  blockNumber: string | null;
  agents: number;
  /** How many registration files could be read (inline or fetched). */
  readableMetadata: number;
  durationMs: number;
  reason: string | null;
  finishedAt: string;
}

export interface RegistryStatus {
  /** A snapshot exists to serve. */
  ready: boolean;
  /** The last sweep succeeded. */
  healthy: boolean;
  reason: string | null;
  blockNumber: string | null;
  readAt: string | null;
  agents: number;
  lastSweep: RegistrySweepReport | null;
}

export interface RegistryListOptions {
  limit: number;
  offset: number;
}

export interface RegistryIndex {
  /** Sweep the registry now. Concurrent calls share one sweep. */
  refresh(): Promise<RegistrySweepReport>;
  /** One category, ranked. `healthy: false` until the first sweep has published. */
  list(category: Category, opts: RegistryListOptions): AgentListPage;
  get(id: string): AgentDetailResult;
  /** Every agent in the current snapshot. */
  all(): readonly AgentRecord[];
  status(): RegistryStatus;
  /** Sweep now and then every `intervalMs`. Returns a stop function. */
  start(intervalMs?: number): () => void;
}

export interface RegistryIndexOptions {
  reader: IdentityRegistryReader;
  metadata: MetadataResolver;
  registryAddress: Address;
  chainId: number;
  now?: () => Date;
  batchSize?: number;
  gapLimit?: number;
  /** Called after each published snapshot — the cache write-through hangs here. */
  onSnapshot?: (records: readonly AgentRecord[], report: RegistrySweepReport) => void | Promise<void>;
  log?: (message: string) => void;
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${(err.message.split("\n")[0] ?? err.message).slice(0, 300)}`;
  return "unknown failure";
}

function protocolsOf(metadata: ResolvedMetadata): string[] {
  const names = metadata.file?.endpoints.map((endpoint) => endpoint.name) ?? [];
  return [...new Set(names)];
}

/**
 * One registry identity to an `AgentRecord`.
 *
 * `name` falls back to `Agent #<id>` — the same placeholder every other source
 * uses — rather than to the raw URI, because a URI like `"user-c0352ec5"` is not
 * a name its owner chose to show.
 */
export function toRegistryRecord(
  identity: RawIdentity,
  metadata: ResolvedMetadata,
  ctx: { chainId: number; registryAddress: Address; blockNumber: bigint; readAt: string },
): AgentRecord {
  const tokenId = identity.tokenId.toString();
  const file = metadata.file;
  const evidence: RegistryEvidence = {
    registryAddress: ctx.registryAddress,
    blockNumber: ctx.blockNumber.toString(),
    readAt: ctx.readAt,
    agentURI: identity.agentURI.length > 512 ? `${identity.agentURI.slice(0, 511)}…` : identity.agentURI,
    metadataStatus: metadata.status,
    metadataReason: metadata.reason,
    endpoints: file?.endpoints ?? [],
    registration: null,
  };

  const record: AgentRecord = {
    id: makeAgentKey(ctx.chainId, tokenId),
    chainId: ctx.chainId,
    tokenId,
    registryAddress: ctx.registryAddress,
    agentId: `${ctx.chainId}:${ctx.registryAddress.toLowerCase()}:${tokenId}`,

    name: file?.name ?? `Agent #${tokenId}`,
    description: file?.description ?? "",
    imageUrl: file?.image ?? null,
    agentType: null,
    tags: file?.tags ?? [],
    categories: [],
    skills: file?.skills ?? [],
    domains: file?.domains ?? [],
    supportedProtocols: protocolsOf(metadata),

    ownerAddress: identity.owner,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: identity.agentWallet,

    isActive: file?.active ?? true,
    // Nothing in the registry verifies anyone; a badge here would be invented.
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: file?.x402Support ?? false,
    reputation: { totalScore: null, healthScore: null, totalFeedbacks: 0, averageScore: null, starCount: 0 },

    classification: null,
    fuguListing: null,

    source: "registry",
    fetchedAt: ctx.readAt,
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
    evidence,
  };
  return { ...record, classification: classify(record) };
}

/**
 * Order within a category: agents whose owners published a readable
 * registration file first (a card with a real description is the one a renter
 * can judge), then by classifier confidence, then newest id first.
 */
function rank(a: AgentRecord, b: AgentRecord): number {
  const readable = (r: AgentRecord) =>
    r.evidence?.metadataStatus === "inline" || r.evidence?.metadataStatus === "fetched" ? 1 : 0;
  const byReadable = readable(b) - readable(a);
  if (byReadable !== 0) return byReadable;
  const byConfidence = (b.classification?.confidence ?? 0) - (a.classification?.confidence ?? 0);
  if (byConfidence !== 0) return byConfidence;
  return BigInt(b.tokenId) > BigInt(a.tokenId) ? 1 : BigInt(b.tokenId) < BigInt(a.tokenId) ? -1 : 0;
}

interface CachedMetadata {
  uri: string;
  metadata: ResolvedMetadata;
  resolvedAtMs: number;
}

export function createRegistryIndex(options: RegistryIndexOptions): RegistryIndex {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? REGISTRY_BATCH_SIZE;
  const gapLimit = options.gapLimit ?? REGISTRY_GAP_LIMIT;
  const log = options.log ?? (() => undefined);

  let snapshot: { records: AgentRecord[]; byId: Map<string, AgentRecord>; byCategory: Map<Category, AgentRecord[]>; blockNumber: bigint; readAt: string } | null = null;
  let lastSweep: RegistrySweepReport | null = null;
  let inFlight: Promise<RegistrySweepReport> | null = null;
  const metadataCache = new Map<string, CachedMetadata>();

  async function readAll(blockNumber: bigint): Promise<RawIdentity[]> {
    const out: RawIdentity[] = [];
    let misses = 0;
    for (let start = 0n; misses < gapLimit && start < BigInt(REGISTRY_MAX_IDS); start += BigInt(batchSize)) {
      const ids = Array.from({ length: batchSize }, (_, i) => start + BigInt(i));
      let rows: (RawIdentity | null)[];
      try {
        rows = await options.reader.readIds(ids, blockNumber);
      } catch {
        // One retry: public RPCs drop a request now and then. A second failure
        // aborts the sweep — publishing ids 0–399 as "the registry" would be a lie.
        rows = await options.reader.readIds(ids, blockNumber);
      }
      for (const row of rows) {
        if (row === null) {
          misses++;
          continue;
        }
        misses = 0;
        out.push(row);
      }
    }
    return out;
  }

  async function resolveAll(identities: readonly RawIdentity[], at: number): Promise<Map<string, ResolvedMetadata>> {
    const out = new Map<string, ResolvedMetadata>();
    const pending: RawIdentity[] = [];
    for (const identity of identities) {
      const key = identity.tokenId.toString();
      const cached = metadataCache.get(key);
      const fresh =
        cached !== undefined &&
        cached.uri === identity.agentURI &&
        at - cached.resolvedAtMs <
          (cached.metadata.status === "unreachable" ? METADATA_RETRY_MS : METADATA_REFRESH_MS);
      if (fresh) out.set(key, cached.metadata);
      else pending.push(identity);
    }

    let next = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const identity = pending[next++];
        if (identity === undefined) return;
        let metadata: ResolvedMetadata;
        try {
          metadata = await options.metadata.resolve(identity.agentURI);
        } catch (err) {
          metadata = { status: "unreachable", reason: describeFailure(err), file: null };
        }
        const key = identity.tokenId.toString();
        metadataCache.set(key, { uri: identity.agentURI, metadata, resolvedAtMs: Date.now() });
        out.set(key, metadata);
      }
    }
    await Promise.all(Array.from({ length: METADATA_CONCURRENCY }, worker));
    return out;
  }

  async function sweep(): Promise<RegistrySweepReport> {
    const startedMs = Date.now();
    let blockNumber: bigint | null = null;
    try {
      blockNumber = await options.reader.blockNumber();
      const readAt = now().toISOString();
      const identities = await readAll(blockNumber);
      if (identities.length === 0) throw new Error("the registry returned no identities at all");
      const metadata = await resolveAll(identities, Date.now());

      const ctx = { chainId: options.chainId, registryAddress: options.registryAddress, blockNumber, readAt };
      const records = identities.map((identity) =>
        toRegistryRecord(identity, metadata.get(identity.tokenId.toString())!, ctx),
      );
      // Carry over registration proofs already found: they are facts about a
      // past block and cannot change.
      if (snapshot !== null) {
        for (const record of records) {
          const previous = snapshot.byId.get(record.id)?.evidence?.registration ?? null;
          if (previous !== null && record.evidence) record.evidence.registration = previous;
        }
      }

      const byCategory = new Map<Category, AgentRecord[]>();
      for (const record of records) {
        const category = record.classification?.category;
        if (category == null) continue;
        const bucket = byCategory.get(category) ?? [];
        bucket.push(record);
        byCategory.set(category, bucket);
      }
      for (const bucket of byCategory.values()) bucket.sort(rank);

      snapshot = { records, byId: new Map(records.map((r) => [r.id, r])), byCategory, blockNumber, readAt };
      const readable = records.filter(
        (r) => r.evidence?.metadataStatus === "inline" || r.evidence?.metadataStatus === "fetched",
      ).length;
      const report: RegistrySweepReport = {
        ok: true,
        blockNumber: blockNumber.toString(),
        agents: records.length,
        readableMetadata: readable,
        durationMs: Date.now() - startedMs,
        reason: null,
        finishedAt: now().toISOString(),
      };
      lastSweep = report;
      log(`[registry] swept ${records.length} agents at block ${blockNumber} in ${report.durationMs} ms (${readable} with readable metadata)`);
      if (options.onSnapshot !== undefined) {
        try {
          await options.onSnapshot(records, report);
        } catch (err) {
          log(`[registry] onSnapshot failed: ${describeFailure(err)}`);
        }
      }
      return report;
    } catch (err) {
      const report: RegistrySweepReport = {
        ok: false,
        blockNumber: blockNumber?.toString() ?? null,
        agents: snapshot?.records.length ?? 0,
        readableMetadata: 0,
        durationMs: Date.now() - startedMs,
        reason: `sweep failed, previous snapshot kept: ${describeFailure(err)}`,
        finishedAt: now().toISOString(),
      };
      lastSweep = report;
      log(`[registry] ${report.reason}`);
      return report;
    }
  }

  function notReady(): string {
    return lastSweep === null
      ? "the first registry sweep has not finished yet"
      : (lastSweep.reason ?? "no registry snapshot yet");
  }

  const index: RegistryIndex = {
    refresh() {
      if (inFlight === null) {
        inFlight = sweep().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },

    list(category, { limit, offset }) {
      const fetchedAt = now().toISOString();
      if (snapshot === null) {
        return { items: [], total: 0, limit, offset, source: "registry", healthy: false, reason: notReady(), fetchedAt };
      }
      const bucket = snapshot.byCategory.get(category) ?? [];
      return {
        items: bucket.slice(offset, offset + limit),
        total: bucket.length,
        limit,
        offset,
        source: "registry",
        healthy: true,
        reason: lastSweep !== null && !lastSweep.ok ? lastSweep.reason : null,
        fetchedAt: snapshot.readAt,
      };
    },

    get(id) {
      const fetchedAt = now().toISOString();
      if (snapshot === null) {
        return { agent: null, source: "registry", healthy: false, reason: notReady(), fetchedAt };
      }
      const agent = snapshot.byId.get(id) ?? null;
      return {
        agent,
        source: "registry",
        healthy: true,
        reason: agent === null ? `no agent ${id} in the registry at block ${snapshot.blockNumber}` : null,
        fetchedAt: snapshot.readAt,
      };
    },

    all() {
      return snapshot?.records ?? [];
    },

    status() {
      return {
        ready: snapshot !== null,
        healthy: snapshot !== null && lastSweep?.ok === true,
        reason: snapshot === null ? notReady() : (lastSweep?.reason ?? null),
        blockNumber: snapshot?.blockNumber.toString() ?? null,
        readAt: snapshot?.readAt ?? null,
        agents: snapshot?.records.length ?? 0,
        lastSweep,
      };
    },

    start(intervalMs = REGISTRY_SWEEP_INTERVAL_MS) {
      void index.refresh();
      const timer = setInterval(() => void index.refresh(), intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
  return index;
}
