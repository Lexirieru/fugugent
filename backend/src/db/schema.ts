/**
 * The Postgres cache schema — **the second of four fallback levels**
 * (8004scan → Postgres cache → on-chain read → curated seed).
 *
 * Three tables:
 *
 * - `agents` — one row per agent, primary key `id` = `` `${chainId}:${tokenId}` ``
 *   (see `makeAgentKey` in `src/types.ts`). Every row carries `fetched_at` so a
 *   reader always knows the **age** of its data and can state it plainly to the
 *   user instead of pretending it is fresh.
 * - `agent_categories` — classifier output (Task 4) for the four Fugu
 *   categories. Kept apart from `agents` so a classification can be rewritten
 *   without touching upstream data, and so the category filter stays indexed.
 * - `source_health` — the status history of each data source, the basis of
 *   `/api/health`.
 *
 * ## Rules baked into this schema
 *
 * 1. **Money is always `numeric(78, 0)`**, never `bigint`/`double precision`.
 *    A `uint256` needs 78 decimal digits; `numeric` stores it exactly, and the
 *    driver returns it as a string that we turn into a `bigint` in
 *    `serialize.ts`. There is no path where a money value touches a JavaScript
 *    `number`.
 * 2. String lists (tags, skills, …) are stored as `jsonb` — in exactly the
 *    shape they arrive in from upstream, with no join table nobody uses.
 * 3. `fetched_at` is `timestamptz not null`. This is the column that makes the
 *    claim "the data is N seconds old" provable rather than merely asserted.
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

/** `numeric` precision for every money value / on-chain id: enough for a `uint256`. */
export const MONEY_PRECISION = 78;

export const agents = pgTable(
  "agents",
  {
    /** `` `${chainId}:${tokenId}` `` — see `makeAgentKey`. */
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

    // --- FuguRegistry listing; every money value is numeric(78,0) ---
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

    /** Where the record came from when written (not when read — reads are always `"cache"`). */
    source: text("source").$type<AgentSource>().notNull(),
    /** When the record was fetched from its source. The basis for computing data age. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
    /** The upstream ISO 8601 verbatim — `text` so microsecond precision is not lost. */
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
     * **Holds `agents.id` (`` `${chainId}:${tokenId}` ``), NOT `agents.agent_id`.**
     * It is named `agent_key` precisely so the two are not confused:
     * `agents.agent_id` stores the 8004scan composite id
     * (`"56:0x8004…:49637"`), whose shape is entirely different. The correct
     * join is always `agent_categories.agent_key = agents.id`.
     */
    agentKey: text("agent_key")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** One of the four Fugu `Category` values. */
    category: text("category").$type<Category>().notNull(),
    /** 0–1, from the classifier. */
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
 * The DDL equivalent of the definitions above, split per statement.
 *
 * Hand-written rather than generated by `drizzle-kit` so that `ensureSchema()`
 * can be run directly by the tests and by the API boot with no separate
 * migration step. Everything is `IF NOT EXISTS`, so it is safe to call
 * repeatedly.
 *
 * **The limit of that safety net:** if a **column name** here drifts from the
 * Drizzle definition above, the repo tests go red immediately because a query
 * names a column that does not exist. **Constraints are not guarded that way**
 * — which is why the FK `agent_categories.agent_key -> agents(id)` is now
 * declared in both places, and anyone adding a constraint must do the same
 * until this project moves to `drizzle-kit`.
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
