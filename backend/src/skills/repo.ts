/**
 * The Postgres-backed skill registry.
 *
 * The row ↔ record conversion lives here and follows two rules that are not
 * negotiable, because both of them protect a safety claim:
 *
 * 1. **A row that is not a valid record is skipped, not repaired.** A missing
 *    or malformed `content_sha256`, an unknown `kind`, a `state` this build has
 *    never heard of — each of those means we do not know what the row says, and
 *    inventing a default would put a real verdict next to fabricated bytes. The
 *    skipped rows are **counted and reported** (`skipped`), the same way the
 *    8004scan normalizer drops one broken item without erasing the other
 *    nineteen.
 * 2. **`AuditEvidence.complete` is always recomputed**, never read. The two
 *    halves live in two columns precisely so that no row can assert that we
 *    hold evidence we do not have.
 *
 * The read path never throws; `putSkill`/`putAudit`/`putAuditor` deliberately
 * do, exactly like `upsertAgents` in `src/db/repo.ts` — a write that failed must
 * be visible.
 */

import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { FuguDb } from "../db/client.js";
import { decodeMoney, encodeMoney } from "../db/serialize.js";
import {
  skillAuditors,
  skillAudits,
  skills as skillsTable,
  type SkillAuditRow,
  type SkillAuditorRow,
  type SkillRow,
} from "../db/schema.js";
import type { Address } from "../types.js";
import {
  AUDIT_STATES,
  AUDIT_TIERS,
  AUDIT_VERDICTS,
  RISK_LEVELS,
  SHA256_PATTERN,
  SKILL_KINDS,
  makeEvidence,
  type AuditRecord,
  type AuditState,
  type AuditStageResult,
  type AuditTier,
  type AuditVerdict,
  type AuditorRecord,
  type EscrowRef,
  type RiskLevel,
  type SkillFinding,
  type SkillKind,
  type SkillRecord,
  type SkillSource,
  type SkillVersionRecord,
} from "./types.js";
import {
  clampSkillLimit,
  clampSkillOffset,
  oldestAgeSeconds,
  type AuditorStoreResult,
  type SkillFilter,
  type SkillStoreDetail,
  type SkillStorePage,
  type SkillStorePort,
} from "./store.js";

// ---------------------------------------------------------------------------
// Row → record, defensively
// ---------------------------------------------------------------------------

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asFindings(value: unknown): SkillFinding[] {
  if (!Array.isArray(value)) return [];
  const out: SkillFinding[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const severity = typeof row.severity === "string" ? row.severity.toLowerCase() : "";
    out.push({
      // An unknown severity becomes the *highest* we cannot rule out rather than
      // the lowest: rounding an unreadable severity down to "none" is the one
      // direction that can make a dangerous finding look harmless.
      severity: (RISK_LEVELS as readonly string[]).includes(severity)
        ? (severity as RiskLevel)
        : "critical",
      title: typeof row.title === "string" ? row.title : "unlabelled finding",
      detail:
        typeof row.detail === "string"
          ? row.detail
          : "the stored finding had no readable detail; its severity is reported as critical " +
            "because an unreadable finding cannot be cleared",
    });
  }
  return out;
}

function asStages(value: unknown): AuditStageResult[] {
  if (!Array.isArray(value)) return [];
  const out: AuditStageResult[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.stage !== "string") continue;
    out.push({
      stage: row.stage as AuditStageResult["stage"],
      status: (typeof row.status === "string" ? row.status : "pending") as AuditStageResult["status"],
      summary: typeof row.summary === "string" ? row.summary : "",
      findings: asFindings(row.findings),
    });
  }
  return out;
}

function asVersions(value: unknown): SkillVersionRecord[] {
  if (!Array.isArray(value)) return [];
  const out: SkillVersionRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const hash = typeof row.contentSha256 === "string" ? row.contentSha256.toLowerCase() : "";
    // A version whose digest we cannot read cannot take part in the rug-pull
    // comparison, so it is dropped rather than listed as if it could.
    if (!SHA256_PATTERN.test(hash)) continue;
    out.push({
      version: typeof row.version === "string" ? row.version : "unknown",
      contentSha256: hash,
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : "",
      auditId: typeof row.auditId === "string" ? row.auditId : null,
    });
  }
  return out;
}

function asEscrow(value: unknown, chainId: number): EscrowRef {
  const row = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const statuses = ["NOT_WIRED", "OPEN", "FUNDED", "SETTLED", "SLASHED"];
  const status = typeof row.status === "string" && statuses.includes(row.status) ? row.status : "NOT_WIRED";
  return {
    chainId: typeof row.chainId === "number" ? row.chainId : chainId,
    contract: typeof row.contract === "string" ? (row.contract as Address) : null,
    jobId: typeof row.jobId === "string" ? row.jobId : null,
    status: status as EscrowRef["status"],
    feeTxHash: typeof row.feeTxHash === "string" ? row.feeTxHash : null,
    bondTxHash: typeof row.bondTxHash === "string" ? row.bondTxHash : null,
    settlementTxHash: typeof row.settlementTxHash === "string" ? row.settlementTxHash : null,
  };
}

function asSource(value: string): SkillSource {
  return value === "seed" || value === "onchain" ? value : "registry";
}

/**
 * `skills` row → `SkillRecord`, or `null` when the row cannot be trusted.
 *
 * The three rejection reasons are all identity: an unreadable digest, an
 * unknown kind, or an unparseable timestamp. Each of them would make some later
 * comparison meaningless rather than merely ugly.
 */
export function skillFromRow(row: SkillRow): SkillRecord | null {
  const contentSha256 = row.contentSha256.trim().toLowerCase();
  if (!SHA256_PATTERN.test(contentSha256)) return null;
  if (!(SKILL_KINDS as readonly string[]).includes(row.kind)) return null;
  if (Number.isNaN(row.fetchedAt.getTime())) return null;

  let price: bigint;
  try {
    price = decodeMoney(row.priceUsd8PerVersion);
  } catch {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    kind: row.kind as SkillKind,
    version: row.version,
    contentSha256,
    sourceUri: row.sourceUri,
    declaredDescription: row.declaredDescription,
    declaredCapabilities: asStringArray(row.declaredCapabilities),
    authorAddress: row.authorAddress as Address | null,
    authorName: row.authorName,
    tags: asStringArray(row.tags),
    priceUsd8PerVersion: price,
    intakeFindings: asFindings(row.intakeFindings),
    versions: asVersions(row.versions),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: asSource(row.source),
    fetchedAt: row.fetchedAt.toISOString(),
    example: row.isExample,
  };
}

/**
 * `skill_audits` row → `AuditRecord`, or `null`.
 *
 * An unknown `state` is rejected rather than defaulted. Defaulting it to
 * `COMPLETE` would fabricate a verdict; defaulting it to `REQUESTED` would erase
 * a real one. Skipping it means the skill falls back to whatever other audits
 * say — and, if there are none, to `UNAUDITED`, which is the honest answer.
 */
export function auditFromRow(row: SkillAuditRow, chainId: number): AuditRecord | null {
  const auditedSha256 = row.auditedSha256.trim().toLowerCase();
  if (!SHA256_PATTERN.test(auditedSha256)) return null;
  if (!(AUDIT_STATES as readonly string[]).includes(row.state)) return null;
  if (!(AUDIT_TIERS as readonly string[]).includes(row.tier)) return null;
  if (row.verdict !== null && !(AUDIT_VERDICTS as readonly string[]).includes(row.verdict)) {
    return null;
  }

  let feeUsd8: bigint;
  let bondUsd8: bigint;
  try {
    feeUsd8 = decodeMoney(row.feeUsd8);
    bondUsd8 = decodeMoney(row.bondUsd8);
  } catch {
    return null;
  }

  return {
    id: row.id,
    skillId: row.skillId,
    skillVersion: row.skillVersion,
    auditedSha256,
    auditorId: row.auditorId,
    tier: row.tier as AuditTier,
    scope: asStringArray(row.scope),
    state: row.state as AuditState,
    verdict: row.verdict as AuditVerdict | null,
    risk:
      row.risk !== null && (RISK_LEVELS as readonly string[]).includes(row.risk)
        ? (row.risk as RiskLevel)
        : null,
    summary: row.summary,
    observedCapabilities: asStringArray(row.observedCapabilities),
    stages: asStages(row.stages),
    findings: asFindings(row.findings),
    feeUsd8,
    bondUsd8,
    escrow: asEscrow(row.escrow, chainId),
    // Recomputed, never read: a row cannot claim we hold evidence we do not.
    evidence: makeEvidence(row.evidenceUri, row.evidenceSha256),
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    source: asSource(row.source),
    fetchedAt: row.fetchedAt.toISOString(),
    example: row.isExample,
  };
}

export function auditorFromRow(row: SkillAuditorRow): AuditorRecord | null {
  let bondUsd8: bigint;
  let listingId: bigint | null;
  try {
    bondUsd8 = decodeMoney(row.bondUsd8);
    listingId = row.reputationListingId === null ? null : decodeMoney(row.reputationListingId);
  } catch {
    return null;
  }

  return {
    id: row.id,
    displayName: row.displayName,
    address: row.address as Address | null,
    reputationListingId: listingId,
    specialization: asStringArray(row.specialization),
    bondUsd8,
    auditsCompleted: row.auditsCompleted,
    verdictsSafe: row.verdictsSafe,
    verdictsDangerous: row.verdictsDangerous,
    slashes: row.slashes,
    reputation: {
      // Never stored. A reputation number is only ever the result of a live
      // read, so a row cannot carry one.
      averageScoreX100: null,
      reviewCount: null,
      source: "unavailable",
      reason: "not read yet on this request",
      contract: null,
      fetchedAt: null,
    },
    source: asSource(row.source),
    fetchedAt: row.fetchedAt.toISOString(),
    example: row.isExample,
  };
}

// ---------------------------------------------------------------------------
// Record → row
// ---------------------------------------------------------------------------

function toDate(iso: string, field: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} is not ISO 8601: ${iso}`);
  return date;
}

export function skillToRow(skill: SkillRecord): typeof skillsTable.$inferInsert {
  if (!SHA256_PATTERN.test(skill.contentSha256)) {
    throw new TypeError(`contentSha256 is not 64 hex characters: ${skill.contentSha256}`);
  }
  return {
    id: skill.id,
    name: skill.name,
    kind: skill.kind,
    version: skill.version,
    contentSha256: skill.contentSha256,
    sourceUri: skill.sourceUri,
    declaredDescription: skill.declaredDescription,
    declaredCapabilities: skill.declaredCapabilities,
    authorAddress: skill.authorAddress,
    authorName: skill.authorName,
    tags: skill.tags,
    priceUsd8PerVersion: encodeMoney(skill.priceUsd8PerVersion),
    intakeFindings: skill.intakeFindings,
    versions: skill.versions,
    createdAt: toDate(skill.createdAt, "createdAt"),
    updatedAt: toDate(skill.updatedAt, "updatedAt"),
    source: skill.source,
    fetchedAt: toDate(skill.fetchedAt, "fetchedAt"),
    isExample: skill.example,
  };
}

export function auditToRow(audit: AuditRecord): typeof skillAudits.$inferInsert {
  return {
    id: audit.id,
    skillId: audit.skillId,
    skillVersion: audit.skillVersion,
    auditedSha256: audit.auditedSha256,
    auditorId: audit.auditorId,
    tier: audit.tier,
    scope: audit.scope,
    state: audit.state,
    verdict: audit.verdict,
    risk: audit.risk,
    summary: audit.summary,
    observedCapabilities: audit.observedCapabilities,
    stages: audit.stages,
    findings: audit.findings,
    feeUsd8: encodeMoney(audit.feeUsd8),
    bondUsd8: encodeMoney(audit.bondUsd8),
    escrow: audit.escrow,
    evidenceUri: audit.evidence.uri,
    evidenceSha256: audit.evidence.sha256,
    requestedAt: toDate(audit.requestedAt, "requestedAt"),
    completedAt: audit.completedAt === null ? null : toDate(audit.completedAt, "completedAt"),
    source: audit.source,
    fetchedAt: toDate(audit.fetchedAt, "fetchedAt"),
    isExample: audit.example,
  };
}

export function auditorToRow(auditor: AuditorRecord): typeof skillAuditors.$inferInsert {
  return {
    id: auditor.id,
    displayName: auditor.displayName,
    address: auditor.address,
    reputationListingId:
      auditor.reputationListingId === null ? null : encodeMoney(auditor.reputationListingId),
    specialization: auditor.specialization,
    bondUsd8: encodeMoney(auditor.bondUsd8),
    auditsCompleted: auditor.auditsCompleted,
    verdictsSafe: auditor.verdictsSafe,
    verdictsDangerous: auditor.verdictsDangerous,
    slashes: auditor.slashes,
    source: auditor.source,
    fetchedAt: toDate(auditor.fetchedAt, "fetchedAt"),
    isExample: auditor.example,
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message.split("\n")[0]}`;
  return `unknown failure: ${String(error)}`;
}

/** `%`, `_` and `\` are LIKE metacharacters; a search term is not a pattern. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface DbSkillStoreOptions {
  chainId: number;
}

export function createDbSkillStore(db: FuguDb, options: DbSkillStoreOptions): SkillStorePort {
  const { chainId } = options;

  function whereFor(filter: SkillFilter): SQL | undefined {
    const clauses: SQL[] = [];
    if (filter.kind !== undefined) clauses.push(eq(skillsTable.kind, filter.kind));
    if (filter.includeExamples === false) clauses.push(eq(skillsTable.isExample, false));
    if (filter.search !== undefined && filter.search.trim() !== "") {
      const pattern = `%${escapeLike(filter.search.trim())}%`;
      const search = or(
        ilike(skillsTable.name, pattern),
        ilike(skillsTable.id, pattern),
        ilike(skillsTable.declaredDescription, pattern),
      );
      if (search !== undefined) clauses.push(search);
    }
    if (clauses.length === 0) return undefined;
    return clauses.length === 1 ? clauses[0] : and(...clauses);
  }

  return {
    async listSkills(filter: SkillFilter, now: Date): Promise<SkillStorePage> {
      const limit = clampSkillLimit(filter.limit);
      const offset = clampSkillOffset(filter.offset);
      const fetchedAt = now.toISOString();
      try {
        const where = whereFor(filter);
        const rows = await db
          .select()
          .from(skillsTable)
          .where(where)
          .orderBy(desc(skillsTable.updatedAt), asc(skillsTable.id))
          .limit(limit)
          .offset(offset);

        const counted = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(skillsTable)
          .where(where);

        const items: SkillRecord[] = [];
        let skipped = 0;
        for (const row of rows) {
          const record = skillFromRow(row);
          if (record === null) skipped++;
          else items.push(record);
        }

        return {
          items,
          total: counted[0]?.total ?? items.length,
          limit,
          offset,
          source: "registry",
          healthy: true,
          reason:
            skipped === 0
              ? null
              : `${skipped} row(s) were skipped because they could not be read as valid records`,
          fetchedAt,
          ageSeconds: oldestAgeSeconds(items, now),
          skipped,
        };
      } catch (error) {
        // The read path never throws. `/api/skills` is needed most when the
        // registry is sick.
        return {
          items: [],
          total: 0,
          limit,
          offset,
          source: "registry",
          healthy: false,
          reason: describeError(error),
          fetchedAt,
          ageSeconds: null,
          skipped: 0,
        };
      }
    },

    async getSkill(id: string, now: Date): Promise<SkillStoreDetail> {
      const fetchedAt = now.toISOString();
      try {
        const rows = await db.select().from(skillsTable).where(eq(skillsTable.id, id)).limit(1);
        const row = rows[0];
        if (row === undefined) {
          return {
            skill: null,
            audits: [],
            source: "registry",
            healthy: true,
            reason: `skill ${id} is not in the registry`,
            fetchedAt,
            ageSeconds: null,
          };
        }
        const skill = skillFromRow(row);
        if (skill === null) {
          return {
            skill: null,
            audits: [],
            source: "registry",
            // A row we cannot read is NOT the same as no row. Reporting it as a
            // clean miss would let a corrupt row read as "this skill does not
            // exist", and the route would answer 404 for something that does.
            healthy: false,
            reason: `skill ${id} is stored in a shape this build cannot read`,
            fetchedAt,
            ageSeconds: null,
          };
        }

        const auditRows = await db
          .select()
          .from(skillAudits)
          .where(eq(skillAudits.skillId, id))
          .orderBy(desc(skillAudits.requestedAt), asc(skillAudits.id));

        const audits: AuditRecord[] = [];
        let skipped = 0;
        for (const auditRow of auditRows) {
          const record = auditFromRow(auditRow, chainId);
          if (record === null) skipped++;
          else audits.push(record);
        }

        return {
          skill,
          audits,
          source: "registry",
          healthy: true,
          reason:
            skipped === 0
              ? null
              : `${skipped} audit row(s) were skipped because they could not be read`,
          fetchedAt,
          ageSeconds: oldestAgeSeconds([skill], now),
        };
      } catch (error) {
        return {
          skill: null,
          audits: [],
          source: "registry",
          healthy: false,
          reason: describeError(error),
          fetchedAt,
          ageSeconds: null,
        };
      }
    },

    async listAuditors(now: Date): Promise<AuditorStoreResult> {
      const fetchedAt = now.toISOString();
      try {
        const rows = await db
          .select()
          .from(skillAuditors)
          .orderBy(desc(skillAuditors.auditsCompleted), asc(skillAuditors.id));
        const items: AuditorRecord[] = [];
        let skipped = 0;
        for (const row of rows) {
          const record = auditorFromRow(row);
          if (record === null) skipped++;
          else items.push(record);
        }
        return {
          items,
          total: items.length,
          source: "registry",
          healthy: true,
          reason: skipped === 0 ? null : `${skipped} auditor row(s) were skipped`,
          fetchedAt,
          ageSeconds: oldestAgeSeconds(items, now),
          skipped,
        };
      } catch (error) {
        return {
          items: [],
          total: 0,
          source: "registry",
          healthy: false,
          reason: describeError(error),
          fetchedAt,
          ageSeconds: null,
          skipped: 0,
        };
      }
    },

    // The three writers below throw on purpose — see the file header.
    async putSkill(skill: SkillRecord): Promise<void> {
      const row = skillToRow(skill);
      await db
        .insert(skillsTable)
        .values(row)
        .onConflictDoUpdate({
          target: skillsTable.id,
          set: {
            name: row.name,
            kind: row.kind,
            version: row.version,
            contentSha256: row.contentSha256,
            sourceUri: row.sourceUri,
            declaredDescription: row.declaredDescription,
            declaredCapabilities: row.declaredCapabilities,
            authorAddress: row.authorAddress,
            authorName: row.authorName,
            tags: row.tags,
            priceUsd8PerVersion: row.priceUsd8PerVersion,
            intakeFindings: row.intakeFindings,
            versions: row.versions,
            updatedAt: row.updatedAt,
            source: row.source,
            fetchedAt: row.fetchedAt,
            isExample: row.isExample,
          },
        });
    },

    async putAudit(audit: AuditRecord): Promise<void> {
      const row = auditToRow(audit);
      await db.insert(skillAudits).values(row).onConflictDoUpdate({
        target: skillAudits.id,
        set: row,
      });
    },

    async putAuditor(auditor: AuditorRecord): Promise<void> {
      const row = auditorToRow(auditor);
      await db.insert(skillAuditors).values(row).onConflictDoUpdate({
        target: skillAuditors.id,
        set: row,
      });
    },
  };
}
