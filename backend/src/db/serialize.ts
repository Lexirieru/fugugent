/**
 * **Satu-satunya tempat** `AgentRecord` berubah bentuk.
 *
 * `AgentRecord.fuguListing` memuat `bigint` (`priceUsd8PerPeriod`, `listingId`,
 * `erc8004AgentId`), jadi `AgentRecord` **tidak JSON-serializable apa adanya** —
 * `JSON.stringify` melempar `TypeError` begitu bertemu `bigint`. Diam-diam
 * menambal itu (lewat `toJSON` di prototipe `BigInt`, atau replacer yang
 * mengubahnya jadi `Number`) adalah cacat: yang pertama membuat kesalahan
 * menjadi tak terlihat, yang kedua menghancurkan presisi uang.
 *
 * Karena itu konversinya eksplisit dan terpusat di sini:
 *
 * - `serializeAgentRecord` / `deserializeAgentRecord` — bentuk kawat HTTP.
 * - `toAgentRow` / `fromAgentRow` — bentuk baris Postgres.
 *
 * Keduanya memakai primitif yang sama, `encodeMoney` / `decodeMoney`, sehingga
 * hanya ada satu aturan uang di seluruh backend: **string desimal di luar,
 * `bigint` di dalam, `number` tidak pernah.**
 */
import {
  makeAgentKey,
  type AgentClassification,
  type AgentRecord,
  type Address,
  type Category,
  type FuguListing,
} from "../types.js";
import type { AgentRow } from "./schema.js";

/** Hanya digit desimal, boleh diawali `-`. Tidak ada `1e9`, tidak ada `15.5`. */
const DECIMAL_INTEGER = /^-?\d+$/;

/** `bigint` → string desimal. Tidak pernah menghasilkan notasi ilmiah. */
export function encodeMoney(value: bigint): string {
  return value.toString(10);
}

/** `bigint` → string desimal, meneruskan `null`. */
export function encodeMoneyOrNull(value: bigint | null): string | null {
  return value === null ? null : encodeMoney(value);
}

/**
 * String desimal (atau `bigint`) → `bigint`.
 *
 * Melempar pada `number`: bila nilainya sudah sampai sini sebagai `number`,
 * presisinya mungkin sudah hilang jauh sebelum kita bisa memeriksanya —
 * melanjutkan berarti menyebarkan angka uang yang salah.
 */
export function decodeMoney(value: string | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    throw new TypeError(
      "nilai uang datang sebagai number — presisi sudah hilang; kirim string desimal atau bigint",
    );
  }
  if (typeof value !== "string" || !DECIMAL_INTEGER.test(value)) {
    throw new TypeError(`nilai uang bukan bilangan bulat desimal: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

/** Seperti `decodeMoney`, tetapi `null` tetap `null`. */
export function decodeMoneyOrNull(value: string | bigint | null | undefined): bigint | null {
  return value === null || value === undefined ? null : decodeMoney(value);
}

// ---------------------------------------------------------------------------
// Bentuk kawat (HTTP / JSON)
// ---------------------------------------------------------------------------

/** `FuguListing` dengan setiap `bigint` diganti string desimal. */
export interface FuguListingJson
  extends Omit<FuguListing, "listingId" | "erc8004AgentId" | "priceUsd8PerPeriod"> {
  listingId: string;
  erc8004AgentId: string;
  priceUsd8PerPeriod: string;
}

/**
 * `AgentRecord` yang aman untuk `JSON.stringify`.
 *
 * `raw` sengaja dibuang: payload mentah upstream tidak pernah ikut ke kawat
 * maupun ke cache (lihat catatan di `src/types.ts`).
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

/** `AgentRecord` → bentuk yang boleh masuk `JSON.stringify`. */
export function serializeAgentRecord(record: AgentRecord): AgentRecordJson {
  const { raw: _raw, fuguListing, ...rest } = record;
  return {
    ...rest,
    fuguListing: fuguListing === null ? null : serializeFuguListing(fuguListing),
  };
}

/** Kebalikan `serializeAgentRecord`. Nilai uang kembali persis sama. */
export function deserializeAgentRecord(json: AgentRecordJson): AgentRecord {
  const { fuguListing, ...rest } = json;
  return {
    ...rest,
    fuguListing: fuguListing === null ? null : deserializeFuguListing(fuguListing),
  };
}

// ---------------------------------------------------------------------------
// Bentuk baris Postgres
// ---------------------------------------------------------------------------

function toDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TypeError(`fetchedAt bukan ISO 8601: ${iso}`);
  return date;
}

/**
 * `AgentRecord` → baris `agents`.
 *
 * `id` selalu dihitung ulang dari `chainId`/`tokenId` (`makeAgentKey`) supaya
 * kunci primer cache tidak pernah bergantung pada `id` yang salah dari upstream.
 *
 * Catatan presisi: `fetchedAt` disimpan sebagai `timestamptz` — presisi
 * milidetik, sama seperti `Date.prototype.toISOString()` yang menghasilkannya.
 * `createdAt`/`updatedAt` dari upstream disimpan sebagai `text` apa adanya
 * karena 8004scan mengirim mikrodetik (`…:11.096927Z`) yang akan terpangkas
 * kalau dilewatkan `Date`.
 */
export function toAgentRow(record: AgentRecord): AgentRow {
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

    fuguListingId: listing ? encodeMoney(listing.listingId) : null,
    fuguErc8004AgentId: listing ? encodeMoney(listing.erc8004AgentId) : null,
    fuguOwner: listing ? listing.owner : null,
    fuguAgentWallet: listing ? listing.agentWallet : null,
    fuguCategory: listing ? listing.category : null,
    fuguPriceUsd8PerPeriod: listing ? encodeMoney(listing.priceUsd8PerPeriod) : null,
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

function listingFromRow(row: AgentRow): FuguListing | null {
  if (row.fuguListingId === null || row.fuguPriceUsd8PerPeriod === null) return null;
  return {
    listingId: decodeMoney(row.fuguListingId),
    erc8004AgentId: decodeMoneyOrNull(row.fuguErc8004AgentId) ?? 0n,
    owner: (row.fuguOwner ?? "0x") as Address,
    agentWallet: (row.fuguAgentWallet ?? "0x") as Address,
    category: (row.fuguCategory ?? "REBALANCING") as Category,
    priceUsd8PerPeriod: decodeMoney(row.fuguPriceUsd8PerPeriod),
    periodSeconds: row.fuguPeriodSeconds ?? 0,
    active: row.fuguActive ?? false,
    curated: row.fuguCurated ?? false,
    metadataURI: row.fuguMetadataUri ?? "",
  };
}

function classificationFromRow(row: AgentRow): AgentClassification | null {
  if (row.classificationCategory === null && row.classificationConfidence === null) return null;
  return {
    category: row.classificationCategory,
    confidence: row.classificationConfidence ?? 0,
    reason: row.classificationReason ?? "",
  };
}

/**
 * Baris `agents` → `AgentRecord`.
 *
 * `similarityScore` selalu `null`: skor kemiripan hanya bermakna pada hasil
 * `semanticSearch` dan sengaja tidak di-cache — angka itu milik satu kueri,
 * bukan milik agent-nya.
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
