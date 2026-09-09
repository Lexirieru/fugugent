/**
 * Where a skill answer came from, in the skill ladder's own vocabulary.
 *
 * The agent ladder has four rungs (8004scan → cache → on-chain → seed); the skill
 * ladder has two, because there is no third-party discovery API for audited skills —
 * the registry *is* the source of truth:
 *
 *   1. `registry` — Postgres, first-party, authoritative
 *   2. `seed`     — curated examples, so the marketplace is never blank
 *
 * Two rungs, not four, is why this file exists rather than reusing
 * `lib/provenance.ts` wholesale: pushing `registry` through an `AgentSource` union
 * would mean labelling it as something it is not. The *functions* are shared —
 * `formatAge`, `formatUtc` and `outcomeLabel` are imported from there, not copied.
 */

import { type TrailOutcome } from "@/lib/provenance";

export type SkillSource = "registry" | "seed";

export function isSkillSource(v: unknown): v is SkillSource {
  return v === "registry" || v === "seed";
}

export interface SkillTrailStep {
  source: SkillSource;
  outcome: TrailOutcome | string;
  reason: string | null;
  items: number | null;
}

export interface SkillProvenance {
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  /** "Cannot be confirmed fresh" — the backend's decision, not our arithmetic. */
  stale: boolean;
  /** The answer came from below the registry. */
  degraded: boolean;
  maxAgeSeconds: number | null;
  /** Present only when the answer contains curated examples. */
  notice: string | null;
  trail: SkillTrailStep[];
}

export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = {
  registry: "the skill registry",
  seed: "bundled examples",
};

export const SKILL_SOURCE_MEANING: Record<SkillSource, string> = {
  registry: "Our first-party registry — the authoritative record of what has been listed.",
  seed:
    "Curated examples shipped with the build so that this page is never blank. They are marked as examples on every card, and none of them is installable.",
};

/** How loudly the provenance row has to speak. Same three weights as the agent one. */
export type ProvenanceWeight = "quiet" | "attention" | "failure";

export function skillWeightOf(p: SkillProvenance): ProvenanceWeight {
  if (!p.healthy) return "failure";
  if (p.source === "seed") return "attention";
  if (p.stale || p.degraded) return "attention";
  return "quiet";
}

export function failedSkillProvenance(reason: string, fetchedAt: string): SkillProvenance {
  return {
    source: "registry",
    healthy: false,
    reason,
    fetchedAt,
    ageSeconds: null,
    stale: true,
    degraded: true,
    maxAgeSeconds: null,
    notice: null,
    trail: [],
  };
}
