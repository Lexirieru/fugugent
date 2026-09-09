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
import type {
  AuditState,
  AuditStageResult,
  AuditTier,
  AuditVerdict,
  EscrowRef,
  RiskLevel,
  SkillFinding,
  SkillKind,
  SkillSource,
  SkillVersionRecord,
} from "../skills/types.js";

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


// ---------------------------------------------------------------------------
// The audited-skill marketplace
// ---------------------------------------------------------------------------

/**
 * Skills listed in the marketplace.
 *
 * **There is deliberately no `audit_status` column.** The status a client sees
 * is derived from the audit rows by `deriveTrust` on every read, so there is no
 * field anybody — a migration, a manual `UPDATE`, a future endpoint — can set to
 * "verified". A safety claim that can be written directly is a safety claim that
 * will eventually be written wrongly.
 */
export const skills = pgTable(
  "skills",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").$type<SkillKind>().notNull(),
    version: text("version").notNull(),
    /** The digest of the build currently served. 64 lowercase hex characters. */
    contentSha256: text("content_sha256").notNull(),
    sourceUri: text("source_uri").notNull(),
    declaredDescription: text("declared_description").notNull(),
    declaredCapabilities: jsonb("declared_capabilities").$type<string[]>().notNull(),
    authorAddress: text("author_address"),
    authorName: text("author_name"),
    tags: jsonb("tags").$type<string[]>().notNull(),
    /** USD, 8 decimals. `numeric(78,0)` for the same reason as every other money column. */
    priceUsd8PerVersion: numeric("price_usd8_per_version", {
      precision: MONEY_PRECISION,
      scale: 0,
    }).notNull(),
    /** Deterministic intake scan output. Evidence of suspicion, never of safety. */
    intakeFindings: jsonb("intake_findings").$type<SkillFinding[]>().notNull(),
    versions: jsonb("versions").$type<SkillVersionRecord[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    source: text("source").$type<SkillSource>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
    /** `true` only for the curated examples. Never defaulted away on read. */
    isExample: boolean("is_example").notNull(),
  },
  (table) => [
    index("skills_kind_idx").on(table.kind),
    index("skills_fetched_at_idx").on(table.fetchedAt),
    index("skills_content_sha256_idx").on(table.contentSha256),
  ],
);

/**
 * Audit jobs. One row per audit of one exact build.
 *
 * `audited_sha256` is the load-bearing column: it is what a verdict is *about*.
 * When it stops matching `skills.content_sha256`, the verdict stops applying —
 * that comparison is the rug-pull guard, and it only works because the digest is
 * stored per audit rather than per skill.
 *
 * The evidence is two plain columns rather than a JSON blob so that
 * `AuditEvidence.complete` is always **recomputed** from what is actually there.
 * A row cannot store `complete: true` without holding both halves.
 */
export const skillAudits = pgTable(
  "skill_audits",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    skillVersion: text("skill_version").notNull(),
    auditedSha256: text("audited_sha256").notNull(),
    auditorId: text("auditor_id"),
    tier: text("tier").$type<AuditTier>().notNull(),
    scope: jsonb("scope").$type<string[]>().notNull(),
    state: text("state").$type<AuditState>().notNull(),
    verdict: text("verdict").$type<AuditVerdict>(),
    risk: text("risk").$type<RiskLevel>(),
    summary: text("summary"),
    observedCapabilities: jsonb("observed_capabilities").$type<string[]>().notNull(),
    stages: jsonb("stages").$type<AuditStageResult[]>().notNull(),
    findings: jsonb("findings").$type<SkillFinding[]>().notNull(),
    feeUsd8: numeric("fee_usd8", { precision: MONEY_PRECISION, scale: 0 }).notNull(),
    bondUsd8: numeric("bond_usd8", { precision: MONEY_PRECISION, scale: 0 }).notNull(),
    escrow: jsonb("escrow").$type<EscrowRef>().notNull(),
    evidenceUri: text("evidence_uri"),
    evidenceSha256: text("evidence_sha256"),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    source: text("source").$type<SkillSource>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
    isExample: boolean("is_example").notNull(),
  },
  (table) => [
    index("skill_audits_skill_id_idx").on(table.skillId),
    index("skill_audits_state_idx").on(table.state),
    index("skill_audits_requested_at_idx").on(table.requestedAt),
  ],
);

/** Auditors and their track record. Reputation itself is read on chain, not stored. */
export const skillAuditors = pgTable(
  "skill_auditors",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    address: text("address"),
    /** The `FuguRegistry` listing whose `FuguReputation` rows are this auditor's. */
    reputationListingId: numeric("reputation_listing_id", {
      precision: MONEY_PRECISION,
      scale: 0,
    }),
    specialization: jsonb("specialization").$type<string[]>().notNull(),
    bondUsd8: numeric("bond_usd8", { precision: MONEY_PRECISION, scale: 0 }).notNull(),
    auditsCompleted: integer("audits_completed").notNull(),
    verdictsSafe: integer("verdicts_safe").notNull(),
    verdictsDangerous: integer("verdicts_dangerous").notNull(),
    slashes: integer("slashes").notNull(),
    source: text("source").$type<SkillSource>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull(),
    isExample: boolean("is_example").notNull(),
  },
  (table) => [index("skill_auditors_fetched_at_idx").on(table.fetchedAt)],
);

export type SkillRow = typeof skills.$inferSelect;
export type SkillInsert = typeof skills.$inferInsert;
export type SkillAuditRow = typeof skillAudits.$inferSelect;
export type SkillAuditInsert = typeof skillAudits.$inferInsert;
export type SkillAuditorRow = typeof skillAuditors.$inferSelect;
export type SkillAuditorInsert = typeof skillAuditors.$inferInsert;

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
  `create table if not exists skills (
    id text primary key,
    name text not null,
    kind text not null,
    version text not null,
    content_sha256 text not null,
    source_uri text not null,
    declared_description text not null,
    declared_capabilities jsonb not null,
    author_address text,
    author_name text,
    tags jsonb not null,
    price_usd8_per_version numeric(${MONEY_PRECISION}, 0) not null,
    intake_findings jsonb not null,
    versions jsonb not null,
    created_at timestamptz not null,
    updated_at timestamptz not null,
    source text not null,
    fetched_at timestamptz not null,
    is_example boolean not null
  )`,
  `create index if not exists skills_kind_idx on skills (kind)`,
  `create index if not exists skills_fetched_at_idx on skills (fetched_at)`,
  `create index if not exists skills_content_sha256_idx on skills (content_sha256)`,
  `create table if not exists skill_audits (
    id text primary key,
    skill_id text not null references skills (id) on delete cascade,
    skill_version text not null,
    audited_sha256 text not null,
    auditor_id text,
    tier text not null,
    scope jsonb not null,
    state text not null,
    verdict text,
    risk text,
    summary text,
    observed_capabilities jsonb not null,
    stages jsonb not null,
    findings jsonb not null,
    fee_usd8 numeric(${MONEY_PRECISION}, 0) not null,
    bond_usd8 numeric(${MONEY_PRECISION}, 0) not null,
    escrow jsonb not null,
    evidence_uri text,
    evidence_sha256 text,
    requested_at timestamptz not null,
    completed_at timestamptz,
    source text not null,
    fetched_at timestamptz not null,
    is_example boolean not null
  )`,
  `create index if not exists skill_audits_skill_id_idx on skill_audits (skill_id)`,
  `create index if not exists skill_audits_state_idx on skill_audits (state)`,
  `create index if not exists skill_audits_requested_at_idx on skill_audits (requested_at desc)`,
  `create table if not exists skill_auditors (
    id text primary key,
    display_name text not null,
    address text,
    reputation_listing_id numeric(${MONEY_PRECISION}, 0),
    specialization jsonb not null,
    bond_usd8 numeric(${MONEY_PRECISION}, 0) not null,
    audits_completed integer not null,
    verdicts_safe integer not null,
    verdicts_dangerous integer not null,
    slashes integer not null,
    source text not null,
    fetched_at timestamptz not null,
    is_example boolean not null
  )`,
  `create index if not exists skill_auditors_fetched_at_idx on skill_auditors (fetched_at)`,
];
