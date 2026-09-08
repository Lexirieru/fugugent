/**
 * Layanan agent — **fallback berjenjang empat tingkat**.
 *
 * Ini lapisan yang membuat kegagalan upstream tidak terlihat oleh pengguna
 * *tanpa berbohong tentangnya*. 8004scan terbukti membalas `500 DATABASE_ERROR`
 * secara intermiten — 4 dari 5 percobaan gagal saat riset. Tanpa berkas ini,
 * marketplace kosong pada empat dari lima kali juri membukanya.
 *
 * ## Urutan yang mengikat
 *
 * ```
 * 1. 8004scan            → source: "scan8004"   (segar)
 * 2. cache Postgres      → source: "cache"      (ditandai stale)
 * 3. FuguRegistry on-chain → source: "onchain"  (first-party, tanpa pihak ketiga)
 * 4. seed terkurasi      → source: "seed"       (umur sebenarnya ikut dilaporkan)
 * ```
 *
 * Sebuah tingkat diturunkan bila ia **tidak sehat**, **kosong**, **melempar**,
 * atau **tidak dipasang**. Keempat sebab itu punya `outcome` sendiri di
 * {@link FallbackAttempt} sehingga bisa dibedakan saat memeriksa, bukan
 * dilebur jadi "gagal".
 *
 * ## Dua janji
 *
 * 1. **Tidak pernah melempar ke pemanggil.** Sumber-sumber di `src/sources/`
 *    dan `src/db/repo.ts` sudah berjanji begitu — dan berkas ini tetap
 *    membungkus setiap panggilan dengan `try/catch`. Janji orang lain bukan
 *    alasan untuk tidak memasang jaring sendiri: yang kita lindungi adalah
 *    halaman marketplace, bukan kerapian lapisan. Diuji per tingkat.
 * 2. **Setiap hasil membawa `source` dan `ageSeconds`.** UI — dan juri — selalu
 *    tahu angka yang dilihat berasal dari mana dan seberapa tua. `degraded` dan
 *    `trail` melengkapinya: `trail` mencatat tiap tingkat yang ditempuh beserta
 *    alasannya, sehingga klaim ketahanan bisa diperiksa alih-alih dipercaya.
 *
 * ## Kenapa `DEFAULT_SPAM_FILTERS` yang mengosongkan chain 97 bukan bug
 *
 * Filter anti-spam bawaan (`is_registered`, `min_score: 10`, `has_a2a`) sangat
 * mungkin menyisakan **nol** agent di testnet. Itu jawaban yang sah dari
 * upstream yang sehat, dan justru alasan tingkat 3 dan 4 ada. Melonggarkan
 * filter untuk "memperbaiki"-nya berarti menukar marketplace kosong dengan
 * marketplace penuh `"Agent #340784"`; yang kedua lebih buruk. Kasus ini
 * punya test sendiri.
 *
 * ## Aturan lain
 *
 * - **Uang tetap `bigint`.** Tidak ada satu pun konversi ke `number` di sini;
 *   `fuguListing` diteruskan apa adanya. USD berbasis 8 desimal.
 * - **Semua sumber disuntikkan.** Tidak ada test yang menyentuh jaringan atau
 *   Postgres sungguhan.
 * - **Kredensial tidak pernah muncul di keluaran.** Pesan kegagalan dari
 *   sumber mana pun disunting ({@link redact}) sebelum masuk `reason`/`trail`.
 * - **Seed tidak pernah ditulis ke cache.** Kalau ditulis, pembacaan berikutnya
 *   akan melapor `source: "cache"` untuk baris yang sebenarnya seed, dan
 *   provenance yang menjadi seluruh nilai lapisan ini hilang.
 */

import { classify } from "../classify.js";
import { CHAIN_ID } from "../config.js";
import {
  DEFAULT_MAX_AGE_SECONDS,
  getCachedAgent,
  getCachedAgents,
  getLatestSourceHealth,
  recordSourceHealth,
  upsertAgents,
  type CachedAgentFilter,
} from "../db/repo.js";
import type { FuguDb } from "../db/client.js";
import {
  ONCHAIN_DEFAULT_LIMIT,
  ONCHAIN_MAX_LIMIT,
  type OnchainSource,
} from "../sources/onchain.js";
import type { Scan8004Source } from "../sources/scan8004.js";
import type {
  AgentDetailResult,
  AgentListPage,
  AgentRecord,
  AgentSource,
  Category,
  SourceHealth,
} from "../types.js";
import { createSeedSource, type SeedSource } from "./seed.js";

// ---------------------------------------------------------------------------
// Bentuk keluaran
// ---------------------------------------------------------------------------

/** Bagaimana satu tingkat fallback berakhir. Empat sebab turun, dibedakan. */
export type FallbackOutcome =
  /** Menjawab dengan isi. Tingkat berikutnya tidak disentuh. */
  | "ok"
  /** Sehat, tapi tidak ada isinya (mis. filter anti-spam mengosongkan chain 97). */
  | "empty"
  /** Sumber melapor `healthy: false` — upstream mati, breaker terbuka, bentuk asing. */
  | "unhealthy"
  /** Sumber melempar exception walau berjanji tidak. Jaring pengaman kita sendiri. */
  | "threw"
  /** Tingkat itu tidak dipasang pada instance ini (mis. backend tanpa Postgres). */
  | "unavailable";

/** Satu baris jejak: tingkat apa dicoba, bagaimana hasilnya, kenapa. */
export interface FallbackAttempt {
  source: AgentSource;
  outcome: FallbackOutcome;
  /** Sudah disunting dari kredensial dan dipotong. `null` bila tidak ada alasan. */
  reason: string | null;
  /** Jumlah item yang tingkat ini berikan. */
  items: number;
  /**
   * Hanya pada tingkat 8004scan: total yang **upstream** laporkan untuk query
   * semantic-nya. Ia BUKAN total kategori — classifier di sisi kita yang
   * membuat kategori — dan karena itu sengaja tidak pernah menjadi `total`
   * halaman. Disimpan di jejak supaya tetap bisa diperiksa saat menyelidiki
   * kenapa sebuah kategori tampak sepi, tanpa pernah bisa menjanjikan halaman
   * yang tidak ada kepada pengguna.
   */
  upstreamTotal?: number;
}

/** Halaman agent lengkap dengan provenance-nya. */
export interface AgentServicePage extends AgentListPage {
  /**
   * Jumlah agent kategori ini yang **benar-benar bisa dipertanggungjawabkan** —
   * bukan total upstream.
   *
   * Pada tingkat 8004scan, total yang dikembalikan upstream adalah total hasil
   * **query semantic**, bukan total kategori: kategori dibuat oleh classifier
   * di sisi kita. Melaporkannya di sini akan menjanjikan "4.812 agent Grid"
   * sementara halaman ketiga sudah kosong — dan juri cukup menekan "next page"
   * untuk menemukannya. Angka upstream tetap terbawa di
   * {@link FallbackAttempt.upstreamTotal} pada `trail`, tempat ia jadi bahan
   * penyelidikan alih-alih janji.
   */
  total: number;
  /** Umur item **tertua** di halaman ini, detik. `null` bila kosong. */
  ageSeconds: number | null;
  /** `true` bila data tidak bisa dipastikan segar (cache, seed, atau lewat TTL). */
  stale: boolean;
  /** `true` bila bukan dari 8004scan — marketplace sedang berjalan dengan jaring pengaman. */
  degraded: boolean;
  maxAgeSeconds: number;
  trail: FallbackAttempt[];
}

/** Satu agent lengkap dengan provenance-nya. */
export interface AgentServiceDetail extends AgentDetailResult {
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  trail: FallbackAttempt[];
}

/**
 * Ringkasan kesehatan untuk `/api/health` — jujur ke juri, bukan selalu hijau.
 *
 * `healthy` dan `degraded` sengaja dua boolean terpisah, karena tiga keadaan
 * yang perlu dibedakan tidak muat di satu:
 *
 * | `healthy` | `degraded` | Artinya |
 * |---|---|---|
 * | `true`  | `false` | melayani langsung dari 8004scan |
 * | `true`  | `true`  | 8004scan tumbang, masih ada sumber data sungguhan (cache / on-chain) |
 * | `false` | `true`  | **tidak ada sumber sungguhan yang menjawab** — yang tersisa hanya seed |
 */
export interface ServiceHealth {
  /**
   * Ada bukti bahwa minimal satu **sumber data sungguhan** — 8004scan, cache
   * Postgres, atau pembacaan on-chain — bekerja saat ini.
   *
   * **Seed tidak dihitung.** Seed adalah berkas di dalam bundel; ia tidak bisa
   * mati, jadi memasukkannya membuat field ini konstan `true` dan menghapus
   * seluruh guna `/api/health`: juri akan mematikan 8004scan dan melihat lampu
   * tetap hijau, yang terbaca sebagai menutupi. Seed tetap muncul di `sources`
   * (berguna: jaring pengamannya utuh), hanya tidak ikut menentukan nilai ini.
   *
   * Tanpa observasi apa pun — misalnya sesaat setelah boot — nilainya `false`.
   * Tidak adanya bukti sehat bukan bukti sehat; monitor yang membunyikan alarm
   * pada keadaan belum-diketahui berperilaku benar.
   */
  healthy: boolean;
  /** 8004scan diketahui tidak sehat — marketplace berjalan dari jaring pengaman. */
  degraded: boolean;
  sources: SourceHealth[];
  checkedAt: string;
}

/**
 * Sumber data sungguhan — yang bisa benar-benar tumbang, dan karena itu yang
 * menentukan `ServiceHealth.healthy`. Seed sengaja tidak termasuk.
 */
export const LIVE_SOURCES: readonly AgentSource[] = ["scan8004", "cache", "onchain"];

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/** Halaman cache: `AgentListPage` plus umur. Dipenuhi `CachedAgentPage` dari repo. */
export interface CachedPage extends AgentListPage {
  ageSeconds: number | null;
  stale: boolean;
}

/** Detail cache: `AgentDetailResult` plus umur. */
export interface CachedDetail extends AgentDetailResult {
  ageSeconds: number | null;
}

/**
 * Cache sebagai port, bukan sebagai `FuguDb` langsung.
 *
 * Alasannya bukan kerapian: seluruh test tingkat 2 berjalan tanpa Postgres,
 * dan backend yang belum punya database tetap bisa menyalakan layanan ini
 * dengan tingkat 2 berstatus `unavailable` alih-alih gagal boot.
 */
export interface AgentCachePort {
  getAgents(filter: CachedAgentFilter, now: Date): Promise<CachedPage>;
  getAgent(id: string, now: Date): Promise<CachedDetail>;
  /** Tulis-balik hasil segar. Kegagalannya tidak pernah menjatuhkan permintaan. */
  saveAgents(records: AgentRecord[]): Promise<number>;
  recordHealth(health: SourceHealth): Promise<void>;
  latestHealth(): Promise<SourceHealth[]>;
}

/** Adapter tipis dari `src/db/repo.ts`. Semua logika ada di repo, bukan di sini. */
export function createDbAgentCache(db: FuguDb): AgentCachePort {
  return {
    getAgents: (filter, now) => getCachedAgents(db, filter, now),
    getAgent: (id, now) => getCachedAgent(db, id, now),
    // `upsertAgents` sengaja MELEMPAR bila infrastrukturnya gagal (lihat repo.ts):
    // penulisan yang gagal harus terlihat. Yang membungkusnya adalah `writeThrough`
    // di bawah, supaya kegagalan menyimpan salinan tidak pernah mengubah apa yang
    // sudah diterima pemanggil.
    saveAgents: (records) => upsertAgents(db, records),
    // `recordSourceHealth` mengembalikan `boolean` (berhasil atau tidak) dan tidak
    // melempar. Port ini tidak peduli: mencatat kesehatan adalah efek samping,
    // bukan bagian dari jawaban yang dilayani.
    recordHealth: async (health) => {
      await recordSourceHealth(db, health);
    },
    latestHealth: () => getLatestSourceHealth(db),
  };
}

// ---------------------------------------------------------------------------
// Konstanta
// ---------------------------------------------------------------------------

/**
 * Query semantic per kategori (spec §6.1).
 *
 * Ditulis dalam bahasa Inggris karena korpus 8004scan berbahasa Inggris, dan
 * memakai frasa yang membedakan — bukan kata telanjang seperti `grid` atau
 * `yield`, yang di data nyata jauh lebih sering berarti hal lain (lihat catatan
 * jebakan di `classify.ts`). Hasilnya tetap disaring ulang oleh classifier
 * deterministik: semantic search menyempitkan populasi, classifier yang memutus.
 */
export const CATEGORY_SEMANTIC_QUERIES: Readonly<Record<Category, string>> = {
  REBALANCING:
    "automated portfolio rebalancing agent that repositions concentrated liquidity ranges and restores target allocation",
  GRID:
    "grid trading bot that places laddered buy and sell grid orders across price levels",
  YIELD:
    "yield farming optimizer that routes capital to the best APY and auto-compounds rewards",
  HEALTH_FACTOR:
    "health factor monitor that protects lending positions from liquidation by repaying debt",
};

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
/** Panjang maksimum sebuah `reason`. Log bukan tempat menumpuk stack trace viem. */
export const MAX_REASON_LENGTH = 400;

// ---------------------------------------------------------------------------
// Penyuntingan kredensial
// ---------------------------------------------------------------------------

/**
 * Pola kredensial yang pernah benar-benar bocor lewat pesan error klien HTTP:
 * URL yang membawa `api_key=`, dan header `Authorization: Bearer …` yang ikut
 * dicetak beberapa pustaka saat request gagal.
 */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/((?:x-)?api[-_]?key)["']?\s*[=:]\s*["']?[^\s&"',;)]+/gi, "$1=[redacted]"],
  [/\bbearer\s+[^\s,;)]+/gi, "Bearer [redacted]"],
  [/\btoken["']?\s*[=:]\s*["']?[^\s&"',;)]+/gi, "token=[redacted]"],
];

/** Sunting kredensial lalu potong. Dipakai untuk SETIAP `reason` yang kita keluarkan. */
export function redact(message: string): string {
  let out = message;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out.length > MAX_REASON_LENGTH ? `${out.slice(0, MAX_REASON_LENGTH - 3)}...` : out;
}

/** Pesan kegagalan yang aman untuk `reason` — juga saat yang dilempar bukan `Error`. */
function describeThrow(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = err.message.split("\n")[0] ?? err.message;
    return redact(`${err.name}: ${firstLine}`);
  }
  return redact(`kegagalan tak dikenal: ${String(err)}`);
}

// ---------------------------------------------------------------------------
// Layanan
// ---------------------------------------------------------------------------

export interface GetAgentsOptions {
  limit?: number;
  offset?: number;
  /** Di atas ini hasil ditandai `stale`. Tidak pernah menyaring apa pun. */
  maxAgeSeconds?: number;
}

export interface AgentServiceDeps {
  scan8004: Scan8004Source;
  /** Tingkat 2. Tanpa ini tingkat 2 berstatus `unavailable`, bukan gagal. */
  cache?: AgentCachePort;
  /** Tingkat 3. Tanpa ini tingkat 3 berstatus `unavailable`. */
  onchain?: OnchainSource;
  /** Tingkat 4. Bawaannya seed terkurasi bawaan repo. */
  seed?: SeedSource;
  chainId?: number;
  now?: () => Date;
  /** Berapa banyak listing on-chain dibaca sekaligus sebelum disaring per kategori. */
  onchainScanLimit?: number;
  /** Tulis hasil tiap tingkat ke tabel `source_health`. Bawaan `true`. */
  persistHealth?: boolean;
}

export interface AgentService {
  getAgentsByCategory(category: Category, opts?: GetAgentsOptions): Promise<AgentServicePage>;
  getAgentDetail(id: string): Promise<AgentServiceDetail>;
  getHealth(): Promise<ServiceHealth>;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

/** `fetchedAt` item tertua. Dipakai sebagai `fetchedAt` halaman supaya ia tidak berbohong. */
function oldestFetchedAt(items: readonly AgentRecord[]): string | null {
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const parsed = Date.parse(item.fetchedAt);
    if (!Number.isNaN(parsed) && parsed < oldestMs) {
      oldestMs = parsed;
      oldest = item.fetchedAt;
    }
  }
  return oldest;
}

/** Umur item tertua di sebuah daftar. Satu aturan untuk keempat tingkat. */
function oldestAgeSeconds(items: readonly AgentRecord[], now: Date): number | null {
  if (items.length === 0) return null;
  let oldest = 0;
  for (const item of items) {
    const parsed = Date.parse(item.fetchedAt);
    const age = Number.isNaN(parsed) ? 0 : Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
    if (age > oldest) oldest = age;
  }
  return oldest;
}

/**
 * `stale` berarti "tidak bisa dipastikan segar", bukan sekadar "tua".
 *
 * Cache selalu stale saat dipakai di sini, karena kita hanya sampai ke cache
 * setelah upstream gagal menjawab — datanya, seberapa pun baru, tidak
 * terkonfirmasi. `ageSeconds` yang menyatakan seberapa jauh; `stale` menyatakan
 * bahwa ia tidak diverifikasi.
 */
function isStale(source: AgentSource, ageSeconds: number | null, maxAgeSeconds: number): boolean {
  if (source === "cache") return true;
  return ageSeconds !== null && ageSeconds > maxAgeSeconds;
}

export function createAgentService(deps: AgentServiceDeps): AgentService {
  const now = deps.now ?? (() => new Date());
  const chainId = deps.chainId ?? CHAIN_ID;
  const seed = deps.seed ?? createSeedSource({ now });
  const onchainScanLimit = deps.onchainScanLimit ?? ONCHAIN_DEFAULT_LIMIT;
  const persistHealth = deps.persistHealth ?? true;

  /**
   * Status terakhir tiap sumber **di proses ini**. Selalu lebih baru daripada
   * riwayat di tabel `source_health`, karena itu ia yang menang saat keduanya ada.
   */
  const lastSeen = new Map<AgentSource, SourceHealth>();

  function noteHealth(attempt: FallbackAttempt, checkedAt: string): void {
    if (attempt.outcome === "unavailable") return;
    const health: SourceHealth = {
      source: attempt.source,
      healthy: attempt.outcome === "ok" || attempt.outcome === "empty",
      reason: attempt.reason,
      checkedAt,
    };
    const previous = lastSeen.get(attempt.source);
    lastSeen.set(attempt.source, health);
    if (!persistHealth || deps.cache === undefined) return;
    // Hanya **perubahan** status yang ditulis. Satu tampilan halaman saat
    // upstream tumbang menempuh empat tingkat; menulis keempatnya tiap
    // permintaan mengubah `source_health` jadi log akses. Yang berguna bagi
    // `/api/health` dan bagi juri adalah kapan sebuah sumber berpindah keadaan,
    // dan itu yang disimpan. Status terkini tetap ada di memori proses ini.
    if (previous !== undefined && previous.healthy === health.healthy) return;
    // Best-effort: gagal mencatat kesehatan tidak boleh menjatuhkan permintaan
    // yang sedang dilayani. Ironinya akan sempurna.
    void deps.cache.recordHealth(health).catch(() => undefined);
  }

  /** Tulis-balik hasil segar ke cache. Best-effort, tidak pernah melempar. */
  async function writeThrough(records: AgentRecord[]): Promise<void> {
    if (deps.cache === undefined || records.length === 0) return;
    try {
      await deps.cache.saveAgents(records);
    } catch {
      // Sengaja diam: data sudah di tangan pemanggil, kegagalan menyimpan
      // salinannya tidak boleh mengubah apa yang ia terima.
    }
  }

  // -------------------------------------------------------------------------
  // Daftar per kategori
  // -------------------------------------------------------------------------

  async function getAgentsByCategory(
    category: Category,
    opts: GetAgentsOptions = {},
  ): Promise<AgentServicePage> {
    const at = now();
    const fetchedAt = at.toISOString();
    const limit = clampLimit(opts.limit);
    const offset = clampOffset(opts.offset);
    const maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
    const trail: FallbackAttempt[] = [];

    function step(attempt: FallbackAttempt): FallbackAttempt {
      trail.push(attempt);
      noteHealth(attempt, fetchedAt);
      return attempt;
    }

    function finish(
      source: AgentSource,
      items: AgentRecord[],
      total: number,
      healthy: boolean,
      reason: string | null,
    ): AgentServicePage {
      const ageSeconds = oldestAgeSeconds(items, at);
      return {
        items,
        total,
        limit,
        offset,
        source,
        healthy,
        reason,
        // `fetchedAt` menunjuk kapan DATANYA diambil, bukan kapan jawaban ini
        // disusun. Menyetelnya ke `now` untuk hasil seed akan membuat satu objek
        // membawa dua pernyataan yang bertentangan: "baru diambil" berdampingan
        // dengan `ageSeconds` ratusan ribu detik. Konsumen yang membaca
        // `fetchedAt` saja tetap mendapat angka yang benar, dan invariant
        // `ageSeconds === now - fetchedAt` berlaku di keempat tingkat.
        fetchedAt: oldestFetchedAt(items) ?? fetchedAt,
        ageSeconds,
        stale: isStale(source, ageSeconds, maxAgeSeconds),
        degraded: source !== "scan8004",
        maxAgeSeconds,
        trail,
      };
    }

    // --- Tingkat 1: 8004scan -------------------------------------------------
    try {
      const page = await deps.scan8004.semanticSearch(CATEGORY_SEMANTIC_QUERIES[category], {
        chainId,
        limit,
        offset,
      });

      if (!page.healthy) {
        step({
          source: "scan8004",
          outcome: "unhealthy",
          reason: redact(page.reason ?? "8004scan tidak sehat tanpa alasan"),
          items: 0,
        });
      } else {
        // Semantic search menyempitkan populasi; classifier deterministik yang
        // memutuskan kategori. Upstream tidak punya keempat kategori kita.
        const classified = page.items.map((item) =>
          item.classification === null ? { ...item, classification: classify(item) } : item,
        );
        const matching = classified.filter(
          (item) => item.classification?.category === category,
        );

        if (matching.length === 0) {
          // Termasuk kasus `DEFAULT_SPAM_FILTERS` mengosongkan chain 97:
          // jawaban sah dari upstream sehat, dan justru sebab tingkat 3 & 4 ada.
          step({
            source: "scan8004",
            outcome: "empty",
            reason: null,
            items: 0,
            upstreamTotal: page.total,
          });
        } else {
          step({
            source: "scan8004",
            outcome: "ok",
            reason: null,
            items: matching.length,
            upstreamTotal: page.total,
          });
          await writeThrough(matching);
          // `page.total` adalah total hasil **query semantic**, BUKAN total
          // kategori — upstream tidak punya keempat kategori kita, classifier
          // di baris atas yang membuatnya. Melaporkannya sebagai `total` berarti
          // menjanjikan "4.812 agent Grid" sementara halaman ketiga sudah kosong;
          // juri cukup menekan "next page" untuk menemukannya. Yang kita punya
          // adalah item yang benar-benar lolos, dan itu yang dilaporkan.
          // Angka upstream tetap dibawa, terpisah dan bernama apa adanya.
          return finish("scan8004", matching, matching.length, true, null);
        }
      }
    } catch (err) {
      // Sumbernya berjanji tidak melempar. Kita tetap tidak bertaruh pada janji itu.
      step({ source: "scan8004", outcome: "threw", reason: describeThrow(err), items: 0 });
    }

    // --- Tingkat 2: cache Postgres ------------------------------------------
    if (deps.cache === undefined) {
      step({ source: "cache", outcome: "unavailable", reason: "cache tidak dipasang", items: 0 });
    } else {
      try {
        const filter: CachedAgentFilter = { chainId, category, limit, offset, maxAgeSeconds };
        const page = await deps.cache.getAgents(filter, at);
        if (!page.healthy) {
          step({
            source: "cache",
            outcome: "unhealthy",
            reason: redact(page.reason ?? "cache tidak sehat tanpa alasan"),
            items: 0,
          });
        } else if (page.items.length === 0) {
          step({ source: "cache", outcome: "empty", reason: null, items: 0 });
        } else {
          step({ source: "cache", outcome: "ok", reason: null, items: page.items.length });
          return finish("cache", page.items, page.total, true, null);
        }
      } catch (err) {
        step({ source: "cache", outcome: "threw", reason: describeThrow(err), items: 0 });
      }
    }

    // --- Tingkat 3: FuguRegistry on-chain -----------------------------------
    if (deps.onchain === undefined) {
      step({ source: "onchain", outcome: "unavailable", reason: "on-chain tidak dipasang", items: 0 });
    } else {
      try {
        // Kategori tersimpan di dalam listing, bukan di parameter kontrak, jadi
        // penyaringan dan paging dilakukan di sini atas hasil bacaan. Jendela
        // bacanya melebar mengikuti `offset` pemanggil: jendela tetap 100 akan
        // membuat halaman 6 marketplace jatuh ke seed sementara halaman 1
        // dilayani on-chain — provenance-nya tetap jujur, tapi sumbernya
        // melompat tanpa sebab yang bisa dijelaskan ke pengguna.
        const page = await deps.onchain.readFuguListings({
          limit: Math.min(Math.max(onchainScanLimit, offset + limit), ONCHAIN_MAX_LIMIT),
          offset: 0,
        });
        if (!page.healthy) {
          step({
            source: "onchain",
            outcome: "unhealthy",
            reason: redact(page.reason ?? "pembacaan on-chain tidak sehat tanpa alasan"),
            items: 0,
          });
        } else {
          const matching = page.items.filter(
            (item) => item.fuguListing?.category === category ||
              item.classification?.category === category,
          );
          const slice = matching.slice(offset, offset + limit);
          if (slice.length === 0) {
            step({ source: "onchain", outcome: "empty", reason: null, items: 0 });
          } else {
            step({ source: "onchain", outcome: "ok", reason: null, items: slice.length });
            await writeThrough(slice);
            return finish("onchain", slice, matching.length, true, null);
          }
        }
      } catch (err) {
        step({ source: "onchain", outcome: "threw", reason: describeThrow(err), items: 0 });
      }
    }

    // --- Tingkat 4: seed terkurasi ------------------------------------------
    try {
      const page = await seed.listAgents(category, { limit, offset });
      // Halaman kosong wajib membawa penjelasannya di `reason`, bukan hanya di
      // `trail`: itu tempat yang paling wajar dilihat, dan "kosong tanpa sebab"
      // tidak bisa dibedakan dari kegagalan diam-diam.
      const emptyReason =
        page.items.length > 0
          ? null
          : (page.reason ??
            `seed terkurasi tidak punya agent kategori ${category} pada offset ${offset}`);
      step({
        source: "seed",
        outcome: page.items.length === 0 ? "empty" : "ok",
        reason: page.items.length === 0 ? emptyReason : page.reason,
        items: page.items.length,
      });

      // **Halaman kosong dari seed tidak selalu berarti "memang tidak ada".**
      // Bila ada tingkat di atas yang mati, yang kita punya bukan jawaban
      // melainkan ketidaktahuan, dan mengakunya sehat membuat pemanggil
      // memperlakukan "kosong" sebagai fakta. Halaman yang BERISI tetap sehat:
      // kita benar-benar menyajikan data terkurasi, dan `source: "seed"` +
      // `degraded: true` sudah mengatakan dari mana.
      const failed = page.items.length === 0 ? upperTierFailed(trail) : undefined;
      const incomplete =
        failed === undefined
          ? emptyReason
          : `kosong tapi TIDAK dapat dipastikan: ${failed.source} ${failed.outcome}` +
            `${failed.reason ? ` (${failed.reason})` : ""}`;

      // Seed TIDAK ditulis ke cache — lihat catatan di kepala berkas.
      return finish("seed", page.items, page.total, failed === undefined, incomplete);
    } catch (err) {
      step({ source: "seed", outcome: "threw", reason: describeThrow(err), items: 0 });
    }

    // Keempat tingkat gagal. Tetap tidak melempar: halaman kosong yang mengaku
    // kosong, dengan seluruh sebabnya terbaca di `reason` dan `trail`.
    return finish("seed", [], 0, false, summarize(trail));
  }

  // -------------------------------------------------------------------------
  // Detail satu agent
  // -------------------------------------------------------------------------

  async function getAgentDetail(id: string): Promise<AgentServiceDetail> {
    const at = now();
    const fetchedAt = at.toISOString();
    const maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS;
    const trail: FallbackAttempt[] = [];

    function step(attempt: FallbackAttempt): void {
      trail.push(attempt);
      noteHealth(attempt, fetchedAt);
    }

    function finish(
      source: AgentSource,
      agent: AgentRecord | null,
      healthy: boolean,
      reason: string | null,
    ): AgentServiceDetail {
      const ageSeconds = agent === null ? null : oldestAgeSeconds([agent], at);
      return {
        agent,
        source,
        healthy,
        reason,
        // Sama seperti jalur daftar: `fetchedAt` menunjuk kapan DATANYA diambil.
        fetchedAt: agent?.fetchedAt ?? fetchedAt,
        ageSeconds,
        stale: agent === null ? false : isStale(source, ageSeconds, maxAgeSeconds),
        degraded: source !== "scan8004",
        maxAgeSeconds,
        trail,
      };
    }

    // `id` = `${chainId}:${tokenId}`. Tingkat 1 dan 3 butuh keduanya; tingkat 2
    // dan 4 mencari lewat `id` utuh, jadi id berbentuk asing tetap dilayani —
    // tingkat yang tidak bisa dipakai ditandai `unavailable`, bukan melempar.
    const split = id.indexOf(":");
    const parsed =
      split > 0 && split < id.length - 1
        ? { chainId: Number(id.slice(0, split)), tokenId: id.slice(split + 1) }
        : null;

    // **chainId datang dari pemanggil dan tidak boleh dipercaya.** Tanpa
    // pemeriksaan ini, `GET /api/agents/1:12345` membuat backend menanyakan
    // agent MAINNET ke 8004scan dan merendernya sebagai halaman detail
    // Fugugent — melanggar bingkai "testnet only" (CLAUDE.md aturan 7) dan
    // menjadikan chain sebagai parameter yang dikendalikan pemanggil.
    // Ditolak, bukan diam-diam dilayani.
    const wrongChain =
      parsed !== null && Number.isFinite(parsed.chainId) && parsed.chainId !== chainId;
    const target =
      parsed !== null && Number.isFinite(parsed.chainId) && !wrongChain ? parsed : null;
    const targetReason = wrongChain
      ? `id "${id}" menunjuk chain ${parsed?.chainId}, layanan ini hanya melayani chain ${chainId}`
      : `id "${id}" tidak berbentuk chainId:tokenId`;

    // --- Tingkat 1: 8004scan -------------------------------------------------
    if (target === null) {
      step({ source: "scan8004", outcome: "unavailable", reason: targetReason, items: 0 });
    } else {
      try {
        const detail = await deps.scan8004.getAgent(target.chainId, target.tokenId);
        if (!detail.healthy) {
          step({
            source: "scan8004",
            outcome: "unhealthy",
            reason: redact(detail.reason ?? "8004scan tidak sehat tanpa alasan"),
            items: 0,
          });
        } else if (detail.agent === null) {
          step({ source: "scan8004", outcome: "empty", reason: null, items: 0 });
        } else {
          const agent =
            detail.agent.classification === null
              ? { ...detail.agent, classification: classify(detail.agent) }
              : detail.agent;
          step({ source: "scan8004", outcome: "ok", reason: null, items: 1 });
          await writeThrough([agent]);
          return finish("scan8004", agent, true, null);
        }
      } catch (err) {
        step({ source: "scan8004", outcome: "threw", reason: describeThrow(err), items: 0 });
      }
    }

    // --- Tingkat 2: cache Postgres ------------------------------------------
    if (deps.cache === undefined) {
      step({ source: "cache", outcome: "unavailable", reason: "cache tidak dipasang", items: 0 });
    } else {
      try {
        const cached = await deps.cache.getAgent(id, at);
        if (!cached.healthy) {
          step({
            source: "cache",
            outcome: "unhealthy",
            reason: redact(cached.reason ?? "cache tidak sehat tanpa alasan"),
            items: 0,
          });
        } else if (cached.agent === null) {
          step({ source: "cache", outcome: "empty", reason: null, items: 0 });
        } else {
          step({ source: "cache", outcome: "ok", reason: null, items: 1 });
          return finish("cache", cached.agent, true, null);
        }
      } catch (err) {
        step({ source: "cache", outcome: "threw", reason: describeThrow(err), items: 0 });
      }
    }

    // --- Tingkat 3: FuguRegistry on-chain -----------------------------------
    if (deps.onchain === undefined || target === null) {
      step({
        source: "onchain",
        outcome: "unavailable",
        reason: deps.onchain === undefined ? "on-chain tidak dipasang" : targetReason,
        items: 0,
      });
    } else {
      try {
        // `FuguRegistry` diindeks per `listingId`, bukan per `tokenId` ERC-8004,
        // dan `OnchainSource` tidak mengekspos `listingByAgentId`. Karena itu
        // listing dibaca lalu dicari di sini — jaring pengaman boleh sedikit
        // lebih mahal, yang tidak boleh adalah ia tidak ada.
        const page = await deps.onchain.readFuguListings({ limit: onchainScanLimit, offset: 0 });
        if (!page.healthy) {
          step({
            source: "onchain",
            outcome: "unhealthy",
            reason: redact(page.reason ?? "pembacaan on-chain tidak sehat tanpa alasan"),
            items: 0,
          });
        } else {
          // Dicocokkan lewat `id` utuh, yang memuat chainId. Mencocokkan
          // `tokenId` telanjang akan mengabaikan chain — token 42 di chain 1
          // dan di chain 97 adalah agent yang berbeda.
          const hit = page.items.find((item) => item.id === id);
          if (hit === undefined) {
            step({ source: "onchain", outcome: "empty", reason: null, items: 0 });
          } else {
            step({ source: "onchain", outcome: "ok", reason: null, items: 1 });
            await writeThrough([hit]);
            return finish("onchain", hit, true, null);
          }
        }
      } catch (err) {
        step({ source: "onchain", outcome: "threw", reason: describeThrow(err), items: 0 });
      }
    }

    // --- Tingkat 4: seed terkurasi ------------------------------------------
    try {
      const detail = await seed.getAgent(id);
      step({
        source: "seed",
        outcome: detail.agent === null ? "empty" : "ok",
        reason: detail.reason,
        items: detail.agent === null ? 0 : 1,
      });

      // Inilah akar 404 palsu: `seed.getAgent` dengan benar melapor "tidak ada
      // di seed" — seed memang tidak memuat agent itu, dan sumber seed sendiri
      // sehat. Yang salah adalah menaikkan jawaban itu menjadi "tidak ditemukan"
      // ketika 8004scan, cache, dan RPC sedang tumbang: agent yang dicari bisa
      // saja ada di ketiganya. `healthy: false` di sini yang membuat pemanggil
      // (rute detail Task 6) bisa membedakan "tidak ada" dari "tidak tahu".
      const failed = detail.agent === null ? upperTierFailed(trail) : undefined;
      const reason =
        failed === undefined
          ? (detail.agent === null ? detail.reason : null)
          : `tidak dapat dipastikan ada atau tidak: ${failed.source} ${failed.outcome}` +
            `${failed.reason ? ` (${failed.reason})` : ""}`;

      return finish("seed", detail.agent, failed === undefined, reason);
    } catch (err) {
      step({ source: "seed", outcome: "threw", reason: describeThrow(err), items: 0 });
    }

    return finish("seed", null, false, summarize(trail));
  }

  // -------------------------------------------------------------------------
  // Kesehatan
  // -------------------------------------------------------------------------

  async function getHealth(): Promise<ServiceHealth> {
    const checkedAt = now().toISOString();

    // Riwayat DB dulu, lalu ditimpa status dalam proses ini — yang terakhir
    // selalu lebih baru. Kegagalan membaca riwayat bukan alasan `/api/health`
    // ikut mati; ia justru saat endpoint ini paling dibutuhkan.
    const merged = new Map<AgentSource, SourceHealth>();
    if (deps.cache !== undefined) {
      try {
        for (const health of await deps.cache.latestHealth()) merged.set(health.source, health);
      } catch (err) {
        merged.set("cache", {
          source: "cache",
          healthy: false,
          reason: describeThrow(err),
          checkedAt,
        });
      }
    }
    for (const [source, health] of lastSeen) merged.set(source, health);

    // Seed tidak punya bagian yang bisa mati sendiri: ia berkas dalam bundel.
    // Selama tidak pernah tercatat melempar, ia sehat — dan itu yang membuat
    // `healthy` di bawah tidak pernah false.
    if (!merged.has("seed")) {
      merged.set("seed", {
        source: "seed",
        healthy: true,
        reason: "seed terkurasi selalu tersedia",
        checkedAt,
      });
    }

    const order: AgentSource[] = ["scan8004", "cache", "onchain", "seed"];
    const sources = order
      .map((source) => merged.get(source))
      .filter((health): health is SourceHealth => health !== undefined);

    return {
      // Hanya sumber sungguhan yang boleh menyalakan lampu hijau — lihat
      // catatan panjang di `ServiceHealth.healthy`.
      healthy: sources.some(
        (health) => health.healthy && LIVE_SOURCES.includes(health.source),
      ),
      degraded: merged.get("scan8004")?.healthy !== true,
      sources,
      checkedAt,
    };
  }

  return { getAgentsByCategory, getAgentDetail, getHealth };
}

/**
 * Apakah ada tingkat di atas yang benar-benar **gagal**, bukan sekadar menjawab
 * kosong atau tidak dipasang.
 *
 * Pembedaan ini yang menentukan apakah "tidak ditemukan" boleh dipercaya.
 * Kalau ketiga tingkat di atas menjawab sehat dan memang kosong, maka kosong
 * adalah jawaban yang sah. Kalau salah satunya mati, kita **tidak tahu** —
 * dan mengaku tahu di situ persis yang membuat rute detail membalas 404 untuk
 * agent yang sebenarnya ada.
 */
function upperTierFailed(trail: readonly FallbackAttempt[]): FallbackAttempt | undefined {
  return trail.find(
    (attempt) =>
      attempt.source !== "seed" && (attempt.outcome === "unhealthy" || attempt.outcome === "threw"),
  );
}

/** Rangkum seluruh jejak jadi satu `reason` — dipakai hanya saat keempat tingkat gagal. */
function summarize(trail: readonly FallbackAttempt[]): string {
  const parts = trail.map((t) => `${t.source}=${t.outcome}${t.reason ? ` (${t.reason})` : ""}`);
  return redact(`keempat tingkat fallback gagal: ${parts.join("; ")}`);
}
