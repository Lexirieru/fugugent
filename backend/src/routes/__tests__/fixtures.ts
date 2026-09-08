/**
 * Perkakas bersama untuk test lapisan HTTP.
 *
 * Seluruhnya sintetis dan disuntikkan: tidak ada test di folder ini yang
 * menyentuh jaringan, Postgres, atau RPC sungguhan.
 */
import type {
  AgentService,
  AgentServiceDetail,
  AgentServicePage,
  GetAgentsOptions,
  ServiceHealth,
} from "../../service/agents.js";
import type { AgentRecord, AgentSource, Category } from "../../types.js";

export const FIXED_NOW = "2026-09-08T12:00:00.000Z";

/**
 * Satu `AgentRecord` lengkap — **dengan `fuguListing` berisi `bigint`**.
 * Justru bagian itu yang harus dibuktikan tidak pernah bocor mentah ke kawat.
 */
export function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "97:41",
    chainId: 97,
    tokenId: "41",
    registryAddress: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
    agentId: "97:0x8004:41",

    name: "FuguGrid",
    description: "grid trading bot",
    imageUrl: null,
    agentType: "trading",
    tags: ["grid"],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: ["A2A"],

    ownerAddress: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",

    isActive: true,
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: 42,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },

    classification: { category: "GRID", confidence: 0.9, reason: "kata kunci grid" },
    fuguListing: {
      listingId: 1n,
      erc8004AgentId: 41n,
      owner: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
      agentWallet: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
      category: "GRID",
      // 12345678 basis 8 desimal = $0,12 — nilai yang tidak boleh pernah lewat `number`.
      priceUsd8PerPeriod: 12_345_678n,
      periodSeconds: 604_800,
      active: true,
      curated: false,
      metadataURI: "ipfs://x",
    },

    source: "scan8004",
    fetchedAt: "2026-09-08T11:59:00.000Z",
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
    ...overrides,
  };
}

export function makePage(overrides: Partial<AgentServicePage> = {}): AgentServicePage {
  const items = overrides.items ?? [makeRecord()];
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    source: "scan8004",
    healthy: true,
    reason: null,
    fetchedAt: FIXED_NOW,
    ageSeconds: 60,
    stale: false,
    degraded: false,
    maxAgeSeconds: 60,
    trail: [{ source: "scan8004", outcome: "ok", reason: null, items: items.length }],
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<AgentServiceDetail> = {}): AgentServiceDetail {
  return {
    agent: makeRecord(),
    source: "scan8004",
    healthy: true,
    reason: null,
    fetchedAt: FIXED_NOW,
    ageSeconds: 60,
    stale: false,
    degraded: false,
    maxAgeSeconds: 60,
    trail: [{ source: "scan8004", outcome: "ok", reason: null, items: 1 }],
    ...overrides,
  };
}

export function makeHealth(overrides: Partial<ServiceHealth> = {}): ServiceHealth {
  return {
    healthy: true,
    degraded: false,
    sources: [
      { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW },
      { source: "cache", healthy: true, reason: null, checkedAt: FIXED_NOW },
      { source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW },
    ],
    checkedAt: FIXED_NOW,
    ...overrides,
  };
}

export interface ListCall {
  category: Category;
  opts: GetAgentsOptions | undefined;
}

export interface FakeService extends AgentService {
  readonly listCalls: ListCall[];
  readonly detailCalls: string[];
}

export interface FakeServiceOptions {
  list?: (category: Category, opts?: GetAgentsOptions) => Promise<AgentServicePage>;
  detail?: (id: string) => Promise<AgentServiceDetail>;
  health?: () => Promise<ServiceHealth>;
}

export function fakeService(options: FakeServiceOptions = {}): FakeService {
  const listCalls: ListCall[] = [];
  const detailCalls: string[] = [];

  return {
    listCalls,
    detailCalls,
    async getAgentsByCategory(category, opts) {
      listCalls.push({ category, opts });
      return options.list ? options.list(category, opts) : makePage();
    },
    async getAgentDetail(id) {
      detailCalls.push(id);
      return options.detail ? options.detail(id) : makeDetail();
    },
    async getHealth() {
      return options.health ? options.health() : makeHealth();
    },
  };
}

/** Halaman kosong-tapi-sehat untuk kategori yang memang tidak berisi apa-apa. */
export function emptyPageFor(source: AgentSource = "seed"): AgentServicePage {
  return makePage({
    items: [],
    total: 0,
    source,
    ageSeconds: null,
    degraded: source !== "scan8004",
    trail: [{ source, outcome: "empty", reason: null, items: 0 }],
  });
}
