/**
 * The audited-skill marketplace domain — **one source of truth for its shapes**.
 *
 * ## The problem these types exist to solve
 *
 * An AI agent gains abilities by installing a skill / MCP tool, and it installs
 * them from open sources nobody vets. That is a named, CVE'd, actively
 * exploited attack surface:
 *
 * - **Tool poisoning** — hidden instructions inside a tool's *description* that
 *   hijack the calling agent (`CVE-2025-54136`, `CVE-2025-54135`).
 * - **Capability mismatch** — a "price checker" that also reads keys or calls
 *   `setApprovalForAll`.
 * - **Supply-chain RCE** — `CVE-2025-6514` in `mcp-remote`, 558k downloads.
 * - **Rug-pull update** — a clean v1 followed by a malicious v2.
 *
 * One poisoned skill drains the agent's wallet and leaks its API keys, and the
 * agent does it **to itself**.
 *
 * ## The rule that shapes every type in this file
 *
 * **A verdict is a claim about safety, so it is never inferred.** The audit
 * status of a skill is *derived* from the audits we actually hold
 * ({@link deriveTrust}), never stored as a field somebody can set. There are
 * seven statuses, and the difference between them is the whole product:
 *
 * | Status | What it means |
 * |---|---|
 * | `UNAUDITED`       | nobody has ever audited it — **we do not know** |
 * | `AUDIT_REQUESTED` | an audit was requested, no verdict yet — **we do not know** |
 * | `AUDITING`        | an auditor is running the pipeline — **we do not know** |
 * | `STALE_AUDIT`     | an audit exists, but for a **different build** — **we do not know** |
 * | `INCONCLUSIVE`    | the audit ran and could not conclude, or we lack its evidence — **we do not know** |
 * | `PASSED`          | audited, clean, evidence held, and the hash matches what is served |
 * | `FAILED`          | audited and found dangerous — **we do know**, and it is bad |
 *
 * `verified` is `true` for exactly one of those seven. "Not knowing" is never
 * rendered as "safe" — the same distinction this backend already enforces
 * between a 404 and "cannot be sure".
 *
 * ## Money
 *
 * Every monetary value here is a `bigint` in **USD with 8 decimals**
 * (`12345678` = $0.12), exactly like `FuguListing.priceUsd8PerPeriod`. The
 * consequence is that these records are **not JSON-serializable as-is** —
 * `src/skills/serialize.ts` is the only door to the wire and to Postgres.
 */

import type { Address } from "../types.js";

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** What kind of artefact the agent would install. */
export const SKILL_KINDS = ["CLAUDE_SKILL", "MCP_SERVER", "PLUGIN"] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

/**
 * Severity, in the vocabulary the audit pipeline emits. Ordered — see
 * {@link severityRank}.
 */
export const RISK_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** `high` and above is what turns a stage red. */
export function severityRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/**
 * The auditor's conclusion.
 *
 * `INCONCLUSIVE` is a first-class verdict rather than a missing value: an audit
 * that ran and could not decide has told us something real, and it must not be
 * flattened into either "clean" or "dangerous".
 */
export const AUDIT_VERDICTS = ["SAFE", "DANGEROUS", "INCONCLUSIVE"] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

/**
 * Where an audit job is in its lifecycle. Follows the actor flow: the developer
 * posts the skill + an RFQ and funds the fee; auditors quote; the selected one
 * bonds, audits, and hands its verdict over.
 */
export const AUDIT_STATES = [
  /** RFQ posted. No auditor selected. */
  "REQUESTED",
  /** An auditor quoted and was selected; fee/bond not both locked yet. */
  "QUOTED",
  /** Fee and bond are both locked in escrow. */
  "FUNDED",
  /** The pipeline is running. */
  "RUNNING",
  /** A verdict was handed over. */
  "COMPLETE",
  /** Abandoned before a verdict — it decides nothing. */
  "ABANDONED",
] as const;
export type AuditState = (typeof AUDIT_STATES)[number];

/** Depth of review requested. A deeper tier costs more and asserts more. */
export const AUDIT_TIERS = ["AUTOMATED", "PROFESSIONAL"] as const;
export type AuditTier = (typeof AUDIT_TIERS)[number];

/** The four pipeline stages, in order. */
export const AUDIT_STAGES = ["scanner", "sandbox", "fork", "synthesizer"] as const;
export type AuditStageName = (typeof AUDIT_STAGES)[number];

/** The seven audit statuses. See the table in the file header. */
export const AUDIT_STATUSES = [
  "UNAUDITED",
  "AUDIT_REQUESTED",
  "AUDITING",
  "STALE_AUDIT",
  "INCONCLUSIVE",
  "PASSED",
  "FAILED",
] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/**
 * The statuses that mean **we cannot vouch for this build**.
 *
 * `FAILED` is deliberately absent: a failed audit is knowledge, not ignorance.
 * `PASSED` is absent because it is the only status that is a positive claim.
 */
export const UNKNOWN_STATUSES: readonly AuditStatus[] = [
  "UNAUDITED",
  "AUDIT_REQUESTED",
  "AUDITING",
  "STALE_AUDIT",
  "INCONCLUSIVE",
];

/**
 * Where a skill-marketplace record came from.
 *
 * - `registry` — our own Postgres store, the first-party registry of skills.
 * - `onchain`  — read back from the escrow / reputation contracts.
 * - `seed`     — the curated **examples** shipped inside this bundle.
 */
export type SkillSource = "registry" | "onchain" | "seed";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** One finding from a stage or from the intake scan. */
export interface SkillFinding {
  severity: RiskLevel;
  title: string;
  detail: string;
}

/** One stage of the audit pipeline together with what it found. */
export interface AuditStageResult {
  stage: AuditStageName;
  status: "pass" | "warn" | "fail" | "running" | "pending";
  summary: string;
  findings: SkillFinding[];
}

/**
 * The on-chain escrow leg of an audit.
 *
 * **The contract is not deployed yet.** Its address is read from configuration,
 * so this whole leg can light up later without any wire shape changing —
 * `status: "NOT_WIRED"` with a `null` contract is the honest state until then,
 * and it is deliberately distinguishable from "wired but nothing happened".
 */
export interface EscrowRef {
  chainId: number;
  /** From `config.contracts.skillEscrow`. `null` until the contract is deployed. */
  contract: Address | null;
  /** Decimal string — a `uint256` does not fit in a `number`. `null` when no job exists. */
  jobId: string | null;
  status: "NOT_WIRED" | "OPEN" | "FUNDED" | "SETTLED" | "SLASHED";
  feeTxHash: string | null;
  bondTxHash: string | null;
  settlementTxHash: string | null;
}

/**
 * Where the full audit report lives and what it hashes to.
 *
 * `complete` is what {@link deriveTrust} consults: a `SAFE` verdict whose report
 * we cannot point at is **not** proof, so it downgrades to `INCONCLUSIVE`
 * rather than showing a green badge we cannot back up.
 */
export interface AuditEvidence {
  uri: string | null;
  sha256: string | null;
  /** `true` only when both a URI and a digest are present. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** One published build of a skill. The hash is what makes a rug-pull visible. */
export interface SkillVersionRecord {
  version: string;
  /** 64 lowercase hex characters. The identity of the exact bytes served. */
  contentSha256: string;
  publishedAt: string;
  /** The audit that examined this exact build, when there is one. */
  auditId: string | null;
}

/**
 * A skill listed in the marketplace.
 *
 * Note what is **not** here: any audit status field. The status is derived from
 * the audits we hold, so there is no column anybody can set to "verified".
 */
export interface SkillRecord {
  /** The stable key. Lowercase, `[a-z0-9-]`. */
  id: string;
  name: string;
  kind: SkillKind;
  /** The version currently served. */
  version: string;
  /** The digest of the build currently served — compared against the audited one. */
  contentSha256: string;
  /** Where the artefact is fetched from. */
  sourceUri: string;
  /** What the skill **claims** to do. The primary tool-poisoning surface. */
  declaredDescription: string;
  /** What it claims it can do. Contrast with the audit's observed capabilities. */
  declaredCapabilities: string[];
  authorAddress: Address | null;
  authorName: string | null;
  tags: string[];
  /** Per-version license price, USD 8 decimals. `0n` = free. */
  priceUsd8PerVersion: bigint;
  /**
   * Deterministic pre-screen of the declared description, run at registration.
   *
   * **This is not an audit and must never be presented as one.** It is a regex
   * pass over the text an attacker controls; it can only ever raise suspicion,
   * never clear a skill. A skill with zero intake findings is still
   * `UNAUDITED`.
   */
  intakeFindings: SkillFinding[];
  versions: SkillVersionRecord[];
  createdAt: string;
  updatedAt: string;
  source: SkillSource;
  /** ISO 8601 UTC. Data age is computed from this. */
  fetchedAt: string;
  /**
   * `true` for the curated illustrative records shipped in this bundle.
   *
   * Never hidden and never defaulted away: an example rendered as a real
   * marketplace listing is exactly the kind of quiet over-claim this backend
   * exists to avoid.
   */
  example: boolean;
}

/** One audit job against one exact build of one skill. */
export interface AuditRecord {
  id: string;
  skillId: string;
  /** The version string the auditor was given. */
  skillVersion: string;
  /**
   * **The digest the auditor actually examined.** This is the field that stops a
   * rug-pull: when it stops matching `SkillRecord.contentSha256`, the verdict
   * stops applying and the status drops to `STALE_AUDIT`.
   */
  auditedSha256: string;
  /** `null` while the RFQ has no selected auditor. */
  auditorId: string | null;
  tier: AuditTier;
  /** What the developer asked to be checked. */
  scope: string[];
  state: AuditState;
  /** `null` until a verdict is handed over. */
  verdict: AuditVerdict | null;
  risk: RiskLevel | null;
  summary: string | null;
  /** What the auditor observed the skill **actually** does. */
  observedCapabilities: string[];
  stages: AuditStageResult[];
  findings: SkillFinding[];
  /** The accepted quote, USD 8 decimals. */
  feeUsd8: bigint;
  /** The auditor's honesty collateral, USD 8 decimals. */
  bondUsd8: bigint;
  escrow: EscrowRef;
  evidence: AuditEvidence;
  requestedAt: string;
  completedAt: string | null;
  source: SkillSource;
  fetchedAt: string;
  example: boolean;
}

/** Reputation of one auditor, and **where each number came from**. */
export interface AuditorReputation {
  /**
   * Average review score x100 (450 = 4.50) read from `FuguReputation`
   * (`0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400`). `null` when not read.
   */
  averageScoreX100: number | null;
  reviewCount: number | null;
  /**
   * The provenance of the two numbers above — never `"onchain"` unless a chain
   * read genuinely succeeded.
   *
   * - `onchain`     — read from the contract.
   * - `unavailable` — no reputation reader wired, or the auditor is not mapped
   *                   to a listing. **Not a failure.**
   * - `unhealthy`   — a reader is wired and the read failed.
   */
  source: "onchain" | "unavailable" | "unhealthy";
  reason: string | null;
  contract: Address | null;
  fetchedAt: string | null;
}

/** An auditor and its track record. */
export interface AuditorRecord {
  id: string;
  displayName: string;
  address: Address | null;
  /**
   * The `FuguRegistry` listing this auditor's reputation maps onto.
   *
   * Auditors are agents, and this project already has a live, subscription-gated
   * review contract for agents — so reputation is read from
   * `FuguReputation.averageScoreX100(listingId)` rather than reinvented.
   * `null` means the auditor has no listing yet, which is why
   * {@link AuditorReputation.source} would then be `unavailable`.
   */
  reputationListingId: bigint | null;
  specialization: string[];
  /** Collateral currently posted, USD 8 decimals. */
  bondUsd8: bigint;
  auditsCompleted: number;
  verdictsSafe: number;
  verdictsDangerous: number;
  /**
   * Times this auditor's bond was slashed for a verdict later proven wrong.
   *
   * Shown even when zero: an auditor with no slashes and an auditor with no
   * audits look identical unless both numbers are visible.
   */
  slashes: number;
  reputation: AuditorReputation;
  source: SkillSource;
  fetchedAt: string;
  example: boolean;
}

// ---------------------------------------------------------------------------
// The derived trust verdict
// ---------------------------------------------------------------------------

/**
 * What we are willing to say about one skill's safety, and why.
 *
 * Always computed from records, never stored. `reason` is always a full
 * sentence, because a status code alone invites a UI to guess.
 */
export interface SkillTrust {
  status: AuditStatus;
  /** `true` for `PASSED` only. */
  verified: boolean;
  /** `true` for every status that means we cannot vouch for this build. */
  unknown: boolean;
  reason: string;
  /** The verdict of the audit this status is based on. `null` when none. */
  verdict: AuditVerdict | null;
  risk: RiskLevel | null;
  auditId: string | null;
  auditorId: string | null;
  /** The digest the deciding audit examined. `null` when there is no audit. */
  auditedSha256: string | null;
  /** The digest currently served. */
  currentSha256: string;
  /** `true` when the two digests above differ — the rug-pull signal. */
  buildChanged: boolean;
  evidence: AuditEvidence;
  completedAt: string | null;
  /** How many audits are on record for this skill, in any state. */
  auditCount: number;
}

/** `sha256` in the only form we accept: 64 lowercase hex characters. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const NO_EVIDENCE: AuditEvidence = { uri: null, sha256: null, complete: false };

function latestOf(audits: readonly AuditRecord[]): AuditRecord | null {
  let best: AuditRecord | null = null;
  for (const audit of audits) {
    if (best === null) {
      best = audit;
      continue;
    }
    const a = Date.parse(audit.requestedAt);
    const b = Date.parse(best.requestedAt);
    // A malformed timestamp must not silently win. `NaN` comparisons are always
    // false, so such a record only wins the id tie-break below.
    if (a > b || (a === b && audit.id > best.id)) best = audit;
  }
  return best;
}

const IN_FLIGHT: readonly AuditState[] = ["REQUESTED", "QUOTED", "FUNDED", "RUNNING"];

/**
 * **The single place a skill is allowed to be called verified.**
 *
 * The order of the checks is the argument:
 *
 * 1. **An audit of the build actually being served wins**, whatever else exists.
 *    A completed audit of *this* digest is the only thing that can produce
 *    `PASSED`, and it is also what produces `FAILED`.
 * 2. **A running audit of this build** is `AUDITING` / `AUDIT_REQUESTED` — in
 *    flight is not a verdict.
 * 3. **Only then** do audits of *other* builds get to speak, and they can only
 *    ever produce `STALE_AUDIT`: the auditor examined bytes that are no longer
 *    the bytes being served. That is precisely the rug-pull case — clean v1,
 *    malicious v2 — and it must not inherit v1's badge. The old verdict still
 *    travels in `verdict`, so a UI can warn "the previous build was flagged
 *    DANGEROUS" instead of showing nothing.
 * 4. **A `SAFE` verdict we cannot evidence is `INCONCLUSIVE`, not `PASSED`.**
 *    A green badge is a claim; without a report URI, its digest, and a named
 *    auditor, we have no claim to make. This is the check that keeps a
 *    half-written row from minting trust.
 */
export function deriveTrust(
  skill: Pick<SkillRecord, "contentSha256">,
  audits: readonly AuditRecord[],
): SkillTrust {
  const current = skill.contentSha256;
  const base = {
    currentSha256: current,
    auditCount: audits.length,
  };

  const forThisBuild = audits.filter((a) => a.auditedSha256 === current);
  const completedHere = forThisBuild.filter((a) => a.state === "COMPLETE");
  const decided = latestOf(completedHere);

  if (decided !== null) {
    const shared = {
      ...base,
      verdict: decided.verdict,
      risk: decided.risk,
      auditId: decided.id,
      auditorId: decided.auditorId,
      auditedSha256: decided.auditedSha256,
      buildChanged: false,
      evidence: decided.evidence,
      completedAt: decided.completedAt,
    };

    if (decided.verdict === "DANGEROUS") {
      return {
        ...shared,
        status: "FAILED",
        verified: false,
        unknown: false,
        reason:
          `audit ${decided.id} examined this exact build and found it dangerous` +
          `${decided.risk === null ? "" : ` (risk: ${decided.risk})`}`,
      };
    }

    if (decided.verdict === "SAFE") {
      if (!decided.evidence.complete || decided.auditorId === null) {
        return {
          ...shared,
          status: "INCONCLUSIVE",
          verified: false,
          unknown: true,
          reason:
            `audit ${decided.id} reports a clean verdict, but we do not hold the ` +
            `evidence for it (${decided.auditorId === null ? "no auditor recorded" : "no report URI or digest"}) — ` +
            "an unevidenced verdict is not proof, so this skill is not shown as verified",
        };
      }
      return {
        ...shared,
        status: "PASSED",
        verified: true,
        unknown: false,
        reason:
          `audit ${decided.id} examined this exact build (sha256 ${current.slice(0, 12)}…) ` +
          `and found it safe; the full report is held at ${decided.evidence.uri}`,
      };
    }

    return {
      ...shared,
      status: "INCONCLUSIVE",
      verified: false,
      unknown: true,
      reason:
        `audit ${decided.id} ran against this build and could not reach a verdict` +
        `${decided.summary === null ? "" : `: ${decided.summary}`}`,
    };
  }

  const running = latestOf(forThisBuild.filter((a) => IN_FLIGHT.includes(a.state)));
  if (running !== null) {
    const inProgress = running.state === "RUNNING";
    return {
      ...base,
      status: inProgress ? "AUDITING" : "AUDIT_REQUESTED",
      verified: false,
      unknown: true,
      verdict: null,
      risk: null,
      auditId: running.id,
      auditorId: running.auditorId,
      auditedSha256: running.auditedSha256,
      buildChanged: false,
      evidence: running.evidence,
      completedAt: null,
      reason: inProgress
        ? `audit ${running.id} is running against this build; there is no verdict yet`
        : `audit ${running.id} is ${running.state.toLowerCase()} and has not started producing a verdict`,
    };
  }

  const stale = latestOf(audits.filter((a) => a.state === "COMPLETE"));
  if (stale !== null) {
    return {
      ...base,
      status: "STALE_AUDIT",
      verified: false,
      unknown: true,
      verdict: stale.verdict,
      risk: stale.risk,
      auditId: stale.id,
      auditorId: stale.auditorId,
      auditedSha256: stale.auditedSha256,
      buildChanged: true,
      evidence: stale.evidence,
      completedAt: stale.completedAt,
      reason:
        `the newest completed audit (${stale.id}) examined build ` +
        `${stale.auditedSha256.slice(0, 12)}… of version ${stale.skillVersion}, ` +
        `not the ${current.slice(0, 12)}… being served now — ` +
        `its ${stale.verdict ?? "unknown"} verdict does not carry over to this build`,
    };
  }

  return {
    ...base,
    status: "UNAUDITED",
    verified: false,
    unknown: true,
    verdict: null,
    risk: null,
    auditId: null,
    auditorId: null,
    auditedSha256: null,
    buildChanged: false,
    evidence: NO_EVIDENCE,
    completedAt: null,
    reason:
      audits.length === 0
        ? "no audit has ever been requested for this skill"
        : "every audit on record was abandoned before producing a verdict",
  };
}

/** A skill together with what we are willing to say about it. */
export interface SkillWithTrust extends SkillRecord {
  trust: SkillTrust;
}

/** An empty {@link AuditEvidence}. Exported so callers do not invent their own. */
export function noEvidence(): AuditEvidence {
  return { ...NO_EVIDENCE };
}

/** Build an {@link AuditEvidence}, computing `complete` rather than trusting it. */
export function makeEvidence(uri: string | null, sha256: string | null): AuditEvidence {
  const cleanUri = uri !== null && uri.trim() !== "" ? uri.trim() : null;
  const cleanHash =
    sha256 !== null && SHA256_PATTERN.test(sha256.trim().toLowerCase())
      ? sha256.trim().toLowerCase()
      : null;
  return { uri: cleanUri, sha256: cleanHash, complete: cleanUri !== null && cleanHash !== null };
}

/** An escrow reference for a job that has no on-chain leg yet. */
export function notWiredEscrow(chainId: number, contract: Address | null = null): EscrowRef {
  return {
    chainId,
    contract,
    jobId: null,
    status: contract === null ? "NOT_WIRED" : "OPEN",
    feeTxHash: null,
    bondTxHash: null,
    settlementTxHash: null,
  };
}
