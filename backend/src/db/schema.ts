/**
 * Skema cache Postgres — **tingkat kedua dari empat tingkat fallback**
 * (8004scan → cache Postgres → baca on-chain → seed terkurasi).
 *
 * Tiga tabel:
 *
 * - `agents` — satu baris per agent, kunci primer `id` = `` `${chainId}:${tokenId}` ``
 *   (lihat `makeAgentKey` di `src/types.ts`). Setiap baris membawa `fetched_at`
 *   supaya pembaca selalu tahu **umur** datanya dan bisa mengatakannya apa adanya
 *   kepada pengguna alih-alih berpura-pura segar.
 * - `agent_categories` — hasil classifier (Task 4) untuk empat kategori Fugu.
 *   Terpisah dari `agents` supaya klasifikasi bisa ditulis ulang tanpa menyentuh
 *   data upstream, dan supaya filter kategori tetap terindeks.
 * - `source_health` — riwayat status tiap sumber data, dasar `/api/health`.
 *
 * ## Aturan yang melekat pada skema ini
 *
 * 1. **Uang selalu `numeric(78, 0)`**, tidak pernah `bigint`/`double precision`.
 *    `uint256` butuh 78 digit desimal; `numeric` menyimpannya persis, dan driver
 *    mengembalikannya sebagai string yang kita ubah ke `bigint` di `serialize.ts`.
 *    Tidak ada jalur di mana nilai uang menyentuh `number` JavaScript.
 * 2. Daftar string (tags, skills, …) disimpan `jsonb` — bentuknya persis seperti
 *    yang datang dari upstream, tanpa tabel penghubung yang tidak dipakai siapa pun.
 * 3. `fetched_at` `timestamptz not null`. Ini kolom yang membuat klaim "data
 *    berumur N detik" bisa dibuktikan, bukan sekadar diucapkan.
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AgentSource, Category, PublisherTier } from "../types.js";

/** Presisi `numeric` untuk seluruh nilai uang/id on-chain: cukup untuk `uint256`. */
export const MONEY_PRECISION = 78;

export const agents = pgTable(
  "agents",
  {
    /** `` `${chainId}:${tokenId}` `` — lihat `makeAgentKey`. */
    id: text("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    tokenId: text("token_id").notNull(),
    registryAddress: text("registry_address"),
    agentId: text("agent_id"),

    name: text("name").notNull(),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    agentType: text("agent_type"),
    tags: jsonb("tags").$type<string[]>().notNull(),
    upstreamCategories: jsonb("upstream_categories").$type<string[]>().notNull(),
    skills: jsonb("skills").$type<string[]>().notNull(),
    domains: jsonb("domains").$type<string[]>().notNull(),
    supportedProtocols: jsonb("supported_protocols").$type<string[]>().notNull(),

    ownerAddress: text("owner_address"),
    ownerUsername: text("owner_username"),
    ownerPublisherTier: text("owner_publisher_tier").$type<PublisherTier>(),
    agentWallet: text("agent_wallet"),

    isActive: boolean("is_active").notNull(),
    isVerified: boolean("is_verified").notNull(),
    isEndpointVerified: boolean("is_endpoint_verified").notNull(),
    x402Supported: boolean("x402_supported").notNull(),

    reputationTotalScore: doublePrecision("reputation_total_score"),
    reputationHealthScore: doublePrecision("reputation_health_score"),
    reputationTotalFeedbacks: integer("reputation_total_feedbacks").notNull(),
    reputationAverageScore: doublePrecision("reputation_average_score"),
    reputationStarCount: integer("reputation_star_count").notNull(),

    classificationCategory: text("classification_category").$type<Category>(),
    classificationConfidence: doublePrecision("classification_confidence"),
    classificationReason: text("classification_reason"),

    // --- listing FuguRegistry; semua nilai uang numeric(78,0) ---
    fuguListingId: numeric("fugu_listing_id", { precision: MONEY_PRECISION, scale: 0 }),
    fuguErc8004AgentId: numeric("fugu_erc8004_agent_id", { precision: MONEY_PRECISION, scale: 0 }),
    fuguOwner: text("fugu_owner"),
    fuguAgentWallet: text("fugu_agent_wallet"),
    fuguCategory: text("fugu_category").$type<Category>(),
    fuguPriceUsd8PerPeriod: numeric("fugu_price_usd8_per_period", {
      precision: MONEY_PRECISION,
      scale: 0,
    }),
    fuguPeriodSeconds: integer("fugu_period_seconds"),
    fuguActive: boolean("fugu_active"),
    fuguCurated: boolean("fugu_curated"),
    fuguMetadataUri: text("fugu_metadata_uri"),

    /** Asal record saat ditulis (bukan saat dibaca — pembacaan selalu `"cache"`). */
    source: text("source").$type<AgentSource>().notNull(),
    /** Kapan record diambil dari sumbernya. Dasar perhitungan umur data. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
    /** ISO 8601 upstream apa adanya — `text` supaya presisi mikrodetik tidak hilang. */
    upstreamCreatedAt: text("upstream_created_at"),
    upstreamUpdatedAt: text("upstream_updated_at"),
  },
  (table) => [
    index("agents_chain_id_idx").on(table.chainId),
    index("agents_fetched_at_idx").on(table.fetchedAt),
    index("agents_total_score_idx").on(table.reputationTotalScore),
  ],
);

export const agentCategories = pgTable(
  "agent_categories",
  {
    /**
     * **Berisi `agents.id` (`` `${chainId}:${tokenId}` ``), BUKAN `agents.agent_id`.**
     * Dinamai `agent_key` justru supaya tidak tertukar: `agents.agent_id` menyimpan
     * id komposit 8004scan (`"56:0x8004…:49637"`) yang bentuknya sama sekali berbeda.
     * Join yang benar selalu `agent_categories.agent_key = agents.id`.
     */
    agentKey: text("agent_key")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Salah satu dari empat `Category` Fugu. */
    category: text("category").$type<Category>().notNull(),
    /** 0–1, dari classifier. */
    confidence: doublePrecision("confidence").notNull(),
    reason: text("reason"),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentKey, table.category] }),
    index("agent_categories_category_idx").on(table.category),
  ],
);

export const sourceHealth = pgTable(
  "source_health",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    source: text("source").$type<AgentSource>().notNull(),
    healthy: boolean("healthy").notNull(),
    reason: text("reason"),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("source_health_source_checked_at_idx").on(table.source, table.checkedAt)],
);

export type AgentRow = typeof agents.$inferSelect;
export type AgentInsert = typeof agents.$inferInsert;
export type AgentCategoryRow = typeof agentCategories.$inferSelect;
export type SourceHealthRow = typeof sourceHealth.$inferSelect;

/**
 * DDL yang setara dengan definisi di atas, dipisah per pernyataan.
 *
 * Ditulis tangan dan bukan hasil `drizzle-kit` supaya `ensureSchema()` bisa
 * dijalankan langsung oleh test dan oleh boot API tanpa langkah migrasi
 * terpisah. Semuanya `IF NOT EXISTS` sehingga aman dipanggil berulang.
 *
 * **Batas jaring pengamannya:** kalau **nama kolom** di sini menyimpang dari
 * definisi Drizzle di atas, test repo langsung merah karena kueri menyebut
 * kolom yang tidak ada. **Constraint tidak dijaga begitu** — karena itu FK
 * `agent_categories.agent_key -> agents(id)` sekarang dideklarasikan di kedua
 * tempat, dan siapa pun yang menambah constraint harus melakukan hal yang sama
 * sampai proyek ini beralih ke `drizzle-kit`.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `create table if not exists agents (
    id text primary key,
    chain_id integer not null,
    token_id text not null,
    registry_address text,
    agent_id text,
    name text not null,
    description text not null,
    image_url text,
    agent_type text,
    tags jsonb not null,
    upstream_categories jsonb not null,
    skills jsonb not null,
    domains jsonb not null,
    supported_protocols jsonb not null,
    owner_address text,
    owner_username text,
    owner_publisher_tier text,
    agent_wallet text,
    is_active boolean not null,
    is_verified boolean not null,
    is_endpoint_verified boolean not null,
    x402_supported boolean not null,
    reputation_total_score double precision,
    reputation_health_score double precision,
    reputation_total_feedbacks integer not null,
    reputation_average_score double precision,
    reputation_star_count integer not null,
    classification_category text,
    classification_confidence double precision,
    classification_reason text,
    fugu_listing_id numeric(${MONEY_PRECISION}, 0),
    fugu_erc8004_agent_id numeric(${MONEY_PRECISION}, 0),
    fugu_owner text,
    fugu_agent_wallet text,
    fugu_category text,
    fugu_price_usd8_per_period numeric(${MONEY_PRECISION}, 0),
    fugu_period_seconds integer,
    fugu_active boolean,
    fugu_curated boolean,
    fugu_metadata_uri text,
    source text not null,
    fetched_at timestamptz not null,
    upstream_created_at text,
    upstream_updated_at text
  )`,
  `create index if not exists agents_chain_id_idx on agents (chain_id)`,
  `create index if not exists agents_fetched_at_idx on agents (fetched_at)`,
  `create index if not exists agents_total_score_idx on agents (reputation_total_score)`,
  `create table if not exists agent_categories (
    agent_key text not null references agents (id) on delete cascade,
    category text not null,
    confidence double precision not null,
    reason text,
    assigned_at timestamptz not null,
    primary key (agent_key, category)
  )`,
  `create index if not exists agent_categories_category_idx on agent_categories (category)`,
  `create table if not exists source_health (
    id integer primary key generated always as identity,
    source text not null,
    healthy boolean not null,
    reason text,
    checked_at timestamptz not null
  )`,
  `create index if not exists source_health_source_checked_at_idx
     on source_health (source, checked_at desc)`,
];
