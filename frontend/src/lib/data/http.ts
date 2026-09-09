/**
 * The `MarketplaceSource` implementation on top of a real backend.
 *
 * The agreed endpoints (`backend/src/routes/agents.ts`):
 *   GET /api/agents?category=&limit=&offset=
 *   GET /api/agents/:id
 *   GET /api/categories
 *   GET /api/health
 *
 * **It never throws.** Every failure, a dead network, unfamiliar JSON, a shape we do
 * not recognise, becomes `healthy: false` with a readable reason. A page that failed
 * still has a shape, and the user is told what happened instead of seeing an empty list
 * masquerading as "no agents yet".
 *
 * The backend envelope carries `source`, `ageSeconds`, `stale`, `degraded`, and
 * `trail`. All five are passed through to `Provenance` unchanged and are **not**
 * recomputed: the backend is the one that knows which rung it actually walked, and it is
 * the only one allowed to declare an answer impossible to confirm fresh.
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

/** Envelope -> `Provenance`. One place, used by the list, the detail, and the categories. */
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
 * A record from the backend carries no live risk reading and no session permissions,
 * so those stay null and the fugu draws hollow: no fresh reading, so no guessed level.
 *
 * What it does carry is whatever the listing owner published on chain. `proof` and
 * `limits` were being dropped here, and that was not a gap in the shape but a defect
 * with a visible symptom: the registration script writes an evidence paragraph with
 * transaction hashes into every listing, and this page answered "Nothing to show,
 * because it has not run" for an agent whose proof had been on chain the whole time.
 *
 * Both are presented as claims by the listing owner, because that is exactly what they
 * are. We did not verify them; we read them off the listing. The wording on screen has
 * to keep saying so.
 */
function toView(record: ReturnType<typeof parseAgentRecord>): AgentView {
  const meta = record.listingMetadata;
  return {
    record,
    risk: null,
    session: null,
    proofs: [],
    notShipped: meta?.limits ?? null,
    outcomes: meta?.proof ? [meta.proof] : [],
  };
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
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
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
        return {
          agent: null,
          provenance: failedProvenance(reasonOf(err), now),
        };
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
        return {
          categories: [],
          provenance: failedProvenance(reasonOf(err), now),
        };
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
        return {
          source: "cache",
          healthy: false,
          reason: reasonOf(err),
          checkedAt,
        };
      }
    },
  };
}
