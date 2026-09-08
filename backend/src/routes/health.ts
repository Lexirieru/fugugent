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
 * - **`?strict=1`: 503 ketika `degraded`.** Pembacanya adalah uptime monitor,
 *   liveness probe, dan `curl -f` — yang hanya melihat status code dan tidak
 *   bisa membaca apa pun. Tanpa mode ini tidak ada satu jalur otomatis pun
 *   yang bisa tahu kami sedang berjalan dari jaring pengaman, dan "ketahanan
 *   yang bisa diperiksa" berhenti pada mata manusia. Badannya tetap lengkap
 *   dan identik.
 *
 * `strict` sengaja dikaitkan pada `degraded` (8004scan tidak sehat), bukan pada
 * `healthy`: `healthy` tingkat atas dihitung di `service/agents.ts` dan di sana
 * `seed` selalu disisipkan sehat, sehingga ia praktis konstan. Selama itu belum
 * berubah, `degraded` adalah satu-satunya field tingkat atas yang benar-benar
 * bergerak. Rute ini sengaja **tidak** menghitung ulang `healthy` sendiri —
 * dua definisi yang bersaing untuk satu nama field lebih buruk daripada satu
 * definisi yang sedang diperbaiki di tempatnya.
 */
import { Hono } from "hono";
import { redact, type AgentService } from "../service/agents.js";
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
  sources: SourceHealth[];
  checkedAt: string;
}

function scrub(health: SourceHealth): SourceHealth {
  return { ...health, reason: health.reason === null ? null : redact(health.reason) };
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
      return strict && body.degraded ? c.json(body, 503) : c.json(body);
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
