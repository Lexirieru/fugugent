/**
 * The audited-skill marketplace service — the tiered fallback for skills.
 *
 * ```
 * 1. registry (Postgres)  → source: "registry"  (first-party, authoritative)
 * 2. curated examples     → source: "seed"      (its real age is reported too)
 * ```
 *
 * Shorter than the agent ladder because it has to be: unlike agents, there is no
 * third-party discovery API for audited skills — the registry *is* the source of
 * truth. What the second level buys is that the marketplace is never blank, and
 * it buys it without ever pretending an example is a listing.
 *
 * ## The promises
 *
 * 1. **Never throws to the caller.** Every level is wrapped, and a level that
 *    breaks its own promise is recorded as `threw` in `trail` rather than
 *    escaping. The read endpoints answer with honest empties.
 * 2. **Provenance travels with every answer** — `source`, `ageSeconds`,
 *    `stale`, `degraded`, `itemSources`, `trail`, exactly as
 *    `src/service/agents.ts` does, so a client written against one is not
 *    surprised by the other.
 * 3. **The trust status is derived here and nowhere else**, from the audits
 *    actually held. There is no path by which a stored field can make a skill
 *    look verified.
 * 4. **Examples are always marked.** Any response that contains a seeded record
 *    carries `notice` and every such record carries `example: true`.
 * 5. **A write that did not persist is reported as a failure**, never as a
 *    success. `registerSkill` returns `stored: false` with a reason; it does not
 *    throw, and it does not lie.
 */

import { CHAIN_ID } from "../config.js";
import { redact } from "../service/agents.js";
import {
  normalizeSkillSubmission,
  type NormalizeSkillContext,
} from "./normalize.js";
import { attachReputation, type AuditorReputationSource } from "./reputation.js";
import { SKILL_SEED_AT, SKILL_SEED_NOTICE, seedAudits, seedAuditors, seedSkills } from "./seed.js";
import {
  applySkillFilter,
  clampSkillLimit,
  clampSkillOffset,
  oldestAgeSeconds,
  type SkillFilter,
  type SkillStorePort,
} from "./store.js";
import {
  AUDIT_STATUSES,
  deriveTrust,
  type AuditRecord,
  type AuditStatus,
  type AuditorRecord,
  type SkillRecord,
  type SkillSource,
  type SkillWithTrust,
} from "./types.js";

/** Above this age a result is flagged `stale`. It never filters anything out. */
export const SKILL_MAX_AGE_SECONDS = 300;

/** How one level of the skill ladder ended. Same vocabulary as the agent trail. */
export type SkillFallbackOutcome = "ok" | "empty" | "unhealthy" | "threw" | "unavailable";

export interface SkillFallbackAttempt {
  source: SkillSource;
  outcome: SkillFallbackOutcome;
  /** Already redacted of credentials. `null` when there is nothing to explain. */
  reason: string | null;
  items: number;
}

/**
 * Levels that **never got to answer**, as opposed to answering "not there".
 *
 * `empty` is deliberately excluded: a healthy registry saying a skill is not in
 * it is an answer. The other three mean there is a place we could not ask, which
 * is what stops `/api/skills/:id` from returning a 404 it has not earned.
 */
export const SKILL_UNCERTAIN_OUTCOMES: readonly SkillFallbackOutcome[] = [
  "threw",
  "unhealthy",
  "unavailable",
];

export function skillTrailIsUncertain(trail: readonly SkillFallbackAttempt[]): boolean {
  return trail.some((attempt) => SKILL_UNCERTAIN_OUTCOMES.includes(attempt.outcome));
}

/** How many skills on a page hold each audit status. */
export type TrustCensus = Partial<Record<AuditStatus, number>>;

export interface SkillServicePage {
  items: SkillWithTrust[];
  total: number;
  limit: number;
  offset: number;
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  /** `true` when the answer did not come from the registry. */
  degraded: boolean;
  maxAgeSeconds: number;
  itemSources: Partial<Record<SkillSource, number>>;
  /** Audit-status census of the items in *this* response. */
  trustCensus: TrustCensus;
  /** Present only when this response contains curated examples. */
  notice: string | null;
  trail: SkillFallbackAttempt[];
}

export interface SkillServiceDetail {
  skill: SkillWithTrust | null;
  /** Full audit history, newest first. Empty when there is none. */
  audits: AuditRecord[];
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  notice: string | null;
  trail: SkillFallbackAttempt[];
}

export interface AuditorServiceList {
  items: AuditorRecord[];
  total: number;
  source: SkillSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  ageSeconds: number | null;
  stale: boolean;
  degraded: boolean;
  maxAgeSeconds: number;
  /**
   * Where the reputation numbers on this page came from, counted.
   *
   * A client can tell at a glance whether it is looking at chain-backed
   * reputation or at rows whose reputation we could not read — without having to
   * inspect every item.
   */
  reputationSources: Partial<Record<"onchain" | "unavailable" | "unhealthy", number>>;
  notice: string | null;
  trail: SkillFallbackAttempt[];
}

/** The result of a registration attempt. Never an exception. */
export interface RegisterSkillResult {
  ok: boolean;
  /** `true` only when the record actually reached storage. */
  stored: boolean;
  /**
   * `false` when the store is in-process memory — the registration is real for
   * this process and will not survive a restart. Stated rather than implied.
   */
  durable: boolean;
  skill: SkillWithTrust | null;
  /** Set when the submission itself was wrong — a 400, not a failure of ours. */
  invalid: { field: string; message: string } | null;
  reason: string | null;
  fetchedAt: string;
}

export interface SkillServiceDeps {
  /** Level 1. Without it the level is `unavailable`, not failed. */
  store?: SkillStorePort & { durable?: boolean };
  /** Level 2. Defaults to the built-in curated examples. */
  seed?: {
    skills: () => SkillRecord[];
    audits: () => AuditRecord[];
    auditors: () => AuditorRecord[];
  };
  /** Optional on-chain reputation reader; absent means `unavailable`. */
  reputation?: AuditorReputationSource;
  now?: () => Date;
  chainId?: number;
  maxAgeSeconds?: number;
}

export interface SkillService {
  listSkills(filter: SkillFilter): Promise<SkillServicePage>;
  getSkill(id: string): Promise<SkillServiceDetail>;
  listAuditors(): Promise<AuditorServiceList>;
  registerSkill(body: unknown): Promise<RegisterSkillResult>;
}

function describeThrow(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = err.message.split("\n")[0] ?? err.message;
    return redact(`${err.name}: ${firstLine}`);
  }
  return redact(`unknown failure: ${String(err)}`);
}

function censusOfSources(
  items: readonly { source: SkillSource }[],
): Partial<Record<SkillSource, number>> {
  const census: Partial<Record<SkillSource, number>> = {};
  for (const item of items) census[item.source] = (census[item.source] ?? 0) + 1;
  return census;
}

/**
 * The audit-status census.
 *
 * Every status present is counted; statuses with zero are left out rather than
 * written as `0`, so "not on this page" and "counted as none" stay distinct —
 * the same reason `unreadableMetadata` is left absent in the agent overlay
 * report.
 */
export function censusOfTrust(items: readonly SkillWithTrust[]): TrustCensus {
  const census: TrustCensus = {};
  for (const item of items) {
    census[item.trust.status] = (census[item.trust.status] ?? 0) + 1;
  }
  return census;
}

/** All seven statuses, so a client can build a filter without hard-coding them. */
export const ALL_AUDIT_STATUSES = AUDIT_STATUSES;

function noticeFor(items: readonly { example: boolean }[]): string | null {
  return items.some((item) => item.example) ? SKILL_SEED_NOTICE : null;
}

export function createSkillService(deps: SkillServiceDeps): SkillService {
  const now = deps.now ?? (() => new Date());
  const chainId = deps.chainId ?? CHAIN_ID;
  const maxAgeSeconds = deps.maxAgeSeconds ?? SKILL_MAX_AGE_SECONDS;
  const seed = deps.seed ?? {
    skills: seedSkills,
    audits: seedAudits,
    auditors: seedAuditors,
  };

  /** Build a `SkillWithTrust` — the only place `deriveTrust` is called. */
  function withTrust(skill: SkillRecord, audits: readonly AuditRecord[]): SkillWithTrust {
    return { ...skill, trust: deriveTrust(skill, audits.filter((a) => a.skillId === skill.id)) };
  }

  function stale(ageSeconds: number | null, source: SkillSource): boolean {
    if (source !== "registry") return true;
    return ageSeconds !== null && ageSeconds > maxAgeSeconds;
  }

  async function listFromSeed(
    filter: SkillFilter,
    at: Date,
    trail: SkillFallbackAttempt[],
  ): Promise<SkillServicePage> {
    const limit = clampSkillLimit(filter.limit);
    const offset = clampSkillOffset(filter.offset);
    const fetchedAt = at.toISOString();
    try {
      const audits = seed.audits();
      const matching = applySkillFilter(seed.skills(), filter);
      const page = matching.slice(offset, offset + limit);
      const items = page.map((skill) => withTrust(skill, audits));
      trail.push({
        source: "seed",
        outcome: items.length === 0 ? "empty" : "ok",
        reason: SKILL_SEED_NOTICE,
        items: items.length,
      });
      const ageSeconds = oldestAgeSeconds(items, at);
      return {
        items,
        total: matching.length,
        limit,
        offset,
        source: "seed",
        healthy: true,
        reason: null,
        fetchedAt,
        ageSeconds,
        stale: true,
        degraded: true,
        maxAgeSeconds,
        itemSources: censusOfSources(items),
        trustCensus: censusOfTrust(items),
        notice: noticeFor(items),
        trail,
      };
    } catch (err) {
      // Level 2 lives inside this bundle, so getting here means our own defect.
      // It still must not reach the client as a 500.
      trail.push({ source: "seed", outcome: "threw", reason: describeThrow(err), items: 0 });
      return {
        items: [],
        total: 0,
        limit,
        offset,
        source: "seed",
        healthy: false,
        reason: describeThrow(err),
        fetchedAt,
        ageSeconds: null,
        stale: true,
        degraded: true,
        maxAgeSeconds,
        itemSources: {},
        trustCensus: {},
        notice: null,
        trail,
      };
    }
  }

  return {
    async listSkills(filter: SkillFilter): Promise<SkillServicePage> {
      const at = now();
      const trail: SkillFallbackAttempt[] = [];

      if (deps.store === undefined) {
        trail.push({
          source: "registry",
          outcome: "unavailable",
          reason: "no skill registry is installed on this instance (no DATABASE_URL)",
          items: 0,
        });
        return listFromSeed(filter, at, trail);
      }

      try {
        const page = await deps.store.listSkills(filter, at);
        if (!page.healthy) {
          trail.push({
            source: "registry",
            outcome: "unhealthy",
            reason: page.reason === null ? null : redact(page.reason),
            items: 0,
          });
          return listFromSeed(filter, at, trail);
        }
        if (page.items.length === 0) {
          trail.push({ source: "registry", outcome: "empty", reason: page.reason, items: 0 });
          return listFromSeed(filter, at, trail);
        }

        // Audits are read per skill so the trust status is always derived from
        // the audits of that exact skill, never from a page-wide bag that could
        // let one skill inherit another's verdict.
        const details = await Promise.all(
          page.items.map(async (skill) => {
            const detail = await deps.store!.getSkill(skill.id, at);
            return withTrust(skill, detail.audits);
          }),
        );

        trail.push({
          source: "registry",
          outcome: "ok",
          reason: page.reason === null ? null : redact(page.reason),
          items: details.length,
        });

        const ageSeconds = oldestAgeSeconds(details, at);
        return {
          items: details,
          total: page.total,
          limit: page.limit,
          offset: page.offset,
          source: "registry",
          healthy: true,
          reason: page.reason === null ? null : redact(page.reason),
          fetchedAt: page.fetchedAt,
          ageSeconds,
          stale: stale(ageSeconds, "registry"),
          degraded: false,
          maxAgeSeconds,
          itemSources: censusOfSources(details),
          trustCensus: censusOfTrust(details),
          notice: noticeFor(details),
          trail,
        };
      } catch (err) {
        trail.push({
          source: "registry",
          outcome: "threw",
          reason: describeThrow(err),
          items: 0,
        });
        return listFromSeed(filter, at, trail);
      }
    },

    async getSkill(id: string): Promise<SkillServiceDetail> {
      const at = now();
      const fetchedAt = at.toISOString();
      const trail: SkillFallbackAttempt[] = [];

      const fromSeed = (): SkillServiceDetail => {
        try {
          const audits = seed.audits().filter((a) => a.skillId === id);
          const hit = seed.skills().find((skill) => skill.id === id) ?? null;
          trail.push({
            source: "seed",
            outcome: hit === null ? "empty" : "ok",
            reason: hit === null ? `${id} is not a curated example` : SKILL_SEED_NOTICE,
            items: hit === null ? 0 : 1,
          });
          const skill = hit === null ? null : withTrust(hit, audits);
          return {
            skill,
            audits: hit === null ? [] : audits,
            source: "seed",
            healthy: true,
            reason: hit === null ? `skill ${id} was not found` : null,
            fetchedAt,
            ageSeconds: skill === null ? null : oldestAgeSeconds([skill], at),
            stale: true,
            degraded: true,
            maxAgeSeconds,
            notice: skill === null ? null : SKILL_SEED_NOTICE,
            trail,
          };
        } catch (err) {
          trail.push({ source: "seed", outcome: "threw", reason: describeThrow(err), items: 0 });
          return {
            skill: null,
            audits: [],
            source: "seed",
            healthy: false,
            reason: describeThrow(err),
            fetchedAt,
            ageSeconds: null,
            stale: true,
            degraded: true,
            maxAgeSeconds,
            notice: null,
            trail,
          };
        }
      };

      if (deps.store === undefined) {
        trail.push({
          source: "registry",
          outcome: "unavailable",
          reason: "no skill registry is installed on this instance (no DATABASE_URL)",
          items: 0,
        });
        return fromSeed();
      }

      try {
        const detail = await deps.store.getSkill(id, at);
        if (!detail.healthy) {
          trail.push({
            source: "registry",
            outcome: "unhealthy",
            reason: detail.reason === null ? null : redact(detail.reason),
            items: 0,
          });
          return fromSeed();
        }
        if (detail.skill === null) {
          // A healthy registry saying "not here" is an answer, so this is
          // `empty` and not an uncertainty — that is what lets the route answer
          // a real 404 when the seed also has nothing.
          trail.push({ source: "registry", outcome: "empty", reason: detail.reason, items: 0 });
          return fromSeed();
        }

        const skill = withTrust(detail.skill, detail.audits);
        trail.push({ source: "registry", outcome: "ok", reason: null, items: 1 });
        const ageSeconds = oldestAgeSeconds([skill], at);
        return {
          skill,
          audits: detail.audits,
          source: "registry",
          healthy: true,
          reason: detail.reason === null ? null : redact(detail.reason),
          fetchedAt: detail.fetchedAt,
          ageSeconds,
          stale: stale(ageSeconds, "registry"),
          degraded: false,
          maxAgeSeconds,
          notice: skill.example ? SKILL_SEED_NOTICE : null,
          trail,
        };
      } catch (err) {
        trail.push({ source: "registry", outcome: "threw", reason: describeThrow(err), items: 0 });
        return fromSeed();
      }
    },

    async listAuditors(): Promise<AuditorServiceList> {
      const at = now();
      const fetchedAt = at.toISOString();
      const trail: SkillFallbackAttempt[] = [];

      const decorate = async (
        items: readonly AuditorRecord[],
        source: SkillSource,
        healthy: boolean,
        reason: string | null,
      ): Promise<AuditorServiceList> => {
        // A failing reputation read must not lose the auditor: `attachReputation`
        // never throws, and a failed read becomes `unhealthy` on that one row.
        const decorated = await Promise.all(
          items.map((auditor) => attachReputation(auditor, deps.reputation, at)),
        );
        const reputationSources: AuditorServiceList["reputationSources"] = {};
        for (const auditor of decorated) {
          const key = auditor.reputation.source;
          reputationSources[key] = (reputationSources[key] ?? 0) + 1;
        }
        const ageSeconds = oldestAgeSeconds(decorated, at);
        return {
          items: decorated,
          total: decorated.length,
          source,
          healthy,
          reason: reason === null ? null : redact(reason),
          fetchedAt,
          ageSeconds,
          stale: stale(ageSeconds, source),
          degraded: source !== "registry",
          maxAgeSeconds,
          reputationSources,
          notice: noticeFor(decorated),
          trail,
        };
      };

      const fromSeed = async (): Promise<AuditorServiceList> => {
        try {
          const items = seed.auditors();
          trail.push({
            source: "seed",
            outcome: items.length === 0 ? "empty" : "ok",
            reason: SKILL_SEED_NOTICE,
            items: items.length,
          });
          return await decorate(items, "seed", true, null);
        } catch (err) {
          trail.push({ source: "seed", outcome: "threw", reason: describeThrow(err), items: 0 });
          return decorate([], "seed", false, describeThrow(err));
        }
      };

      if (deps.store === undefined) {
        trail.push({
          source: "registry",
          outcome: "unavailable",
          reason: "no skill registry is installed on this instance (no DATABASE_URL)",
          items: 0,
        });
        return fromSeed();
      }

      try {
        const result = await deps.store.listAuditors(at);
        if (!result.healthy) {
          trail.push({
            source: "registry",
            outcome: "unhealthy",
            reason: result.reason === null ? null : redact(result.reason),
            items: 0,
          });
          return fromSeed();
        }
        if (result.items.length === 0) {
          trail.push({ source: "registry", outcome: "empty", reason: result.reason, items: 0 });
          return fromSeed();
        }
        trail.push({
          source: "registry",
          outcome: "ok",
          reason: result.reason === null ? null : redact(result.reason),
          items: result.items.length,
        });
        return await decorate(result.items, "registry", true, result.reason);
      } catch (err) {
        trail.push({ source: "registry", outcome: "threw", reason: describeThrow(err), items: 0 });
        return fromSeed();
      }
    },

    async registerSkill(body: unknown): Promise<RegisterSkillResult> {
      const at = now();
      const fetchedAt = at.toISOString();
      const ctx: NormalizeSkillContext = { now: fetchedAt, source: "registry", chainId };

      const parsed = normalizeSkillSubmission(body, ctx);
      if (!parsed.ok) {
        return {
          ok: false,
          stored: false,
          durable: deps.store?.durable ?? false,
          skill: null,
          invalid: { field: parsed.field, message: parsed.message },
          reason: parsed.message,
          fetchedAt,
        };
      }

      // A brand-new skill has no audits, so its status is UNAUDITED by
      // derivation rather than by assignment — there is no code path in which a
      // registration can arrive already carrying a verdict.
      const skill = withTrust(parsed.skill, []);

      if (deps.store === undefined) {
        return {
          ok: false,
          stored: false,
          durable: false,
          skill,
          invalid: null,
          reason:
            "no skill registry is installed on this instance (no DATABASE_URL), so this " +
            "registration was not stored — the record above is what would have been stored",
          fetchedAt,
        };
      }

      try {
        await deps.store.putSkill(parsed.skill);
        return {
          ok: true,
          stored: true,
          durable: deps.store.durable ?? true,
          skill,
          invalid: null,
          reason: null,
          fetchedAt,
        };
      } catch (err) {
        // The store throws on a failed write on purpose. It is turned into an
        // honest failure here — never swallowed into a success.
        return {
          ok: false,
          stored: false,
          durable: deps.store.durable ?? true,
          skill,
          invalid: null,
          reason: describeThrow(err),
          fetchedAt,
        };
      }
    },
  };
}

/** Re-exported so route and test code has one import site for the seed date. */
export { SKILL_SEED_AT, SKILL_SEED_NOTICE };
