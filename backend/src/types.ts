/**
 * Bentuk data bersama seluruh backend Fugugent — **satu sumber kebenaran**.
 *
 * `AgentRecord` adalah bentuk yang dipakai bersama oleh:
 * - **Task 2 (sumber)** — 8004scan dan pembacaan on-chain keduanya dinormalkan ke sini.
 * - **Task 3 (cache DB)** — `id` + `chainId`/`tokenId` adalah identitas stabilnya,
 *   `fetchedAt` adalah umur datanya.
 * - **Task 4 (classifier)** — `name`, `description`, `tags`, `categories`,
 *   `skills`/`domains` (OASF), dan `supportedProtocols` adalah masukannya;
 *   `classification` adalah keluarannya.
 * - **Task 6 (tampilan)** — sisanya adalah apa yang dilihat pengguna.
 *
 * ## Aturan yang melekat pada tipe ini
 *
 * 1. **Semua nilai on-chain bertipe `bigint`** (`FuguListing`). Tidak pernah `number`
 *    untuk uang. Konsekuensinya `AgentRecord` **tidak** JSON-serializable apa adanya —
 *    lapisan yang menulis ke DB atau ke HTTP wajib mengubah bigint menjadi string
 *    desimal secara eksplisit.
 * 2. `tokenId` adalah **string desimal**, bukan `number`. `uint256` tidak muat di
 *    `number`, dan 8004scan sendiri mengembalikannya sebagai string.
 * 3. Field yang tidak diketahui bernilai `null`, bukan dihilangkan. Pembaca tidak
 *    perlu membedakan "tidak ada" dari "belum diisi".
 * 4. `source` dan `fetchedAt` **selalu** terisi. Setiap record tahu dari mana ia
 *    berasal dan kapan diambil — itulah yang membuat klaim ketahanan bisa diperiksa,
 *    bukan sekadar diucapkan.
 */

/** Empat kategori produk Fugugent. Urutannya SAMA dengan enum `Category` di Solidity. */
export const CATEGORIES = ["REBALANCING", "GRID", "YIELD", "HEALTH_FACTOR"] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Peta indeks enum on-chain -> kategori.
 * `contracts/src/types/FuguTypes.sol`: `REBALANCING=0, GRID=1, YIELD=2, HEALTH_FACTOR=3`.
 * Jangan pernah mengurutkan ulang `CATEGORIES` tanpa mengubah kontraknya.
 */
export function categoryFromOnchainIndex(index: number): Category | null {
  return CATEGORIES[index] ?? null;
}

/**
 * Asal sebuah record. Ini yang ditampilkan ke pengguna (dan juri) supaya jelas
 * apakah angka yang dilihat datang dari upstream, dari cache basi, atau dari
 * jaring pengaman on-chain.
 */
export type AgentSource = "scan8004" | "cache" | "onchain" | "seed";

/** Tier sertifikasi publisher di 8004scan. */
export type PublisherTier = "OFFICIAL" | "VERIFIED" | "COMMUNITY";

/** Alamat EVM dalam bentuk checksummed/lowercase `0x...`. */
export type Address = `0x${string}`;

/** Sinyal reputasi. Semua nullable: agent baru belum punya satu pun. */
export interface AgentReputation {
  /** Skor gabungan 8004scan v5, 0–100. */
  totalScore: number | null;
  /** Skor health-check 8004scan, 0–100. */
  healthScore: number | null;
  totalFeedbacks: number;
  /** Rata-rata skor feedback, 0–100. */
  averageScore: number | null;
  starCount: number;
}

/**
 * Listing first-party di `FuguRegistry`. `null` pada agent yang hanya ada di
 * 8004scan dan belum pernah didaftarkan ke marketplace kita.
 *
 * **Setiap nilai numeriknya on-chain, karena itu `bigint`.**
 */
export interface FuguListing {
  /** Id listing di registry kita. Dimulai dari 1 — 0 berarti tidak ada. */
  listingId: bigint;
  /** Identitas ERC-8004 yang diklaim listing ini. */
  erc8004AgentId: bigint;
  /** Pemilik listing — **penerima uang** langganan. */
  owner: Address;
  /** Wallet operasional agent. **Tidak pernah menerima pembayaran**, murni metadata. */
  agentWallet: Address;
  category: Category;
  /** Harga per periode dalam USD 8 desimal (mis. `1_500_000_000n` = $15). */
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  /** Ditandai kurator terpercaya. UI sebaiknya menonjolkan yang `true`. */
  curated: boolean;
  metadataURI: string;
}

/** Keluaran classifier (Task 4). `null` bila kepercayaan di bawah ambang. */
export interface AgentClassification {
  category: Category | null;
  /** 0–1. */
  confidence: number;
  /** Alasan yang bisa dibaca manusia — ditampilkan agar klasifikasi bisa diaudit. */
  reason: string;
}

/**
 * Satu agent, dinormalkan dari sumber mana pun.
 *
 * Kunci stabilnya adalah `id` = `` `${chainId}:${tokenId}` ``. Jangan memakai
 * `agentId` 8004scan sebagai kunci utama — ia memuat alamat registry yang bisa
 * berbeda antar deployment, dan tidak ada pada record hasil pembacaan on-chain.
 */
export interface AgentRecord {
  // --- identitas stabil (dipakai cache DB Task 3 dan URL detail Task 6) ---
  /** `` `${chainId}:${tokenId}` ``. Kunci primer di semua lapisan. */
  id: string;
  chainId: number;
  /** Desimal, string. `uint256` tidak muat di `number`. */
  tokenId: string;
  /** Alamat registry asal record ini (ERC-8004 atau FuguRegistry). */
  registryAddress: Address | null;
  /** Id komposit 8004scan `"56:0x8004…:49637"`, bila record berasal dari sana. */
  agentId: string | null;

  // --- masukan classifier (Task 4) + tampilan (Task 6) ---
  name: string;
  description: string;
  imageUrl: string | null;
  /** Mis. `"prediction"`, `"trading"` — dari registration file ERC-8004. */
  agentType: string | null;
  tags: string[];
  /** Kategori bebas dari upstream. **Bukan** `Category` kita — jangan tertukar. */
  categories: string[];
  /** OASF skill. Salah satu masukan utama lapis kedua classifier. */
  skills: string[];
  /** OASF domain. */
  domains: string[];
  /** Mis. `["MCP", "A2A", "Web"]`. */
  supportedProtocols: string[];

  // --- kepemilikan ---
  ownerAddress: Address | null;
  ownerUsername: string | null;
  ownerPublisherTier: PublisherTier | null;
  agentWallet: Address | null;

  // --- sinyal kepercayaan (badge di kartu agent) ---
  isActive: boolean;
  isVerified: boolean;
  isEndpointVerified: boolean;
  x402Supported: boolean;
  reputation: AgentReputation;

  // --- hasil klasifikasi; `null` sampai Task 4 mengisinya ---
  classification: AgentClassification | null;

  // --- listing first-party; `null` bila agent belum ada di FuguRegistry ---
  fuguListing: FuguListing | null;

  // --- provenance: dari mana dan kapan ---
  source: AgentSource;
  /** ISO 8601 UTC. Umur data dihitung dari sini. */
  fetchedAt: string;
  /** ISO 8601 dari upstream, bila ada. */
  createdAt: string | null;
  updatedAt: string | null;
  /** Skor kemiripan, hanya terisi pada hasil `semanticSearch`. */
  similarityScore: number | null;
  /**
   * Payload mentah upstream, untuk debugging dan lapis LLM classifier.
   * Lapisan cache boleh membuangnya — jangan ada yang bergantung padanya.
   */
  raw?: unknown;
}

/**
 * Satu halaman hasil dari sebuah sumber. **Tidak pernah melempar** ke pemanggil:
 * kegagalan diwakili oleh `healthy: false` + `reason`, bukan exception.
 */
export interface AgentListPage {
  items: AgentRecord[];
  /** Total di upstream (bukan panjang `items`). */
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
   * Keterangan keadaan sumber. Tidak pernah memuat kredensial.
   *
   * Boleh terisi meski `healthy: true` — mis. `readFuguListings` yang melewati
   * satu listing yang revert, atau detail yang tidak ditemukan. `healthy` adalah
   * penentu; `reason` hanya menjelaskan.
   */
  reason: string | null;
  /** ISO 8601 UTC — kapan halaman ini diambil. */
  fetchedAt: string;
}

/** Hasil pengambilan satu agent. Sama seperti `AgentListPage`: tidak pernah melempar. */
export interface AgentDetailResult {
  agent: AgentRecord | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
}

/** Status satu sumber data, untuk `/api/health` (Task 6) dan tabel `source_health` (Task 3). */
export interface SourceHealth {
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  checkedAt: string;
}

/** Kunci stabil sebuah agent. Dipakai konsisten di seluruh lapisan. */
export function makeAgentKey(chainId: number, tokenId: string): string {
  return `${chainId}:${tokenId}`;
}

/** Halaman kosong yang menandai sumber tidak sehat. */
export function unhealthyPage(
  source: AgentSource,
  reason: string,
  fetchedAt: string,
  limit: number,
  offset: number,
): AgentListPage {
  return { items: [], total: 0, limit, offset, source, healthy: false, reason, fetchedAt };
}
