/**
 * `/api/health` — endpoint yang membuat klaim ketahanan bisa **diperiksa**.
 *
 * Bukan probe liveness. Ini laporan keadaan **tiap sumber**, termasuk yang
 * sedang tumbang, dan itulah seluruh gunanya: siapa pun boleh mematikan
 * 8004scan lalu memeriksa apakah kami mengakuinya. Endpoint kesehatan yang
 * selalu hijau tidak membuktikan apa pun.
 *
 * Dua aturan yang mengikat berkas ini:
 *
 * 1. **Tidak pernah 5xx.** Termasuk saat Postgres mati — justru saat itulah ia
 *    paling dibutuhkan. `getHealth()` yang melempar menjadi laporan
 *    `healthy: false` yang jujur, bukan halaman error.
 * 2. **Tidak pernah memuat kredensial.** Setiap `reason` — juga yang datang
 *    dari pesan error upstream — disunting lewat `redact` sebelum keluar.
 *
 * ## Dua mode, karena ada dua pembaca
 *
 * - **Bawaan: selalu 200**, bahkan saat `healthy: false`. Pembacanya adalah UI
 *   dan manusia, yang membaca badan respons. (`fetch` sendiri tidak membuang
 *   badan pada 503 — yang membuangnya adalah `getJson` di frontend, yang
 *   melempar pada non-2xx. Jadi 200 di sini adalah pilihan demi klien itu,
 *   bukan sifat HTTP.)
 * - **`?strict=1`: 503 ketika ada bukti kerusakan** (lihat {@link shouldAlarm}).
 *   Pembacanya adalah uptime monitor, liveness probe, dan `curl -f` — yang hanya
 *   melihat status code dan tidak bisa membaca apa pun. Badannya tetap lengkap
 *   dan identik dengan mode bawaan.
 */
import { Hono } from "hono";
import {
  LIVE_SOURCES,
  redact,
  type AgentService,
  type ObservedSourceHealth,
} from "../service/agents.js";
import type { AgentSource, SourceHealth } from "../types.js";
import { QueryError } from "./query.js";

export interface HealthRoutesDeps {
  service: AgentService;
  now?: () => Date;
}

/** Urutan fallback — dipakai untuk menyebut sumber mana yang sedang melayani. */
const SOURCE_ORDER: readonly AgentSource[] = ["scan8004", "cache", "onchain", "seed"];

export interface HealthResponse {
  healthy: boolean;
  /** `true` bila 8004scan tidak sehat — kami berjalan dari jaring pengaman. */
  degraded: boolean;
  /**
   * Sumber teratas yang masih sehat: dari sinilah permintaan berikutnya
   * kemungkinan besar dilayani. `"seed"` bila tidak ada yang sehat.
   */
  source: AgentSource;
  /** Ringkasan sumber yang tidak sehat. `null` bila semuanya sehat. */
  reason: string | null;
  /** Tiap baris membawa umur observasinya (`ageSeconds`, `stale`). */
  sources: ObservedSourceHealth[];
  checkedAt: string;
}

function scrub(health: ObservedSourceHealth): ObservedSourceHealth {
  return { ...health, reason: health.reason === null ? null : redact(health.reason) };
}

/**
 * **Kontrak `?strict=1`.** Ini yang akan dipegang orang lain, jadi ditulis sebagai
 * satu fungsi bernama alih-alih sebagai ekspresi di dalam handler.
 *
 * Alarm berbunyi bila **ada bukti kerusakan**, bukan hanya bila pengguna sudah
 * merasakannya:
 *
 * 1. **Ada sumber sungguhan yang diketahui tidak sehat.** Ini yang dulu hilang.
 *    `degraded` saja tidak cukup: kalau **hanya** Postgres mati sementara
 *    8004scan segar, mutu data yang dilihat pengguna memang tidak turun —
 *    `degraded: false`, `healthy: true` — dan monitor melihat 200 sementara
 *    satu sumber benar-benar tumbang. Justru keadaan itu yang ingin ditangkap
 *    **sebelum** menjadi masalah: cache yang mati adalah jaring yang hilang,
 *    dan ia baru terasa tepat ketika 8004scan menyusul tumbang.
 * 2. **`degraded`** — 8004scan tidak diketahui sehat. Tetap ada meski sebagian
 *    besar tercakup butir 1: bila 8004scan belum pernah terobservasi sama
 *    sekali, ia tidak muncul di `sources`, tetapi `degraded` tetap `true`.
 *    Membiarkan `strict` membalas 200 sementara badannya berkata
 *    `degraded: true` akan membuat dua pembaca endpoint yang sama saling
 *    bertentangan.
 * 3. **`!healthy`** — tidak ada satu pun sumber sungguhan yang terkonfirmasi
 *    sehat. Termasuk keadaan "belum diketahui apa pun" sesaat setelah boot:
 *    tidak adanya bukti sehat bukan bukti sehat, dan monitor yang membunyikan
 *    alarm pada keadaan belum-diketahui berperilaku benar. Ia diam sendiri
 *    begitu permintaan pertama lewat.
 *
 * Yang **tidak** membunyikan alarm:
 *
 * - **Sumber sungguhan yang tidak pernah terobservasi.** Backend yang sengaja
 *   dijalankan tanpa `DATABASE_URL` adalah konfigurasi yang sah, bukan
 *   kerusakan; `cache` tidak pernah muncul di `sources` dan tidak boleh membuat
 *   monitor merah selamanya. "Tidak dipasang" bukan "rusak" — pembedaan yang
 *   sama dengan yang dipakai `/api/agents/:id` untuk tidak menghapus agent nyata.
 * - **`seed`.** Ia berkas di dalam bundel proses ini, bukan sumber sungguhan
 *   ({@link LIVE_SOURCES}); ia tidak bisa tumbang sendiri, jadi ia tidak bisa
 *   menjadi bukti kerusakan infrastruktur.
 * - **Observasi yang `stale`.** `observe()` di `service/agents.ts` mencabut klaim
 *   sehat dari observasi yang melewati TTL — `healthy: false` di sana berarti
 *   "belum diperiksa ulang", bukan "gagal". Menghitungnya sebagai kerusakan akan
 *   membuat monitor merah permanen: `onchain` hanya tersentuh ketika tingkat 1
 *   dan 2 gagal, jadi observasinya nyaris selalu kedaluwarsa. Ini pembedaan yang
 *   sama persis dengan yang dipakai `/api/agents/:id`: **tidak tahu bukan rusak**,
 *   seperti tidak tahu bukan tidak ada. Diukur di container hidup: tanpa
 *   pengecualian ini, `strict=1` membalas 503 walaupun tidak ada yang rusak.
 */
export function shouldAlarm(health: {
  healthy: boolean;
  degraded: boolean;
  sources: readonly ObservedSourceHealth[];
}): boolean {
  const liveBroken = health.sources.some(
    (source) =>
      LIVE_SOURCES.includes(source.source) && !source.healthy && source.stale !== true,
  );
  return liveBroken || health.degraded || !health.healthy;
}

/**
 * `?strict=1` — nyala hanya pada `1` atau `true`.
 *
 * Ejaan lain ditolak alih-alih dianggap "tidak nyala": `?strict=yes` yang
 * diam-diam berarti mati akan membuat monitor melaporkan hijau selamanya
 * tanpa pernah memberi tahu bahwa ia sedang tidak memeriksa apa pun.
 */
export function parseStrict(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new QueryError("strict", `strict hanya menerima 1/true/0/false, bukan ${JSON.stringify(raw)}`);
}

function servingSource(sources: readonly SourceHealth[]): AgentSource {
  for (const source of SOURCE_ORDER) {
    if (sources.some((health) => health.source === source && health.healthy)) return source;
  }
  return "seed";
}

export function createHealthRoutes(deps: HealthRoutesDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get("/health", async (c) => {
    let strict: boolean;
    try {
      strict = parseStrict(c.req.query("strict"));
    } catch (err) {
      const qe = err as QueryError;
      return c.json({ error: "invalid_query", field: qe.field, message: qe.message }, 400);
    }

    try {
      const health = await deps.service.getHealth();
      const sources = health.sources.map(scrub);
      const unhealthy = sources.filter((s) => !s.healthy);

      const body: HealthResponse = {
        healthy: health.healthy,
        degraded: health.degraded,
        source: servingSource(sources),
        reason:
          unhealthy.length === 0
            ? null
            : redact(
                unhealthy
                  .map((s) => `${s.source} tidak sehat${s.reason ? `: ${s.reason}` : ""}`)
                  .join("; "),
              ),
        sources,
        checkedAt: health.checkedAt,
      };
      // Badan yang sama persis; hanya status code-nya yang berbicara kepada
      // pembaca yang tidak bisa membaca badan.
      return strict && shouldAlarm(body) ? c.json(body, 503) : c.json(body);
    } catch (err) {
      // Layanan berjanji tidak melempar; kalau ia tetap melempar, itu justru
      // fakta kesehatan yang paling penting untuk dilaporkan — bukan alasan
      // untuk ikut mati.
      const message =
        err instanceof Error ? `${err.name}: ${err.message.split("\n")[0]}` : String(err);
      const body: HealthResponse = {
        healthy: false,
        degraded: true,
        source: "seed",
        reason: redact(message),
        sources: [],
        checkedAt: now().toISOString(),
      };
      return strict ? c.json(body, 503) : c.json(body);
    }
  });

  return app;
}
