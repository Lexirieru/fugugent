/**
 * What BNB Chain's quest tracker needs from us, read from the contracts.
 *
 * The Phase 2 brief asks every marketplace for "an API endpoint for anything not
 * verifiable onchain: hires per wallet, agents per owner". Strictly, both ARE on
 * chain here — every hire is a `FuguSubscription` subscription and every listing a
 * `FuguRegistry` entry — but neither contract keeps an index by wallet, so answering
 * "what did 0xabc hire?" means reading every subscription. This module does that read
 * once and answers by wallet.
 *
 * ## Read by state, not by logs
 *
 * Same reason as `registry.ts`: no free BSC testnet RPC serves historical
 * `eth_getLogs`. `subCount()` then `getSub(1..n)` and `listingCount()` then
 * `getListing(1..n)` through Multicall3 are served everywhere. Every answer states
 * the block it was read at, so a tracker can re-read the same state itself.
 *
 * ## What counts
 *
 * - **A hire** is a subscription whose `subscriber` is the wallet. Cancelled ones
 *   still count as hires — the payment happened, the `Subscribed` event exists —
 *   and each row says whether it is active, ended or cancelled.
 * - **A category** is the category the listing owner declared in `FuguRegistry`,
 *   not a guess from a description.
 * - **An agent owned** is a `FuguRegistry` listing whose `owner` is the wallet, and,
 *   separately, an ERC-8004 identity whose `ownerOf` is the wallet.
 */

import type { Chain, Client, Transport } from "viem";
import { getBlock, multicall, readContract } from "viem/actions";
import { FUGU_REGISTRY_ABI } from "./onchain.js";
import { categoryFromOnchainIndex, type Address, type AgentRecord, type Category } from "../types.js";

export const SUBSCRIPTION_READ_ABI = [
  { type: "function", name: "subCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "getSub",
    stateMutability: "view",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "listingId", type: "uint256" },
          { name: "subscriber", type: "address" },
          { name: "payToken", type: "address" },
          { name: "deposited", type: "uint128" },
          { name: "claimed", type: "uint128" },
          { name: "startedAt", type: "uint64" },
          { name: "endsAt", type: "uint64" },
          { name: "cancelled", type: "bool" },
          { name: "feeBps", type: "uint16" },
        ],
      },
    ],
  },
] as const;

export const REPUTATION_READ_ABI = [
  {
    type: "function",
    name: "hasReviewed",
    stateMutability: "view",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface RawSub {
  subId: bigint;
  listingId: bigint;
  subscriber: Address;
  payToken: Address;
  deposited: bigint;
  claimed: bigint;
  startedAt: bigint;
  endsAt: bigint;
  cancelled: boolean;
}

export interface RawListing {
  listingId: bigint;
  erc8004AgentId: bigint;
  owner: Address;
  agentWallet: Address;
  category: Category | null;
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
}

export interface ChainSnapshot {
  blockNumber: bigint;
  blockTimestamp: bigint;
  subs: RawSub[];
  listings: RawListing[];
}

/** The chain reads. Injected so no test touches an RPC. */
export interface TrackingChain {
  snapshot(): Promise<ChainSnapshot>;
  reviewed(listingIds: readonly bigint[], wallet: Address, blockNumber: bigint): Promise<boolean[]>;
}

export interface TrackingContracts {
  registry: Address;
  subscription: Address;
  reputation: Address;
}

const BATCH = 200;

export function createViemTrackingChain(
  client: Client<Transport, Chain | undefined>,
  contracts: TrackingContracts,
): TrackingChain {
  async function readMany<T>(
    count: bigint,
    call: (id: bigint) => { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
    blockNumber: bigint,
  ): Promise<{ id: bigint; value: T }[]> {
    const out: { id: bigint; value: T }[] = [];
    for (let start = 1n; start <= count; start += BigInt(BATCH)) {
      const ids: bigint[] = [];
      for (let id = start; id <= count && id < start + BigInt(BATCH); id++) ids.push(id);
      const results = await multicall(client, {
        // The call shapes are built from the const ABIs above; viem's generic
        // inference cannot follow them through this helper.
        contracts: ids.map(call) as never,
        allowFailure: false,
        blockNumber,
      });
      ids.forEach((id, i) => out.push({ id, value: results[i] as T }));
    }
    return out;
  }

  return {
    async snapshot() {
      const block = await getBlock(client);
      const blockNumber = block.number;
      const [subCount, listingCount] = await Promise.all([
        readContract(client, { address: contracts.subscription, abi: SUBSCRIPTION_READ_ABI, functionName: "subCount", blockNumber }),
        readContract(client, { address: contracts.registry, abi: FUGU_REGISTRY_ABI, functionName: "listingCount", blockNumber }),
      ]);
      const [subs, listings] = await Promise.all([
        readMany<Omit<RawSub, "subId">>(
          subCount as bigint,
          (id) => ({ address: contracts.subscription, abi: SUBSCRIPTION_READ_ABI, functionName: "getSub", args: [id] }),
          blockNumber,
        ),
        readMany<{
          erc8004AgentId: bigint;
          owner: Address;
          agentWallet: Address;
          category: number;
          priceUsd8PerPeriod: bigint;
          periodSeconds: number;
          active: boolean;
        }>(
          listingCount as bigint,
          (id) => ({ address: contracts.registry, abi: FUGU_REGISTRY_ABI, functionName: "getListing", args: [id] }),
          blockNumber,
        ),
      ]);
      return {
        blockNumber,
        blockTimestamp: block.timestamp,
        subs: subs.map(({ id, value }) => ({ subId: id, ...value })),
        listings: listings.map(({ id, value }) => ({
          listingId: id,
          erc8004AgentId: value.erc8004AgentId,
          owner: value.owner,
          agentWallet: value.agentWallet,
          category: categoryFromOnchainIndex(value.category),
          priceUsd8PerPeriod: value.priceUsd8PerPeriod,
          periodSeconds: value.periodSeconds,
          active: value.active,
        })),
      };
    },

    async reviewed(listingIds, wallet, blockNumber) {
      if (listingIds.length === 0) return [];
      const results = await multicall(client, {
        contracts: listingIds.map((id) => ({
          address: contracts.reputation,
          abi: REPUTATION_READ_ABI,
          functionName: "hasReviewed" as const,
          args: [id, wallet] as const,
        })),
        allowFailure: false,
        blockNumber,
      });
      return results as boolean[];
    },
  };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type HireStatus = "active" | "ended" | "cancelled";

export interface HireRow {
  subId: string;
  listingId: string;
  erc8004AgentId: string | null;
  agentKey: string | null;
  agentName: string | null;
  category: Category | null;
  /** `0x000…0` means native tBNB. */
  payToken: Address;
  /** Wei (or token base units), decimal string. */
  deposited: string;
  claimedByAgent: string;
  startedAt: string;
  endsAt: string;
  status: HireStatus;
}

export interface Snapshotted {
  chainId: number;
  blockNumber: string;
  readAt: string;
  contracts: TrackingContracts;
}

export interface HiresAnswer extends Snapshotted {
  wallet: Address;
  hires: HireRow[];
  /** Distinct categories this wallet has hired at least once, cancelled or not. */
  categoriesHired: Category[];
}

export interface OwnedListing {
  listingId: string;
  erc8004AgentId: string;
  agentKey: string;
  agentName: string | null;
  category: Category | null;
  active: boolean;
  priceUsd8PerPeriod: string;
  periodSeconds: number;
  agentWallet: Address;
}

export interface OwnedIdentity {
  erc8004AgentId: string;
  agentKey: string;
  name: string;
  /** Listed on this marketplace by this owner. */
  listingId: string | null;
}

export interface AgentsAnswer extends Snapshotted {
  owner: Address;
  listings: OwnedListing[];
  identities: OwnedIdentity[];
  /** The registry block the identities were read at; `null` before the first sweep. */
  identitiesBlockNumber: string | null;
}

export interface ReviewsAnswer extends Snapshotted {
  wallet: Address;
  reviewedListings: { listingId: string; erc8004AgentId: string; agentKey: string; category: Category | null }[];
}

export interface TrackingServiceOptions {
  chain: TrackingChain;
  chainId: number;
  contracts: TrackingContracts;
  /** The ERC-8004 registry snapshot: names and identity owners. */
  registryAgents?: () => readonly AgentRecord[];
  registryBlock?: () => string | null;
  now?: () => Date;
  /** How long one chain snapshot is reused. Keeps a tracker's burst of calls to one read. */
  ttlMs?: number;
}

export interface TrackingService {
  hires(wallet: Address): Promise<HiresAnswer>;
  agents(owner: Address): Promise<AgentsAnswer>;
  reviews(wallet: Address): Promise<ReviewsAnswer>;
}

export const TRACKING_TTL_MS = 15_000;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createTrackingService(options: TrackingServiceOptions): TrackingService {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? TRACKING_TTL_MS;
  let held: { snapshot: ChainSnapshot; at: number; readAt: string } | null = null;
  let inFlight: Promise<{ snapshot: ChainSnapshot; at: number; readAt: string }> | null = null;

  async function snapshot() {
    if (held !== null && Date.now() - held.at < ttlMs) return held;
    inFlight ??= options.chain
      .snapshot()
      .then((snapshot) => {
        held = { snapshot, at: Date.now(), readAt: now().toISOString() };
        return held;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function nameOf(agentKey: string): string | null {
    const record = options.registryAgents?.().find((r) => r.id === agentKey);
    return record?.name ?? null;
  }

  function envelope(s: { snapshot: ChainSnapshot; readAt: string }): Snapshotted {
    return {
      chainId: options.chainId,
      blockNumber: s.snapshot.blockNumber.toString(),
      readAt: s.readAt,
      contracts: options.contracts,
    };
  }

  const keyOf = (id: bigint) => `${options.chainId}:${id.toString()}`;

  return {
    async hires(wallet) {
      const s = await snapshot();
      const listings = new Map(s.snapshot.listings.map((l) => [l.listingId, l]));
      const hires: HireRow[] = s.snapshot.subs
        .filter((sub) => same(sub.subscriber, wallet))
        .map((sub) => {
          const listing = listings.get(sub.listingId) ?? null;
          const agentKey = listing === null ? null : keyOf(listing.erc8004AgentId);
          const status: HireStatus = sub.cancelled
            ? "cancelled"
            : sub.endsAt > s.snapshot.blockTimestamp
              ? "active"
              : "ended";
          return {
            subId: sub.subId.toString(),
            listingId: sub.listingId.toString(),
            erc8004AgentId: listing?.erc8004AgentId.toString() ?? null,
            agentKey,
            agentName: agentKey === null ? null : nameOf(agentKey),
            category: listing?.category ?? null,
            payToken: sub.payToken,
            deposited: sub.deposited.toString(),
            claimedByAgent: sub.claimed.toString(),
            startedAt: new Date(Number(sub.startedAt) * 1000).toISOString(),
            endsAt: new Date(Number(sub.endsAt) * 1000).toISOString(),
            status,
          };
        });
      const categoriesHired = [...new Set(hires.map((h) => h.category).filter((c): c is Category => c !== null))];
      return { ...envelope(s), wallet, hires, categoriesHired };
    },

    async agents(owner) {
      const s = await snapshot();
      const mine = s.snapshot.listings.filter((l) => same(l.owner, owner));
      const listedByAgent = new Map(mine.map((l) => [l.erc8004AgentId.toString(), l.listingId.toString()]));
      const identities: OwnedIdentity[] = (options.registryAgents?.() ?? [])
        .filter((r) => r.ownerAddress !== null && same(r.ownerAddress, owner))
        .map((r) => ({
          erc8004AgentId: r.tokenId,
          agentKey: r.id,
          name: r.name,
          listingId: listedByAgent.get(r.tokenId) ?? null,
        }));
      return {
        ...envelope(s),
        owner,
        listings: mine.map((l) => ({
          listingId: l.listingId.toString(),
          erc8004AgentId: l.erc8004AgentId.toString(),
          agentKey: keyOf(l.erc8004AgentId),
          agentName: nameOf(keyOf(l.erc8004AgentId)),
          category: l.category,
          active: l.active,
          priceUsd8PerPeriod: l.priceUsd8PerPeriod.toString(),
          periodSeconds: l.periodSeconds,
          agentWallet: l.agentWallet,
        })),
        identities,
        identitiesBlockNumber: options.registryBlock?.() ?? null,
      };
    },

    async reviews(wallet) {
      const s = await snapshot();
      const ids = s.snapshot.listings.map((l) => l.listingId);
      const flags = await options.chain.reviewed(ids, wallet, s.snapshot.blockNumber);
      const reviewedListings = s.snapshot.listings
        .filter((_, i) => flags[i] === true)
        .map((l) => ({
          listingId: l.listingId.toString(),
          erc8004AgentId: l.erc8004AgentId.toString(),
          agentKey: keyOf(l.erc8004AgentId),
          category: l.category,
        }));
      return { ...envelope(s), wallet, reviewedListings };
    },
  };
}
