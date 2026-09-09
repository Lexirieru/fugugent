/**
 * The wire (JSON) shape of `AgentRecord`, and its translator.
 *
 * `AgentRecord` carries `bigint` and is therefore **not** JSON-serializable as it
 * stands, `backend/src/types.ts` states this rule at the top of the file: the layer
 * that writes to HTTP must turn every bigint into a decimal string explicitly. This
 * file is the frontend half of that agreement.
 *
 * The parser is fussy on purpose. The backend does not exist yet; if it later sends a
 * slightly different shape, we want to hear about it through an honest `healthy: false`,
 * not through a `NaN` that quietly renders as a price.
 */

import type { AgentRecord, Address, Category, FuguListing, PublisherTier } from "@/lib/agent-types";
import { CATEGORIES } from "@/lib/agent-types";

export interface WireFuguListing {
  listingId: string;
  erc8004AgentId: string;
  owner: string;
  agentWallet: string;
  category: string;
  /** A USD8 decimal string. `"10000000"` = $0.10. Never a `number`. */
  priceUsd8PerPeriod: string;
  periodSeconds: number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

export type WireAgentRecord = Omit<AgentRecord, "fuguListing"> & {
  fuguListing: WireFuguListing | null;
};

export class WireError extends Error {}

function asRecord(v: unknown, at: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new WireError(`${at}: expected an object`);
  }
  return v as Record<string, unknown>;
}

function bigintFromDecimal(v: unknown, at: string): bigint {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) {
    // Rejecting `number` here is the whole point of this file: money that passes
    // through `number` loses precision long before anyone sees it wrong on screen.
    throw new WireError(`${at}: expected a decimal string, got ${typeof v}`);
  }
  return BigInt(v);
}

function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

function parseListing(v: unknown, at: string): FuguListing {
  const o = asRecord(v, at);
  if (!isCategory(o.category)) throw new WireError(`${at}.category: unknown category`);
  if (typeof o.periodSeconds !== "number" || !Number.isFinite(o.periodSeconds)) {
    throw new WireError(`${at}.periodSeconds: expected a number`);
  }
  return {
    listingId: bigintFromDecimal(o.listingId, `${at}.listingId`),
    erc8004AgentId: bigintFromDecimal(o.erc8004AgentId, `${at}.erc8004AgentId`),
    owner: String(o.owner) as Address,
    agentWallet: String(o.agentWallet) as Address,
    category: o.category,
    priceUsd8PerPeriod: bigintFromDecimal(o.priceUsd8PerPeriod, `${at}.priceUsd8PerPeriod`),
    periodSeconds: o.periodSeconds,
    active: Boolean(o.active),
    curated: Boolean(o.curated),
    metadataURI: String(o.metadataURI ?? ""),
  };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function nullableString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function nullableNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** One record, from the wire to the domain shape. Throws `WireError` on an unfamiliar shape. */
export function parseAgentRecord(v: unknown, at = "agent"): AgentRecord {
  const o = asRecord(v, at);
  if (typeof o.id !== "string" || !o.id) throw new WireError(`${at}.id: required`);
  if (typeof o.chainId !== "number") throw new WireError(`${at}.chainId: expected a number`);
  if (typeof o.tokenId !== "string") throw new WireError(`${at}.tokenId: expected a string`);

  const rep = asRecord(o.reputation ?? {}, `${at}.reputation`);
  const cls = o.classification == null ? null : asRecord(o.classification, `${at}.classification`);

  return {
    id: o.id,
    chainId: o.chainId,
    tokenId: o.tokenId,
    registryAddress: (nullableString(o.registryAddress) as Address | null) ?? null,
    agentId: nullableString(o.agentId),

    name: String(o.name ?? ""),
    description: String(o.description ?? ""),
    imageUrl: nullableString(o.imageUrl),
    agentType: nullableString(o.agentType),
    tags: strArray(o.tags),
    categories: strArray(o.categories),
    skills: strArray(o.skills),
    domains: strArray(o.domains),
    supportedProtocols: strArray(o.supportedProtocols),

    ownerAddress: (nullableString(o.ownerAddress) as Address | null) ?? null,
    ownerUsername: nullableString(o.ownerUsername),
    ownerPublisherTier: (nullableString(o.ownerPublisherTier) as PublisherTier | null) ?? null,
    agentWallet: (nullableString(o.agentWallet) as Address | null) ?? null,

    isActive: Boolean(o.isActive),
    isVerified: Boolean(o.isVerified),
    isEndpointVerified: Boolean(o.isEndpointVerified),
    x402Supported: Boolean(o.x402Supported),
    reputation: {
      totalScore: nullableNumber(rep.totalScore),
      healthScore: nullableNumber(rep.healthScore),
      totalFeedbacks: nullableNumber(rep.totalFeedbacks) ?? 0,
      averageScore: nullableNumber(rep.averageScore),
      starCount: nullableNumber(rep.starCount) ?? 0,
    },

    classification: cls
      ? {
          category: isCategory(cls.category) ? cls.category : null,
          confidence: nullableNumber(cls.confidence) ?? 0,
          reason: String(cls.reason ?? ""),
        }
      : null,

    fuguListing: o.fuguListing == null ? null : parseListing(o.fuguListing, `${at}.fuguListing`),

    source: (o.source as AgentRecord["source"]) ?? "cache",
    fetchedAt: String(o.fetchedAt ?? new Date(0).toISOString()),
    createdAt: nullableString(o.createdAt),
    updatedAt: nullableString(o.updatedAt),
    similarityScore: nullableNumber(o.similarityScore),
  };
}

/** The other direction, used when the frontend has to pass a record along unchanged. */
export function toWire(record: AgentRecord): WireAgentRecord {
  const { fuguListing, ...rest } = record;
  return {
    ...rest,
    fuguListing: fuguListing
      ? {
          ...fuguListing,
          listingId: fuguListing.listingId.toString(),
          erc8004AgentId: fuguListing.erc8004AgentId.toString(),
          priceUsd8PerPeriod: fuguListing.priceUsd8PerPeriod.toString(),
        }
      : null,
  };
}
