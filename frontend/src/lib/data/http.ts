/**
 * Implementasi `MarketplaceSource` di atas backend sungguhan.
 *
 * Endpoint yang disepakati (`docs/plans/`, `backend/src/types.ts`):
 *   GET /api/agents?category=&limit=&offset=
 *   GET /api/agents/:id
 *   GET /api/categories
 *   GET /api/health
 *
 * Hari ini tidak ada yang menjawabnya. Berkas ini tetap ditulis lengkap supaya
 * menukar sumber nanti berarti mengisi satu variabel lingkungan, bukan menyentuh
 * satu pun komponen.
 *
 * **Tidak pernah melempar.** Setiap kegagalan — jaringan mati, JSON asing, bentuk
 * yang tidak dikenali — menjadi `healthy: false` dengan alasan yang bisa dibaca.
 * Halaman yang gagal tetap punya bentuk, dan pengguna diberi tahu apa yang terjadi
 * alih-alih melihat daftar kosong yang menyamar sebagai "belum ada agent".
 */

import type { SourceHealth } from "@/lib/agent-types";
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

const TIMEOUT_MS = 8_000;

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown error";
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
          source: (o.source as MarketplacePage["source"]) ?? "cache",
          healthy: o.healthy !== false,
          reason: typeof o.reason === "string" ? o.reason : null,
          fetchedAt: typeof o.fetchedAt === "string" ? o.fetchedAt : now,
        };
      } catch (err) {
        return {
          agents: [],
          total: 0,
          limit,
          offset,
          source: "cache",
          healthy: false,
          reason: reasonOf(err),
          fetchedAt: now,
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
          source: (o.source as AgentDetailView["source"]) ?? "cache",
          healthy: o.healthy !== false,
          reason: typeof o.reason === "string" ? o.reason : null,
          fetchedAt: typeof o.fetchedAt === "string" ? o.fetchedAt : now,
        };
      } catch (err) {
        return { agent: null, source: "cache", healthy: false, reason: reasonOf(err), fetchedAt: now };
      }
    },

    async listCategories(): Promise<CategoryListResult> {
      try {
        const body = await getJson(`${base}/api/categories`);
        const rows = Array.isArray(body)
          ? body
          : ((body as Record<string, unknown>).categories as unknown[]) ?? [];
        const categories: CategoryCount[] = [];
        for (const row of rows) {
          const o = row as Record<string, unknown>;
          if (isCategory(o.category as string)) {
            categories.push({
              category: o.category as CategoryCount["category"],
              count: typeof o.count === "number" ? o.count : 0,
            });
          }
        }
        return { categories, healthy: true, reason: null };
      } catch (err) {
        return { categories: [], healthy: false, reason: reasonOf(err) };
      }
    },

    async health(): Promise<SourceHealth> {
      const checkedAt = new Date().toISOString();
      try {
        const body = (await getJson(`${base}/api/health`)) as Record<string, unknown>;
        return {
          source: (body.source as SourceHealth["source"]) ?? "cache",
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
