/**
 * The contract for the skill data layer. Pages talk to this and never to `fetch`.
 *
 * Two properties copied from the agent source and kept for the same reasons:
 *
 * 1. **It never throws to the caller.** A dead network, unfamiliar JSON, an unknown
 *    shape, all become `healthy: false` with a readable reason. A page that failed
 *    still has a shape, and the reader is told what happened instead of seeing an empty
 *    list that looks like "no skills yet".
 * 2. **Every answer knows where it came from and how old it is**, so the "these are
 *    examples" banner cannot be forgotten by a human.
 *
 * `notFound` is a third promise particular to this endpoint. The backend answers 404
 * **only when it truly knows** a skill does not exist, every level answered "not
 * there" and none of them threw. A registry that is merely sick produces a 200 with
 * `healthy: false`, never a 404 that erases a real skill. That distinction survives the
 * trip through here as a separate flag; it is not flattened into "no result".
 */

import type { SkillProvenance } from "@/lib/skills/provenance";
import type {
  AuditRecord,
  AuditorRecord,
  SkillKind,
  SkillRecord,
  TrustStatus,
} from "@/lib/skills/types";

export interface SkillQuery {
  limit?: number;
  offset?: number;
  kind?: SkillKind | null;
  status?: TrustStatus | null;
  q?: string | null;
}

export interface SkillPage {
  items: SkillRecord[];
  total: number;
  limit: number;
  offset: number;
  /** How many skills on this page hold each status. Absent statuses are absent, not 0. */
  trustCensus: Partial<Record<TrustStatus, number>>;
  /** The seven statuses, as the backend enumerates them. */
  statuses: TrustStatus[];
  provenance: SkillProvenance;
}

export interface SkillDetail {
  skill: SkillRecord | null;
  /** The full audit history, newest first, in whatever state each audit is in. */
  audits: AuditRecord[];
  /** `true` only when the backend actually knows this skill does not exist. */
  notFound: boolean;
  provenance: SkillProvenance;
}

export interface AuditorList {
  items: AuditorRecord[];
  total: number;
  reputationSources: Record<string, number>;
  provenance: SkillProvenance;
}

export interface SkillSourcePort {
  /** `"seed"` = examples inside the bundle. `"http"` = a real backend. */
  readonly kind: "seed" | "http";
  /** Where this data comes from, shown to the reader exactly as it is. */
  readonly origin: string;
  listSkills(query: SkillQuery): Promise<SkillPage>;
  getSkill(id: string): Promise<SkillDetail>;
  listAuditors(): Promise<AuditorList>;
}
