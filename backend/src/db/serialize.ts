/**
 * **The only place** an `AgentRecord` changes shape.
 *
 * `AgentRecord.fuguListing` holds `bigint`s (`priceUsd8PerPeriod`, `listingId`,
 * `erc8004AgentId`), so an `AgentRecord` is **not JSON-serializable as-is** —
 * `JSON.stringify` throws a `TypeError` the moment it meets a `bigint`.
 * Silently patching that over (via a `toJSON` on `BigInt`'s prototype, or a
 * replacer that turns it into a `Number`) is a defect: the first makes the
 * mistake invisible, the second destroys money precision.
 *
 * So the conversion is explicit and centralized here:
 *
 * - `serializeAgentRecord` / `deserializeAgentRecord` — the HTTP wire shape.
 * - `toAgentRow` / `fromAgentRow` — the Postgres row shape.
 *
 * Both use the same primitives, `encodeMoney` / `decodeMoney`, so there is only
 * one money rule across the whole backend: **decimal strings on the outside,
 * `bigint` on the inside, `number` never.**
 */
import {
  CATEGORIES,
  makeAgentKey,
  type AgentClassification,
  type AgentRecord,
  type Address,
  type Category,
  type FuguListing,
} from "../types.js";
import { MONEY_PRECISION, type AgentRow } from "./schema.js";

/** Decimal digits only, optionally prefixed with `-`. No `1e9`, no `15.5`. */
const DECIMAL_INTEGER = /^-?\d+$/;

/** A `tokenId` is a decimal `uint256`. `"1.5"` and `"1e+21"` are not token ids. */
const DECIMAL_UNSIGNED = /^\d+$/;

/** `bigint` → decimal string. Never produces scientific notation. */
export function encodeMoney(value: bigint): string {
  return value.toString(10);
}

/** `bigint` → decimal string, passing `null` through. */
export function encodeMoneyOrNull(value: bigint | null): string | null {
  return value === null ? null : encodeMoney(value);
}

/**
 * A decimal string (or a `bigint`) → `bigint`.
 *
 * Throws on a `number`: if the value arrived here as a `number`, its precision
 * may already have been lost long before we could check it — continuing means
 * spreading a wrong money figure.
 */
export function decodeMoney(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    throw new TypeError(
      "money value arrived as a number — precision is already lost; pass a decimal string or a bigint",
    );
  }
  if (typeof value !== "string" || !DECIMAL_INTEGER.test(value)) {
    throw new TypeError(`money value is not a decimal integer: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

/** Like `decodeMoney`, but `null` stays `null`. */
export function decodeMoneyOrNull(value: string | bigint | null | undefined): bigint | null {
  return value === null || value === undefined ? null : decodeMoney(value);
}

// ---------------------------------------------------------------------------
// The wire shape (HTTP / JSON)
// ---------------------------------------------------------------------------

/** A `FuguListing` with every `bigint` replaced by a decimal string. */
export interface FuguListingJson
  extends Omit<FuguListing, "listingId" | "erc8004AgentId" | "priceUsd8PerPeriod"> {
  listingId: string;
  erc8004AgentId: string;
  priceUsd8PerPeriod: string;
}

/**
 * An `AgentRecord` that is safe for `JSON.stringify`.
 *
 * `raw` is deliberately dropped: the raw upstream payload never travels to the
 * wire nor into the cache (see the note in `src/types.ts`).
 */
export interface AgentRecordJson extends Omit<AgentRecord, "fuguListing" | "raw"> {
  fuguListing: FuguListingJson | null;
}

export function serializeFuguListing(listing: FuguListing): FuguListingJson {
  return {
    ...listing,
    listingId: encodeMoney(listing.listingId),
    erc8004AgentId: encodeMoney(listing.erc8004AgentId),
    priceUsd8PerPeriod: encodeMoney(listing.priceUsd8PerPeriod),
  };
}

export function deserializeFuguListing(json: FuguListingJson): FuguListing {
  return {
    ...json,
    listingId: decodeMoney(json.listingId),
    erc8004AgentId: decodeMoney(json.erc8004AgentId),
    priceUsd8PerPeriod: decodeMoney(json.priceUsd8PerPeriod),
  };
}

/** `AgentRecord` → the shape that may go into `JSON.stringify`. */
export function serializeAgentRecord(record: AgentRecord): AgentRecordJson {
  const { raw: _raw, fuguListing, ...rest } = record;
  return {
    ...rest,
    fuguListing: fuguListing === null ? null : serializeFuguListing(fuguListing),
  };
}

/** The inverse of `serializeAgentRecord`. Money values come back exactly the same. */
export function deserializeAgentRecord(json: AgentRecordJson): AgentRecord {
  const { fuguListing, ...rest } = json;
  return {
    ...rest,
    fuguListing: fuguListing === null ? null : deserializeFuguListing(fuguListing),
  };
}

// ---------------------------------------------------------------------------
// The Postgres row shape
// ---------------------------------------------------------------------------

/**
 * Like `encodeMoney`, but rejects values that do not fit in
 * `numeric(78, 0)`. Without this Postgres is the one that rejects it — mid
 * transaction, after the whole batch has already been assembled — and one
 * malformed record takes 19 healthy records down with it.
 */
function encodeMoneyForColumn(value: bigint, field: string): string {
  const encoded = encodeMoney(value);
  const digits = encoded.startsWith("-") ? encoded.length - 1 : encoded.length;
  if (digits > MONEY_PRECISION) {
    throw new RangeError(
      `${field} does not fit in numeric(${MONEY_PRECISION}, 0): ${digits} digits`,
    );
  }
  return encoded;
}

function toDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TypeError(`fetchedAt is not ISO 8601: ${iso}`);
  return date;
}

/**
 * `AgentRecord` → an `agents` row.
 *
 * `id` is always recomputed from `chainId`/`tokenId` (`makeAgentKey`) so the
 * cache's primary key never depends on a wrong `id` coming from upstream.
 *
 * A note on precision: `fetchedAt` is stored as `timestamptz` — millisecond
 * precision, the same as the `Date.prototype.toISOString()` that produces it.
 * The upstream `createdAt`/`updatedAt` are stored as `text` verbatim because
 * 8004scan sends microseconds (`…:11.096927Z`) that would be truncated if
 * passed through `Date`.
 */
export function toAgentRow(record: AgentRecord): AgentRow {
  if (!DECIMAL_UNSIGNED.test(record.tokenId)) {
    // This value becomes the cache's primary key and a segment of the detail
    // URL. A `1e21` that slips through as `"97:1e+21"` is an agent that can
    // never be looked up again.
    throw new TypeError(`tokenId is not a decimal integer: ${JSON.stringify(record.tokenId)}`);
  }
  const listing = record.fuguListing;
  return {
    id: makeAgentKey(record.chainId, record.tokenId),
    chainId: record.chainId,
    tokenId: record.tokenId,
    registryAddress: record.registryAddress,
    agentId: record.agentId,

    name: record.name,
    description: record.description,
    imageUrl: record.imageUrl,
    agentType: record.agentType,
    tags: record.tags,
    upstreamCategories: record.categories,
    skills: record.skills,
    domains: record.domains,
    supportedProtocols: record.supportedProtocols,

    ownerAddress: record.ownerAddress,
    ownerUsername: record.ownerUsername,
    ownerPublisherTier: record.ownerPublisherTier,
    agentWallet: record.agentWallet,

    isActive: record.isActive,
    isVerified: record.isVerified,
    isEndpointVerified: record.isEndpointVerified,
    x402Supported: record.x402Supported,

    reputationTotalScore: record.reputation.totalScore,
    reputationHealthScore: record.reputation.healthScore,
    reputationTotalFeedbacks: record.reputation.totalFeedbacks,
    reputationAverageScore: record.reputation.averageScore,
    reputationStarCount: record.reputation.starCount,

    classificationCategory: record.classification?.category ?? null,
    classificationConfidence: record.classification?.confidence ?? null,
    classificationReason: record.classification?.reason ?? null,

    fuguListingId: listing ? encodeMoneyForColumn(listing.listingId, "listingId") : null,
    fuguErc8004AgentId: listing
      ? encodeMoneyForColumn(listing.erc8004AgentId, "erc8004AgentId")
      : null,
    fuguOwner: listing ? listing.owner : null,
    fuguAgentWallet: listing ? listing.agentWallet : null,
    fuguCategory: listing ? listing.category : null,
    fuguPriceUsd8PerPeriod: listing
      ? encodeMoneyForColumn(listing.priceUsd8PerPeriod, "priceUsd8PerPeriod")
      : null,
    fuguPeriodSeconds: listing ? listing.periodSeconds : null,
    fuguActive: listing ? listing.active : null,
    fuguCurated: listing ? listing.curated : null,
    fuguMetadataUri: listing ? listing.metadataURI : null,

    source: record.source,
    fetchedAt: toDate(record.fetchedAt),
    upstreamCreatedAt: record.createdAt,
    upstreamUpdatedAt: record.updatedAt,
  };
}

function isCategory(value: string | null): value is Category {
  return value !== null && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * The listing from a row — or `null` when the row does not hold a complete
 * listing.
 *
 * It deliberately does **not** invent defaults. A half-filled row (perhaps from
 * a migration or a manual write) used to produce `owner: "0x"` — an invalid
 * address — and `category: "REBALANCING"` — a real category that would be shown
 * to the user as though it were a fact. Better to admit there is no listing,
 * just like the normalizer skipping an item with no identity.
 */
function listingFromRow(row: AgentRow): FuguListing | null {
  if (
    row.fuguListingId === null ||
    row.fuguPriceUsd8PerPeriod === null ||
    row.fuguOwner === null ||
    row.fuguAgentWallet === null ||
    !isCategory(row.fuguCategory) ||
    row.fuguPeriodSeconds === null ||
    row.fuguActive === null ||
    row.fuguCurated === null
  ) {
    return null;
  }
  return {
    listingId: decodeMoney(row.fuguListingId),
    erc8004AgentId: decodeMoneyOrNull(row.fuguErc8004AgentId) ?? 0n,
    owner: row.fuguOwner as Address,
    agentWallet: row.fuguAgentWallet as Address,
    category: row.fuguCategory,
    priceUsd8PerPeriod: decodeMoney(row.fuguPriceUsd8PerPeriod),
    periodSeconds: row.fuguPeriodSeconds,
    active: row.fuguActive,
    curated: row.fuguCurated,
    metadataURI: row.fuguMetadataUri ?? "",
  };
}

function classificationFromRow(row: AgentRow): AgentClassification | null {
  if (row.classificationCategory === null && row.classificationConfidence === null) return null;
  return {
    // An unknown category (an older schema, a manual write) is reported as
    // `null` — "not classified yet" — not passed on as a fake category.
    category: isCategory(row.classificationCategory) ? row.classificationCategory : null,
    confidence: row.classificationConfidence ?? 0,
    reason: row.classificationReason ?? "",
  };
}

/**
 * An `agents` row → `AgentRecord`.
 *
 * `similarityScore` is always `null`: a similarity score is only meaningful on
 * `semanticSearch` results and is deliberately not cached — that number belongs
 * to one query, not to the agent.
 */
export function fromAgentRow(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    chainId: row.chainId,
    tokenId: row.tokenId,
    registryAddress: row.registryAddress as Address | null,
    agentId: row.agentId,

    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    agentType: row.agentType,
    tags: row.tags,
    categories: row.upstreamCategories,
    skills: row.skills,
    domains: row.domains,
    supportedProtocols: row.supportedProtocols,

    ownerAddress: row.ownerAddress as Address | null,
    ownerUsername: row.ownerUsername,
    ownerPublisherTier: row.ownerPublisherTier,
    agentWallet: row.agentWallet as Address | null,

    isActive: row.isActive,
    isVerified: row.isVerified,
    isEndpointVerified: row.isEndpointVerified,
    x402Supported: row.x402Supported,

    reputation: {
      totalScore: row.reputationTotalScore,
      healthScore: row.reputationHealthScore,
      totalFeedbacks: row.reputationTotalFeedbacks,
      averageScore: row.reputationAverageScore,
      starCount: row.reputationStarCount,
    },

    classification: classificationFromRow(row),
    fuguListing: listingFromRow(row),

    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
    createdAt: row.upstreamCreatedAt,
    updatedAt: row.upstreamUpdatedAt,
    similarityScore: null,
  };
}
