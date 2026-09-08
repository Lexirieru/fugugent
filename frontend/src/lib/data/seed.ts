/**
 * Implementasi `MarketplaceSource` di atas data contoh yang dibundel.
 *
 * Tidak pernah gagal, dan selalu mengaku apa adanya: `source: "seed"` dengan
 * `degraded: true`, karena seed memang tingkat paling bawah tangga jatuh —
 * lantai terakhir sebelum halaman kosong, bukan sumber utama yang sehat.
 *
 * `ageSeconds: null` bukan kelalaian. Data ini ikut ke dalam bundel saat build,
 * jadi umurnya adalah umur build, bukan umur pembacaan; melaporkan angka detik
 * di sini justru akan mengarang kesegaran yang tidak ada.
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
