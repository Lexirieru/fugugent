/**
 * Cache agent — **tingkat kedua dari empat tingkat fallback**.
 *
 * Bila 8004scan tumbang, inilah yang menjawab. Karena itu ada tiga janji yang
 * dipegang berkas ini:
 *
 * 1. **Umur data selalu ikut terbawa.** Setiap pembacaan mengembalikan
 *    `ageSeconds`, `oldestFetchedAt`, dan `stale` supaya UI bisa jujur berkata
 *    "data berumur N detik" alih-alih berpura-pura segar. Ini janji produk,
 *    bukan detail teknis — data basi yang ditampilkan sebagai basi masih
 *    berguna; data basi yang menyamar sebagai segar adalah kebohongan.
 * 2. **Penulisan dari satu sumber tidak pernah menghapus apa yang hanya
 *    diketahui sumber lain.** Lihat "Aturan penggabungan" di bawah.
 * 3. **Jalur baca dan jalur pelaporan kesehatan tidak pernah melempar.**
 *    `getCachedAgents`, `getCachedAgent`, `recordSourceHealth`, dan
 *    `getLatestSourceHealth` mengembalikan bentuk yang menyatakan kegagalan.
 *    `/api/health` justru paling dibutuhkan ketika Postgres mati; endpoint itu
 *    tidak boleh ikut mati bersamanya.
 *
 *    **Satu-satunya pengecualian adalah `upsertAgents`, yang sengaja melempar**
 *    bila infrastrukturnya gagal. Penulisan yang gagal harus terlihat oleh
 *    scheduler; kalau ia mengembalikan 0 dengan tenang, cache membusuk tanpa
 *    ada yang tahu sampai juri membuka marketplace. Pemanggilnya wajib
 *    membungkus dengan `try` — Task 5/6, ini bagian kalian.
 *
 * Perhatikan bahwa **umur tidak pernah menjadi alasan menyembunyikan data**.
 * `maxAgeSeconds` hanya menyalakan penanda `stale`; barisnya tetap dikembalikan.
 * Marketplace kosong jauh lebih buruk daripada marketplace yang mengaku basi.
 *
 * ## Aturan penggabungan (kenapa `upsertAgents` tidak sekadar menimpa)
 *
 * Satu agent bisa ditulis oleh dua sumber yang tahu hal berbeda: `onchain` tahu
 * listing `FuguRegistry` (harga, `curated`) tapi namanya cuma `"Agent #49637"`;
 * `scan8004` tahu nama, deskripsi, tag, dan reputasi tapi tidak tahu apa-apa
 * tentang listing kita. Menimpa seluruh kolom membuat penyegaran yang **berhasil**
 * justru menghapus listing first-party kita sendiri — persis sebelum cache ini
 * dibutuhkan sebagai tingkat kedua. Tiga aturan mencegahnya:
 *
 * - **A. `null` berarti "tidak tahu", bukan "tidak ada".** Kolom opsional
 *   (`fugu_*`, `classification_*`, alamat, skor) memakai
 *   `coalesce(excluded, agents)`.
 * - **B. Teks wajib yang kosong juga berarti "tidak tahu".** `name` dan
 *   `description` memakai `coalesce(nullif(excluded, ''), agents)`.
 * - **C. Sumber yang buta terhadap metadata deskriptif tidak menyentuhnya.**
 *   `onchain` tidak pernah menimpa nama/deskripsi/tag/skill/reputasi/badge milik
 *   baris yang sudah ada — nilainya hanya placeholder. Pada baris **baru** nilai
 *   itu tetap dipakai, karena saat itu memang cuma itu yang kita punya.
 *
 * Konsekuensi yang harus disadari: dengan aturan A, `fuguListing` tidak bisa
 * dikosongkan lewat `upsertAgents`. Listing yang dicabut ditandai
 * `active: false` oleh `FuguRegistry` (bukan dihapus), jadi jalur itu tetap
 * benar; penghapusan sungguhan butuh `delete` eksplisit.
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

/** Batas bawaan satu halaman. */
export const DEFAULT_LIMIT = 20;
/** Batas atas keras — melindungi Postgres dari kueri `limit=100000`. */
export const MAX_LIMIT = 100;
/**
 * Ambang bawaan "basi", selaras dengan TTL daftar agent di rencana backend
 * (detail 60 dtk · leaderboard 5 mnt · trending 1 mnt · global 60 dtk).
 */
export const DEFAULT_MAX_AGE_SECONDS = 60;

/**
 * Sumber yang **tidak** punya pendapat tentang metadata deskriptif.
 *
 * `readFuguListings()` menyusun `name: "Agent #<tokenId>"`, `description: ""`,
 * `tags: []` — bukan karena agent-nya memang begitu, tapi karena kontrak tidak
 * menyimpannya. Menganggap itu sebagai pendapat berarti setiap penyegaran
 * on-chain mengganti nama sungguhan dengan placeholder.
 */
export const SOURCES_BLIND_TO_DESCRIPTIVE_METADATA: readonly AgentSource[] = ["onchain"];

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

/** Satu record yang tidak jadi ditulis, beserta alasannya. */
export interface SkippedRecord {
  /** `` `${chainId}:${tokenId}` `` bila masih bisa dihitung, selain itu `tokenId` mentah. */
  id: string;
  reason: string;
}

export interface UpsertOptions {
  /**
   * Dipanggil untuk tiap record cacat yang dilewati. Sengaja callback dan bukan
   * nilai balik supaya tanda tangan `upsertAgents` tetap `Promise<number>` bagi
   * pemanggil yang tidak peduli.
   */
  onSkipped?: (skipped: SkippedRecord) => void;
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
// Aturan penggabungan per kolom
// ---------------------------------------------------------------------------

type MergeStrategy =
  /** Penulis terakhir menang. Untuk kolom yang setiap sumber punya pendapatnya. */
  | "overwrite"
  /** Aturan A: `null` pada nilai baru berarti "tidak tahu" — nilai lama bertahan. */
  | "keepOldWhenNull"
  /** Aturan B: string kosong pada nilai baru juga berarti "tidak tahu". */
  | "keepOldWhenEmptyText";

interface MergeRule {
  strategy: MergeStrategy;
  /** Aturan C: kolom ini tidak boleh disentuh sumber yang buta metadata deskriptif. */
  descriptive?: true;
}

/**
 * Aturan untuk **setiap** kolom `agents`.
 *
 * Sengaja `Record<keyof AgentRow, …>`: menambah kolom tanpa memutuskan aturannya
 * membuat build gagal. Cacat yang ditemukan review lahir persis dari kolom baru
 * yang diam-diam ikut `excluded.*`.
 */
const MERGE_RULES: Record<keyof AgentRow, MergeRule> = {
  // identitas — sama persis di kedua sisi konflik
  id: { strategy: "overwrite" },
  chainId: { strategy: "overwrite" },
  tokenId: { strategy: "overwrite" },
  registryAddress: { strategy: "keepOldWhenNull" },
  agentId: { strategy: "keepOldWhenNull", descriptive: true },

  // metadata deskriptif — hanya sumber yang benar-benar tahu yang boleh menulis
  name: { strategy: "keepOldWhenEmptyText", descriptive: true },
  description: { strategy: "keepOldWhenEmptyText", descriptive: true },
  imageUrl: { strategy: "keepOldWhenNull", descriptive: true },
  agentType: { strategy: "keepOldWhenNull", descriptive: true },
  tags: { strategy: "overwrite", descriptive: true },
  upstreamCategories: { strategy: "overwrite", descriptive: true },
  skills: { strategy: "overwrite", descriptive: true },
  domains: { strategy: "overwrite", descriptive: true },
  supportedProtocols: { strategy: "overwrite", descriptive: true },

  // kepemilikan — alamat diketahui kedua sumber, nama pengguna hanya upstream
  ownerAddress: { strategy: "keepOldWhenNull" },
  ownerUsername: { strategy: "keepOldWhenNull", descriptive: true },
  ownerPublisherTier: { strategy: "keepOldWhenNull", descriptive: true },
  agentWallet: { strategy: "keepOldWhenNull" },

  // status — `false` adalah pendapat yang sah, jadi ditimpa…
  isActive: { strategy: "overwrite" },
  // …kecuali badge kepercayaan, yang tidak diketahui pembaca on-chain
  isVerified: { strategy: "overwrite", descriptive: true },
  isEndpointVerified: { strategy: "overwrite", descriptive: true },
  x402Supported: { strategy: "overwrite", descriptive: true },

  // reputasi — seluruhnya milik 8004scan
  reputationTotalScore: { strategy: "keepOldWhenNull", descriptive: true },
  reputationHealthScore: { strategy: "keepOldWhenNull", descriptive: true },
  reputationTotalFeedbacks: { strategy: "overwrite", descriptive: true },
  reputationAverageScore: { strategy: "keepOldWhenNull", descriptive: true },
  reputationStarCount: { strategy: "overwrite", descriptive: true },

  // klasifikasi (Task 4) — penulis tanpa klasifikasi tidak menghapus yang lama
  classificationCategory: { strategy: "keepOldWhenNull" },
  classificationConfidence: { strategy: "keepOldWhenNull" },
  classificationReason: { strategy: "keepOldWhenNull" },

  // listing first-party — hanya diketahui pembacaan on-chain
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

  // provenance — mencatat penulis terakhir, bukan asal tiap kolom
  source: { strategy: "overwrite" },
  fetchedAt: { strategy: "overwrite" },
  upstreamCreatedAt: { strategy: "keepOldWhenNull", descriptive: true },
  upstreamUpdatedAt: { strategy: "keepOldWhenNull", descriptive: true },
};

const BLIND_SOURCE_LIST = SOURCES_BLIND_TO_DESCRIPTIVE_METADATA.map(
  (source) => `'${source}'`,
).join(", ");

/** Ekspresi `SET` untuk satu kolom pada `ON CONFLICT DO UPDATE`. */
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
// Tulis
// ---------------------------------------------------------------------------

/**
 * Menulis (atau memperbarui) sekumpulan agent ke cache.
 *
 * **Idempoten**: kunci primernya `id` = `` `${chainId}:${tokenId}` ``, dan
 * konfliknya digabungkan menurut `MERGE_RULES`. Memanggilnya dua kali dengan
 * data yang sama menghasilkan tepat baris yang sama — bukan duplikat, dan tanpa
 * kehilangan apa pun yang ditulis sumber lain (lihat "Aturan penggabungan").
 *
 * Klasifikasi ditulis ke `agent_categories`; barisnya dihapus **hanya** untuk id
 * yang membawa klasifikasi baru, sehingga penyegaran dari sumber yang tidak
 * mengklasifikasi apa pun tidak menghapus kategori yang sudah ada.
 *
 * **Record cacat dilewati, bukan menjatuhkan batch.** `fetchedAt` tidak sah,
 * `tokenId` bukan desimal, atau nilai uang yang tidak muat `numeric(78,0)` hanya
 * membuang record itu sendiri — 19 record sehat lainnya tetap tersimpan. Ini
 * disiplin yang sama dengan normalizer Task 2, dan lapisan yang berjanji "jangan
 * pernah kosong" tidak punya alasan memegang disiplin yang lebih longgar.
 *
 * **Melempar** bila infrastrukturnya gagal (Postgres mati, skema hilang) — satu-
 * satunya fungsi di berkas ini yang begitu, dan disengaja: lihat catatan kepala.
 *
 * @returns jumlah agent unik yang benar-benar ditulis.
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

  // Postgres menolak dua baris dengan id sama dalam satu pernyataan
  // `ON CONFLICT DO UPDATE` ("cannot affect row a second time"). Membuang yang
  // duplikat ("yang terakhir menang") akan menghidupkan kembali cacat yang sama:
  // satu batch berisi record on-chain **dan** record 8004scan untuk agent yang
  // sama akan kehilangan salah satunya. Karena itu batch dipecah menjadi
  // beberapa putaran ber-id unik, dijalankan berurutan di dalam satu transaksi —
  // sehingga aturan penggabungan di `MERGE_RULES` yang menyatukannya, bukan
  // logika kedua yang harus dijaga tetap sejalan.
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

  // Klasifikasi terakhir yang benar-benar punya pendapat untuk tiap id — sejajar
  // dengan `coalesce(excluded, agents)` pada kolom `classification_*`.
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
 * Mencatat status satu sumber data. Riwayat disimpan, bukan ditimpa.
 *
 * Tidak pernah melempar: ini sering dipanggil **dari** jalur penanganan
 * kegagalan, dan kegagalan mencatat kegagalan tidak boleh menimpa kegagalan
 * aslinya.
 *
 * @returns `true` bila benar-benar tercatat.
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
 * Status terakhir tiap sumber — dasar `/api/health`.
 *
 * Tidak pernah melempar. Bila cache-nya sendiri yang tidak bisa dibaca, ia
 * melaporkan hal itu sebagai satu entri `source: "cache", healthy: false` —
 * jawaban yang jauh lebih berguna daripada HTTP 500 tanpa penjelasan, tepat
 * ketika pengguna sedang bertanya "apa yang sedang tumbang?".
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
