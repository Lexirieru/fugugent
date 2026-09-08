/**
 * Seed terkurasi — **tingkat keempat dan terakhir** dari fallback berjenjang.
 *
 * Ini yang menjawab ketika 8004scan tumbang, cache Postgres kosong, dan
 * `FuguRegistry` on-chain belum berisi listing apa pun. Tanpa berkas ini
 * marketplace bisa tampil kosong di depan juri; dengan berkas ini ia tampil
 * berisi — **dan mengaku apa adanya dari mana isinya**.
 *
 * ## Aturan yang mengikat berkas ini
 *
 * 1. **Tidak ada agent fiktif.** Keempat agent di sini benar-benar ada: mereka
 *    di-scaffold dengan BNB Agent Studio di `ai/`, punya wallet admin Altana
 *    sendiri yang alamatnya tertulis di `ai/<agent>/app/agent/studio.toml`, dan
 *    session-nya terdaftar di Keystore Altana on-chain
 *    (`0x6b8361C29d05D498b1a12B54A37310f94171E94A`, `isValidKey` → `true`).
 *    Siapa pun bisa memverifikasinya tanpa API key:
 *
 *    ```bash
 *    cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
 *      0x6b8361C29d05D498b1a12B54A37310f94171E94A \
 *      'isValidKey(address,bytes32)(bool)' <WALLET_AGENT> <KEY_HASH>
 *    ```
 *
 * 2. **Tidak mengklaim apa yang belum terjadi.** Keempat agent belum punya
 *    `agentId` ERC-8004 (dihasilkan `bag erc8004 register`) dan belum punya
 *    listing di `FuguRegistry`. Karena itu `agentId`, `registryAddress`, dan
 *    `fuguListing` semuanya `null`; reputasi nol; `isVerified: false`.
 *    Menaruh harga karangan di sini akan menampilkan tombol langganan yang
 *    tidak bisa dibayar — kebohongan yang persis ingin kita hindari.
 *
 * 3. **`tokenId` sengaja bukan angka desimal.** Ia berbentuk `seed-<nama>`,
 *    sehingga `id` = `97:seed-fugugrid` tidak bisa disalahartikan sebagai token
 *    ERC-8004 sungguhan oleh lapisan mana pun. Begitu `bag erc8004 register`
 *    berjalan, `tokenId` di sini diganti dengan angka aslinya dan seluruh
 *    lapisan lain tidak perlu berubah.
 *
 * 4. **`fetchedAt` = tanggal kurasi, bukan `now`.** Konsekuensinya
 *    `ageSeconds` yang dilihat pengguna adalah umur sebenarnya data ini —
 *    berhari-hari, bukan nol detik. Memalsukan `fetchedAt` menjadi `now` akan
 *    membuat data kurasi menyamar sebagai data segar.
 *
 * 5. **Seed tidak pernah ditulis ke cache Postgres.** Kalau ditulis, pembacaan
 *    berikutnya akan melaporkan `source: "cache"` untuk baris yang sebenarnya
 *    berasal dari seed — dan provenance yang jadi seluruh nilai lapisan ini
 *    hilang. Aturan itu ditegakkan di `agents.ts`, diuji di sana.
 *
 * ## Deskripsi bukan teks pemasaran
 *
 * Deskripsi tiap agent ditulis dalam bahasa Inggris dan memakai istilah yang
 * benar-benar menjelaskan strateginya (`grid trading`, `portfolio rebalancing`,
 * `yield farming`, `health factor`). Itu bukan kebetulan: `seed.test.ts`
 * menjalankan `classify()` atas tiap record dan menuntut classifier setuju
 * dengan kategori kurasinya. Kalau deskripsi berubah jadi slogan kosong, test
 * itu merah — seed tidak boleh berisi kalimat yang tidak menjelaskan apa pun.
 */

import type {
  Address,
  AgentDetailResult,
  AgentListPage,
  AgentRecord,
  Category,
} from "../types.js";
import { makeAgentKey } from "../types.js";

/** Chain tempat keempat agent ini hidup. Testnet BSC — satu-satunya yang didukung. */
export const SEED_CHAIN_ID = 97;

/**
 * Kapan seed ini terakhir diperiksa terhadap kenyataan (wallet, session,
 * `bag doctor` 14 PASS / 0 FAIL). Dipakai sebagai `fetchedAt` supaya umur data
 * yang ditampilkan ke pengguna adalah umur sebenarnya.
 */
export const CURATED_SEED_AT = "2026-09-08T00:00:00.000Z";

interface SeedSpec {
  slug: string;
  name: string;
  category: Category;
  description: string;
  tags: string[];
  /** Alamat wallet admin Altana — sumbernya `ai/<agent>/app/agent/studio.toml`. */
  agentWallet: Address;
}

/**
 * Keempat agent Fugugent. Kategori, protokol, dan wallet-nya disalin dari
 * `ai/CLAUDE.md` dan `ai/<agent>/app/agent/studio.toml` — bukan dikarang.
 */
const SEED_SPECS: readonly SeedSpec[] = [
  {
    slug: "fugurebalancer",
    name: "FuguRebalancer",
    category: "REBALANCING",
    description:
      "Portfolio rebalancing agent for PancakeSwap v3 concentrated liquidity positions on BNB Chain. " +
      "It repositions the LP range back to its target allocation when price leaves the range, when " +
      "deviation from target exceeds the configured band, or on a fixed interval — whichever comes first. " +
      "The strategy is deterministic code and can be backtested; no language model decides money.",
    tags: ["rebalancing", "pancakeswap-v3", "bnb-chain"],
    agentWallet: "0xb8f155D1278f0437b9De7c63911f2C0EDa485941",
  },
  {
    slug: "fugugrid",
    name: "FuguGrid",
    category: "GRID",
    description:
      "Grid trading agent on PancakeSwap v3. A keeper watches the pool slot0() tick and fills " +
      "pre-computed grid orders across the configured grid levels, buying low and selling high " +
      "within the band. Grid levels are computed by deterministic code, never by a language model.",
    tags: ["grid-trading", "pancakeswap-v3", "bnb-chain"],
    agentWallet: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
  },
  {
    slug: "fuguyield",
    name: "FuguYield",
    category: "YIELD",
    description:
      "Yield farming optimizer across Venus, Aave v3 and Lista on BNB Chain. It moves capital to the " +
      "best APY only when the measured spread beats the full cost of moving, and auto-compounds rewards " +
      "in between. Every move is a deterministic rule over on-chain data, not a language model guess.",
    tags: ["yield-farming", "venus", "aave", "lista"],
    agentWallet: "0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866",
  },
  {
    slug: "fuguguardian",
    name: "FuguGuardian",
    category: "HEALTH_FACTOR",
    description:
      "Health factor guardian for Venus and Aave v3 borrowing positions. It watches the health factor " +
      "and the collateral ratio, and repays debt for liquidation protection before the position crosses " +
      "the liquidation threshold. Executes through a bounded Altana session key with an explicit call allowlist.",
    tags: ["health-factor", "liquidation-protection", "venus", "aave"],
    agentWallet: "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0",
  },
] as const;

function toRecord(spec: SeedSpec): AgentRecord {
  const tokenId = `seed-${spec.slug}`;
  return {
    id: makeAgentKey(SEED_CHAIN_ID, tokenId),
    chainId: SEED_CHAIN_ID,
    tokenId,
    // Belum terdaftar di registry mana pun — lihat aturan 2 di kepala berkas.
    registryAddress: null,
    agentId: null,

    name: spec.name,
    description: spec.description,
    imageUrl: null,
    agentType: "trading",
    tags: [...spec.tags],
    categories: [],
    // OASF hanya ada pada `MCPAgentDetail` di 8004scan; kita tidak punya
    // padanannya untuk agent kita sendiri, jadi dikosongkan (netral bagi classifier).
    skills: [],
    domains: [],
    // Benar-benar diekspos oleh keempat agent: `protocols = ["A2A","MCP"]` di studio.toml.
    supportedProtocols: ["A2A", "MCP"],

    ownerAddress: null,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: spec.agentWallet,

    // Wallet + session terverifikasi on-chain dan `bag doctor` 14 PASS / 0 FAIL.
    isActive: true,
    // `isVerified` di produk ini berarti "dikurasi lewat FuguRegistry.setCurated".
    // Belum terjadi, jadi false — walaupun agent ini milik kita sendiri.
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },

    classification: {
      category: spec.category,
      confidence: 1,
      reason: "seed terkurasi Fugugent: kategori ditetapkan oleh pembuat agent, bukan ditebak",
    },
    fuguListing: null,

    source: "seed",
    fetchedAt: CURATED_SEED_AT,
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
  };
}

/**
 * Salinan segar keempat record seed.
 *
 * Selalu salinan dalam: pemanggil yang memutasi hasilnya (mis. classifier yang
 * menimpa `classification`, atau lapisan HTTP yang mengubah bigint jadi string)
 * tidak boleh merusak seed untuk permintaan berikutnya.
 *
 * `_now` diterima supaya tanda tangannya stabil bila kelak seed perlu bergantung
 * pada waktu; saat ini umur seed sepenuhnya ditentukan {@link CURATED_SEED_AT}.
 */
export function seedAgents(_now: Date = new Date()): AgentRecord[] {
  return SEED_SPECS.map(toRecord);
}

export interface SeedListOptions {
  limit?: number;
  offset?: number;
}

/**
 * Bentuk sumber seed. Async dan sebentuk sumber lain, supaya `agents.ts`
 * memperlakukan keempat tingkat dengan cara yang persis sama — dan supaya test
 * bisa menyuntikkan seed yang **melempar**, yang harus tetap tidak menjatuhkan
 * pemanggil.
 */
export interface SeedSource {
  listAgents(category: Category, opts?: SeedListOptions): Promise<AgentListPage>;
  getAgent(id: string): Promise<AgentDetailResult>;
}

export interface SeedSourceOptions {
  /** Disuntikkan supaya `fetchedAt` halaman deterministik di test. */
  now?: () => Date;
}

export function createSeedSource(options: SeedSourceOptions = {}): SeedSource {
  const now = options.now ?? (() => new Date());

  return {
    async listAgents(category: Category, opts: SeedListOptions = {}): Promise<AgentListPage> {
      const fetchedAt = now().toISOString();
      const limit = Math.max(1, Math.trunc(opts.limit ?? 20));
      const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
      const matching = seedAgents(now()).filter(
        (agent) => agent.classification?.category === category,
      );
      return {
        items: matching.slice(offset, offset + limit),
        total: matching.length,
        limit,
        offset,
        source: "seed",
        healthy: true,
        reason: null,
        fetchedAt,
      };
    },

    async getAgent(id: string): Promise<AgentDetailResult> {
      const fetchedAt = now().toISOString();
      const hit = seedAgents(now()).find((agent) => agent.id === id) ?? null;
      return {
        agent: hit,
        source: "seed",
        healthy: true,
        reason: hit === null ? `agent ${id} tidak ada di seed terkurasi` : null,
        fetchedAt,
      };
    },
  };
}
