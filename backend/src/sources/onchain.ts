/**
 * The on-chain data source — **the marketplace's safety net**.
 *
 * When 8004scan is down (and it is proven to go down often: `500 DATABASE_ERROR`
 * on 4 out of 5 attempts during the research) and the Postgres cache is still
 * empty, this is what keeps the marketplace populated. Its data is first-party:
 * listings genuinely registered in our own `FuguRegistry`, not a copy from a
 * third party.
 *
 * ## This module's contract
 *
 * Same as the 8004scan source: **it never throws**. A dead RPC or a single
 * reverting `getListing` becomes `healthy: false` / a skipped listing, not an
 * exception that takes the request down.
 *
 * ## Rules
 *
 * - The registry address is **always** read from `config.contracts.registry`.
 *   No address is hardcoded in this module — the single source of truth is in
 *   `config.ts`.
 * - Every money value stays a `bigint` the whole way through. Never a `number`.
 * - Listing ids in `FuguRegistry` **start at 1** (`listingId = ++_listingCount`);
 *   reading id 0 always reverts. The range read is therefore
 *   `offset+1 .. offset+limit`.
 * - The viem client is injected through the options — tests use a fake transport
 *   and never touch a real RPC.
 */

import type { Chain, Client, Transport } from "viem";
import { readContract } from "viem/actions";
import type { FugugentConfig } from "../config.js";
import {
  categoryFromOnchainIndex,
  makeAgentKey,
  unhealthyPage,
  type Address,
  type AgentDetailResult,
  type AgentListPage,
  type AgentRecord,
  type Category,
  type FuguListing,
} from "../types.js";

/**
 * The minimal `FuguRegistry` ABI — only the read side the backend uses.
 * Derived from `contracts/src/interfaces/IFuguRegistry.sol` and
 * `contracts/src/types/FuguTypes.sol`. The tuple field order **must** match the
 * Solidity `Listing` struct exactly.
 */
export const FUGU_REGISTRY_ABI = [
  {
    type: "function",
    name: "listingCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getListing",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "erc8004AgentId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "agentWallet", type: "address" },
          { name: "category", type: "uint8" },
          { name: "priceUsd8PerPeriod", type: "uint128" },
          { name: "periodSeconds", type: "uint32" },
          { name: "active", type: "bool" },
          { name: "curated", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "countByCategory",
    stateMutability: "view",
    inputs: [{ name: "category", type: "uint8" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "listingByAgentId",
    stateMutability: "view",
    inputs: [{ name: "erc8004AgentId", type: "uint256" }],
    outputs: [{ name: "listingId", type: "uint256" }],
  },
] as const;

/** Any viem client that can perform an `eth_call`. Injected, not constructed here. */
export type RegistryClient = Client<Transport, Chain | undefined>;

/** The raw shape of the `Listing` struct returned by `getListing`. */
interface RawListingTuple {
  erc8004AgentId: bigint;
  owner: Address;
  agentWallet: Address;
  category: number;
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

/** The default on-chain read: fetch many at once — this is a safety net, not a UI page. */
export const ONCHAIN_DEFAULT_LIMIT = 100;
/** A hard limit so a single request never floods the RPC. */
export const ONCHAIN_MAX_LIMIT = 500;
/** How many `eth_call`s run concurrently. The public BSC testnet RPC chokes easily. */
export const ONCHAIN_BATCH_SIZE = 10;

export interface ReadFuguListingsOptions {
  limit?: number;
  offset?: number;
}

export interface OnchainSource {
  readFuguListings(opts?: ReadFuguListingsOptions): Promise<AgentListPage>;
  readFuguListing(listingId: bigint | number): Promise<AgentDetailResult>;
}

export interface OnchainSourceOptions {
  client: RegistryClient;
  config: FugugentConfig;
  /** Injected so `fetchedAt` is deterministic in tests. */
  now?: () => Date;
  batchSize?: number;
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) {
    // viem messages can be very long (they carry the whole request detail); trim it.
    const firstLine = err.message.split("\n")[0] ?? err.message;
    return `${err.name}: ${firstLine}`;
  }
  return "unknown failure while reading on-chain";
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Turns a single on-chain `Listing` into an `AgentRecord`.
 *
 * The on-chain category is truth already signed by the listing owner — so it is
 * used directly as the `classification` with full confidence, and the classifier
 * (Task 4) does not have to guess for listings that have one.
 */
function toAgentRecord(
  listingId: bigint,
  listing: RawListingTuple,
  category: Category,
  chainId: number,
  registryAddress: Address,
  fetchedAt: string,
): AgentRecord {
  const tokenId = listing.erc8004AgentId.toString();

  const fuguListing: FuguListing = {
    listingId,
    erc8004AgentId: listing.erc8004AgentId,
    owner: listing.owner,
    agentWallet: listing.agentWallet,
    category,
    priceUsd8PerPeriod: listing.priceUsd8PerPeriod,
    periodSeconds: listing.periodSeconds,
    active: listing.active,
    curated: listing.curated,
    metadataURI: listing.metadataURI,
  };

  return {
    id: makeAgentKey(chainId, tokenId),
    chainId,
    tokenId,
    registryAddress,
    agentId: null,

    // The name and description live in `metadataURI` (IPFS/HTTPS), which is
    // deliberately NOT fetched here — the safety net must work without an extra
    // network that can go down too. Task 5 may enrich it from the cache.
    name: `Agent #${tokenId}`,
    description: "",
    imageUrl: null,
    agentType: null,
    tags: [],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: [],

    ownerAddress: listing.owner,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: listing.agentWallet,

    isActive: listing.active,
    // `curated` is granted by a trusted curator through `setCurated`, and a
    // curator may not curate their own listing — that is the strongest
    // verification signal we have without calling anything off-chain.
    isVerified: listing.curated,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },

    classification: {
      category,
      confidence: 1,
      reason: "on-chain category from FuguRegistry",
    },
    fuguListing,

    source: "onchain",
    fetchedAt,
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
  };
}

export function createOnchainSource(options: OnchainSourceOptions): OnchainSource {
  const { client, config } = options;
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? ONCHAIN_BATCH_SIZE;
  const registryAddress = config.contracts.registry as Address;
  const chainId = config.chainId;

  async function readListing(listingId: bigint): Promise<RawListingTuple> {
    const result = await readContract(client, {
      address: registryAddress,
      abi: FUGU_REGISTRY_ABI,
      functionName: "getListing",
      args: [listingId],
    });
    return result as unknown as RawListingTuple;
  }

  return {
    async readFuguListings(opts: ReadFuguListingsOptions = {}): Promise<AgentListPage> {
      const fetchedAt = now().toISOString();
      const limit = Math.min(
        Math.max(Math.trunc(opts.limit ?? ONCHAIN_DEFAULT_LIMIT), 1),
        ONCHAIN_MAX_LIMIT,
      );
      const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);

      let count: bigint;
      try {
        count = (await readContract(client, {
          address: registryAddress,
          abi: FUGU_REGISTRY_ABI,
          functionName: "listingCount",
        })) as bigint;
      } catch (err) {
        return unhealthyPage("onchain", describeFailure(err), fetchedAt, limit, offset);
      }

      // `listingCount()` is a `uint256`. Above 2^53 `Number()` drifts
      // silently, so the number is clamped rather than left to lie quietly.
      // Realistically unreachable; this ensures that if the contract ever
      // changes, what surfaces is an obviously impossible number.
      const total =
        count > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(count);
      const base = {
        total,
        limit,
        offset,
        source: "onchain" as const,
        fetchedAt,
      };

      // Listing ids start at 1 — `getListing(0)` always reverts.
      const ids: bigint[] = [];
      for (let i = offset + 1; i <= Math.min(offset + limit, total); i++) {
        ids.push(BigInt(i));
      }

      const items: AgentRecord[] = [];
      let skipped = 0;

      for (const group of chunk(ids, batchSize)) {
        const settled = await Promise.allSettled(group.map((id) => readListing(id)));
        settled.forEach((result, index) => {
          if (result.status !== "fulfilled") {
            // A single reverting listing (e.g. removed in a later contract
            // version) must not take the whole page down.
            skipped++;
            return;
          }
          const category = categoryFromOnchainIndex(result.value.category);
          if (category === null) {
            // An on-chain enum outside 0–3: the contract is newer than this
            // backend. Skip it rather than showing the wrong category.
            skipped++;
            return;
          }
          items.push(
            toAgentRecord(
              group[index]!,
              result.value,
              category,
              chainId,
              registryAddress,
              fetchedAt,
            ),
          );
        });
      }

      return {
        ...base,
        items,
        healthy: true,
        reason: skipped > 0 ? `${skipped} listing(s) skipped because they could not be read` : null,
      };
    },

    async readFuguListing(listingId: bigint | number): Promise<AgentDetailResult> {
      const fetchedAt = now().toISOString();
      const id = BigInt(listingId);
      const base = { source: "onchain" as const, fetchedAt };

      try {
        const listing = await readListing(id);
        const category = categoryFromOnchainIndex(listing.category);
        if (category === null) {
          return {
            ...base,
            agent: null,
            healthy: false,
            reason: `unknown on-chain category: ${listing.category}`,
          };
        }
        return {
          ...base,
          agent: toAgentRecord(id, listing, category, chainId, registryAddress, fetchedAt),
          healthy: true,
          reason: null,
        };
      } catch (err) {
        return { ...base, agent: null, healthy: false, reason: describeFailure(err) };
      }
    },
  };
}
