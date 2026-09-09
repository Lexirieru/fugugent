/**
 * Money on the wire.
 *
 * The property being defended is small and absolute: a record holding `bigint`s
 * cannot be handed to `JSON.stringify`, and the conversion that makes it
 * possible must not lose a digit. The first test asserts the raw record really
 * does throw — without it, "serialization goes through one door" is a claim
 * nobody is checking.
 */
import { describe, expect, it } from "vitest";
import { CHAIN_ID } from "../../config.js";
import {
  deserializeAudit,
  deserializeAuditor,
  deserializeSkill,
  serializeAudit,
  serializeAuditor,
  serializeSkill,
  serializeSkillWithTrust,
} from "../serialize.js";
import { seedAudits, seedAuditors, seedSkills } from "../seed.js";
import { deriveTrust, makeEvidence, notWiredEscrow, type AuditRecord } from "../types.js";

const MAX_UINT256 = 2n ** 256n - 1n;

describe("a raw record is not JSON-serializable — which is why this module exists", () => {
  it("JSON.stringify over a skill holding a bigint price throws", () => {
    const skill = seedSkills()[0]!;
    expect(() => JSON.stringify(skill)).toThrow(TypeError);
  });

  it("JSON.stringify over the serialized form does not", () => {
    const skill = seedSkills()[0]!;
    expect(() => JSON.stringify(serializeSkill(skill))).not.toThrow();
  });

  it("an audit holding fee and bond bigints throws until serialized", () => {
    const audit = seedAudits()[0]!;
    expect(() => JSON.stringify(audit)).toThrow(TypeError);
    expect(() => JSON.stringify(serializeAudit(audit))).not.toThrow();
  });

  it("an auditor holding a bond and a listing id throws until serialized", () => {
    const auditor = seedAuditors()[0]!;
    expect(() => JSON.stringify(auditor)).toThrow(TypeError);
    expect(() => JSON.stringify(serializeAuditor(auditor))).not.toThrow();
  });
});

describe("money crosses as a decimal string and comes back exact", () => {
  it("a price round-trips at the top of uint256 without losing a digit", () => {
    const skill = { ...seedSkills()[0]!, priceUsd8PerVersion: MAX_UINT256 };
    const json = serializeSkill(skill);
    expect(json.priceUsd8PerVersion).toBe(MAX_UINT256.toString(10));
    // Never scientific notation — a `1e+77` is an unpayable price.
    expect(json.priceUsd8PerVersion).not.toContain("e");
    expect(deserializeSkill(json).priceUsd8PerVersion).toBe(MAX_UINT256);
  });

  it("USD 8 decimals: 12345678 means $0.12 and stays exactly that", () => {
    const json = serializeSkill({ ...seedSkills()[0]!, priceUsd8PerVersion: 12_345_678n });
    expect(json.priceUsd8PerVersion).toBe("12345678");
    expect(typeof json.priceUsd8PerVersion).toBe("string");
  });

  it("a fee and a bond round-trip independently", () => {
    const audit: AuditRecord = {
      ...seedAudits()[0]!,
      feeUsd8: MAX_UINT256,
      bondUsd8: 1n,
    };
    const back = deserializeAudit(serializeAudit(audit));
    expect(back.feeUsd8).toBe(MAX_UINT256);
    expect(back.bondUsd8).toBe(1n);
  });

  it("an auditor's listing id survives, and `null` stays `null`", () => {
    const auditor = { ...seedAuditors()[0]!, reputationListingId: MAX_UINT256 };
    expect(deserializeAuditor(serializeAuditor(auditor)).reputationListingId).toBe(MAX_UINT256);
    const unmapped = { ...auditor, reputationListingId: null };
    expect(serializeAuditor(unmapped).reputationListingId).toBeNull();
    expect(deserializeAuditor(serializeAuditor(unmapped)).reputationListingId).toBeNull();
  });

  it("no bigint survives anywhere in the serialized JSON tree", () => {
    const skill = seedSkills()[0]!;
    const json = JSON.parse(
      JSON.stringify(serializeSkillWithTrust({ ...skill, trust: deriveTrust(skill, seedAudits()) })),
    ) as unknown;
    const seen: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "bigint") seen.push(path);
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
      else if (typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(json, "$");
    expect(seen).toEqual([]);
  });
});

describe("the trust verdict travels intact on the wire", () => {
  it("`status`, `verified` and `unknown` are all present after serialization", () => {
    const skill = seedSkills().find((s) => s.id === "example-weather-lookup")!;
    const wire = serializeSkillWithTrust({ ...skill, trust: deriveTrust(skill, seedAudits()) });
    expect(wire.trust.status).toBe("PASSED");
    expect(wire.trust.verified).toBe(true);
    expect(wire.trust.unknown).toBe(false);
    expect(wire.trust.reason.length).toBeGreaterThan(0);
  });

  it("an escrow with no contract still crosses as an explicit NOT_WIRED", () => {
    const audit: AuditRecord = {
      ...seedAudits()[0]!,
      escrow: notWiredEscrow(CHAIN_ID),
      evidence: makeEvidence(null, null),
    };
    const wire = serializeAudit(audit);
    expect(wire.escrow.status).toBe("NOT_WIRED");
    expect(wire.escrow.contract).toBeNull();
    // Present as `false`, never absent — a missing key reads as falsy anyway,
    // but only by accident.
    expect(wire.evidence.complete).toBe(false);
  });
});
