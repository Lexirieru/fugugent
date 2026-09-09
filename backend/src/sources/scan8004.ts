/**
 * The 8004scan data source — a client for `GET /agents`,
 * `GET /agents/search/semantic`, and `GET /agents/{chain_id}/{token_id}`.
 *
 * ## This module's contract
 *
 * **Not a single function here throws.** Upstream failures — the
 * `500 DATABASE_ERROR` proven to be intermittent (4 out of 5 attempts failed
 * during the research), an open circuit breaker, or a changed response shape —
 * all become `healthy: false` + `reason`. The caller (Task 5) uses that to drop
 * to the next fallback level, not to catch an exception.
 *
 * ## What this module does NOT do
 *
 * No `fetch` of its own. The browser `User-Agent` header (without it upstream
 * answers HTTP 500, not 429 — verified live), backoff retries, timeouts, and
 * the circuit breaker all belong to `createHttpClient` from Task 1. That client
 * is injected; tests never touch a real network.
 *
 * ## API key
 *
 * Sent ONLY through `withApiKey()` — a non-enumerable property, so it does not
 * travel into `JSON.stringify`/`console.log` of the options, and never touches
 * the query string.
 */

import type { FugugentConfig } from "../config.js";
import {
  UpstreamError,
  withApiKey,
  type HttpClient,
  type HttpGetOptions,
} from "../http/client.js";
import {
  unhealthyPage,
  type AgentDetailResult,
  type AgentListPage,
  type PublisherTier,
} from "../types.js";
import {
  normalizeAgentDetailBody,
  normalizeAgentListBody,
  type NormalizeContext,
} from "./normalize.js";

/** `"any"` = do not filter on this field (a value upstream understands). */
export type TriState = boolean | "any";

/**
 * Filters sent to `GET /agents`. Field names here are camelCase; the mapping to
 * snake_case query parameters lives in `buildAgentListQuery`.
 */
export interface AgentListFilters {
  /** Drops placeholders & test domains (`localhost`, `example.com`). */
  isRegistered?: TriState;
  /** The ERC-8004 `active` field. */
  isActive?: TriState;
  /** 0–100. A value of 0/undefined means no filtering. */
  minScore?: number;
  minFeedbacks?: number;
  minValidations?: number;
  hasA2a?: boolean;
  hasMcp?: boolean;
  hasOasf?: boolean;
  isEndpointVerified?: boolean;
  x402Supported?: boolean;
  ownerPublisherTier?: PublisherTier;
  ownerAddress?: string;
  supportedProtocol?: string;
  supportedTrust?: string;
  isTestnet?: boolean;
  /** Multi-value, OR logic — sent as a repeated parameter. */
  oasfSkill?: string[];
  oasfDomain?: string[];
  /** Multi-value, OR logic — sent as a single comma-separated parameter. */
  tags?: string[];
  categories?: string[];
  search?: string;
  searchType?: "auto" | "text" | "token_id" | "agent_id" | "address" | "ens" | "did";
  searchFields?: string[];
  createdAfter?: string;
  createdBefore?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * The default anti-spam filters.
 *
 * Of the 309,444 agents on BSC, the majority are bulk registrations with no
 * description and `total_score: 0`. Without these filters the marketplace would
 * be full of `"Agent #340784"`. They are what spec §6.1 calls the population
 * pre-filter, and they really are sent as query parameters (there is a test for
 * it).
 *
 * **How to turn one off:** pass `undefined` explicitly, e.g.
 * `listAgents({ filters: { hasA2a: undefined } })`. The spread overwrites that
 * key with `undefined` and the parameter is not sent.
 *
 * **A deliberate trade-off:** on testnet (chain 97) the agent population is far
 * smaller, and `hasA2a` can empty out the results. That is not a failure —
 * Task 5 drops to the cache and then to the on-chain `FuguRegistry`. Loosening
 * the defaults here would trade an empty marketplace for a spam-filled one; the
 * second is worse.
 */
export const DEFAULT_SPAM_FILTERS: AgentListFilters = {
  isRegistered: true,
  isActive: true,
  minScore: 10,
  hasA2a: true,
};

/** Spec §6.1: per-category semantic search uses this weight and threshold. */
export const DEFAULT_SEMANTIC_WEIGHT = 0.7;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.55;

export const DEFAULT_LIMIT = 20;
/** The upstream hard limit. */
export const MAX_LIMIT = 100;

export interface ListAgentsOptions {
  chainId?: number;
  limit?: number;
  offset?: number;
  /** Merged ON TOP OF `DEFAULT_SPAM_FILTERS`. */
  filters?: AgentListFilters;
}

export interface SemanticSearchOptions {
  chainId?: number;
  limit?: number;
  offset?: number;
  semanticWeight?: number;
  similarityThreshold?: number;
  isActive?: TriState;
}

export interface Scan8004Source {
  listAgents(opts?: ListAgentsOptions): Promise<AgentListPage>;
  semanticSearch(query: string, opts?: SemanticSearchOptions): Promise<AgentListPage>;
  getAgent(chainId: number, tokenId: string | number | bigint): Promise<AgentDetailResult>;
}

export interface Scan8004SourceOptions {
  /** The Task 1 client — it already carries the browser User-Agent, retries, and the breaker. */
  http: HttpClient;
  config: FugugentConfig;
  /** Injected so `fetchedAt` is deterministic in tests. */
  now?: () => Date;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

function setTriState(params: URLSearchParams, key: string, value: TriState | undefined): void {
  if (value === undefined) return;
  params.set(key, value === "any" ? "any" : String(value));
}

function setBool(params: URLSearchParams, key: string, value: boolean | undefined): void {
  if (value === undefined) return;
  params.set(key, String(value));
}

function setNumber(params: URLSearchParams, key: string, value: number | undefined): void {
  if (value === undefined || !Number.isFinite(value) || value === 0) return;
  params.set(key, String(value));
}

function setString(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value === undefined || value.trim() === "") return;
  params.set(key, value);
}

function setCsv(params: URLSearchParams, key: string, values: string[] | undefined): void {
  if (values === undefined || values.length === 0) return;
  params.set(key, values.join(","));
}

function setRepeated(params: URLSearchParams, key: string, values: string[] | undefined): void {
  if (values === undefined) return;
  for (const value of values) params.append(key, value);
}

/**
 * Builds the query for `GET /agents`. Exported so it can be tested directly —
 * that the anti-spam filters really are sent is a claim that must be proven,
 * not assumed.
 */
export function buildAgentListQuery(
  chainId: number,
  limit: number,
  offset: number,
  filters: AgentListFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("chain_id", String(chainId));
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  setTriState(params, "is_registered", filters.isRegistered);
  setTriState(params, "is_active", filters.isActive);
  setNumber(params, "min_score", filters.minScore);
  setNumber(params, "min_feedbacks", filters.minFeedbacks);
  setNumber(params, "min_validations", filters.minValidations);
  setBool(params, "has_a2a", filters.hasA2a);
  setBool(params, "has_mcp", filters.hasMcp);
  setBool(params, "has_oasf", filters.hasOasf);
  setBool(params, "is_endpoint_verified", filters.isEndpointVerified);
  setBool(params, "x402_supported", filters.x402Supported);
  setBool(params, "is_testnet", filters.isTestnet);
  setString(params, "owner_publisher_tier", filters.ownerPublisherTier);
  setString(params, "owner_address", filters.ownerAddress);
  setString(params, "supported_protocol", filters.supportedProtocol);
  setString(params, "supported_trust", filters.supportedTrust);
  setRepeated(params, "oasf_skill", filters.oasfSkill);
  setRepeated(params, "oasf_domain", filters.oasfDomain);
  setCsv(params, "tags", filters.tags);
  setCsv(params, "categories", filters.categories);
  setCsv(params, "search_fields", filters.searchFields);
  setString(params, "search", filters.search);
  setString(params, "search_type", filters.searchType);
  setString(params, "created_after", filters.createdAfter);
  setString(params, "created_before", filters.createdBefore);
  setString(params, "sort_by", filters.sortBy);
  setString(params, "sort_order", filters.sortOrder);

  return params;
}

/** A failure message safe to log and to send to the frontend. */
function describeFailure(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" && status !== 0
      ? `${err.name} ${status}: ${err.message}`
      : `${err.name}: ${err.message}`;
  }
  return "unknown failure while calling 8004scan";
}

export function createScan8004Source(options: Scan8004SourceOptions): Scan8004Source {
  const { http, config } = options;
  const now = options.now ?? (() => new Date());
  const baseUrl = config.scan8004.baseUrl.replace(/\/+$/, "");
  // Read once here, then passed ONLY through `withApiKey`.
  const apiKey = config.scan8004.apiKey;

  function requestOptions(): HttpGetOptions | undefined {
    return apiKey === undefined ? undefined : withApiKey(apiKey);
  }

  function context(limit: number, offset: number, chainId: number): NormalizeContext {
    return { source: "scan8004", fetchedAt: now().toISOString(), chainId, limit, offset };
  }

  async function fetchPage(
    url: string,
    ctx: NormalizeContext,
  ): Promise<AgentListPage> {
    try {
      const result = await http.get<unknown>(url, requestOptions());
      return normalizeAgentListBody(result.data, ctx);
    } catch (err) {
      return unhealthyPage("scan8004", describeFailure(err), ctx.fetchedAt, ctx.limit, ctx.offset);
    }
  }

  return {
    async listAgents(opts: ListAgentsOptions = {}): Promise<AgentListPage> {
      const chainId = opts.chainId ?? config.chainId;
      const limit = clampLimit(opts.limit);
      const offset = clampOffset(opts.offset);
      const filters: AgentListFilters = { ...DEFAULT_SPAM_FILTERS, ...opts.filters };
      const query = buildAgentListQuery(chainId, limit, offset, filters);
      return fetchPage(`${baseUrl}/agents?${query.toString()}`, context(limit, offset, chainId));
    },

    async semanticSearch(
      query: string,
      opts: SemanticSearchOptions = {},
    ): Promise<AgentListPage> {
      const chainId = opts.chainId ?? config.chainId;
      const limit = clampLimit(opts.limit);
      const offset = clampOffset(opts.offset);
      const ctx = context(limit, offset, chainId);

      const trimmed = query.trim();
      if (trimmed === "") {
        // Upstream requires `q` to be 1–500 characters; calling it with an
        // empty query only burns rate-limit quota to be answered with a 422.
        return unhealthyPage("scan8004", "empty semantic query", ctx.fetchedAt, limit, offset);
      }

      const params = new URLSearchParams();
      params.set("q", trimmed.slice(0, 500));
      params.set("chain_id", String(chainId));
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      params.set("semantic_weight", String(opts.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT));
      params.set(
        "similarity_threshold",
        String(opts.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD),
      );
      setTriState(params, "is_active", opts.isActive ?? true);

      return fetchPage(`${baseUrl}/agents/search/semantic?${params.toString()}`, ctx);
    },

    async getAgent(
      chainId: number,
      tokenId: string | number | bigint,
    ): Promise<AgentDetailResult> {
      const ctx = context(1, 0, chainId);
      const url = `${baseUrl}/agents/${chainId}/${encodeURIComponent(String(tokenId))}`;
      try {
        const result = await http.get<unknown>(url, requestOptions());
        return normalizeAgentDetailBody(result.data, ctx);
      } catch (err) {
        // HTTP 404 means upstream ANSWERED correctly: that agent does not
        // exist. Marking it unhealthy would turn the `/api/health` light red and
        // push the whole system into the fallbacks just because someone
        // mistyped a token id. Real failures (5xx, timeout, breaker) are still
        // marked unhealthy.
        const notFound = err instanceof UpstreamError && err.status === 404;
        return {
          agent: null,
          source: "scan8004",
          healthy: notFound,
          reason: notFound ? `agent not found (HTTP 404)` : describeFailure(err),
          fetchedAt: ctx.fetchedAt,
        };
      }
    },
  };
}
