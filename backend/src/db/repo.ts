/**
 * Cache agent — **tingkat kedua dari empat tingkat fallback**.
 *
 * Bila 8004scan tumbang, inilah yang menjawab. Karena itu ada dua janji yang
 * dipegang berkas ini:
 *
 * 1. **Tidak pernah melempar ke pemanggil.** Sama seperti `AgentListPage` pada
 *    sumber lain, kegagalan diwakili `healthy: false` + `reason`.
 * 2. **Umur data selalu ikut terbawa.** Setiap pembacaan mengembalikan
 *    `ageSeconds`, `oldestFetchedAt`, dan `stale` supaya UI bisa jujur berkata
 *    "data berumur N detik" alih-alih berpura-pura segar. Ini janji produk,
 *    bukan detail teknis — data basi yang ditampilkan sebagai basi masih
 *    berguna; data basi yang menyamar sebagai segar adalah kebohongan.
 *
 * Perhatikan bahwa **umur tidak pernah menjadi alasan menyembunyikan data**.
 * `maxAgeSeconds` hanya menyalakan penanda `stale`; barisnya tetap dikembalikan.
 * Marketplace kosong jauh lebih buruk daripada marketplace yang mengaku basi.
 */
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type {
  AgentDetailResult,
  AgentListPage,
  AgentRecord,
  Category,
  SourceHealth,
} from "../types.js";
import type { FuguDb } from "./client.js";
import { agentCategories, agents, sourceHealth as sourceHealthTable, type AgentRow } from "./schema.js";
import { fromAgentRow, toAgentRow } from "./serialize.js";

/** Batas bawaan satu halaman. */
export const DEFAULT_LIMIT = 20;
/** Batas atas keras — melindungi Postgres dari kueri `limit=100000`. */
export const MAX_LIMIT = 100;
/**
 * Ambang bawaan "basi", selaras dengan TTL daftar agent di rencana backend
 * (detail 60 dtk · leaderboard 5 mnt · trending 1 mnt · global 60 dtk).
 */
export const DEFAULT_MAX_AGE_SECONDS = 60;

export interface CachedAgentFilter {
  chainId?: number;
  /** Salah satu dari empat kategori Fugu — disaring lewat `agent_categories`. */
  category?: Category;
  /** Ambang kepercayaan classifier, 0–1. Hanya berarti bersama `category`. */
  minConfidence?: number;
  /** Cocokkan pada nama atau deskripsi, tanpa peduli huruf besar-kecil. */
  search?: string;
  onlyActive?: boolean;
  /** Hanya agent yang punya listing di `FuguRegistry`. */
  onlyListed?: boolean;
  /** Hanya listing yang ditandai kurator. */
  onlyCurated?: boolean;
  minTotalScore?: number;
  limit?: number;
  offset?: number;
  /** Di atas ini halaman ditandai `stale`. **Tidak** menyaring apa pun. */
  maxAgeSeconds?: number;
  orderBy?: "score" | "fetchedAt" | "name";
}

/** `AgentListPage` plus umur datanya. Selalu `source: "cache"`. */
export interface CachedAgentPage extends AgentListPage {
  /** Umur record **tertua** di halaman ini, detik. `null` bila halaman kosong. */
  ageSeconds: number | null;
  /** Umur record termuda di halaman ini, detik. */
  freshestAgeSeconds: number | null;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
  /** `true` bila `ageSeconds` melewati `maxAgeSeconds`. Data tetap dikembalikan. */
  stale: boolean;
  /** Ambang yang dipakai, supaya pemanggil tidak perlu menebak. */
  maxAgeSeconds: number;
}

/** `AgentDetailResult` plus umur datanya. */
export interface CachedAgentResult extends AgentDetailResult {
  ageSeconds: number | null;
  stale: boolean;
  maxAgeSeconds: number;
}

/** Umur satu record dalam detik. Tidak pernah negatif walau jam bergeser. */
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

/** `%` dan `_` di kata kunci pengguna adalah literal, bukan wildcard. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// ---------------------------------------------------------------------------
// Tulis
// ---------------------------------------------------------------------------

/**
 * Menulis (atau memperbarui) sekumpulan agent ke cache.
 *
 * **Idempoten**: kunci primernya `id` = `` `${chainId}:${tokenId}` ``, dan
 * konfliknya menimpa seluruh kolom. Memanggilnya dua kali dengan data yang sama
 * menghasilkan tepat baris yang sama — bukan duplikat.
 *
 * Klasifikasi ditulis ke `agent_categories` dengan pola hapus-lalu-sisip untuk
 * id yang disentuh, sehingga classifier yang berubah pikiran tidak meninggalkan
 * kategori lama yang menghantui hasil pencarian.
 *
 * @returns jumlah agent unik yang ditulis.
 */
export async function upsertAgents(db: FuguDb, records: AgentRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  // Dua record dengan id sama dalam satu batch akan membuat Postgres menolak
  // (`ON CONFLICT DO UPDATE cannot affect row a second time`). Yang terakhir menang.
  const byId = new Map<string, AgentRecord>();
  for (const record of records) byId.set(toAgentRow(record).id, record);

  const rows: AgentRow[] = [...byId.values()].map(toAgentRow);
  const ids = rows.map((row) => row.id);

  const columns = getTableColumns(agents);
  const overwrite = Object.fromEntries(
    Object.entries(columns)
      .filter(([key]) => key !== "id")
      .map(([key, column]) => [key, sql.raw(`excluded."${column.name}"`)]),
  ) as PgUpdateSetSource<typeof agents>;

  const categoryRows = [...byId.values()]
    .map((record) => {
      const classification = record.classification;
      if (!classification || classification.category === null) return null;
      return {
        agentId: toAgentRow(record).id,
        category: classification.category,
        confidence: classification.confidence,
        reason: classification.reason,
        assignedAt: new Date(record.fetchedAt),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  await db.transaction(async (tx) => {
    await tx.insert(agents).values(rows).onConflictDoUpdate({ target: agents.id, set: overwrite });
    await tx.delete(agentCategories).where(inArray(agentCategories.agentId, ids));
    if (categoryRows.length > 0) await tx.insert(agentCategories).values(categoryRows);
  });

  return rows.length;
}

/** Mencatat status satu sumber data. Riwayat disimpan, bukan ditimpa. */
export async function recordSourceHealth(db: FuguDb, health: SourceHealth): Promise<void> {
  await db.insert(sourceHealthTable).values({
    source: health.source,
    healthy: health.healthy,
    reason: health.reason,
    checkedAt: new Date(health.checkedAt),
  });
}

/** Status terakhir tiap sumber — dasar `/api/health`. */
export async function getLatestSourceHealth(db: FuguDb): Promise<SourceHealth[]> {
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
}

// ---------------------------------------------------------------------------
// Baca
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
      .select({ agentId: agentCategories.agentId })
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
      // Skor tertinggi dulu; agent tanpa skor turun ke bawah, bukan naik ke atas.
      return [sql`${agents.reputationTotalScore} desc nulls last`, asc(agents.id)];
  }
}

/**
 * Membaca agent dari cache beserta **umur datanya**.
 *
 * Tidak pernah melempar: kegagalan Postgres menghasilkan halaman kosong dengan
 * `healthy: false` + `reason`, supaya pemanggil bisa turun ke tingkat fallback
 * berikutnya (baca on-chain, lalu seed terkurasi) tanpa menangkap exception.
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

/** Satu agent dari cache, beserta umur datanya. Tidak pernah melempar. */
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

/** Pesan kegagalan yang aman ditampilkan — tidak pernah memuat kredensial. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `cache Postgres gagal: ${message.replace(/postgres(ql)?:\/\/[^\s]*/gi, "[redacted]")}`;
}
