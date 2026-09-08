/**
 * Implementasi `MarketplaceSource` di atas backend sungguhan.
 *
 * Endpoint yang disepakati (`backend/src/routes/agents.ts`):
 *   GET /api/agents?category=&limit=&offset=
 *   GET /api/agents/:id
 *   GET /api/categories
 *   GET /api/health
 *
 * **Tidak pernah melempar.** Setiap kegagalan — jaringan mati, JSON asing, bentuk
 * yang tidak dikenali — menjadi `healthy: false` dengan alasan yang bisa dibaca.
 * Halaman yang gagal tetap punya bentuk, dan pengguna diberi tahu apa yang terjadi
 * alih-alih melihat daftar kosong yang menyamar sebagai "belum ada agent".
 *
 * Amplop backend membawa `source`, `ageSeconds`, `stale`, `degraded`, dan `trail`.
 * Kelimanya diteruskan apa adanya ke `Provenance` dan **tidak** dihitung ulang:
 * backend yang tahu tangga mana yang benar-benar ditempuh, dan hanya ia yang
 * boleh menyatakan sebuah jawaban tidak bisa dipastikan segar.
 */

import type { AgentSource, SourceHealth } from "@/lib/agent-types";
import { isCategory } from "@/lib/agents";
import type {
  AgentDetailView,
  AgentView,
  CategoryCount,
  CategoryListResult,
  ListQuery,
  MarketplacePage,
  MarketplaceSource,
} from "@/lib/data/types";
import { parseAgentRecord } from "@/lib/data/wire";
import type { Provenance, TrailStep } from "@/lib/provenance";

const TIMEOUT_MS = 8_000;

const SOURCES: AgentSource[] = ["scan8004", "cache", "onchain", "seed"];

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown error";
}

function asSource(v: unknown, fallback: AgentSource): AgentSource {
  return SOURCES.includes(v as AgentSource) ? (v as AgentSource) : fallback;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseTrail(v: unknown): TrailStep[] {
  if (!Array.isArray(v)) return [];
  return v.map((row) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      source: asSource(o.source, "cache"),
      outcome: typeof o.outcome === "string" ? o.outcome : "unknown",
      reason: typeof o.reason === "string" ? o.reason : null,
      items: numberOrNull(o.items),
    };
  });
}

/** Amplop -> `Provenance`. Satu tempat, dipakai daftar, detail, dan kategori. */
function parseProvenance(o: Record<string, unknown>, now: string): Provenance {
  return {
    source: asSource(o.source, "cache"),
    healthy: o.healthy !== false,
    reason: typeof o.reason === "string" ? o.reason : null,
    fetchedAt: typeof o.fetchedAt === "string" ? o.fetchedAt : now,
    ageSeconds: numberOrNull(o.ageSeconds),
    stale: o.stale === true,
    degraded: o.degraded === true,
    maxAgeSeconds: numberOrNull(o.maxAgeSeconds),
    trail: parseTrail(o.trail),
  };
}

function failedProvenance(reason: string, now: string): Provenance {
  return {
    source: "cache",
    healthy: false,
    reason,
    fetchedAt: now,
    ageSeconds: null,
    stale: true,
    degraded: true,
    maxAgeSeconds: null,
    trail: [],
  };
}

/**
 * Record dari backend belum membawa risiko, izin sesi, atau bukti — bentuk
 * `AgentRecord` memang belum memuatnya. Kolom itu dibiarkan kosong, yang membuat
 * fugu digambar berlubang: tidak ada bacaan segar, jadi tidak ada tingkat yang
 * ditebak. Begitu backend menyajikannya, hanya fungsi ini yang berubah.
 */
function toView(record: ReturnType<typeof parseAgentRecord>): AgentView {
  return { record, risk: null, session: null, proofs: [], notShipped: null, outcomes: [] };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function createHttpSource(baseUrl: string): MarketplaceSource {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    kind: "http",
    origin: base,

    async listAgents(query: ListQuery): Promise<MarketplacePage> {
      const limit = query.limit ?? 24;
      const offset = query.offset ?? 0;
      const now = new Date().toISOString();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (query.category) params.set("category", query.category);

      try {
        const body = await getJson(`${base}/api/agents?${params}`);
        const o = body as Record<string, unknown>;
        if (!Array.isArray(o.items)) throw new Error("response has no `items` array");
        return {
          agents: o.items.map((item, i) => toView(parseAgentRecord(item, `items[${i}]`))),
          total: typeof o.total === "number" ? o.total : o.items.length,
          limit,
          offset,
          provenance: parseProvenance(o, now),
        };
      } catch (err) {
        return {
          agents: [],
          total: 0,
          limit,
          offset,
          provenance: failedProvenance(reasonOf(err), now),
        };
      }
    },

    async getAgent(id: string): Promise<AgentDetailView> {
      const now = new Date().toISOString();
      try {
        const body = await getJson(`${base}/api/agents/${encodeURIComponent(id)}`);
        const o = body as Record<string, unknown>;
        const raw = "agent" in o ? o.agent : o;
        return {
          agent: raw == null ? null : toView(parseAgentRecord(raw)),
          provenance: parseProvenance(o, now),
        };
      } catch (err) {
        return { agent: null, provenance: failedProvenance(reasonOf(err), now) };
      }
    },

    async listCategories(): Promise<CategoryListResult> {
      const now = new Date().toISOString();
      try {
        const body = await getJson(`${base}/api/categories`);
        const o = (Array.isArray(body) ? {} : body) as Record<string, unknown>;
        const rows = Array.isArray(body) ? body : ((o.categories as unknown[]) ?? []);
        const categories: CategoryCount[] = [];
        for (const row of rows) {
          const r = row as Record<string, unknown>;
          if (isCategory(r.category as string)) {
            categories.push({
              category: r.category as CategoryCount["category"],
              count: typeof r.count === "number" ? r.count : 0,
            });
          }
        }
        return { categories, provenance: parseProvenance(o, now) };
      } catch (err) {
        return { categories: [], provenance: failedProvenance(reasonOf(err), now) };
      }
    },

    async health(): Promise<SourceHealth> {
      const checkedAt = new Date().toISOString();
      try {
        const body = (await getJson(`${base}/api/health`)) as Record<string, unknown>;
        return {
          source: asSource(body.source, "cache"),
          healthy: body.healthy !== false,
          reason: typeof body.reason === "string" ? body.reason : null,
          checkedAt,
        };
      } catch (err) {
        return { source: "cache", healthy: false, reason: reasonOf(err), checkedAt };
      }
    },
  };
}
