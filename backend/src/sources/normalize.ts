/**
 * The 8004scan response normalizer → `AgentRecord`.
 *
 * ## Why this module exists
 *
 * 8004scan response shapes are **not uniform** (verified live, 8 Sep 2026):
 *
 * | Endpoint | Shape |
 * |---|---|
 * | `GET /agents` | `{ items, total, limit, offset }` — flat, no envelope |
 * | `GET /chains` | `{ success: true, data: … }` — enveloped |
 * | any error | `{ success: false, error: { code, message } }` |
 *
 * And a **fourth** shape that must be assumed to exist: anything we have never
 * seen before — an HTML page from a proxy, an empty body, or a new shape after
 * upstream changes version. On an unknown shape this module **does not throw**;
 * it returns an empty list and marks the source unhealthy, so the marketplace
 * drops to the next fallback instead of dying in front of the judges.
 *
 * The same rule applies per item: one broken item is skipped, the rest are
 * still returned. One weird agent must not erase the other 19 agents on the
 * page.
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
  /** ISO 8601 UTC — injected so tests are deterministic. */
  fetchedAt: string;
  /** The chainId used when upstream does not include one. */
  chainId: number;
  limit: number;
  offset: number;
}

/** The result of stripping the response envelope. `kind` decides how to read it. */
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

/** Only real `true`/`false` counts as a boolean. `"yes"`/`1` do not — do not guess. */
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asAddress(value: unknown): Address | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/**
 * Collects strings from a field that in the real world may be
 * `["a","b"]` or `[{name:"a"}, {id:"b"}]` — or, when upstream changes,
 * something that is not an array at all.
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
 * The depth limit for stripping `{success,data}` envelopes.
 *
 * The only real shape ever observed is one layer deep. The limit is two so
 * there is still room if upstream adds an envelope, without giving this
 * recursion unbounded depth: without a counter, a `{success,data}` nested
 * 20,000 layers deep throws a `RangeError` — violating the rule that an unknown
 * shape must not throw. This limit is **enforced by `depth`**, not assumed.
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
 * Strips the upstream response envelope. Never throws.
 *
 * - a bare array → `list`
 * - `{ items: [...] }` → `list`
 * - `{ success: false, … }` → `error` (even when `error` is a string)
 * - `{ success: true, data }` → stripped one layer and reprocessed
 * - a plain object (e.g. an agent detail response) → `object`
 * - anything else → `unknown`
 *
 * `depth` is an internal parameter; callers need not supply it. Nesting beyond
 * `MAX_ENVELOPE_DEPTH` becomes `unknown`, not a throw.
 */
export function unwrapEnvelope(body: unknown, depth = 0): UpstreamEnvelope {
  if (Array.isArray(body)) {
    return { kind: "list", items: body, total: body.length, limit: null, offset: null };
  }

  if (!isPlainObject(body)) {
    return { kind: "unknown", message: `unknown response shape: ${describeShape(body)}` };
  }

  if (body.success === false) {
    const err = body.error;
    if (isPlainObject(err)) {
      return {
        kind: "error",
        code: asNonEmptyString(err.code) ?? "UNKNOWN_ERROR",
        message: asNonEmptyString(err.message) ?? "upstream answered with an error but no message",
      };
    }
    return {
      kind: "error",
      code: "UNKNOWN_ERROR",
      message: asNonEmptyString(err) ?? "upstream answered success=false with no detail",
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
      return { kind: "unknown", message: "unknown response shape: success=true with no data" };
    }
    if (depth >= MAX_ENVELOPE_DEPTH) {
      // Not a throw: an envelope nested too deeply is an "unknown shape" like
      // any other odd shape, and is treated the same way.
      return {
        kind: "unknown",
        message: `{success,data} envelope nested more than ${MAX_ENVELOPE_DEPTH} layers deep`,
      };
    }
    const inner = unwrapEnvelope(body.data, depth + 1);
    return inner.kind === "unknown"
      ? { kind: "unknown", message: `inside {success,data}: ${inner.message}` }
      : inner;
  }

  return { kind: "object", value: body };
}

/** A non-negative decimal integer — the only valid shape for a `tokenId`. */
const DECIMAL_UINT = /^\d+$/;

/**
 * Validates `token_id` into a decimal string.
 *
 * This is not tidiness: `tokenId` goes into the `id` that becomes the cache's
 * primary key and a segment of the detail page URL. Values like `1.5` or `1e21`
 * used to slip through and produce `"97:1.5"` / `"97:1e+21"` — broken shapes
 * that spread into the DB and into URLs. Better to skip that agent than to have
 * a malformed primary key.
 */
function asTokenId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return DECIMAL_UINT.test(trimmed) ? trimmed : null;
  }
  if (typeof value === "number") {
    // `Number.isSafeInteger` rejects both 1e21 and 1.5; `String()` on a number
    // outside the safe range produces exponent notation.
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }
  return null;
}

/** Extracts the `token_id` from the 8004scan composite id `"56:0x8004…:49637"`. */
function parseCompositeAgentId(agentId: string): { chainId: number | null; tokenId: string } | null {
  const parts = agentId.split(":");
  if (parts.length !== 3) return null;
  const tokenId = parts[2]!.trim();
  if (!/^\d+$/.test(tokenId)) return null;
  return { chainId: asFiniteNumber(parts[0]), tokenId };
}

/**
 * Collects OASF skills/domains from several possible locations.
 *
 * **What is already known (live calls by the Task 4 implementer):**
 * `oasf_skills`/`oasf_domains` exist in the OpenAPI spec typed as
 * `string[] | null`, but **only in the `MCPAgentDetail` schema** — not in the
 * `GET /agents` body nor in the `GET /agents/{chain}/{token}` detail body. That
 * means the path that actually bears fruit on the responses we use is
 * `raw_metadata.offchain_content.skills`, and **the list carries no OASF at
 * all**. Task 4 must therefore not make its OASF layer depend on the result of
 * `listAgents()`.
 *
 * The other names are still swept: it is cheap, and it covers the possibility
 * that upstream starts sending them on the endpoints we use.
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
 * Turns a single 8004scan agent item into an `AgentRecord`.
 * Returns `null` — rather than throwing — when its identity cannot be established.
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

    // Upstream defaults to `is_active=true`; we follow it so that agents
    // without this field do not silently vanish from the marketplace.
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
 * Turns a list response body into an `AgentListPage`. **Never throws.**
 * An error or unknown shape → an empty list + `healthy: false`.
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
    // A list endpoint answering a single object: it may genuinely be one agent.
    const single = normalizeAgent(envelope.value, ctx);
    if (single === null) {
      return {
        ...base,
        items: [],
        total: 0,
        healthy: false,
        reason: `unknown response shape: ${describeShape(envelope.value)}`,
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
 * Upstream error codes that mean "that agent genuinely does not exist", not
 * "upstream is sick". Telling the two apart matters: `healthy:false` flows into
 * `recordSourceHealth` and turns the `/api/health` light red — and pushes
 * Task 5 down into the fallbacks — when 8004scan in fact answered correctly.
 */
const NOT_FOUND_CODES: readonly string[] = ["NOT_FOUND", "AGENT_NOT_FOUND", "NOT_FOUND_ERROR"];

/** Turns a detail response body into an `AgentDetailResult`. **Never throws.** */
export function normalizeAgentDetailBody(body: unknown, ctx: NormalizeContext): AgentDetailResult {
  const base = { source: ctx.source, fetchedAt: ctx.fetchedAt };
  const envelope = unwrapEnvelope(body);

  if (envelope.kind === "error") {
    const notFound = NOT_FOUND_CODES.includes(envelope.code.toUpperCase());
    return {
      ...base,
      agent: null,
      // "not found" is a legitimate answer, so the source stays healthy.
      healthy: notFound,
      reason: `${envelope.code}: ${envelope.message}`,
    };
  }

  if (envelope.kind === "unknown") {
    return { ...base, agent: null, healthy: false, reason: envelope.message };
  }

  // A legitimately empty list from the detail endpoint = the agent does not
  // exist. Not a defect.
  if (envelope.kind === "list" && envelope.items.length === 0) {
    return { ...base, agent: null, healthy: true, reason: "agent not found" };
  }

  const candidate = envelope.kind === "object" ? envelope.value : envelope.items[0];
  const agent = normalizeAgent(candidate, ctx);

  if (agent === null) {
    return {
      ...base,
      agent: null,
      healthy: false,
      reason: `unknown response shape: ${describeShape(candidate)}`,
    };
  }

  return { ...base, agent, healthy: true, reason: null };
}
