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

/**
 * Batas kedalaman pengupasan pembungkus `{success,data}`.
 *
 * Bentuk nyata yang pernah dilihat hanya satu lapis. Batasnya dua supaya masih
 * ada ruang bila upstream menambah satu pembungkus, tanpa memberi rekursi ini
 * kedalaman tak terbatas: tanpa penghitung, `{success,data}` bersarang 20.000
 * lapis melempar `RangeError` — melanggar aturan bahwa bentuk tak dikenal tidak
 * boleh melempar. Batas ini **ditegakkan oleh `depth`**, bukan diasumsikan.
 */
export const MAX_ENVELOPE_DEPTH = 2;

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
 *
 * `depth` adalah parameter internal; pemanggil tidak perlu mengisinya.
 * Bersarang melewati `MAX_ENVELOPE_DEPTH` menjadi `unknown`, bukan lemparan.
 */
export function unwrapEnvelope(body: unknown, depth = 0): UpstreamEnvelope {
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
    if (depth >= MAX_ENVELOPE_DEPTH) {
      // Bukan lemparan: pembungkus yang bersarang terlalu dalam adalah
      // "bentuk tak dikenal" seperti bentuk aneh lainnya, dan diperlakukan sama.
      return {
        kind: "unknown",
        message: `pembungkus {success,data} bersarang lebih dari ${MAX_ENVELOPE_DEPTH} lapis`,
      };
    }
    const inner = unwrapEnvelope(body.data, depth + 1);
    return inner.kind === "unknown"
      ? { kind: "unknown", message: `di dalam {success,data}: ${inner.message}` }
      : inner;
  }

  return { kind: "object", value: body };
}

/** Bilangan bulat desimal non-negatif — bentuk satu-satunya yang sah untuk `tokenId`. */
const DECIMAL_UINT = /^\d+$/;

/**
 * Validasi `token_id` menjadi string desimal.
 *
 * Ini bukan kerapian: `tokenId` masuk ke `id` yang menjadi kunci primer cache
 * dan potongan URL halaman detail. Nilai seperti `1.5` atau `1e21` dulu lolos
 * dan menghasilkan `"97:1.5"` / `"97:1e+21"` — bentuk rusak yang menyebar ke DB
 * dan ke URL. Lebih baik agent itu dilewati daripada kunci primernya cacat.
 */
function asTokenId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return DECIMAL_UINT.test(trimmed) ? trimmed : null;
  }
  if (typeof value === "number") {
    // `Number.isSafeInteger` menolak 1e21 dan 1.5 sekaligus; `String()` atas
    // angka di luar rentang aman menghasilkan notasi eksponen.
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }
  return null;
}

/** Ambil `token_id` dari id komposit 8004scan `"56:0x8004…:49637"`. */
function parseCompositeAgentId(agentId: string): { chainId: number | null; tokenId: string } | null {
  const parts = agentId.split(":");
  if (parts.length !== 3) return null;
  const tokenId = parts[2]!.trim();
  if (!/^\d+$/.test(tokenId)) return null;
  return { chainId: asFiniteNumber(parts[0]), tokenId };
}

/**
 * Kumpulkan OASF skill/domain dari beberapa lokasi yang mungkin.
 *
 * **Apa yang sudah diketahui (panggilan live oleh implementer Task 4):**
 * `oasf_skills`/`oasf_domains` ada di OpenAPI bertipe `string[] | null`, tapi
 * **hanya di skema `MCPAgentDetail`** — bukan di body `GET /agents` maupun di
 * body detail `GET /agents/{chain}/{token}`. Artinya jalur yang benar-benar
 * berbuah pada respons yang kita pakai adalah
 * `raw_metadata.offchain_content.skills`, dan **daftar tidak membawa OASF sama
 * sekali**. Task 4 karena itu tidak boleh menggantungkan lapis OASF pada hasil
 * `listAgents()`.
 *
 * Nama-nama lain tetap disapu: murah, dan menutup kemungkinan upstream mulai
 * mengirimkannya di endpoint yang kita pakai.
 */
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

  const tokenId = asTokenId(raw.token_id) ?? composite?.tokenId ?? null;
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

/**
 * Kode error upstream yang berarti "agent itu memang tidak ada", bukan
 * "upstream sedang sakit". Membedakan keduanya penting: `healthy:false` mengalir
 * ke `recordSourceHealth` dan menyalakan lampu merah `/api/health` — dan
 * mendorong Task 5 turun ke fallback — padahal 8004scan menjawab dengan benar.
 */
const NOT_FOUND_CODES: readonly string[] = ["NOT_FOUND", "AGENT_NOT_FOUND", "NOT_FOUND_ERROR"];

/** Ubah body respons detail menjadi `AgentDetailResult`. **Tidak pernah melempar.** */
export function normalizeAgentDetailBody(body: unknown, ctx: NormalizeContext): AgentDetailResult {
  const base = { source: ctx.source, fetchedAt: ctx.fetchedAt };
  const envelope = unwrapEnvelope(body);

  if (envelope.kind === "error") {
    const notFound = NOT_FOUND_CODES.includes(envelope.code.toUpperCase());
    return {
      ...base,
      agent: null,
      // "tidak ditemukan" adalah jawaban yang sah, jadi sumbernya tetap sehat.
      healthy: notFound,
      reason: `${envelope.code}: ${envelope.message}`,
    };
  }

  if (envelope.kind === "unknown") {
    return { ...base, agent: null, healthy: false, reason: envelope.message };
  }

  // Daftar kosong yang sah dari endpoint detail = agent tidak ada. Bukan cacat.
  if (envelope.kind === "list" && envelope.items.length === 0) {
    return { ...base, agent: null, healthy: true, reason: "agent tidak ditemukan" };
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
