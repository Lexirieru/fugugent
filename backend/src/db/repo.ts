/**
 * The agent cache — **the second of four fallback levels**.
 *
 * When 8004scan is down, this is what answers. Hence the three promises this
 * file keeps:
 *
 * 1. **The age of the data always travels with it.** Every read returns
 *    `ageSeconds`, `oldestFetchedAt`, and `stale` so the UI can honestly say
 *    "this data is N seconds old" instead of pretending it is fresh. This is a
 *    product promise, not a technical detail — stale data shown as stale is
 *    still useful; stale data disguised as fresh is a lie.
 * 2. **A write from one source never erases what only another source knows.**
 *    See "Merge rules" below.
 * 3. **The read path and the health-reporting path never throw.**
 *    `getCachedAgents`, `getCachedAgent`, `recordSourceHealth`, and
 *    `getLatestSourceHealth` return a shape that states the failure.
 *    `/api/health` is needed most precisely when Postgres is down; that
 *    endpoint must not go down with it.
 *
 *    **The only exception is `upsertAgents`, which throws on purpose** when its
 *    infrastructure fails. A failed write must be visible to the scheduler; if
 *    it quietly returned 0, the cache would rot with nobody knowing until the
 *    judges opened the marketplace. Its callers must wrap it in a `try` —
 *    Task 5/6, this part is yours.
 *
 * Note that **age is never a reason to hide data**. `maxAgeSeconds` only lights
 * up the `stale` flag; the rows are still returned. An empty marketplace is far
 * worse than a marketplace that admits it is stale.
 *
 * ## Merge rules (why `upsertAgents` does not simply overwrite)
 *
 * One agent can be written by two sources that know different things: `onchain`
 * knows the `FuguRegistry` listing (price, `curated`) but its name is only
 * `"Agent #49637"`; `scan8004` knows the name, description, tags, and
 * reputation but knows nothing about our listing. Overwriting every column
 * makes a **successful** refresh erase our own first-party listing — right
 * before this cache is needed as the second level. Three rules prevent that:
 *
 * - **A. `null` means "don't know", not "doesn't exist".** Optional columns
 *   (`fugu_*`, `classification_*`, addresses, scores) use
 *   `coalesce(excluded, agents)`.
 * - **B. An empty required text field also means "don't know".** `name` and
 *   `description` use `coalesce(nullif(excluded, ''), agents)`.
 * - **C. A source blind to descriptive metadata does not touch it.** `onchain`
 *   never overwrites the name/description/tags/skills/reputation/badges of an
 *   existing row — its values are only placeholders. On a **new** row those
 *   values are still used, because at that point they are all we have.
 *
 * A consequence to be aware of: under rule A, `fuguListing` cannot be cleared
 * through `upsertAgents`. A withdrawn listing is marked `active: false` by
 * `FuguRegistry` (not deleted), so that path stays correct; a real deletion
 * requires an explicit `delete`.
 */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type {
  AgentDetailResult,
  AgentListPage,
  AgentRecord,
  AgentSource,
  Category,
  SourceHealth,
} from "../types.js";
import type { FuguDb } from "./client.js";
import {
  agentCategories,
  agents,
  sourceHealth as sourceHealthTable,
  type AgentRow,
} from "./schema.js";
import { fromAgentRow, toAgentRow } from "./serialize.js";

/** The default page size. */
export const DEFAULT_LIMIT = 20;
/** A hard upper bound — it protects Postgres from a `limit=100000` query. */
export const MAX_LIMIT = 100;
/**
 * The default "stale" threshold, aligned with the agent list TTLs in the backend
 * plan (detail 60 s · leaderboard 5 min · trending 1 min · global 60 s).
 */
export const DEFAULT_MAX_AGE_SECONDS = 60;

/**
 * Sources that hold **no** opinion about descriptive metadata.
 *
 * `readFuguListings()` builds `name: "Agent #<tokenId>"`, `description: ""`,
 * `tags: []` — not because the agent really is like that, but because the
 * contract does not store it. Treating that as an opinion means every on-chain
 * refresh replaces a real name with a placeholder.
 */
export const SOURCES_BLIND_TO_DESCRIPTIVE_METADATA: readonly AgentSource[] = ["onchain"];

export interface CachedAgentFilter {
  chainId?: number;
  /** One of the four Fugu categories — filtered through `agent_categories`. */
  category?: Category;
  /** The classifier confidence threshold, 0–1. Only meaningful together with `category`. */
  minConfidence?: number;
  /** Matched against the name or the description, case-insensitively. */
  search?: string;
  onlyActive?: boolean;
  /** Only agents that have a listing in `FuguRegistry`. */
  onlyListed?: boolean;
  /** Only listings flagged by a curator. */
  onlyCurated?: boolean;
  minTotalScore?: number;
  limit?: number;
  offset?: number;
  /** Above this the page is flagged `stale`. It filters **nothing**. */
  maxAgeSeconds?: number;
  orderBy?: "score" | "fetchedAt" | "name";
}

/** An `AgentListPage` plus the age of its data. Always `source: "cache"`. */
export interface CachedAgentPage extends AgentListPage {
  /** The age of the **oldest** record on this page, in seconds. `null` when the page is empty. */
  ageSeconds: number | null;
  /** The age of the youngest record on this page, in seconds. */
  freshestAgeSeconds: number | null;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
  /** `true` when `ageSeconds` exceeds `maxAgeSeconds`. The data is still returned. */
  stale: boolean;
  /** The threshold that was used, so the caller does not have to guess. */
  maxAgeSeconds: number;
}

/** An `AgentDetailResult` plus the age of its data. */
export interface CachedAgentResult extends AgentDetailResult {
  ageSeconds: number | null;
  stale: boolean;
  maxAgeSeconds: number;
}

/** One record that ended up not being written, with the reason. */
export interface SkippedRecord {
  /** `` `${chainId}:${tokenId}` `` when it can still be computed, otherwise the raw `tokenId`. */
  id: string;
  reason: string;
}

export interface UpsertOptions {
  /**
   * Called for each malformed record that is skipped. Deliberately a callback
   * rather than a return value so the `upsertAgents` signature stays
   * `Promise<number>` for callers that do not care.
   */
  onSkipped?: (skipped: SkippedRecord) => void;
}

/** The age of one record in seconds. Never negative even if the clock shifts. */
export function agentAgeSeconds(record: AgentRecord, now: Date = new Date()): number {
  return ageOf(new Date(record.fetchedAt), now);
}

function ageOf(fetchedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - fetchedAt.getTime()) / 1000));
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function clampOffset(offset: number | undefined): number {
  return offset === undefined ? 0 : Math.max(0, Math.trunc(offset));
}

/** `%` and `_` in a user's search term are literals, not wildcards. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ---------------------------------------------------------------------------
// Per-column merge rules
// ---------------------------------------------------------------------------

type MergeStrategy =
  /** Last writer wins. For columns every source has an opinion about. */
  | "overwrite"
  /** Rule A: a `null` in the incoming value means "don't know" — the old value survives. */
  | "keepOldWhenNull"
  /** Rule B: an empty string in the incoming value also means "don't know". */
  | "keepOldWhenEmptyText";

interface MergeRule {
  strategy: MergeStrategy;
  /** Rule C: this column must not be touched by a source blind to descriptive metadata. */
  descriptive?: true;
}

/**
 * The rule for **every** `agents` column.
 *
 * Deliberately a `Record<keyof AgentRow, …>`: adding a column without deciding
 * its rule breaks the build. The defect a review once found was born from
 * exactly that — a new column silently riding along on `excluded.*`.
 */
const MERGE_RULES: Record<keyof AgentRow, MergeRule> = {
  // identity — identical on both sides of a conflict
  id: { strategy: "overwrite" },
  chainId: { strategy: "overwrite" },
  tokenId: { strategy: "overwrite" },
  registryAddress: { strategy: "keepOldWhenNull" },
  agentId: { strategy: "keepOldWhenNull", descriptive: true },

  // descriptive metadata — only a source that genuinely knows may write it
  name: { strategy: "keepOldWhenEmptyText", descriptive: true },
  description: { strategy: "keepOldWhenEmptyText", descriptive: true },
  imageUrl: { strategy: "keepOldWhenNull", descriptive: true },
  agentType: { strategy: "keepOldWhenNull", descriptive: true },
  tags: { strategy: "overwrite", descriptive: true },
  upstreamCategories: { strategy: "overwrite", descriptive: true },
  skills: { strategy: "overwrite", descriptive: true },
  domains: { strategy: "overwrite", descriptive: true },
  supportedProtocols: { strategy: "overwrite", descriptive: true },

  // ownership — the address is known to both sources, the username only to upstream
  ownerAddress: { strategy: "keepOldWhenNull" },
  ownerUsername: { strategy: "keepOldWhenNull", descriptive: true },
  ownerPublisherTier: { strategy: "keepOldWhenNull", descriptive: true },
  agentWallet: { strategy: "keepOldWhenNull" },

  // status — `false` is a legitimate opinion, so it is overwritten…
  isActive: { strategy: "overwrite" },
  // …except the trust badges, which the on-chain reader knows nothing about
  isVerified: { strategy: "overwrite", descriptive: true },
  isEndpointVerified: { strategy: "overwrite", descriptive: true },
  x402Supported: { strategy: "overwrite", descriptive: true },

  // reputation — entirely 8004scan's
  reputationTotalScore: { strategy: "keepOldWhenNull", descriptive: true },
  reputationHealthScore: { strategy: "keepOldWhenNull", descriptive: true },
  reputationTotalFeedbacks: { strategy: "overwrite", descriptive: true },
  reputationAverageScore: { strategy: "keepOldWhenNull", descriptive: true },
  reputationStarCount: { strategy: "overwrite", descriptive: true },

  // classification (Task 4) — a writer with no classification does not erase the old one
  classificationCategory: { strategy: "keepOldWhenNull" },
  classificationConfidence: { strategy: "keepOldWhenNull" },
  classificationReason: { strategy: "keepOldWhenNull" },

  // the first-party listing — known only to the on-chain read
  fuguListingId: { strategy: "keepOldWhenNull" },
  fuguErc8004AgentId: { strategy: "keepOldWhenNull" },
  fuguOwner: { strategy: "keepOldWhenNull" },
  fuguAgentWallet: { strategy: "keepOldWhenNull" },
  fuguCategory: { strategy: "keepOldWhenNull" },
  fuguPriceUsd8PerPeriod: { strategy: "keepOldWhenNull" },
  fuguPeriodSeconds: { strategy: "keepOldWhenNull" },
  fuguActive: { strategy: "keepOldWhenNull" },
  fuguCurated: { strategy: "keepOldWhenNull" },
  fuguMetadataUri: { strategy: "keepOldWhenNull" },

  // provenance — records the last writer, not the origin of each column
  source: { strategy: "overwrite" },
  fetchedAt: { strategy: "overwrite" },
  upstreamCreatedAt: { strategy: "keepOldWhenNull", descriptive: true },
  upstreamUpdatedAt: { strategy: "keepOldWhenNull", descriptive: true },
};

const BLIND_SOURCE_LIST = SOURCES_BLIND_TO_DESCRIPTIVE_METADATA.map(
  (source) => `'${source}'`,
).join(", ");

/** The `SET` expression for one column in `ON CONFLICT DO UPDATE`. */
function mergeExpression(columnName: string, rule: MergeRule): string {
  const target = `agents."${columnName}"`;
  const incoming = `excluded."${columnName}"`;
  const base =
    rule.strategy === "overwrite"
      ? incoming
      : rule.strategy === "keepOldWhenNull"
        ? `coalesce(${incoming}, ${target})`
        : `coalesce(nullif(${incoming}, ''), ${target})`;

  if (rule.descriptive !== true) return base;
  return `case when excluded."source" in (${BLIND_SOURCE_LIST}) then ${target} else ${base} end`;
}

function buildMergeSet(): PgUpdateSetSource<typeof agents> {
  const columns = getTableColumns(agents);
  return Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => key !== "id")
      .map(([key, column]) => [
        key,
        sql.raw(mergeExpression(column.name, MERGE_RULES[key as keyof AgentRow])),
      ]),
  ) as PgUpdateSetSource<typeof agents>;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Writes (or updates) a set of agents into the cache.
 *
 * **Idempotent**: the primary key is `id` = `` `${chainId}:${tokenId}` ``, and
 * conflicts are merged according to `MERGE_RULES`. Calling it twice with the
 * same data produces exactly the same rows — no duplicates, and without losing
 * anything another source wrote (see "Merge rules").
 *
 * Classifications are written into `agent_categories`; their rows are deleted
 * **only** for the ids that carry a new classification, so a refresh from a
 * source that classifies nothing does not erase existing categories.
 *
 * **Malformed records are skipped, they do not take the batch down.** An invalid
 * `fetchedAt`, a non-decimal `tokenId`, or a money value that does not fit
 * `numeric(78,0)` discards only that record — the other 19 healthy records are
 * still stored. This is the same discipline as the Task 2 normalizer, and a
 * layer that promises "never empty" has no reason to hold a looser one.
 *
 * **Throws** when its infrastructure fails (Postgres down, schema missing) — the
 * only function in this file that does, and deliberately so: see the header note.
 *
 * @returns the number of unique agents actually written.
 */
export async function upsertAgents(
  db: FuguDb,
  records: AgentRecord[],
  options: UpsertOptions = {},
): Promise<number> {
  if (records.length === 0) return 0;

  const entries: { record: AgentRecord; row: AgentRow }[] = [];
  for (const record of records) {
    try {
      entries.push({ record, row: toAgentRow(record) });
    } catch (error) {
      options.onSkipped?.({
        id: record.id || record.tokenId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (entries.length === 0) return 0;

  // Postgres rejects two rows with the same id in a single
  // `ON CONFLICT DO UPDATE` statement ("cannot affect row a second time").
  // Dropping the duplicate ("last one wins") would resurrect the very same
  // defect: a batch containing both an on-chain record **and** an 8004scan
  // record for the same agent would lose one of them. So the batch is split
  // into several rounds with unique ids, run in sequence inside one transaction
  // — so that the merge rules in `MERGE_RULES` are what unify them, rather than
  // a second piece of logic that has to be kept in step.
  const rounds: AgentRow[][] = [];
  const seenPerRound: Set<string>[] = [];
  for (const { row } of entries) {
    let index = 0;
    while (seenPerRound[index]?.has(row.id) === true) index += 1;
    if (rounds[index] === undefined) {
      rounds[index] = [];
      seenPerRound[index] = new Set<string>();
    }
    rounds[index]!.push(row);
    seenPerRound[index]!.add(row.id);
  }

  // The last classification that genuinely holds an opinion for each id — in
  // step with `coalesce(excluded, agents)` on the `classification_*` columns.
  const categoryByKey = new Map<string, typeof agentCategories.$inferInsert>();
  for (const { record, row } of entries) {
    const classification = record.classification;
    if (!classification || classification.category === null) continue;
    categoryByKey.set(row.id, {
      agentKey: row.id,
      category: classification.category,
      confidence: classification.confidence,
      reason: classification.reason,
      assignedAt: row.fetchedAt,
    });
  }
  const categoryRows = [...categoryByKey.values()];

  const mergeSet = buildMergeSet();
  await db.transaction(async (tx) => {
    for (const round of rounds) {
      await tx.insert(agents).values(round).onConflictDoUpdate({ target: agents.id, set: mergeSet });
    }

    if (categoryRows.length > 0) {
      await tx.delete(agentCategories).where(
        inArray(
          agentCategories.agentKey,
          categoryRows.map((row) => row.agentKey),
        ),
      );
      await tx.insert(agentCategories).values(categoryRows);
    }
  });

  return new Set(entries.map((entry) => entry.row.id)).size;
}

/**
 * Records the status of one data source. History is kept, not overwritten.
 *
 * Never throws: this is often called **from** the failure-handling path, and a
 * failure to record a failure must not paper over the original failure.
 *
 * @returns `true` when it really was recorded.
 */
export async function recordSourceHealth(db: FuguDb, health: SourceHealth): Promise<boolean> {
  try {
    await db.insert(sourceHealthTable).values({
      source: health.source,
      healthy: health.healthy,
      reason: health.reason,
      checkedAt: new Date(health.checkedAt),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The latest status of each source — the basis of `/api/health`.
 *
 * Never throws. If the cache itself cannot be read, it reports that as a single
 * `source: "cache", healthy: false` entry — a far more useful answer than an
 * unexplained HTTP 500, precisely when the user is asking "what is down?".
 */
export async function getLatestSourceHealth(
  db: FuguDb,
  now: Date = new Date(),
): Promise<SourceHealth[]> {
  try {
    const rows = await db
      .selectDistinctOn([sourceHealthTable.source])
      .from(sourceHealthTable)
      .orderBy(sourceHealthTable.source, desc(sourceHealthTable.checkedAt));

    return rows.map((row) => ({
      source: row.source,
      healthy: row.healthy,
      reason: row.reason,
      checkedAt: row.checkedAt.toISOString(),
    }));
  } catch (error) {
    return [
      {
        source: "cache",
        healthy: false,
        reason: describeError(error),
        checkedAt: now.toISOString(),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function buildWhere(db: FuguDb, filter: CachedAgentFilter): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];

  if (filter.chainId !== undefined) conditions.push(eq(agents.chainId, filter.chainId));
  if (filter.onlyActive) conditions.push(eq(agents.isActive, true));
  if (filter.onlyListed) conditions.push(isNotNull(agents.fuguListingId));
  if (filter.onlyCurated) conditions.push(eq(agents.fuguCurated, true));
  if (filter.minTotalScore !== undefined) {
    conditions.push(gte(agents.reputationTotalScore, filter.minTotalScore));
  }

  if (filter.search !== undefined && filter.search.trim() !== "") {
    const pattern = `%${escapeLike(filter.search.trim())}%`;
    conditions.push(or(ilike(agents.name, pattern), ilike(agents.description, pattern)));
  }

  if (filter.category !== undefined) {
    const classified = db
      .select({ agentKey: agentCategories.agentKey })
      .from(agentCategories)
      .where(
        and(
          eq(agentCategories.category, filter.category),
          filter.minConfidence === undefined
            ? undefined
            : gte(agentCategories.confidence, filter.minConfidence),
        ),
      );
    conditions.push(inArray(agents.id, classified));
  }

  const defined = conditions.filter((condition): condition is SQL => condition !== undefined);
  return defined.length === 0 ? undefined : and(...defined);
}

function buildOrderBy(orderBy: CachedAgentFilter["orderBy"]): SQL[] {
  switch (orderBy) {
    case "fetchedAt":
      return [desc(agents.fetchedAt), asc(agents.id)];
    case "name":
      return [asc(agents.name), asc(agents.id)];
    default:
      // Highest score first; agents with no score sink to the bottom, not float to the top.
      return [sql`${agents.reputationTotalScore} desc nulls last`, asc(agents.id)];
  }
}

/**
 * Reads agents from the cache together with **the age of their data**.
 *
 * Never throws: a Postgres failure produces an empty page with
 * `healthy: false` + `reason`, so the caller can drop to the next fallback level
 * (the on-chain read, then the curated seed) without catching an exception.
 */
export async function getCachedAgents(
  db: FuguDb,
  filter: CachedAgentFilter = {},
  now: Date = new Date(),
): Promise<CachedAgentPage> {
  const limit = clampLimit(filter.limit);
  const offset = clampOffset(filter.offset);
  const maxAgeSeconds = filter.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  try {
    const where = buildWhere(db, filter);

    const countRows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(agents)
      .where(where);
    const total = countRows[0]?.total ?? 0;

    const rows = await db
      .select()
      .from(agents)
      .where(where)
      .orderBy(...buildOrderBy(filter.orderBy))
      .limit(limit)
      .offset(offset);

    const items = rows.map((row) => ({ ...fromAgentRow(row), source: "cache" as const }));
    const timestamps = rows.map((row) => row.fetchedAt.getTime());
    const oldest = timestamps.length === 0 ? null : new Date(Math.min(...timestamps));
    const newest = timestamps.length === 0 ? null : new Date(Math.max(...timestamps));
    const ageSeconds = oldest === null ? null : ageOf(oldest, now);

    return {
      items,
      total,
      limit,
      offset,
      source: "cache",
      healthy: true,
      reason: null,
      fetchedAt: now.toISOString(),
      ageSeconds,
      freshestAgeSeconds: newest === null ? null : ageOf(newest, now),
      oldestFetchedAt: oldest === null ? null : oldest.toISOString(),
      newestFetchedAt: newest === null ? null : newest.toISOString(),
      stale: ageSeconds !== null && ageSeconds > maxAgeSeconds,
      maxAgeSeconds,
    };
  } catch (error) {
    return {
      items: [],
      total: 0,
      limit,
      offset,
      source: "cache",
      healthy: false,
      reason: describeError(error),
      fetchedAt: now.toISOString(),
      ageSeconds: null,
      freshestAgeSeconds: null,
      oldestFetchedAt: null,
      newestFetchedAt: null,
      stale: false,
      maxAgeSeconds,
    };
  }
}

/** A single agent from the cache, with the age of its data. Never throws. */
export async function getCachedAgent(
  db: FuguDb,
  id: string,
  now: Date = new Date(),
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): Promise<CachedAgentResult> {
  try {
    const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
    const row = rows[0];
    const ageSeconds = row === undefined ? null : ageOf(row.fetchedAt, now);
    return {
      agent: row === undefined ? null : { ...fromAgentRow(row), source: "cache" },
      source: "cache",
      healthy: true,
      reason: null,
      fetchedAt: now.toISOString(),
      ageSeconds,
      stale: ageSeconds !== null && ageSeconds > maxAgeSeconds,
      maxAgeSeconds,
    };
  } catch (error) {
    return {
      agent: null,
      source: "cache",
      healthy: false,
      reason: describeError(error),
      fetchedAt: now.toISOString(),
      ageSeconds: null,
      stale: false,
      maxAgeSeconds,
    };
  }
}

/** A failure message safe to display — it never contains credentials. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Postgres cache failed: ${message.replace(/postgres(ql)?:\/\/[^\s]*/gi, "[redacted]")}`;
}
