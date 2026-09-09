/**
 * **The only place** a skill-marketplace record changes shape.
 *
 * `SkillRecord.priceUsd8PerVersion`, `AuditRecord.feeUsd8`/`bondUsd8` and
 * `AuditorRecord.bondUsd8` are `bigint`s, so these records are **not
 * JSON-serializable as-is** — `JSON.stringify` throws the moment it meets one.
 *
 * This file follows exactly the rule `src/db/serialize.ts` already sets for
 * `AgentRecord`, and reuses its `encodeMoney` / `decodeMoney` primitives rather
 * than inventing a second money convention: **decimal strings on the outside,
 * `bigint` on the inside, `number` never.**
 */

import { decodeMoney, encodeMoney } from "../db/serialize.js";
import type {
  AuditRecord,
  AuditorRecord,
  SkillRecord,
  SkillWithTrust,
} from "./types.js";

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** A `SkillRecord` with every `bigint` replaced by a decimal string. */
export interface SkillRecordJson extends Omit<SkillRecord, "priceUsd8PerVersion"> {
  /** USD, 8 decimals, as a decimal string. `"1500000000"` = $15.00. */
  priceUsd8PerVersion: string;
}

/** A `SkillWithTrust` on the wire. */
export interface SkillWithTrustJson extends SkillRecordJson {
  trust: SkillWithTrust["trust"];
}

export interface AuditRecordJson extends Omit<AuditRecord, "feeUsd8" | "bondUsd8"> {
  feeUsd8: string;
  bondUsd8: string;
}

export interface AuditorRecordJson
  extends Omit<AuditorRecord, "bondUsd8" | "reputationListingId"> {
  bondUsd8: string;
  /** Decimal string, or `null` when the auditor is not mapped to a listing. */
  reputationListingId: string | null;
}

export function serializeSkill(skill: SkillRecord): SkillRecordJson {
  return { ...skill, priceUsd8PerVersion: encodeMoney(skill.priceUsd8PerVersion) };
}

export function serializeSkillWithTrust(skill: SkillWithTrust): SkillWithTrustJson {
  return { ...serializeSkill(skill), trust: skill.trust };
}

export function deserializeSkill(json: SkillRecordJson): SkillRecord {
  return { ...json, priceUsd8PerVersion: decodeMoney(json.priceUsd8PerVersion) };
}

export function serializeAudit(audit: AuditRecord): AuditRecordJson {
  return {
    ...audit,
    feeUsd8: encodeMoney(audit.feeUsd8),
    bondUsd8: encodeMoney(audit.bondUsd8),
  };
}

export function deserializeAudit(json: AuditRecordJson): AuditRecord {
  return {
    ...json,
    feeUsd8: decodeMoney(json.feeUsd8),
    bondUsd8: decodeMoney(json.bondUsd8),
  };
}

export function serializeAuditor(auditor: AuditorRecord): AuditorRecordJson {
  return {
    ...auditor,
    bondUsd8: encodeMoney(auditor.bondUsd8),
    reputationListingId:
      auditor.reputationListingId === null ? null : encodeMoney(auditor.reputationListingId),
  };
}

export function deserializeAuditor(json: AuditorRecordJson): AuditorRecord {
  return {
    ...json,
    bondUsd8: decodeMoney(json.bondUsd8),
    reputationListingId:
      json.reputationListingId === null ? null : decodeMoney(json.reputationListingId),
  };
}
