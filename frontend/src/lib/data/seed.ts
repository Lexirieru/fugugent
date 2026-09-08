/**
 * The `MarketplaceSource` implementation on top of the bundled sample data.
 *
 * It never fails, and it always admits what it is: `source: "seed"` with
 * `degraded: true`, because the seed really is the bottom rung of the fallback ladder —
 * the last floor before an empty page, not a healthy primary source.
 *
 * `ageSeconds: null` is not an oversight. This data goes into the bundle at build time,
 * so its age is the age of the build and not the age of a reading; reporting a number of
 * seconds here would invent a freshness that does not exist.
 */

import type { SourceHealth } from "@/lib/agent-types";
import { CATEGORY_ORDER, categoryOf } from "@/lib/agents";
import { SEED_AGENTS, SEED_FETCHED_AT } from "@/lib/data/sample";
import type {
  AgentDetailView,
  CategoryListResult,
  ListQuery,
  MarketplacePage,
  MarketplaceSource,
} from "@/lib/data/types";
import type { Provenance } from "@/lib/provenance";

const SEED_PROVENANCE: Provenance = {
  source: "seed",
  healthy: true,
  reason: "bundled with this build; no marketplace API is configured",
  fetchedAt: SEED_FETCHED_AT,
  ageSeconds: null,
  stale: false,
  degraded: true,
  maxAgeSeconds: null,
  trail: [{ source: "seed", outcome: "ok", reason: null, items: SEED_AGENTS.length }],
};

export const seedSource: MarketplaceSource = {
  kind: "seed",
  origin: "sample data bundled with this build",

  async listAgents(query: ListQuery): Promise<MarketplacePage> {
    const limit = query.limit ?? 24;
    const offset = query.offset ?? 0;
    const matching = query.category
      ? SEED_AGENTS.filter((a) => categoryOf(a.record) === query.category)
      : SEED_AGENTS;
    return {
      agents: matching.slice(offset, offset + limit),
      total: matching.length,
      limit,
      offset,
      provenance: { ...SEED_PROVENANCE, trail: [{ ...SEED_PROVENANCE.trail[0], items: matching.length }] },
    };
  },

  async getAgent(id: string): Promise<AgentDetailView> {
    const agent = SEED_AGENTS.find((a) => a.record.id === id) ?? null;
    return {
      agent,
      provenance: { ...SEED_PROVENANCE, trail: [{ ...SEED_PROVENANCE.trail[0], items: agent ? 1 : 0 }] },
    };
  },

  async listCategories(): Promise<CategoryListResult> {
    return {
      categories: CATEGORY_ORDER.map((category) => ({
        category,
        count: SEED_AGENTS.filter((a) => categoryOf(a.record) === category).length,
      })),
      provenance: SEED_PROVENANCE,
    };
  },

  async health(): Promise<SourceHealth> {
    return { source: "seed", healthy: true, reason: null, checkedAt: SEED_FETCHED_AT };
  },
};
