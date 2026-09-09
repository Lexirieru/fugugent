/**
 * The skill service: the fallback ladder, the write path, and reputation
 * provenance.
 *
 * Every source is injected — no test here touches a network, an RPC endpoint, or
 * Postgres. The behaviours defended:
 *
 * - a sick registry produces an honest empty plus the examples, never a throw;
 * - "not installed" and "broken" stay different states in `trail`;
 * - a registration that did not persist is reported as a failure, not a success;
 * - a reputation number is never invented when we could not read one.
 */
import { describe, expect, it, vi } from "vitest";
import { seedAudits, seedAuditors, seedSkills, SKILL_SEED_NOTICE } from "../seed.js";
import { createMemorySkillStore, type SkillStorePort } from "../store.js";
import { createSkillService, censusOfTrust } from "../service.js";
import type { AuditorReputationSource } from "../reputation.js";
import { AUDIT_STATUSES } from "../types.js";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const now = () => NOW;

function service(overrides: Parameters<typeof createSkillService>[0] = {}) {
  return createSkillService({ now, ...overrides });
}

const SHA = "f".repeat(64);

function submission(overrides: Record<string, unknown> = {}) {
  return {
    name: "My Skill",
    kind: "CLAUDE_SKILL",
    version: "1.0.0",
    contentSha256: SHA,
    sourceUri: "https://example.invalid/s",
    declaredDescription: "Does one useful thing.",
    ...overrides,
  };
}

describe("listSkills — the fallback ladder", () => {
  it("with no registry installed it serves the examples and says the level is unavailable", async () => {
    const page = await service().listSkills({});
    expect(page.source).toBe("seed");
    expect(page.degraded).toBe(true);
    expect(page.items.length).toBeGreaterThan(0);
    const registry = page.trail.find((t) => t.source === "registry");
    // `unavailable`, not `unhealthy`: a backend without DATABASE_URL is a
    // configuration, not a breakage.
    expect(registry?.outcome).toBe("unavailable");
  });

  it("an unhealthy registry falls through to the examples instead of throwing", async () => {
    const page = await service({
      store: createMemorySkillStore({ failWith: "PostgresError: connection refused" }),
    }).listSkills({});
    expect(page.source).toBe("seed");
    expect(page.trail.find((t) => t.source === "registry")?.outcome).toBe("unhealthy");
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("a registry that throws is recorded as `threw` and still answers", async () => {
    const broken: SkillStorePort = {
      listSkills: () => Promise.reject(new Error("boom")),
      getSkill: () => Promise.reject(new Error("boom")),
      listAuditors: () => Promise.reject(new Error("boom")),
      putSkill: () => Promise.reject(new Error("boom")),
      putAudit: () => Promise.reject(new Error("boom")),
      putAuditor: () => Promise.reject(new Error("boom")),
    };
    const page = await service({ store: broken }).listSkills({});
    expect(page.trail.find((t) => t.source === "registry")?.outcome).toBe("threw");
    expect(page.source).toBe("seed");
    expect(page.healthy).toBe(true);
  });

  it("a healthy but empty registry is `empty`, not `unhealthy`", async () => {
    const page = await service({ store: createMemorySkillStore() }).listSkills({});
    expect(page.trail.find((t) => t.source === "registry")?.outcome).toBe("empty");
  });

  it("a populated registry answers without the examples", async () => {
    const store = createMemorySkillStore();
    const registered = await service({ store }).registerSkill(submission());
    expect(registered.stored).toBe(true);

    const page = await service({ store }).listSkills({});
    expect(page.source).toBe("registry");
    expect(page.degraded).toBe(false);
    expect(page.items).toHaveLength(1);
    expect(page.notice).toBeNull();
    expect(page.itemSources).toEqual({ registry: 1 });
  });
});

describe("examples are always marked as examples", () => {
  it("every seeded record carries example: true", () => {
    expect(seedSkills().every((s) => s.example)).toBe(true);
    expect(seedAudits().every((a) => a.example)).toBe(true);
    expect(seedAuditors().every((a) => a.example)).toBe(true);
  });

  it("every seeded id is prefixed so it cannot be mistaken for a real listing", () => {
    expect(seedSkills().every((s) => s.id.startsWith("example-"))).toBe(true);
    expect(seedAuditors().every((a) => a.id.startsWith("example-"))).toBe(true);
  });

  it("a response containing examples carries the notice", async () => {
    const page = await service().listSkills({});
    expect(page.notice).toBe(SKILL_SEED_NOTICE);
    expect(page.notice).toContain("not real skills");
  });

  it("the seeded age is the real curation age, not zero", async () => {
    const page = await service().listSkills({});
    expect(page.ageSeconds).toBeGreaterThan(0);
    expect(page.stale).toBe(true);
  });

  it("the example set exercises every one of the seven statuses", async () => {
    const page = await service().listSkills({ limit: 100 });
    const seen = new Set(page.items.map((item) => item.trust.status));
    for (const status of AUDIT_STATUSES) {
      expect(seen.has(status), `no example produces ${status}`).toBe(true);
    }
  });

  it("the rug-pull example really has two different digests on record", () => {
    const skill = seedSkills().find((s) => s.id === "example-tax-reporter")!;
    const digests = new Set(skill.versions.map((v) => v.contentSha256));
    expect(digests.size).toBe(2);
    expect(digests.has(skill.contentSha256)).toBe(true);
  });
});

describe("registerSkill — a write that did not persist is never reported as one", () => {
  it("stores a valid submission and derives UNAUDITED for it", async () => {
    const result = await service({ store: createMemorySkillStore() }).registerSkill(submission());
    expect(result.ok).toBe(true);
    expect(result.stored).toBe(true);
    expect(result.skill?.trust.status).toBe("UNAUDITED");
    expect(result.skill?.trust.verified).toBe(false);
  });

  it("reports `durable: false` for an in-process store rather than implying storage", async () => {
    const result = await service({ store: createMemorySkillStore() }).registerSkill(submission());
    expect(result.durable).toBe(false);
  });

  it("with no store at all it reports stored: false with a reason", async () => {
    const result = await service().registerSkill(submission());
    expect(result.ok).toBe(false);
    expect(result.stored).toBe(false);
    expect(result.reason).toContain("was not stored");
    // The record it *would* have stored is still returned, so a caller can see
    // exactly what was rejected.
    expect(result.skill?.id).toBe("my-skill");
  });

  it("a store that throws mid-write surfaces as a failure, never as a success", async () => {
    const result = await service({
      store: createMemorySkillStore({ failWith: "PostgresError: disk full" }),
    }).registerSkill(submission());
    expect(result.ok).toBe(false);
    expect(result.stored).toBe(false);
    expect(result.reason).toContain("disk full");
  });

  it("an invalid submission names the offending field and is not a storage failure", async () => {
    const result = await service({ store: createMemorySkillStore() }).registerSkill(
      submission({ contentSha256: "nope" }),
    );
    expect(result.invalid?.field).toBe("contentSha256");
    expect(result.stored).toBe(false);
  });

  it("a registration can never arrive already carrying a verdict", async () => {
    const result = await service({ store: createMemorySkillStore() }).registerSkill(
      submission({ trust: { status: "PASSED", verified: true }, verdict: "SAFE" }),
    );
    expect(result.skill?.trust.status).toBe("UNAUDITED");
    expect(result.skill?.trust.verified).toBe(false);
  });
});

describe("getSkill", () => {
  it("a registry that is not installed leaves the trail uncertain", async () => {
    const detail = await service().getSkill("does-not-exist");
    expect(detail.skill).toBeNull();
    expect(detail.trail.some((t) => t.outcome === "unavailable")).toBe(true);
  });

  it("a healthy registry that does not hold it reports `empty`, an answer rather than a doubt", async () => {
    const detail = await service({ store: createMemorySkillStore() }).getSkill("does-not-exist");
    expect(detail.trail.find((t) => t.source === "registry")?.outcome).toBe("empty");
  });

  it("returns the full audit history for a seeded skill", async () => {
    const detail = await service().getSkill("example-pdf-toolkit");
    expect(detail.skill?.trust.status).toBe("FAILED");
    expect(detail.audits.length).toBeGreaterThan(0);
    expect(detail.audits[0]!.findings.length).toBeGreaterThan(0);
  });

  it("one skill never inherits another skill's audits", async () => {
    const detail = await service().getSkill("example-gas-estimator");
    expect(detail.audits).toHaveLength(0);
    expect(detail.skill?.trust.status).toBe("UNAUDITED");
  });
});

describe("listAuditors — reputation provenance is never fabricated", () => {
  it("with no reader wired, reputation is `unavailable` with null numbers", async () => {
    const list = await service().listAuditors();
    expect(list.items.length).toBeGreaterThan(0);
    for (const auditor of list.items) {
      expect(auditor.reputation.source).toBe("unavailable");
      // Not zero. Zero is a rating; null is the absence of one.
      expect(auditor.reputation.averageScoreX100).toBeNull();
      expect(auditor.reputation.reviewCount).toBeNull();
    }
    expect(list.reputationSources.unavailable).toBe(list.items.length);
  });

  it("a working reader produces `onchain` with the contract named", async () => {
    const reputation: AuditorReputationSource = {
      contract: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
      read: async () => ({
        averageScoreX100: 450,
        reviewCount: 12,
        healthy: true,
        reason: null,
      }),
    };
    const list = await service({ reputation }).listAuditors();
    const mapped = list.items.filter((a) => a.reputationListingId !== null);
    expect(mapped.length).toBeGreaterThan(0);
    for (const auditor of mapped) {
      expect(auditor.reputation.source).toBe("onchain");
      expect(auditor.reputation.averageScoreX100).toBe(450);
      expect(auditor.reputation.contract).toBe("0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400");
    }
  });

  it("an auditor with no listing stays `unavailable` even when a reader is wired", async () => {
    const read = vi.fn(async () => ({
      averageScoreX100: 500,
      reviewCount: 3,
      healthy: true,
      reason: null,
    }));
    const list = await service({
      reputation: { contract: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400", read },
    }).listAuditors();
    const unmapped = list.items.filter((a) => a.reputationListingId === null);
    expect(unmapped.length).toBeGreaterThan(0);
    for (const auditor of unmapped) {
      expect(auditor.reputation.source).toBe("unavailable");
      expect(auditor.reputation.averageScoreX100).toBeNull();
    }
    // The unmapped ones were never asked for.
    expect(read).toHaveBeenCalledTimes(list.items.length - unmapped.length);
  });

  it("a failing read is `unhealthy` — distinguishable from never having been read", async () => {
    const list = await service({
      reputation: {
        contract: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
        read: async () => ({
          averageScoreX100: null,
          reviewCount: null,
          healthy: false,
          reason: "ContractFunctionExecutionError: reverted",
        }),
      },
    }).listAuditors();
    const mapped = list.items.filter((a) => a.reputationListingId !== null);
    for (const auditor of mapped) {
      expect(auditor.reputation.source).toBe("unhealthy");
      expect(auditor.reputation.reason).toContain("reverted");
      expect(auditor.reputation.averageScoreX100).toBeNull();
    }
    // One bad read must not take the auditor list down.
    expect(list.healthy).toBe(true);
  });

  it("a reader that throws does not take the endpoint down", async () => {
    const list = await service({
      reputation: {
        contract: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
        read: async () => {
          throw new Error("network down");
        },
      },
    }).listAuditors();
    // `attachReputation` promises not to throw; if that ever regresses this test
    // fails rather than the endpoint.
    expect(list.items.length).toBeGreaterThan(0);
  }, 10_000);
});

describe("censusOfTrust", () => {
  it("counts only the statuses actually present, leaving the rest absent", async () => {
    const page = await service().listSkills({ limit: 100 });
    const census = censusOfTrust(page.items);
    const total = Object.values(census).reduce((sum, n) => sum + (n ?? 0), 0);
    expect(total).toBe(page.items.length);
    for (const value of Object.values(census)) expect(value).toBeGreaterThan(0);
  });
});
