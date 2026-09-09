/**
 * JSON off the wire → the typed records in `types.ts`.
 *
 * Everything here is defensive in one direction only. A field we cannot read becomes
 * `null`, an unknown status becomes the *least* trusting reading, and a `verified` flag
 * that disagrees with its own status is discarded. There is no branch in this file that
 * can make a skill look safer than the backend said it was.
 */

import { parseUsd8 } from "@/lib/money";
import {
  isSkillSource,
  type SkillProvenance,
  type SkillTrailStep,
} from "@/lib/skills/provenance";
import {
  AUDIT_VERDICTS,
  RISK_LEVELS,
  isSkillKind,
  isTrustStatus,
  type AuditRecord,
  type AuditStage,
  type AuditVerdict,
  type AuditorRecord,
  type AuditorReputation,
  type Escrow,
  type Evidence,
  type Finding,
  type RiskLevel,
  type SkillRecord,
  type SkillVersion,
  type Trust,
} from "@/lib/skills/types";

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v !== null && typeof v === "object" ? (v as Obj) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function riskLevel(v: unknown): RiskLevel | null {
  return typeof v === "string" && (RISK_LEVELS as readonly string[]).includes(v)
    ? (v as RiskLevel)
    : null;
}

function verdict(v: unknown): AuditVerdict | null {
  return typeof v === "string" && (AUDIT_VERDICTS as readonly string[]).includes(v)
    ? (v as AuditVerdict)
    : null;
}

/**
 * A finding whose severity we cannot read is treated as `critical`, not dropped.
 * The safe direction for an unreadable warning is upwards.
 */
function findings(v: unknown): Finding[] {
  if (!Array.isArray(v)) return [];
  return v.map((row) => {
    const o = obj(row);
    return {
      severity: riskLevel(o.severity) ?? "critical",
      title: str(o.title, "unnamed finding"),
      detail: str(o.detail, ""),
    };
  });
}

function evidence(v: unknown): Evidence {
  const o = obj(v);
  return {
    uri: strOrNull(o.uri),
    sha256: strOrNull(o.sha256),
    complete: o.complete === true,
  };
}

/**
 * The trust block.
 *
 * Three deliberate asymmetries, all of them one-way:
 *
 * 1. An unrecognised `status` is read as `INCONCLUSIVE` — "the audit could not
 *    conclude" — because a status we do not understand is a thing we do not know.
 * 2. `verified` is accepted only when the status is `PASSED` as well. A payload that
 *    claims verification for any other status is contradicting itself, and the reading
 *    that costs nobody a wallet is the untrusting one.
 * 3. `unknown` defaults to `true` for everything except the two statuses that really
 *    are knowledge (`PASSED`, `FAILED`).
 */
export function parseTrust(v: unknown): Trust {
  const o = obj(v);
  const status = isTrustStatus(o.status) ? o.status : "INCONCLUSIVE";
  const known = status === "PASSED" || status === "FAILED";
  const auditedSha256 = strOrNull(o.auditedSha256);
  const currentSha256 = strOrNull(o.currentSha256);

  return {
    status,
    verified: o.verified === true && status === "PASSED",
    // Not read off the wire, derived from the status by the same rule the backend
    // states: five statuses are ignorance, `PASSED` and `FAILED` are knowledge.
    unknown: !known,
    reason: str(o.reason, "the backend gave no reason for this status"),
    verdict: verdict(o.verdict),
    risk: riskLevel(o.risk),
    auditId: strOrNull(o.auditId),
    auditorId: strOrNull(o.auditorId),
    auditedSha256,
    currentSha256,
    // Reported by the backend. The comparison below is a floor, not a second opinion:
    // it can only turn a `false` into a `true`, never the other way round.
    buildChanged:
      o.buildChanged === true ||
      (auditedSha256 !== null && currentSha256 !== null && auditedSha256 !== currentSha256),
    evidence: evidence(o.evidence),
    completedAt: strOrNull(o.completedAt),
    auditCount: num(o.auditCount, 0),
  };
}

function versions(v: unknown): SkillVersion[] {
  if (!Array.isArray(v)) return [];
  return v.map((row) => {
    const o = obj(row);
    return {
      version: str(o.version, "unknown"),
      contentSha256: str(o.contentSha256, ""),
      publishedAt: str(o.publishedAt, ""),
      auditId: strOrNull(o.auditId),
    };
  });
}

export function parseSkill(v: unknown): SkillRecord {
  const o = obj(v);
  return {
    id: str(o.id, "unknown"),
    name: str(o.name, "Unnamed skill"),
    kind: isSkillKind(o.kind) ? o.kind : "PLUGIN",
    version: str(o.version, "unknown"),
    contentSha256: str(o.contentSha256, ""),
    sourceUri: str(o.sourceUri, ""),
    declaredDescription: str(o.declaredDescription, ""),
    declaredCapabilities: strings(o.declaredCapabilities),
    authorAddress: strOrNull(o.authorAddress),
    authorName: strOrNull(o.authorName),
    tags: strings(o.tags),
    priceUsd8PerVersion: parseUsd8(o.priceUsd8PerVersion) ?? 0n,
    intakeFindings: findings(o.intakeFindings),
    versions: versions(o.versions),
    createdAt: str(o.createdAt, ""),
    updatedAt: str(o.updatedAt, ""),
    example: o.example === true,
    trust: parseTrust(o.trust),
  };
}

function stages(v: unknown): AuditStage[] {
  if (!Array.isArray(v)) return [];
  return v.map((row) => {
    const o = obj(row);
    return {
      stage: str(o.stage, "stage"),
      status: str(o.status, "pending"),
      summary: str(o.summary, ""),
      findings: findings(o.findings),
    };
  });
}

function escrow(v: unknown): Escrow {
  const o = obj(v);
  return {
    chainId: numOrNull(o.chainId),
    contract: strOrNull(o.contract),
    jobId: typeof o.jobId === "number" ? String(o.jobId) : strOrNull(o.jobId),
    status: str(o.status, "UNKNOWN"),
    feeTxHash: strOrNull(o.feeTxHash),
    bondTxHash: strOrNull(o.bondTxHash),
    settlementTxHash: strOrNull(o.settlementTxHash),
  };
}

export function parseAudit(v: unknown): AuditRecord {
  const o = obj(v);
  return {
    id: str(o.id, "unknown"),
    skillId: str(o.skillId, ""),
    skillVersion: str(o.skillVersion, "unknown"),
    auditedSha256: str(o.auditedSha256, ""),
    auditorId: strOrNull(o.auditorId),
    tier: str(o.tier, "UNKNOWN"),
    scope: strings(o.scope),
    state: str(o.state, "UNKNOWN"),
    verdict: verdict(o.verdict),
    risk: riskLevel(o.risk),
    summary: strOrNull(o.summary),
    observedCapabilities: strings(o.observedCapabilities),
    stages: stages(o.stages),
    findings: findings(o.findings),
    feeUsd8: parseUsd8(o.feeUsd8) ?? 0n,
    bondUsd8: parseUsd8(o.bondUsd8) ?? 0n,
    escrow: escrow(o.escrow),
    evidence: evidence(o.evidence),
    requestedAt: str(o.requestedAt, ""),
    completedAt: strOrNull(o.completedAt),
    example: o.example === true,
  };
}

function reputation(v: unknown): AuditorReputation {
  const o = obj(v);
  const source = str(o.source, "unavailable");
  // A score is only a score when it was actually read. `unavailable` with a stored 0
  // would print "0.00 / 5", which is a claim about the auditor rather than about us.
  const readable = source === "onchain";
  return {
    averageScoreX100: readable ? numOrNull(o.averageScoreX100) : null,
    reviewCount: readable ? numOrNull(o.reviewCount) : null,
    source,
    reason: strOrNull(o.reason),
    contract: strOrNull(o.contract),
    fetchedAt: strOrNull(o.fetchedAt),
  };
}

export function parseAuditor(v: unknown): AuditorRecord {
  const o = obj(v);
  return {
    id: str(o.id, "unknown"),
    displayName: str(o.displayName, "Unnamed auditor"),
    address: strOrNull(o.address),
    reputationListingId: strOrNull(o.reputationListingId),
    specialization: strings(o.specialization),
    bondUsd8: parseUsd8(o.bondUsd8) ?? 0n,
    auditsCompleted: num(o.auditsCompleted, 0),
    verdictsSafe: num(o.verdictsSafe, 0),
    verdictsDangerous: num(o.verdictsDangerous, 0),
    slashes: num(o.slashes, 0),
    reputation: reputation(o.reputation),
    example: o.example === true,
  };
}

function trail(v: unknown): SkillTrailStep[] {
  if (!Array.isArray(v)) return [];
  return v.map((row) => {
    const o = obj(row);
    return {
      source: isSkillSource(o.source) ? o.source : "registry",
      outcome: str(o.outcome, "unknown"),
      reason: strOrNull(o.reason),
      items: numOrNull(o.items),
    };
  });
}

export function parseSkillProvenance(v: unknown, now: string): SkillProvenance {
  const o = obj(v);
  return {
    source: isSkillSource(o.source) ? o.source : "registry",
    healthy: o.healthy !== false,
    reason: strOrNull(o.reason),
    fetchedAt: str(o.fetchedAt, now),
    ageSeconds: numOrNull(o.ageSeconds),
    stale: o.stale === true,
    degraded: o.degraded === true,
    maxAgeSeconds: numOrNull(o.maxAgeSeconds),
    notice: strOrNull(o.notice),
    trail: trail(o.trail),
  };
}
