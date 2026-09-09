/**
 * `SkillSourcePort` on top of the real backend (`backend/src/routes/skills.ts`).
 *
 *   GET /api/skills?limit=&offset=&kind=&status=&q=&includeExamples=
 *   GET /api/skills/:id
 *   GET /api/auditors
 *
 * The envelope — `source`, `ageSeconds`, `stale`, `degraded`, `notice`, `trail` — is
 * passed through unchanged and never recomputed. The backend is the one that knows
 * which rung it walked, and it is the only party allowed to declare an answer
 * impossible to confirm fresh.
 *
 * The one piece of real logic here is the 404. The backend returns 404 **with a full
 * body** when it genuinely knows a skill is not there, and 200 with `healthy: false`
 * when it merely could not ask. Reading the body on a 404 is what keeps those two
 * apart on this side of the wire.
 */

import { TRUST_STATUSES, type TrustStatus } from "@/lib/skills/types";
import { failedSkillProvenance } from "@/lib/skills/provenance";
import type {
  AuditorList,
  SkillDetail,
  SkillPage,
  SkillQuery,
  SkillSourcePort,
} from "@/lib/skills/source";
import {
  parseAudit,
  parseAuditor,
  parseSkill,
  parseSkillProvenance,
} from "@/lib/skills/wire";

const TIMEOUT_MS = 8_000;

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

type Fetched = { status: number; body: unknown };

async function getJson(url: string): Promise<Fetched> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  // A 404 carries a body worth reading; every other failure does not.
  if (!res.ok && res.status !== 404) throw new Error(`${res.status} ${res.statusText}`);
  return { status: res.status, body: await res.json() };
}

function statuses(v: unknown): TrustStatus[] {
  if (!Array.isArray(v)) return [...TRUST_STATUSES];
  const found = v.filter((s): s is TrustStatus =>
    typeof s === "string" && (TRUST_STATUSES as readonly string[]).includes(s),
  );
  return found.length > 0 ? found : [...TRUST_STATUSES];
}

function census(v: unknown): Partial<Record<TrustStatus, number>> {
  const out: Partial<Record<TrustStatus, number>> = {};
  if (v === null || typeof v !== "object") return out;
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if ((TRUST_STATUSES as readonly string[]).includes(key) && typeof value === "number") {
      out[key as TrustStatus] = value;
    }
  }
  return out;
}

export function createHttpSkillSource(baseUrl: string): SkillSourcePort {
  const base = baseUrl.replace(/\/+$/, "");

  return {
    kind: "http",
    origin: base,

    async listSkills(query: SkillQuery): Promise<SkillPage> {
      const limit = query.limit ?? 24;
      const offset = query.offset ?? 0;
      const now = new Date().toISOString();
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (query.kind) params.set("kind", query.kind);
      if (query.status) params.set("status", query.status);
      if (query.q && query.q.trim() !== "") params.set("q", query.q.trim());

      try {
        const { body } = await getJson(`${base}/api/skills?${params}`);
        const o = (body ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.items)) throw new Error("response has no `items` array");
        return {
          items: o.items.map(parseSkill),
          total: typeof o.total === "number" ? o.total : o.items.length,
          limit,
          offset,
          trustCensus: census(o.trustCensus),
          statuses: statuses(o.statuses),
          provenance: parseSkillProvenance(o, now),
        };
      } catch (err) {
        return {
          items: [],
          total: 0,
          limit,
          offset,
          trustCensus: {},
          statuses: [...TRUST_STATUSES],
          provenance: failedSkillProvenance(reasonOf(err), now),
        };
      }
    },

    async getSkill(id: string): Promise<SkillDetail> {
      const now = new Date().toISOString();
      try {
        const { status, body } = await getJson(
          `${base}/api/skills/${encodeURIComponent(id)}`,
        );
        const o = (body ?? {}) as Record<string, unknown>;
        const provenance = parseSkillProvenance(o, now);
        const raw = o.skill;
        return {
          skill: raw == null ? null : parseSkill(raw),
          audits: Array.isArray(o.audits) ? o.audits.map(parseAudit) : [],
          // A 404 from this backend is a fact it has earned, not a shrug.
          notFound: status === 404 && provenance.healthy,
          provenance,
        };
      } catch (err) {
        return {
          skill: null,
          audits: [],
          notFound: false,
          provenance: failedSkillProvenance(reasonOf(err), now),
        };
      }
    },

    async listAuditors(): Promise<AuditorList> {
      const now = new Date().toISOString();
      try {
        const { body } = await getJson(`${base}/api/auditors`);
        const o = (body ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.items)) throw new Error("response has no `items` array");
        const sources: Record<string, number> = {};
        if (o.reputationSources !== null && typeof o.reputationSources === "object") {
          for (const [k, v] of Object.entries(o.reputationSources as Record<string, unknown>)) {
            if (typeof v === "number") sources[k] = v;
          }
        }
        return {
          items: o.items.map(parseAuditor),
          total: typeof o.total === "number" ? o.total : o.items.length,
          reputationSources: sources,
          provenance: parseSkillProvenance(o, now),
        };
      } catch (err) {
        return {
          items: [],
          total: 0,
          reputationSources: {},
          provenance: failedSkillProvenance(reasonOf(err), now),
        };
      }
    },
  };
}
