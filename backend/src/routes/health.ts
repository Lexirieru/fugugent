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
 * Status HTTP-nya selalu 200, bahkan saat `healthy: false`. Kesehatan ada di
 * badan respons; menjadikannya 503 hanya membuat klien membuang isinya persis
 * ketika isinya adalah informasi yang dicari.
 */
import { Hono } from "hono";
import { redact, type AgentService } from "../service/agents.js";
import type { AgentSource, SourceHealth } from "../types.js";

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
    try {
      const health = await deps.service.getHealth();
      const sources = health.sources.map(scrub);
      const unhealthy = sources.filter((s) => !s.healthy);

      return c.json({
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
      } satisfies HealthResponse);
    } catch (err) {
      // Layanan berjanji tidak melempar; kalau ia tetap melempar, itu justru
      // fakta kesehatan yang paling penting untuk dilaporkan — bukan alasan
      // untuk ikut mati.
      const message =
        err instanceof Error ? `${err.name}: ${err.message.split("\n")[0]}` : String(err);
      return c.json({
        healthy: false,
        degraded: true,
        source: "seed" as AgentSource,
        reason: redact(message),
        sources: [],
        checkedAt: now().toISOString(),
      } satisfies HealthResponse);
    }
  });

  return app;
}
