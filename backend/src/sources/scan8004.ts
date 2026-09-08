/**
 * Sumber data 8004scan — klien untuk `GET /agents`, `GET /agents/search/semantic`,
 * dan `GET /agents/{chain_id}/{token_id}`.
 *
 * ## Kontrak modul ini
 *
 * **Tidak ada satu pun fungsi di sini yang melempar.** Kegagalan upstream —
 * `500 DATABASE_ERROR` yang terbukti intermiten (4 dari 5 percobaan gagal saat
 * riset), circuit breaker yang terbuka, atau bentuk respons yang berubah —
 * semuanya menjadi `healthy: false` + `reason`. Pemanggil (Task 5) memakai itu
 * untuk turun ke tingkat fallback berikutnya, bukan untuk menangkap exception.
 *
 * ## Yang TIDAK dilakukan modul ini
 *
 * Tidak ada `fetch` sendiri. Header `User-Agent` browser (tanpa itu upstream
 * membalas HTTP 500, bukan 429 — terverifikasi live), retry backoff, timeout,
 * dan circuit breaker semuanya milik `createHttpClient` dari Task 1. Klien itu
 * disuntikkan; test tidak pernah menyentuh jaringan sungguhan.
 *
 * ## API key
 *
 * Dikirim HANYA lewat `withApiKey()` — properti non-enumerable, jadi tidak ikut
 * ke `JSON.stringify`/`console.log` opsi, dan tidak pernah menyentuh query string.
 */

import type { FugugentConfig } from "../config.js";
import { withApiKey, type HttpClient, type HttpGetOptions } from "../http/client.js";
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

/** `"any"` = jangan filter berdasarkan field ini (nilai yang dipahami upstream). */
export type TriState = boolean | "any";

/**
 * Filter yang dikirim ke `GET /agents`. Nama field di sini camelCase; pemetaan
 * ke query snake_case ada di `buildAgentListQuery`.
 */
export interface AgentListFilters {
  /** Buang placeholder & domain test (`localhost`, `example.com`). */
  isRegistered?: TriState;
  /** Field `active` ERC-8004. */
  isActive?: TriState;
  /** 0–100. Nilai 0/undefined berarti tidak memfilter. */
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
  /** Multi-value, logika OR — dikirim sebagai parameter berulang. */
  oasfSkill?: string[];
  oasfDomain?: string[];
  /** Multi-value, logika OR — dikirim sebagai satu parameter dipisah koma. */
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
 * Filter anti-spam default.
 *
 * Dari 309.444 agent di BSC, mayoritas adalah bulk registration tanpa deskripsi
 * dan dengan `total_score: 0`. Tanpa ketiga filter ini marketplace akan penuh
 * `"Agent #340784"`. Ketiganya adalah yang disebut spec §6.1 sebagai pre-filter
 * populasi, dan ketiganya benar-benar dikirim sebagai query (ada test-nya).
 *
 * **Cara mematikan salah satu:** oper `undefined` secara eksplisit, mis.
 * `listAgents({ filters: { hasA2a: undefined } })`. Spread menimpa kunci itu
 * dengan `undefined` dan parameternya tidak ikut dikirim.
 *
 * **Trade-off yang disadari:** di testnet (chain 97) populasi agent jauh lebih
 * kecil, dan `hasA2a` bisa mengosongkan hasil. Itu bukan kegagalan — Task 5
 * turun ke cache lalu ke `FuguRegistry` on-chain. Melonggarkan default di sini
 * berarti menukar marketplace kosong dengan marketplace penuh spam; yang kedua
 * lebih buruk.
 */
export const DEFAULT_SPAM_FILTERS: AgentListFilters = {
  isRegistered: true,
  isActive: true,
  minScore: 10,
  hasA2a: true,
};

/** Spec §6.1: semantic search per kategori memakai bobot dan ambang ini. */
export const DEFAULT_SEMANTIC_WEIGHT = 0.7;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.55;

export const DEFAULT_LIMIT = 20;
/** Batas keras upstream. */
export const MAX_LIMIT = 100;

export interface ListAgentsOptions {
  chainId?: number;
  limit?: number;
  offset?: number;
  /** Digabung DI ATAS `DEFAULT_SPAM_FILTERS`. */
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
  /** Klien Task 1 — sudah membawa User-Agent browser, retry, dan breaker. */
  http: HttpClient;
  config: FugugentConfig;
  /** Disuntikkan supaya `fetchedAt` deterministik di test. */
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
 * Susun query untuk `GET /agents`. Diekspor supaya bisa diuji langsung —
 * bahwa filter anti-spam benar-benar terkirim adalah klaim yang harus dibuktikan,
 * bukan diasumsikan.
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

/** Pesan kegagalan yang aman untuk di-log dan dikirim ke frontend. */
function describeFailure(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" && status !== 0
      ? `${err.name} ${status}: ${err.message}`
      : `${err.name}: ${err.message}`;
  }
  return "kegagalan tak dikenal saat memanggil 8004scan";
}

export function createScan8004Source(options: Scan8004SourceOptions): Scan8004Source {
  const { http, config } = options;
  const now = options.now ?? (() => new Date());
  const baseUrl = config.scan8004.baseUrl.replace(/\/+$/, "");
  // Dibaca sekali di sini, lalu HANYA dioper lewat `withApiKey`.
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
        // Upstream mewajibkan `q` 1–500 karakter; memanggilnya dengan query
        // kosong hanya membakar kuota rate limit untuk dijawab 422.
        return unhealthyPage("scan8004", "query semantic kosong", ctx.fetchedAt, limit, offset);
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
        return {
          agent: null,
          source: "scan8004",
          healthy: false,
          reason: describeFailure(err),
          fetchedAt: ctx.fetchedAt,
        };
      }
    },
  };
}
