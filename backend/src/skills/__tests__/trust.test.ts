/**
 * `deriveTrust` — **the only place a skill is allowed to be called verified.**
 *
 * Every test here is written so that it goes red if the corresponding rule is
 * removed rather than merely reworded. The three that matter most:
 *
 * - drop the `evidence.complete` check and "a clean verdict we cannot evidence
 *   is INCONCLUSIVE" turns into a green badge;
 * - drop the digest comparison and the rug-pull test starts reporting a v2
 *   nobody audited as PASSED;
 * - collapse the five unknown statuses into "not verified" and the
 *   `unknown`/`FAILED` distinction disappears — a skill proven dangerous and a
 *   skill nobody has looked at become the same thing.
 */
import { describe, expect, it } from "vitest";
import { CHAIN_ID } from "../../config.js";
import {
  AUDIT_STATUSES,
  UNKNOWN_STATUSES,
  deriveTrust,
  makeEvidence,
  notWiredEscrow,
  type AuditRecord,
  type AuditState,
  type AuditVerdict,
} from "../types.js";

const CURRENT = "a".repeat(64);
const OTHER = "b".repeat(64);

function audit(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: "audit-1",
    skillId: "s1",
    skillVersion: "1.0.0",
    auditedSha256: CURRENT,
    auditorId: "auditor-1",
    tier: "AUTOMATED",
    scope: ["description-injection"],
    state: "COMPLETE",
    verdict: "SAFE",
    risk: "none",
    summary: "clean",
    observedCapabilities: [],
    stages: [],
    findings: [],
    feeUsd8: 100_000_000n,
    bondUsd8: 200_000_000_000n,
    escrow: notWiredEscrow(CHAIN_ID),
    evidence: makeEvidence("https://example.invalid/report.json", "c".repeat(64)),
    requestedAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:10:00.000Z",
    source: "registry",
    fetchedAt: "2026-09-01T00:10:00.000Z",
    example: false,
    ...overrides,
  };
}

const skill = { contentSha256: CURRENT };

describe("deriveTrust — the seven statuses", () => {
  it("no audits at all is UNAUDITED, and that is not safe", () => {
    const trust = deriveTrust(skill, []);
    expect(trust.status).toBe("UNAUDITED");
    expect(trust.verified).toBe(false);
    expect(trust.unknown).toBe(true);
    expect(trust.auditId).toBeNull();
    expect(trust.reason).toContain("no audit has ever been requested");
  });

  it("a clean, evidenced audit of THIS build is the only thing that produces PASSED", () => {
    const trust = deriveTrust(skill, [audit()]);
    expect(trust.status).toBe("PASSED");
    expect(trust.verified).toBe(true);
    expect(trust.unknown).toBe(false);
    expect(trust.buildChanged).toBe(false);
    expect(trust.auditId).toBe("audit-1");
  });

  it("a DANGEROUS verdict is FAILED — knowledge, not ignorance", () => {
    const trust = deriveTrust(skill, [
      audit({ verdict: "DANGEROUS", risk: "critical" }),
    ]);
    expect(trust.status).toBe("FAILED");
    expect(trust.verified).toBe(false);
    // The point: FAILED is the one non-PASSED status that is NOT `unknown`.
    expect(trust.unknown).toBe(false);
    expect(trust.risk).toBe("critical");
  });

  it("a clean verdict we cannot evidence is INCONCLUSIVE, never PASSED", () => {
    const trust = deriveTrust(skill, [audit({ evidence: makeEvidence(null, null) })]);
    expect(trust.status).toBe("INCONCLUSIVE");
    expect(trust.verified).toBe(false);
    expect(trust.unknown).toBe(true);
    expect(trust.reason).toContain("not shown as verified");
  });

  it("a report URI without its digest is still not evidence", () => {
    const trust = deriveTrust(skill, [
      audit({ evidence: makeEvidence("https://example.invalid/report.json", null) }),
    ]);
    expect(trust.status).toBe("INCONCLUSIVE");
    expect(trust.verified).toBe(false);
  });

  it("a clean verdict with no named auditor is INCONCLUSIVE — nobody staked anything on it", () => {
    const trust = deriveTrust(skill, [audit({ auditorId: null })]);
    expect(trust.status).toBe("INCONCLUSIVE");
    expect(trust.verified).toBe(false);
    expect(trust.reason).toContain("no auditor recorded");
  });

  it("an audit that ran and could not conclude is INCONCLUSIVE, not silence", () => {
    const trust = deriveTrust(skill, [
      audit({ verdict: "INCONCLUSIVE", summary: "sandbox timed out" }),
    ]);
    expect(trust.status).toBe("INCONCLUSIVE");
    expect(trust.unknown).toBe(true);
    expect(trust.reason).toContain("sandbox timed out");
  });

  it("a running audit is AUDITING — in flight is not a verdict", () => {
    const trust = deriveTrust(skill, [
      audit({ state: "RUNNING", verdict: null, risk: null, completedAt: null }),
    ]);
    expect(trust.status).toBe("AUDITING");
    expect(trust.verified).toBe(false);
    expect(trust.verdict).toBeNull();
  });

  it.each<AuditState>(["REQUESTED", "QUOTED", "FUNDED"])(
    "state %s is AUDIT_REQUESTED",
    (state) => {
      const trust = deriveTrust(skill, [
        audit({ state, verdict: null, risk: null, completedAt: null }),
      ]);
      expect(trust.status).toBe("AUDIT_REQUESTED");
      expect(trust.unknown).toBe(true);
    },
  );

  it("audits that were all abandoned leave the skill UNAUDITED, and say so", () => {
    const trust = deriveTrust(skill, [
      audit({ state: "ABANDONED", verdict: null, completedAt: null }),
    ]);
    expect(trust.status).toBe("UNAUDITED");
    expect(trust.reason).toContain("abandoned");
  });
});

describe("deriveTrust — the rug-pull guard", () => {
  it("a clean v1 does NOT vouch for a v2 with different bytes", () => {
    const trust = deriveTrust(
      { contentSha256: OTHER },
      [audit({ auditedSha256: CURRENT, skillVersion: "1.0.0" })],
    );
    expect(trust.status).toBe("STALE_AUDIT");
    expect(trust.verified).toBe(false);
    expect(trust.unknown).toBe(true);
    expect(trust.buildChanged).toBe(true);
    // The old verdict is still carried, so a UI can explain rather than hide.
    expect(trust.verdict).toBe("SAFE");
    expect(trust.auditedSha256).toBe(CURRENT);
    expect(trust.currentSha256).toBe(OTHER);
    expect(trust.reason).toContain("does not carry over");
  });

  it("a DANGEROUS verdict about an older build also does not carry over — but is still shown", () => {
    const trust = deriveTrust({ contentSha256: OTHER }, [audit({ verdict: "DANGEROUS" })]);
    expect(trust.status).toBe("STALE_AUDIT");
    expect(trust.verdict).toBe("DANGEROUS");
    // We do not know about THIS build, so `unknown` is right even though the
    // previous build was proven bad.
    expect(trust.unknown).toBe(true);
  });

  it("an audit of the served build wins over a newer audit of a different one", () => {
    const trust = deriveTrust(skill, [
      audit({ id: "old-but-relevant", requestedAt: "2026-01-01T00:00:00.000Z" }),
      audit({
        id: "new-but-irrelevant",
        auditedSha256: OTHER,
        verdict: "DANGEROUS",
        requestedAt: "2026-09-09T00:00:00.000Z",
      }),
    ]);
    expect(trust.status).toBe("PASSED");
    expect(trust.auditId).toBe("old-but-relevant");
  });

  it("among audits of the served build, the newest completed one decides", () => {
    const trust = deriveTrust(skill, [
      audit({ id: "first", requestedAt: "2026-01-01T00:00:00.000Z" }),
      audit({
        id: "second",
        verdict: "DANGEROUS",
        risk: "high",
        requestedAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);
    expect(trust.status).toBe("FAILED");
    expect(trust.auditId).toBe("second");
  });

  it("a completed audit of this build outranks one still running against it", () => {
    const trust = deriveTrust(skill, [
      audit({ id: "running", state: "RUNNING", verdict: null, requestedAt: "2026-09-09T00:00:00.000Z" }),
      audit({ id: "done", requestedAt: "2026-09-01T00:00:00.000Z" }),
    ]);
    expect(trust.status).toBe("PASSED");
    expect(trust.auditId).toBe("done");
  });
});

describe("deriveTrust — the invariants", () => {
  it("`verified` is true for PASSED and for nothing else", () => {
    const cases: { audits: AuditRecord[]; current: string }[] = [
      { audits: [], current: CURRENT },
      { audits: [audit()], current: CURRENT },
      { audits: [audit({ verdict: "DANGEROUS" })], current: CURRENT },
      { audits: [audit({ evidence: makeEvidence(null, null) })], current: CURRENT },
      { audits: [audit({ state: "RUNNING", verdict: null })], current: CURRENT },
      { audits: [audit({ state: "REQUESTED", verdict: null })], current: CURRENT },
      { audits: [audit()], current: OTHER },
      { audits: [audit({ verdict: "INCONCLUSIVE" })], current: CURRENT },
    ];
    for (const { audits, current } of cases) {
      const trust = deriveTrust({ contentSha256: current }, audits);
      expect(trust.verified).toBe(trust.status === "PASSED");
    }
  });

  it("`unknown` is exactly the complement of PASSED and FAILED", () => {
    for (const status of AUDIT_STATUSES) {
      const expected = status !== "PASSED" && status !== "FAILED";
      expect(UNKNOWN_STATUSES.includes(status)).toBe(expected);
    }
  });

  it("every status carries a reason a human can read", () => {
    const samples: AuditRecord[][] = [
      [],
      [audit()],
      [audit({ verdict: "DANGEROUS" })],
      [audit({ evidence: makeEvidence(null, null) })],
      [audit({ state: "RUNNING", verdict: null })],
      [audit({ state: "ABANDONED", verdict: null })],
    ];
    for (const audits of samples) {
      expect(deriveTrust(skill, audits).reason.length).toBeGreaterThan(20);
    }
    expect(deriveTrust({ contentSha256: OTHER }, [audit()]).reason.length).toBeGreaterThan(20);
  });

  it("`auditCount` counts every audit on record, whatever it decided", () => {
    const trust = deriveTrust(skill, [
      audit({ id: "a" }),
      audit({ id: "b", state: "ABANDONED", verdict: null }),
      audit({ id: "c", auditedSha256: OTHER }),
    ]);
    expect(trust.auditCount).toBe(3);
  });
});

describe("makeEvidence", () => {
  it("`complete` is computed, never taken on trust", () => {
    expect(makeEvidence("https://x.invalid/r", "d".repeat(64)).complete).toBe(true);
    expect(makeEvidence("https://x.invalid/r", "not-a-digest").complete).toBe(false);
    expect(makeEvidence("  ", "d".repeat(64)).complete).toBe(false);
    expect(makeEvidence(null, null).complete).toBe(false);
  });

  it("a digest that is not 64 hex characters is dropped rather than stored as-is", () => {
    expect(makeEvidence("https://x.invalid/r", "ABC").sha256).toBeNull();
    expect(makeEvidence("https://x.invalid/r", "D".repeat(64)).sha256).toBe("d".repeat(64));
  });
});

describe("notWiredEscrow", () => {
  it("says NOT_WIRED while the escrow contract has no address, and OPEN once it does", () => {
    expect(notWiredEscrow(CHAIN_ID).status).toBe("NOT_WIRED");
    expect(notWiredEscrow(CHAIN_ID).contract).toBeNull();
    const wired = notWiredEscrow(CHAIN_ID, "0x00000000000000000000000000000000000000e5");
    expect(wired.status).toBe("OPEN");
  });
});
