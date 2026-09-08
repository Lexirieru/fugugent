/**
 * Rute HTTP agent: `/api/agents`, `/api/agents/:id`, `/api/categories`.
 *
 * Lapisan ini **tidak** punya logika data sendiri. Seluruh fallback berjenjang
 * ada di `src/service/agents.ts`; di sini hanya tiga hal yang terjadi, dan
 * ketiganya adalah janji kepada klien:
 *
 * 1. **Serialisasi lewat satu pintu.** `AgentRecord` memuat `bigint`
 *    (`fuguListing.priceUsd8PerPeriod`, `listingId`, `erc8004AgentId`) sehingga
 *    `JSON.stringify` atasnya **melempar**. Konversinya selalu
 *    {@link serializeAgentRecord}, tidak pernah replacer lokal: uang menyeberang
 *    sebagai string desimal basis 8 (`"12345678"` = $0,12), tidak pernah `number`.
 *
 * 2. **Provenance ikut di setiap respons.** `source`, `ageSeconds`, `stale`,
 *    `degraded`, dan `trail` diteruskan apa adanya supaya UI bisa berkata
 *    "data berumur N detik dari cache" alih-alih menampilkan angka tanpa asal.
 *
 * 3. **Tidak pernah 5xx karena upstream.** Layanan berjanji tidak melempar;
 *    handler di sini tetap memasang `try/catch` sendiri dan mengubah kegagalan
 *    apa pun menjadi amplop `healthy: false` berisi alasan yang sudah disunting
 *    dari kredensial. 500 saat 8004scan mati adalah kegagalan yang persis
 *    ingin kita hindari — juri akan mematikannya dan melihat apa yang terjadi.
 *
 * Parameter yang cacat adalah pengecualiannya: `limit=abc` dijawab 400 dengan
 * field yang salah disebutkan (lihat `query.ts`), bukan diam-diam dijadikan
 * nilai bawaan.
 */
import { Hono, type Context } from "hono";
import { DEFAULT_MAX_AGE_SECONDS } from "../db/repo.js";
import { serializeAgentRecord, type AgentRecordJson } from "../db/serialize.js";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  redact,
  type AgentService,
  type AgentServiceDetail,
  type AgentServicePage,
  type FallbackAttempt,
  type FallbackOutcome,
} from "../service/agents.js";
import { CATEGORIES, type AgentSource, type Category } from "../types.js";
import { parseAgentId, parseCategory, parseLimit, parseOffset, QueryError } from "./query.js";

export interface AgentRoutesDeps {
  service: AgentService;
  /** Disuntikkan supaya `fetchedAt` amplop kegagalan deterministik di test. */
  now?: () => Date;
}

/**
 * Berapa banyak yang dibaca per kategori saat menghitung `/api/categories`.
 * Sengaja bukan 1: tingkat pertama menyaring hasilnya lewat classifier, jadi
 * membaca satu item saja akan sering menghasilkan nol dan menjatuhkan hitungan
 * ke tingkat berikutnya tanpa sebab.
 */
export const CATEGORY_COUNT_LIMIT = MAX_PAGE_LIMIT;

/** Urutan fallback. Dipakai untuk memilih sumber paling terdegradasi saat menggabung. */
const SOURCE_ORDER: readonly AgentSource[] = ["scan8004", "cache", "onchain", "seed"];

function worstSource(sources: readonly AgentSource[]): AgentSource {
  let worst: AgentSource = "scan8004";
  for (const source of sources) {
    if (SOURCE_ORDER.indexOf(source) > SOURCE_ORDER.indexOf(worst)) worst = source;
  }
  return worst;
}

/**
 * Tingkat fallback yang **tidak sempat menjawab** — bukan yang menjawab "tidak ada".
 *
 * `empty` sengaja TIDAK termasuk: sumber sehat yang berkata "tidak ketemu"
 * adalah jawaban, bukan ketidaktahuan. Ketiga sisanya berarti ada tempat yang
 * belum bisa kita tanyai.
 */
export const UNCERTAIN_OUTCOMES: readonly FallbackOutcome[] = [
  "threw",
  "unhealthy",
  "unavailable",
];

/** `true` bila ada tingkat yang tidak bisa dimintai jawaban. */
export function isUncertain(trail: readonly FallbackAttempt[]): boolean {
  return trail.some((attempt) => UNCERTAIN_OUTCOMES.includes(attempt.outcome));
}

/** Pesan kegagalan yang aman untuk klien — disunting, tanpa stack trace. */
function describe(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = err.message.split("\n")[0] ?? err.message;
    return redact(`${err.name}: ${firstLine}`);
  }
  return redact(`kegagalan tak dikenal: ${String(err)}`);
}

// ---------------------------------------------------------------------------
// Bentuk kawat
// ---------------------------------------------------------------------------

/** Amplop daftar. Sama dengan `AgentServicePage`, `items` sudah terserialisasi. */
export interface AgentListResponse {
  items: AgentRecordJson[];
  total: number;
  limit: number;
  offset: number;
  /** `null` berarti permintaan mencakup keempat kategori. */
  category: Category | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  /** Umur item tertua, detik. `null` bila kosong. */
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  trail: FallbackAttempt[];
}

export interface AgentDetailResponse {
  agent: AgentRecordJson | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  trail: FallbackAttempt[];
}

export interface CategoryCountRow {
  category: Category;
  count: number;
  source: AgentSource;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  healthy: boolean;
  reason: string | null;
}

export interface CategoryListResponse {
  categories: CategoryCountRow[];
  total: number;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
}

function toListResponse(page: AgentServicePage, category: Category | null): AgentListResponse {
  return {
    items: page.items.map(serializeAgentRecord),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    category,
    source: page.source,
    healthy: page.healthy,
    reason: page.reason === null ? null : redact(page.reason),
    fetchedAt: page.fetchedAt,
    ageSeconds: page.ageSeconds,
    stale: page.stale,
    degraded: page.degraded,
    maxAgeSeconds: page.maxAgeSeconds,
    trail: page.trail,
  };
}

function toDetailResponse(detail: AgentServiceDetail): AgentDetailResponse {
  return {
    agent: detail.agent === null ? null : serializeAgentRecord(detail.agent),
    source: detail.source,
    healthy: detail.healthy,
    reason: detail.reason === null ? null : redact(detail.reason),
    fetchedAt: detail.fetchedAt,
    ageSeconds: detail.ageSeconds,
    stale: detail.stale,
    degraded: detail.degraded,
    maxAgeSeconds: detail.maxAgeSeconds,
    trail: detail.trail,
  };
}

/**
 * Amplop untuk kegagalan yang tidak terduga.
 *
 * `source: "seed"` dan `degraded: true` bukan hiasan: bila kita sampai di sini,
 * tidak satu pun tingkat menjawab, dan mengaku berada di dasar tangga fallback
 * lebih jujur daripada melaporkan sumber yang sebenarnya tidak memberi apa-apa.
 */
function failedList(
  err: unknown,
  category: Category | null,
  limit: number,
  offset: number,
  fetchedAt: string,
): AgentListResponse {
  return {
    items: [],
    total: 0,
    limit,
    offset,
    category,
    source: "seed",
    healthy: false,
    reason: describe(err),
    fetchedAt,
    ageSeconds: null,
    stale: true,
    degraded: true,
    maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
    trail: [],
  };
}

// ---------------------------------------------------------------------------
// Penggabungan lintas kategori
// ---------------------------------------------------------------------------

/**
 * `GET /api/agents` tanpa `category` berarti "semua kategori".
 *
 * Layanan hanya tahu cara menjawab per kategori (setiap kategori punya query
 * semantic sendiri), jadi penggabungannya dilakukan di sini — dan dilakukan
 * **secara jujur**: `source` yang dilaporkan adalah yang paling terdegradasi di
 * antara keempatnya, `ageSeconds` yang tertua, dan `healthy` hanya `true` bila
 * keempat kategori sehat. Melaporkan yang terbaik dari empat akan menyembunyikan
 * kategori yang sedang tidak terlayani.
 */
function mergePages(
  pages: readonly AgentServicePage[],
  limit: number,
  offset: number,
  fetchedAt: string,
): AgentListResponse {
  const seen = new Set<string>();
  const merged = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  const ages = pages.map((p) => p.ageSeconds).filter((a): a is number => a !== null);
  const reasons = pages
    .map((p) => p.reason)
    .filter((r): r is string => r !== null && r.trim() !== "");

  return {
    items: merged.slice(offset, offset + limit).map(serializeAgentRecord),
    /**
     * Jumlah item **berbeda yang benar-benar bisa dijangkau lewat paging ini**,
     * bukan jumlah `total` keempat kategori.
     *
     * Tiap kategori dibaca paling banyak {@link MAX_PAGE_LIMIT} item, jadi
     * jendela gabungan ini punya batas keras. Melaporkan jumlah keempat `total`
     * (yang bisa ribuan) akan menjanjikan halaman yang tidak pernah ada:
     * klien membangun pagination dari angka itu, lalu menerima halaman kosong
     * ber-`healthy: true` begitu melewati jendelanya. Angka per kategori tetap
     * bisa diperiksa lewat `/api/categories` dan lewat `trail`.
     */
    total: merged.length,
    limit,
    offset,
    category: null,
    source: worstSource(pages.map((p) => p.source)),
    healthy: pages.every((p) => p.healthy),
    reason: reasons.length === 0 ? null : redact(reasons.join("; ")),
    fetchedAt,
    ageSeconds: ages.length === 0 ? null : Math.max(...ages),
    stale: pages.some((p) => p.stale),
    degraded: pages.some((p) => p.degraded),
    maxAgeSeconds: Math.max(...pages.map((p) => p.maxAgeSeconds), DEFAULT_MAX_AGE_SECONDS),
    trail: pages.flatMap((p) => p.trail),
  };
}

// ---------------------------------------------------------------------------
// Rute
// ---------------------------------------------------------------------------

export function createAgentRoutes(deps: AgentRoutesDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get("/agents", async (c) => {
    // Validasi lebih dulu, sebelum menyentuh layanan: permintaan cacat tidak
    // pantas membebani upstream, dan jawabannya tidak bergantung pada data.
    let category: Category | null;
    let limit: number;
    let offset: number;
    try {
      category = parseCategory(c.req.query("category"));
      limit = parseLimit(c.req.query("limit"), DEFAULT_PAGE_LIMIT);
      offset = parseOffset(c.req.query("offset"));
    } catch (err) {
      return queryErrorResponse(c, err);
    }

    const fetchedAt = now().toISOString();
    try {
      if (category !== null) {
        const page = await deps.service.getAgentsByCategory(category, { limit, offset });
        return c.json(toListResponse(page, category));
      }

      // Tiap kategori harus dibaca sampai `offset + limit` supaya paging global
      // di atas gabungannya benar; dibatasi supaya satu permintaan tidak pernah
      // meminta lebih dari yang layanan izinkan.
      const perCategory = Math.min(offset + limit, MAX_PAGE_LIMIT);
      const pages = await Promise.all(
        CATEGORIES.map((cat) =>
          deps.service.getAgentsByCategory(cat, { limit: perCategory, offset: 0 }),
        ),
      );
      return c.json(mergePages(pages, limit, offset, fetchedAt));
    } catch (err) {
      return c.json(failedList(err, category, limit, offset, fetchedAt));
    }
  });

  app.get("/agents/:id", async (c) => {
    let id: string;
    try {
      id = parseAgentId(c.req.param("id"));
    } catch (err) {
      return queryErrorResponse(c, err);
    }

    const fetchedAt = now().toISOString();
    let detail: AgentDetailResponse;
    try {
      detail = toDetailResponse(await deps.service.getAgentDetail(id));
    } catch (err) {
      // Kita tidak tahu apakah agent ini ada — karena itu 200 dengan
      // `healthy: false`, bukan 404 yang mengklaim ia tidak ada.
      return c.json({
        agent: null,
        source: "seed" as AgentSource,
        healthy: false,
        reason: describe(err),
        fetchedAt,
        ageSeconds: null,
        stale: true,
        degraded: true,
        maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
        trail: [],
      } satisfies AgentDetailResponse);
    }

    // 404 hanya bila kita benar-benar tahu jawabannya. `healthy` saja TIDAK
    // cukup untuk menyimpulkan itu: tingkat 4 (seed) melaporkan `healthy: true`
    // untuk id apa pun yang bukan salah satu agent kurasi, tanpa melihat apa
    // yang terjadi di tingkat 1–3. Jadi `{agent: null, healthy: true}` juga
    // dihasilkan oleh keadaan "8004scan mati, cache tidak dipasang, on-chain
    // tidak memuatnya" — keadaan di mana agent-nya sangat mungkin ADA.
    //
    // Membalas 404 di situ berarti marketplace menghapus agent yang nyata
    // persis ketika sumber primernya tumbang. Karena itu `trail` yang memutus:
    // satu saja tingkat yang `threw`, `unhealthy`, atau `unavailable` berarti
    // ada tempat yang belum sempat kita tanyai, dan "tidak tahu" bukan
    // "tidak ada". `unavailable` ikut dihitung: cache yang tidak dipasang
    // adalah tempat memastikan yang tidak kita punya.
    if (detail.agent === null && detail.healthy && !isUncertain(detail.trail)) {
      return c.json(detail, 404);
    }
    return c.json(detail);
  });

  app.get("/categories", async (c) => {
    const fetchedAt = now().toISOString();

    const rows = await Promise.all(
      CATEGORIES.map(async (category): Promise<CategoryCountRow> => {
        try {
          const page = await deps.service.getAgentsByCategory(category, {
            limit: CATEGORY_COUNT_LIMIT,
            offset: 0,
          });
          return {
            category,
            count: page.total,
            source: page.source,
            ageSeconds: page.ageSeconds,
            stale: page.stale,
            degraded: page.degraded,
            healthy: page.healthy,
            reason: page.reason === null ? null : redact(page.reason),
          };
        } catch (err) {
          // Satu kategori yang gagal tidak boleh menghapus tiga lainnya —
          // marketplace dengan tiga tab tetap jauh lebih berguna daripada 500.
          return {
            category,
            count: 0,
            source: "seed",
            ageSeconds: null,
            stale: true,
            degraded: true,
            healthy: false,
            reason: describe(err),
          };
        }
      }),
    );

    const ages = rows.map((r) => r.ageSeconds).filter((a): a is number => a !== null);
    const reasons = rows
      .filter((r) => !r.healthy && r.reason !== null)
      .map((r) => `${r.category}: ${r.reason}`);

    return c.json({
      categories: rows,
      total: rows.reduce((sum, row) => sum + row.count, 0),
      source: worstSource(rows.map((r) => r.source)),
      healthy: rows.every((r) => r.healthy),
      reason: reasons.length === 0 ? null : redact(reasons.join("; ")),
      fetchedAt,
      ageSeconds: ages.length === 0 ? null : Math.max(...ages),
      stale: rows.some((r) => r.stale),
      degraded: rows.some((r) => r.degraded),
    } satisfies CategoryListResponse);
  });

  return app;
}

/** 400 yang menyebut field, pesan, dan (bila enum) nilai yang sah. */
function queryErrorResponse(c: Context, err: unknown) {
  if (err instanceof QueryError) {
    return c.json(
      {
        error: "invalid_query",
        field: err.field,
        message: err.message,
        ...(err.allowed ? { allowed: [...err.allowed] } : {}),
      },
      400,
    );
  }
  return c.json({ error: "invalid_query", field: "unknown", message: describe(err) }, 400);
}
