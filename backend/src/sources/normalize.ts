/**
 * Normalizer respons 8004scan → `AgentRecord`.
 *
 * ## Kenapa modul ini ada
 *
 * Bentuk respons 8004scan **tidak seragam** (terverifikasi live, 8 Sep 2026):
 *
 * | Endpoint | Bentuk |
 * |---|---|
 * | `GET /agents` | `{ items, total, limit, offset }` — datar, tanpa pembungkus |
 * | `GET /chains` | `{ success: true, data: … }` — terbungkus |
 * | error apa pun | `{ success: false, error: { code, message } }` |
 *
 * Dan bentuk **keempat** yang harus diasumsikan ada: apa pun yang belum pernah
 * kita lihat — halaman HTML dari proxy, body kosong, atau bentuk baru setelah
 * upstream ganti versi. Pada bentuk tak dikenal modul ini **tidak melempar**;
 * ia mengembalikan daftar kosong dan menandai sumber tidak sehat, supaya
 * marketplace jatuh ke fallback berikutnya alih-alih mati di depan juri.
 *
 * Aturan yang sama berlaku per-item: satu item rusak dilewati, sisanya tetap
 * dikembalikan. Satu agent aneh tidak boleh menghapus 19 agent lain di halaman.
 */

import {
  makeAgentKey,
  type Address,
  type AgentDetailResult,
  type AgentListPage,
  type AgentRecord,
  type AgentSource,
  type PublisherTier,
} from "../types.js";

export interface NormalizeContext {
  source: AgentSource;
  /** ISO 8601 UTC — disuntikkan supaya test deterministik. */
  fetchedAt: string;
  /** chainId yang dipakai bila upstream tidak menyertakannya. */
  chainId: number;
  limit: number;
  offset: number;
}

/** Hasil pengupasan pembungkus respons. `kind` menentukan cara membacanya. */
export type UpstreamEnvelope =
  | { kind: "list"; items: unknown[]; total: number | null; limit: number | null; offset: number | null }
  | { kind: "object"; value: Record<string, unknown> }
  | { kind: "error"; code: string; message: string }
  | { kind: "unknown"; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Hanya `true`/`false` asli dianggap boolean. `"yes"`/`1` bukan — jangan menebak. */
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asAddress(value: unknown): Address | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/**
 * Kumpulkan string dari sebuah field yang di dunia nyata bisa berupa
 * `["a","b"]` atau `[{name:"a"}, {id:"b"}]` — atau, saat upstream berubah,
 * sesuatu yang bukan array sama sekali.
 */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry.trim() !== "") out.push(entry);
      continue;
    }
    if (isPlainObject(entry)) {
      const label =
        asNonEmptyString(entry.name) ?? asNonEmptyString(entry.id) ?? asNonEmptyString(entry.skill);
      if (label !== null) out.push(label);
    }
  }
  return out;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

const PUBLISHER_TIERS: readonly string[] = ["OFFICIAL", "VERIFIED", "COMMUNITY"];

function asPublisherTier(value: unknown): PublisherTier | null {
  return typeof value === "string" && PUBLISHER_TIERS.includes(value)
    ? (value as PublisherTier)
    : null;
}

function describeShape(body: unknown): string {
  if (body === null) return "null";
  if (Array.isArray(body)) return "array";
  const type = typeof body;
  if (type !== "object") return type;
  return `object{${Object.keys(body as object).slice(0, 6).join(",")}}`;
}

/**
 * Kupas pembungkus respons upstream. Tidak pernah melempar.
 *
 * - array telanjang → `list`
 * - `{ items: [...] }` → `list`
 * - `{ success: false, … }` → `error` (bahkan bila `error` berupa string)
 * - `{ success: true, data }` → dikupas satu lapis lalu diproses ulang
 * - objek biasa (mis. respons detail agent) → `object`
 * - selain itu → `unknown`
 */
export function unwrapEnvelope(body: unknown): UpstreamEnvelope {
  if (Array.isArray(body)) {
    return { kind: "list", items: body, total: body.length, limit: null, offset: null };
  }

  if (!isPlainObject(body)) {
    return { kind: "unknown", message: `bentuk respons tak dikenal: ${describeShape(body)}` };
  }

  if (body.success === false) {
    const err = body.error;
    if (isPlainObject(err)) {
      return {
        kind: "error",
        code: asNonEmptyString(err.code) ?? "UNKNOWN_ERROR",
        message: asNonEmptyString(err.message) ?? "upstream membalas error tanpa pesan",
      };
    }
    return {
      kind: "error",
      code: "UNKNOWN_ERROR",
      message: asNonEmptyString(err) ?? "upstream membalas success=false tanpa detail",
    };
  }

  if (Array.isArray(body.items)) {
    return {
      kind: "list",
      items: body.items,
      total: asFiniteNumber(body.total),
      limit: asFiniteNumber(body.limit),
      offset: asFiniteNumber(body.offset),
    };
  }

  if (body.success === true) {
    if (body.data === undefined) {
      return { kind: "unknown", message: "bentuk respons tak dikenal: success=true tanpa data" };
    }
    // Satu lapis saja — `{success,data:{success,data}}` tidak pernah terjadi
    // dan rekursi tanpa batas bukan hal yang ingin kita undang dari upstream.
    const inner = unwrapEnvelope(body.data);
    return inner.kind === "unknown"
      ? { kind: "unknown", message: `bentuk respons tak dikenal di dalam data: ${describeShape(body.data)}` }
      : inner;
  }

  return { kind: "object", value: body };
}

/** Ambil `token_id` dari id komposit 8004scan `"56:0x8004…:49637"`. */
function parseCompositeAgentId(agentId: string): { chainId: number | null; tokenId: string } | null {
  const parts = agentId.split(":");
  if (parts.length !== 3) return null;
  const tokenId = parts[2]!.trim();
  if (!/^\d+$/.test(tokenId)) return null;
  return { chainId: asFiniteNumber(parts[0]), tokenId };
}

function collectOasf(raw: Record<string, unknown>, keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) out.push(...asStringList(raw[key]));

  const rawMetadata = raw.raw_metadata;
  if (isPlainObject(rawMetadata)) {
    const offchain = rawMetadata.offchain_content;
    if (isPlainObject(offchain)) {
      for (const key of keys) out.push(...asStringList(offchain[key]));
    }
  }
  return dedupe(out);
}

/**
 * Ubah satu item agent 8004scan menjadi `AgentRecord`.
 * Mengembalikan `null` — bukan melempar — bila identitasnya tidak bisa ditetapkan.
 */
export function normalizeAgent(raw: unknown, ctx: NormalizeContext): AgentRecord | null {
  if (!isPlainObject(raw)) return null;

  const agentId = asNonEmptyString(raw.agent_id);
  const composite = agentId !== null ? parseCompositeAgentId(agentId) : null;

  let tokenId = asNonEmptyString(raw.token_id);
  if (tokenId === null && typeof raw.token_id === "number" && Number.isFinite(raw.token_id)) {
    tokenId = String(raw.token_id);
  }
  tokenId ??= composite?.tokenId ?? null;
  if (tokenId === null) return null;

  const chainId = asFiniteNumber(raw.chain_id) ?? composite?.chainId ?? ctx.chainId;

  return {
    id: makeAgentKey(chainId, tokenId),
    chainId,
    tokenId,
    registryAddress: asAddress(raw.contract_address),
    agentId,

    name: asNonEmptyString(raw.name) ?? `Agent #${tokenId}`,
    description: asNonEmptyString(raw.description) ?? "",
    imageUrl: asNonEmptyString(raw.image_url),
    agentType: asNonEmptyString(raw.agent_type),
    tags: asStringList(raw.tags),
    categories: asStringList(raw.categories),
    skills: collectOasf(raw, ["oasf_skills", "oasf_skill", "skills"]),
    domains: collectOasf(raw, ["oasf_domains", "oasf_domain", "domains"]),
    supportedProtocols: asStringList(raw.supported_protocols),

    ownerAddress: asAddress(raw.owner_address),
    ownerUsername: asNonEmptyString(raw.owner_username),
    ownerPublisherTier: asPublisherTier(raw.owner_publisher_tier),
    agentWallet: asAddress(raw.agent_wallet),

    // Upstream memakai default `is_active=true`; kami mengikutinya supaya
    // agent tanpa field ini tidak hilang diam-diam dari marketplace.
    isActive: asBoolean(raw.is_active, true),
    isVerified: asBoolean(raw.is_verified, false),
    isEndpointVerified: asBoolean(raw.is_endpoint_verified, false),
    x402Supported: asBoolean(raw.x402_supported, false),
    reputation: {
      totalScore: asFiniteNumber(raw.total_score),
      healthScore: asFiniteNumber(raw.health_score),
      totalFeedbacks: asFiniteNumber(raw.total_feedbacks) ?? 0,
      averageScore: asFiniteNumber(raw.average_score),
      starCount: asFiniteNumber(raw.star_count) ?? 0,
    },

    classification: null,
    fuguListing: null,

    source: ctx.source,
    fetchedAt: ctx.fetchedAt,
    createdAt: asNonEmptyString(raw.created_at),
    updatedAt: asNonEmptyString(raw.updated_at),
    similarityScore: asFiniteNumber(raw.similarity_score),
    raw,
  };
}

/**
 * Ubah body respons daftar menjadi `AgentListPage`. **Tidak pernah melempar.**
 * Bentuk error atau tak dikenal → daftar kosong + `healthy: false`.
 */
export function normalizeAgentListBody(body: unknown, ctx: NormalizeContext): AgentListPage {
  const base = {
    limit: ctx.limit,
    offset: ctx.offset,
    source: ctx.source,
    fetchedAt: ctx.fetchedAt,
  };

  const envelope = unwrapEnvelope(body);

  if (envelope.kind === "error") {
    return {
      ...base,
      items: [],
      total: 0,
      healthy: false,
      reason: `${envelope.code}: ${envelope.message}`,
    };
  }

  if (envelope.kind === "unknown") {
    return { ...base, items: [], total: 0, healthy: false, reason: envelope.message };
  }

  if (envelope.kind === "object") {
    // Endpoint daftar yang membalas satu objek: bisa jadi memang satu agent.
    const single = normalizeAgent(envelope.value, ctx);
    if (single === null) {
      return {
        ...base,
        items: [],
        total: 0,
        healthy: false,
        reason: `bentuk respons tak dikenal: ${describeShape(envelope.value)}`,
      };
    }
    return { ...base, items: [single], total: 1, healthy: true, reason: null };
  }

  const items: AgentRecord[] = [];
  for (const entry of envelope.items) {
    const record = normalizeAgent(entry, ctx);
    if (record !== null) items.push(record);
  }

  return {
    ...base,
    items,
    total: envelope.total ?? items.length,
    limit: envelope.limit ?? ctx.limit,
    offset: envelope.offset ?? ctx.offset,
    healthy: true,
    reason: null,
  };
}

/** Ubah body respons detail menjadi `AgentDetailResult`. **Tidak pernah melempar.** */
export function normalizeAgentDetailBody(body: unknown, ctx: NormalizeContext): AgentDetailResult {
  const base = { source: ctx.source, fetchedAt: ctx.fetchedAt };
  const envelope = unwrapEnvelope(body);

  if (envelope.kind === "error") {
    return { ...base, agent: null, healthy: false, reason: `${envelope.code}: ${envelope.message}` };
  }

  if (envelope.kind === "unknown") {
    return { ...base, agent: null, healthy: false, reason: envelope.message };
  }

  const candidate = envelope.kind === "object" ? envelope.value : envelope.items[0];
  const agent = normalizeAgent(candidate, ctx);

  if (agent === null) {
    return {
      ...base,
      agent: null,
      healthy: false,
      reason: `bentuk respons tak dikenal: ${describeShape(candidate)}`,
    };
  }

  return { ...base, agent, healthy: true, reason: null };
}
