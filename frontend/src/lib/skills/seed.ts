/**
 * The bundled-example implementation of `SkillSourcePort`.
 *
 * It exists so that the marketplace is never blank when no backend is configured, and
 * it is honest about being what it is: `source: "seed"`, `degraded: true`,
 * `stale: true`, a `notice` on every page, and `example: true` on every record. The
 * banner that says so is driven by those fields, not by a human remembering to write it.
 *
 * The filtering below mirrors the backend's (`applySkillFilter` plus the route's
 * status filter) so that a URL behaves the same with and without an API. It does not
 * mirror `deriveTrust`, and must not: the status of every record here was derived by
 * the backend before it was copied, and this file only reads it.
 */

import type { SkillProvenance } from "@/lib/skills/provenance";
import {
  SEED_AUDIT_PAYLOADS,
  SEED_AUDITOR_PAYLOADS,
  SEED_FETCHED_AT,
  SEED_NOTICE,
  SEED_SKILL_PAYLOADS,
} from "@/lib/skills/seed-data";
import type {
  AuditorList,
  SkillDetail,
  SkillPage,
  SkillQuery,
  SkillSourcePort,
} from "@/lib/skills/source";
import { TRUST_STATUSES, type SkillRecord, type TrustStatus } from "@/lib/skills/types";
import { parseAudit, parseAuditor, parseSkill } from "@/lib/skills/wire";

const SKILLS: SkillRecord[] = SEED_SKILL_PAYLOADS.map(parseSkill);
const AUDITS = SEED_AUDIT_PAYLOADS.map(parseAudit);
const AUDITORS = SEED_AUDITOR_PAYLOADS.map(parseAuditor);

const NOTICE = `${SEED_NOTICE} No marketplace API is connected to this build, so this page is showing them instead of a live registry.`;

function ageSeconds(now: Date): number | null {
  const ms = Date.parse(SEED_FETCHED_AT);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((now.getTime() - ms) / 1000));
}

function provenance(now: Date): SkillProvenance {
  return {
    source: "seed",
    healthy: true,
    reason: null,
    fetchedAt: now.toISOString(),
    ageSeconds: ageSeconds(now),
    // Both true, and both meant: a copy inside the bundle cannot be confirmed fresh,
    // and it is by definition a rung below the registry.
    stale: true,
    degraded: true,
    maxAgeSeconds: 300,
    notice: NOTICE,
    trail: [
      {
        source: "registry",
        outcome: "unavailable",
        reason: "no marketplace API is configured (NEXT_PUBLIC_API_BASE_URL is unset)",
        items: 0,
      },
      {
        source: "seed",
        outcome: "ok",
        reason: SEED_NOTICE,
        items: SKILLS.length,
      },
    ],
  };
}

/** The same haystack the backend searches: id, name, description, tags, capabilities. */
function matches(skill: SkillRecord, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (q === "") return true;
  return [
    skill.id,
    skill.name,
    skill.declaredDescription,
    ...skill.tags,
    ...skill.declaredCapabilities,
  ]
    .join("\n")
    .toLowerCase()
    .includes(q);
}

export const seedSkillSource: SkillSourcePort = {
  kind: "seed",
  origin: "curated examples bundled with this build",

  async listSkills(query: SkillQuery): Promise<SkillPage> {
    const now = new Date();
    const limit = query.limit ?? 24;
    const offset = query.offset ?? 0;

    const filtered = SKILLS.filter((s) => {
      if (query.kind && s.kind !== query.kind) return false;
      if (query.status && s.trust.status !== query.status) return false;
      if (query.q && !matches(s, query.q)) return false;
      return true;
    });
    const items = filtered.slice(offset, offset + limit);

    const trustCensus: Partial<Record<TrustStatus, number>> = {};
    for (const s of items) {
      trustCensus[s.trust.status] = (trustCensus[s.trust.status] ?? 0) + 1;
    }

    return {
      items,
      total: filtered.length,
      limit,
      offset,
      trustCensus,
      statuses: [...TRUST_STATUSES],
      provenance: {
        ...provenance(now),
        notice: items.length > 0 ? NOTICE : null,
      },
    };
  },

  async getSkill(id: string): Promise<SkillDetail> {
    const now = new Date();
    const skill = SKILLS.find((s) => s.id === id) ?? null;
    const audits = AUDITS.filter((a) => a.skillId === id).sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt),
    );
    return {
      skill,
      audits,
      // Every level answered, and one of them said "not there". That is knowledge.
      notFound: skill === null,
      provenance: {
        ...provenance(now),
        notice: skill === null ? null : NOTICE,
      },
    };
  },

  async listAuditors(): Promise<AuditorList> {
    const now = new Date();
    const sources: Record<string, number> = {};
    for (const a of AUDITORS) {
      sources[a.reputation.source] = (sources[a.reputation.source] ?? 0) + 1;
    }
    return {
      items: AUDITORS,
      total: AUDITORS.length,
      reputationSources: sources,
      provenance: provenance(now),
    };
  },
};
