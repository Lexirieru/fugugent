/**
 * **Cermin** dari `backend/src/types.ts` — satu sumber kebenaran ada di backend,
 * berkas ini hanya salinan supaya frontend bisa dibangun sebelum backend selesai.
 * Kalau backend mengubah bentuknya, berkas ini yang menyesuaikan, bukan sebaliknya.
 *
 * Dua aturan dari sumbernya yang paling mudah dilanggar dan paling mahal:
 *
 * 1. **Uang tidak pernah `number`.** `priceUsd8PerPeriod` bertipe `bigint` dengan
 *    basis 8 desimal: `12345678n` berarti $0.12, bukan dua belas juta. Karena itu
 *    `AgentRecord` tidak JSON-serializable apa adanya — lihat `lib/data/wire.ts`.
 * 2. **Field yang tidak diketahui bernilai `null`, bukan dihilangkan.**
 */

export const CATEGORIES = ["REBALANCING", "GRID", "YIELD", "HEALTH_FACTOR"] as const;

export type Category = (typeof CATEGORIES)[number];

/** `contracts/src/types/FuguTypes.sol`: REBALANCING=0, GRID=1, YIELD=2, HEALTH_FACTOR=3. */
export function categoryFromOnchainIndex(index: number): Category | null {
  return CATEGORIES[index] ?? null;
}

export type AgentSource = "scan8004" | "cache" | "onchain" | "seed";

export type PublisherTier = "OFFICIAL" | "VERIFIED" | "COMMUNITY";

export type Address = `0x${string}`;

export interface AgentReputation {
  totalScore: number | null;
  healthScore: number | null;
  totalFeedbacks: number;
  averageScore: number | null;
  starCount: number;
}

export interface FuguListing {
  listingId: bigint;
  erc8004AgentId: bigint;
  owner: Address;
  agentWallet: Address;
  category: Category;
  /** USD basis 8 desimal. `1_500_000_000n` = $15. */
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

export interface AgentClassification {
  category: Category | null;
  confidence: number;
  reason: string;
}

export interface AgentRecord {
  id: string;
  chainId: number;
  tokenId: string;
  registryAddress: Address | null;
  agentId: string | null;

  name: string;
  description: string;
  imageUrl: string | null;
  agentType: string | null;
  tags: string[];
  categories: string[];
  skills: string[];
  domains: string[];
  supportedProtocols: string[];

  ownerAddress: Address | null;
  ownerUsername: string | null;
  ownerPublisherTier: PublisherTier | null;
  agentWallet: Address | null;

  isActive: boolean;
  isVerified: boolean;
  isEndpointVerified: boolean;
  x402Supported: boolean;
  reputation: AgentReputation;

  classification: AgentClassification | null;
  fuguListing: FuguListing | null;

  source: AgentSource;
  fetchedAt: string;
  createdAt: string | null;
  updatedAt: string | null;
  similarityScore: number | null;
  raw?: unknown;
}

export interface AgentListPage {
  items: AgentRecord[];
  total: number;
  limit: number;
  offset: number;
  source: AgentSource;
  /**
   * `false` bila sumber gagal ATAU membalas bentuk yang tidak dikenali.
   * Daftar kosong yang sah tetap `healthy: true`, begitu juga jawaban
   * "tidak ditemukan" — agent yang memang tidak ada bukan tanda upstream sakit.
   */
  healthy: boolean;
  /**
   * Keterangan keadaan sumber; tidak pernah memuat kredensial. Boleh terisi meski
   * `healthy: true`. `healthy` adalah penentu, `reason` hanya menjelaskan.
   */
  reason: string | null;
  fetchedAt: string;
}

export interface AgentDetailResult {
  agent: AgentRecord | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
}

export interface SourceHealth {
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  checkedAt: string;
}

export function makeAgentKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

export function unhealthyPage(
  source: AgentSource,
  reason: string,
  fetchedAt: string,
  limit: number,
  offset: number,
): AgentListPage {
  return { items: [], total: 0, limit, offset, source, healthy: false, reason, fetchedAt };
}
