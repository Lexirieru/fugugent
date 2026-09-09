/**
 * The skill registry as a **port**, plus an in-memory implementation.
 *
 * Why a port rather than a `FuguDb` directly: the same reason `AgentCachePort`
 * exists. Every service test runs without Postgres, and a backend started
 * without `DATABASE_URL` must still answer — with the registry level marked
 * `unavailable`, not with a boot failure. "Not installed" and "broken" are
 * different states and this backend keeps them apart everywhere.
 *
 * ## The promises an implementation makes
 *
 * 1. **The read path never throws.** A failure comes back as
 *    `healthy: false` + `reason`, exactly like `AgentListPage`. `/api/skills`
 *    is needed most when something is wrong.
 * 2. **The write path throws on purpose.** A registration that did not persist
 *    must be visible to its caller — a silent success is how a marketplace
 *    quietly loses a listing. The service turns it into an honest failure
 *    envelope; it never swallows it.
 * 3. **Nothing is invented on read.** A row that cannot be turned into a valid
 *    record is skipped and counted, never patched up with defaults. A skill
 *    with a fabricated digest would take its audit's verdict with it.
 */

import type {
  AuditRecord,
  AuditorRecord,
  SkillKind,
  SkillRecord,
  SkillSource,
} from "./types.js";

/** Filter for a skill listing. Every field is optional. */
export interface SkillFilter {
  kind?: SkillKind;
  /** Case-insensitive match against name, id, description and tags. */
  search?: string;
  /** `false` hides the curated examples; `undefined` shows everything. */
  includeExamples?: boolean;
  limit?: number;
  offset?: number;
}

/** A page of skills with its provenance — the same envelope shape as `AgentListPage`. */
export interface SkillStorePage {
  items: SkillRecord[];
  total: number;
  limit: number;
  offset: number;
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  /** Age of the oldest item, seconds. `null` when the page is empty. */
  ageSeconds: number | null;
  /** Rows that could not be turned into a record. Reported, never hidden. */
  skipped: number;
}

export interface SkillStoreDetail {
  skill: SkillRecord | null;
  audits: AuditRecord[];
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
}

export interface AuditorStoreResult {
  items: AuditorRecord[];
  total: number;
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  skipped: number;
}

export interface SkillStorePort {
  listSkills(filter: SkillFilter, now: Date): Promise<SkillStorePage>;
  getSkill(id: string, now: Date): Promise<SkillStoreDetail>;
  listAuditors(now: Date): Promise<AuditorStoreResult>;
  /** Persist a skill. **Throws** when the infrastructure fails — see promise 2. */
  putSkill(skill: SkillRecord): Promise<void>;
  /** Persist an audit. **Throws** when the infrastructure fails. */
  putAudit(audit: AuditRecord): Promise<void>;
  /** Persist an auditor. **Throws** when the infrastructure fails. */
  putAuditor(auditor: AuditorRecord): Promise<void>;
}

export const DEFAULT_SKILL_LIMIT = 20;
export const MAX_SKILL_LIMIT = 100;

export function clampSkillLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SKILL_LIMIT;
  return Math.min(MAX_SKILL_LIMIT, Math.max(1, Math.trunc(limit)));
}

export function clampSkillOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

/** Age in seconds of the oldest `fetchedAt` in a set. `null` when the set is empty. */
export function oldestAgeSeconds(
  records: readonly { fetchedAt: string }[],
  now: Date,
): number | null {
  let oldest: number | null = null;
  for (const record of records) {
    const parsed = Date.parse(record.fetchedAt);
    // An unparseable timestamp is not treated as age zero: that would report
    // broken data as the freshest thing on the page.
    if (Number.isNaN(parsed)) continue;
    const age = Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
    if (oldest === null || age > oldest) oldest = age;
  }
  return oldest;
}

/** Case-insensitive haystack for {@link SkillFilter.search}. */
export function matchesSearch(skill: SkillRecord, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  const haystack = [
    skill.id,
    skill.name,
    skill.declaredDescription,
    ...skill.tags,
    ...skill.declaredCapabilities,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

export function applySkillFilter(
  all: readonly SkillRecord[],
  filter: SkillFilter,
): SkillRecord[] {
  return all.filter((skill) => {
    if (filter.kind !== undefined && skill.kind !== filter.kind) return false;
    if (filter.includeExamples === false && skill.example) return false;
    if (filter.search !== undefined && !matchesSearch(skill, filter.search)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// The in-memory store
// ---------------------------------------------------------------------------

export interface MemorySkillStoreOptions {
  skills?: readonly SkillRecord[];
  audits?: readonly AuditRecord[];
  auditors?: readonly AuditorRecord[];
  /** Made to fail on demand, so the service's failure path is testable. */
  failWith?: string;
}

/**
 * An in-memory registry.
 *
 * Used by a backend started without `DATABASE_URL` — a registration then lives
 * for the life of the process, which is honest and stated in the response
 * (`durable: false`) rather than quietly pretending to be storage.
 */
export function createMemorySkillStore(
  options: MemorySkillStoreOptions = {},
): SkillStorePort & { durable: false } {
  const skills = new Map<string, SkillRecord>();
  const audits = new Map<string, AuditRecord>();
  const auditors = new Map<string, AuditorRecord>();

  for (const skill of options.skills ?? []) skills.set(skill.id, skill);
  for (const audit of options.audits ?? []) audits.set(audit.id, audit);
  for (const auditor of options.auditors ?? []) auditors.set(auditor.id, auditor);

  function fail(): never {
    throw new Error(options.failWith);
  }

  return {
    durable: false,

    async listSkills(filter: SkillFilter, now: Date): Promise<SkillStorePage> {
      const limit = clampSkillLimit(filter.limit);
      const offset = clampSkillOffset(filter.offset);
      const fetchedAt = now.toISOString();
      if (options.failWith !== undefined) {
        return {
          items: [],
          total: 0,
          limit,
          offset,
          source: "registry",
          healthy: false,
          reason: options.failWith,
          fetchedAt,
          ageSeconds: null,
          skipped: 0,
        };
      }
      const matching = applySkillFilter([...skills.values()], filter);
      const items = matching.slice(offset, offset + limit);
      return {
        items,
        total: matching.length,
        limit,
        offset,
        source: "registry",
        healthy: true,
        reason: null,
        fetchedAt,
        ageSeconds: oldestAgeSeconds(items, now),
        skipped: 0,
      };
    },

    async getSkill(id: string, now: Date): Promise<SkillStoreDetail> {
      const fetchedAt = now.toISOString();
      if (options.failWith !== undefined) {
        return {
          skill: null,
          audits: [],
          source: "registry",
          healthy: false,
          reason: options.failWith,
          fetchedAt,
          ageSeconds: null,
        };
      }
      const skill = skills.get(id) ?? null;
      const forSkill = [...audits.values()].filter((a) => a.skillId === id);
      return {
        skill,
        audits: forSkill,
        source: "registry",
        healthy: true,
        // A healthy store saying "not there" is an answer, not a failure — the
        // reason explains, `healthy` stays true.
        reason: skill === null ? `skill ${id} is not in the registry` : null,
        fetchedAt,
        ageSeconds: skill === null ? null : oldestAgeSeconds([skill], now),
      };
    },

    async listAuditors(now: Date): Promise<AuditorStoreResult> {
      const fetchedAt = now.toISOString();
      if (options.failWith !== undefined) {
        return {
          items: [],
          total: 0,
          source: "registry",
          healthy: false,
          reason: options.failWith,
          fetchedAt,
          ageSeconds: null,
          skipped: 0,
        };
      }
      const items = [...auditors.values()];
      return {
        items,
        total: items.length,
        source: "registry",
        healthy: true,
        reason: null,
        fetchedAt,
        ageSeconds: oldestAgeSeconds(items, now),
        skipped: 0,
      };
    },

    async putSkill(skill: SkillRecord): Promise<void> {
      if (options.failWith !== undefined) fail();
      skills.set(skill.id, skill);
    },

    async putAudit(audit: AuditRecord): Promise<void> {
      if (options.failWith !== undefined) fail();
      audits.set(audit.id, audit);
    },

    async putAuditor(auditor: AuditorRecord): Promise<void> {
      if (options.failWith !== undefined) fail();
      auditors.set(auditor.id, auditor);
    },
  };
}
