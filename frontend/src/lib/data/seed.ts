/**
 * Implementasi `MarketplaceSource` di atas data contoh yang dibundel.
 * Tidak pernah gagal, dan selalu mengaku `source: "seed"` supaya UI bisa
 * memasang spanduk kejujuran tanpa ada yang perlu mengingatnya.
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
      source: "seed",
      healthy: true,
      reason: null,
      fetchedAt: SEED_FETCHED_AT,
    };
  },

  async getAgent(id: string): Promise<AgentDetailView> {
    const agent = SEED_AGENTS.find((a) => a.record.id === id) ?? null;
    return {
      agent,
      source: "seed",
      healthy: true,
      reason: null,
      fetchedAt: SEED_FETCHED_AT,
    };
  },

  async listCategories(): Promise<CategoryListResult> {
    return {
      categories: CATEGORY_ORDER.map((category) => ({
        category,
        count: SEED_AGENTS.filter((a) => categoryOf(a.record) === category).length,
      })),
      healthy: true,
      reason: null,
    };
  },

  async health(): Promise<SourceHealth> {
    return {
      source: "seed",
      healthy: true,
      reason: null,
      checkedAt: SEED_FETCHED_AT,
    };
  },
};
