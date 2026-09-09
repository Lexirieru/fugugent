/**
 * The audited-skill marketplace, as the frontend sees it.
 *
 * An agent gains abilities by installing a skill or an MCP server, and it installs them
 * from open sources nobody vets. That is a named, CVE'd attack surface, tool poisoning
 * (`CVE-2025-54136`, `CVE-2025-54135`), capability mismatch, supply-chain RCE
 * (`CVE-2025-6514`), and the rug-pull update: a clean v1 followed by a malicious v2. One
 * poisoned skill drains the agent's wallet, and the agent does it to itself.
 *
 * ## The rule this file exists to protect
 *
 * `trust.status` is **derived by the backend** from the audits it actually holds
 * (`deriveTrust`), and there is no `audit_status` column anywhere that anyone could set.
 * Nothing here may reproduce that derivation. The frontend reads the status; it never
 * computes one, and it never promotes one.
 *
 * The one liberty taken is in the opposite direction, in `parseTrust`: a payload whose
 * `verified` flag disagrees with its own `status` is read as **not** verified. That can
 * only ever lower a claim, never raise one.
 *
 * ## Money
 *
 * Every monetary value arrives as a decimal string in USD8 base (`"1500000000"` = $15.00)
 * and becomes a `bigint` here. It never passes through `number`, `12345678` is $0.12,
 * and a single `Number()` on that path would show "12,345,678" to somebody deciding
 * whether to install.
 */

/** What the agent would actually install. */
export const SKILL_KINDS = ["CLAUDE_SKILL", "MCP_SERVER", "PLUGIN"] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export function isSkillKind(v: unknown): v is SkillKind {
  return typeof v === "string" && (SKILL_KINDS as readonly string[]).includes(v);
}

/**
 * The seven audit statuses, in the order the backend lists them: from knowing nothing
 * towards knowing something. The difference between them is the whole product.
 *
 * Exactly one of them (`PASSED`) means "safe". Five mean "we do not know". `FAILED`
 * means we *do* know, and it is bad, which is not the same as not knowing, and must
 * never be drawn as if it were.
 */
export const TRUST_STATUSES = [
  "UNAUDITED",
  "AUDIT_REQUESTED",
  "AUDITING",
  "STALE_AUDIT",
  "INCONCLUSIVE",
  "PASSED",
  "FAILED",
] as const;
export type TrustStatus = (typeof TRUST_STATUSES)[number];

export function isTrustStatus(v: unknown): v is TrustStatus {
  return typeof v === "string" && (TRUST_STATUSES as readonly string[]).includes(v);
}

export const RISK_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const AUDIT_VERDICTS = ["SAFE", "DANGEROUS", "INCONCLUSIVE"] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

export interface Finding {
  severity: RiskLevel;
  title: string;
  detail: string;
}

/** The report the auditor is paid for holding. Without it, a `SAFE` verdict is a rumour. */
export interface Evidence {
  uri: string | null;
  sha256: string | null;
  /** The backend's own judgement of whether it holds the whole report. */
  complete: boolean;
}

export interface Trust {
  status: TrustStatus;
  /** `true` for `PASSED` and for nothing else. */
  verified: boolean;
  /** `true` for the five states of not knowing. `FAILED` is knowledge, so it is `false`. */
  unknown: boolean;
  /** The backend's sentence explaining the status. Shown verbatim; never paraphrased. */
  reason: string;
  verdict: AuditVerdict | null;
  risk: RiskLevel | null;
  auditId: string | null;
  auditorId: string | null;
  /** The digest the auditor actually examined. */
  auditedSha256: string | null;
  /** The digest being served right now. */
  currentSha256: string | null;
  /** `true` when those two differ, the rug-pull signal. */
  buildChanged: boolean;
  evidence: Evidence;
  completedAt: string | null;
  auditCount: number;
}

export interface SkillVersion {
  version: string;
  contentSha256: string;
  publishedAt: string;
  auditId: string | null;
}

export interface SkillRecord {
  id: string;
  name: string;
  kind: SkillKind;
  version: string;
  contentSha256: string;
  sourceUri: string;
  /** The author's own text. Untrusted, it is the injection surface itself. */
  declaredDescription: string;
  declaredCapabilities: string[];
  authorAddress: string | null;
  authorName: string | null;
  tags: string[];
  /** USD8. `0n` is a real price, not a missing one. */
  priceUsd8PerVersion: bigint;
  /**
   * A deterministic scan of the declared text. **Not an audit**: it can raise suspicion
   * and never clears anything, and the backend's `deriveTrust` does not read it at all.
   */
  intakeFindings: Finding[];
  versions: SkillVersion[];
  createdAt: string;
  updatedAt: string;
  /** `true` = a curated example shipped to exercise the statuses. Never a real listing. */
  example: boolean;
  trust: Trust;
}

export type AuditState = "REQUESTED" | "FUNDED" | "RUNNING" | "COMPLETE" | "ABANDONED" | string;
export type StageStatus = "pass" | "warn" | "fail" | "running" | "pending" | string;

export interface AuditStage {
  stage: string;
  status: StageStatus;
  summary: string;
  findings: Finding[];
}

/** Where the fee and the bond sit. `NOT_WIRED` is stated, never hidden behind a zero. */
export interface Escrow {
  chainId: number | null;
  contract: string | null;
  jobId: string | null;
  status: string;
  feeTxHash: string | null;
  bondTxHash: string | null;
  settlementTxHash: string | null;
}

export interface AuditRecord {
  id: string;
  skillId: string;
  skillVersion: string;
  auditedSha256: string;
  auditorId: string | null;
  tier: string;
  scope: string[];
  state: AuditState;
  verdict: AuditVerdict | null;
  risk: RiskLevel | null;
  summary: string | null;
  observedCapabilities: string[];
  stages: AuditStage[];
  findings: Finding[];
  /** USD8. What the auditor is paid. */
  feeUsd8: bigint;
  /** USD8. What the auditor loses if the verdict is overturned. */
  bondUsd8: bigint;
  escrow: Escrow;
  evidence: Evidence;
  requestedAt: string;
  completedAt: string | null;
  example: boolean;
}

/** On-chain reputation, or an honest account of why we could not read it. */
export interface AuditorReputation {
  /** Score × 100. `null` when it could not be read, never rendered as zero. */
  averageScoreX100: number | null;
  reviewCount: number | null;
  source: "onchain" | "unavailable" | "unhealthy" | string;
  reason: string | null;
  contract: string | null;
  fetchedAt: string | null;
}

export interface AuditorRecord {
  id: string;
  displayName: string;
  address: string | null;
  reputationListingId: string | null;
  specialization: string[];
  /** USD8 at risk. This is what makes a verdict cost something to get wrong. */
  bondUsd8: bigint;
  auditsCompleted: number;
  verdictsSafe: number;
  verdictsDangerous: number;
  slashes: number;
  reputation: AuditorReputation;
  example: boolean;
}
