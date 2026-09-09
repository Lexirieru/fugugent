/**
 * The Postgres-backed registry, exercised on PGlite — the same in-process
 * Postgres the agent cache tests use, so no test needs a running database.
 *
 * The two rules under test are the ones that protect a safety claim:
 *
 * - **a row that cannot be read is skipped and counted, never repaired**, so a
 *   corrupt row can never lend its digest to a real verdict;
 * - **`evidence.complete` is recomputed on every read**, so no row can assert
 *   we hold a report we do not.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { CHAIN_ID } from "../../config.js";
import { ensureSchema, type FuguDb } from "../../db/client.js";
import { createDbSkillStore } from "../repo.js";
import { seedAudits, seedAuditors, seedSkills } from "../seed.js";
import type { SkillStorePort } from "../store.js";
import { deriveTrust, makeEvidence, type AuditRecord, type SkillRecord } from "../types.js";

const NOW = new Date("2026-09-09T12:00:00.000Z");

async function freshStore(): Promise<{ db: FuguDb; store: SkillStorePort }> {
  const db = drizzle(new PGlite()) as unknown as FuguDb;
  await ensureSchema(db);
  return { db, store: createDbSkillStore(db, { chainId: CHAIN_ID }) };
}

function skillOf(id: string): SkillRecord {
  const base = seedSkills()[0]!;
  return { ...base, id, source: "registry", example: false };
}

describe("ensureSchema creates the skill tables alongside the agent tables", () => {
  it("all three tables exist and are queryable", async () => {
    const { db } = await freshStore();
    for (const table of ["skills", "skill_audits", "skill_auditors"]) {
      const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
      expect(rows).toBeTruthy();
    }
  });

  it("running it twice does not fail", async () => {
    const { db } = await freshStore();
    await expect(ensureSchema(db)).resolves.toBeUndefined();
  });
});

describe("round-tripping records through Postgres", () => {
  let store: SkillStorePort;
  let db: FuguDb;
  beforeEach(async () => {
    ({ db, store } = await freshStore());
  });

  it("stores a skill and reads it back with its money intact", async () => {
    const huge = 2n ** 200n;
    await store.putSkill({ ...skillOf("round-trip"), priceUsd8PerVersion: huge });
    const page = await store.listSkills({}, NOW);
    expect(page.healthy).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.priceUsd8PerVersion).toBe(huge);
  });

  it("stores an audit and derives the same status the record implies", async () => {
    const skill = skillOf("with-audit");
    await store.putSkill(skill);
    const audit: AuditRecord = {
      ...seedAudits()[0]!,
      id: "a-1",
      skillId: skill.id,
      auditedSha256: skill.contentSha256,
      source: "registry",
      example: false,
    };
    await store.putAudit(audit);

    const detail = await store.getSkill(skill.id, NOW);
    expect(detail.skill).not.toBeNull();
    expect(detail.audits).toHaveLength(1);
    expect(deriveTrust(detail.skill!, detail.audits).status).toBe("PASSED");
  });

  it("an audit of a DIFFERENT digest comes back and still yields STALE_AUDIT", async () => {
    const skill = skillOf("rugged");
    await store.putSkill(skill);
    await store.putAudit({
      ...seedAudits()[0]!,
      id: "a-old",
      skillId: skill.id,
      auditedSha256: "9".repeat(64),
      source: "registry",
      example: false,
    });
    const detail = await store.getSkill(skill.id, NOW);
    const trust = deriveTrust(detail.skill!, detail.audits);
    expect(trust.status).toBe("STALE_AUDIT");
    expect(trust.verified).toBe(false);
  });

  it("stores an auditor and never stores a reputation number with it", async () => {
    await store.putAuditor({ ...seedAuditors()[0]!, source: "registry", example: false });
    const list = await store.listAuditors(NOW);
    expect(list.items).toHaveLength(1);
    // Reputation is only ever the result of a live read.
    expect(list.items[0]!.reputation.source).toBe("unavailable");
    expect(list.items[0]!.reputation.averageScoreX100).toBeNull();
  });

  it("a re-registration updates in place rather than duplicating", async () => {
    await store.putSkill(skillOf("same-id"));
    await store.putSkill({ ...skillOf("same-id"), name: "Renamed", version: "2.0.0" });
    const page = await store.listSkills({}, NOW);
    expect(page.total).toBe(1);
    expect(page.items[0]!.name).toBe("Renamed");
  });
});

describe("evidence is recomputed, never trusted", () => {
  it("a row with a URI but no digest comes back `complete: false`", async () => {
    const { db, store } = await freshStore();
    const skill = skillOf("half-evidenced");
    await store.putSkill(skill);
    await store.putAudit({
      ...seedAudits()[0]!,
      id: "half",
      skillId: skill.id,
      auditedSha256: skill.contentSha256,
      evidence: makeEvidence("https://example.invalid/r.json", null),
      source: "registry",
      example: false,
    });

    const detail = await store.getSkill(skill.id, NOW);
    expect(detail.audits[0]!.evidence.complete).toBe(false);
    // And the consequence that matters: no green badge.
    expect(deriveTrust(detail.skill!, detail.audits).status).toBe("INCONCLUSIVE");
    void db;
  });

  it("a row hand-edited to hold both halves does come back complete", async () => {
    const { store } = await freshStore();
    const skill = skillOf("fully-evidenced");
    await store.putSkill(skill);
    await store.putAudit({
      ...seedAudits()[0]!,
      id: "full",
      skillId: skill.id,
      auditedSha256: skill.contentSha256,
      evidence: makeEvidence("https://example.invalid/r.json", "e".repeat(64)),
      source: "registry",
      example: false,
    });
    const detail = await store.getSkill(skill.id, NOW);
    expect(detail.audits[0]!.evidence.complete).toBe(true);
    expect(deriveTrust(detail.skill!, detail.audits).status).toBe("PASSED");
  });
});

describe("an unreadable row is skipped and counted, never repaired", () => {
  it("a skill row with a malformed digest is dropped from the list and reported", async () => {
    const { db, store } = await freshStore();
    await store.putSkill(skillOf("good-one"));
    await db.execute(
      sql.raw(`insert into skills (
        id, name, kind, version, content_sha256, source_uri, declared_description,
        declared_capabilities, tags, price_usd8_per_version, intake_findings, versions,
        created_at, updated_at, source, fetched_at, is_example
      ) values (
        'broken-one', 'Broken', 'CLAUDE_SKILL', '1.0.0', 'not-a-digest',
        'https://example.invalid/b', '', '[]'::jsonb, '[]'::jsonb, 0, '[]'::jsonb, '[]'::jsonb,
        now(), now(), 'registry', now(), false
      )`),
    );

    const page = await store.listSkills({}, NOW);
    expect(page.healthy).toBe(true);
    expect(page.items.map((s) => s.id)).toEqual(["good-one"]);
    expect(page.skipped).toBe(1);
    expect(page.reason).toContain("skipped");
  });

  it("a single unreadable skill is reported as unhealthy, NOT as a clean miss", async () => {
    const { db, store } = await freshStore();
    await db.execute(
      sql.raw(`insert into skills (
        id, name, kind, version, content_sha256, source_uri, declared_description,
        declared_capabilities, tags, price_usd8_per_version, intake_findings, versions,
        created_at, updated_at, source, fetched_at, is_example
      ) values (
        'corrupt', 'Corrupt', 'NOT_A_KIND', '1.0.0', '${"a".repeat(64)}',
        'https://example.invalid/c', '', '[]'::jsonb, '[]'::jsonb, 0, '[]'::jsonb, '[]'::jsonb,
        now(), now(), 'registry', now(), false
      )`),
    );
    const detail = await store.getSkill("corrupt", NOW);
    expect(detail.skill).toBeNull();
    // The distinction that stops a 404 for something that does exist.
    expect(detail.healthy).toBe(false);
    expect(detail.reason).toContain("cannot read");
  });

  it("an audit row with an unknown state is skipped rather than defaulted to COMPLETE", async () => {
    const { db, store } = await freshStore();
    const skill = skillOf("with-bad-audit");
    await store.putSkill(skill);
    await db.execute(
      sql.raw(`insert into skill_audits (
        id, skill_id, skill_version, audited_sha256, auditor_id, tier, scope, state,
        observed_capabilities, stages, findings, fee_usd8, bond_usd8, escrow,
        requested_at, source, fetched_at, is_example
      ) values (
        'bad-audit', '${skill.id}', '1.0.0', '${skill.contentSha256}', 'x', 'AUTOMATED',
        '[]'::jsonb, 'TELEPORTED', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0, 0, '{}'::jsonb,
        now(), 'registry', now(), false
      )`),
    );

    const detail = await store.getSkill(skill.id, NOW);
    expect(detail.audits).toHaveLength(0);
    // The honest consequence: no audit we can read means UNAUDITED.
    expect(deriveTrust(detail.skill!, detail.audits).status).toBe("UNAUDITED");
  });

  it("a finding with an unreadable severity is reported as critical, never as none", async () => {
    const { db, store } = await freshStore();
    const skill = skillOf("odd-finding");
    await store.putSkill(skill);
    await db.execute(
      sql.raw(`insert into skill_audits (
        id, skill_id, skill_version, audited_sha256, auditor_id, tier, scope, state, verdict,
        observed_capabilities, stages, findings, fee_usd8, bond_usd8, escrow,
        requested_at, source, fetched_at, is_example
      ) values (
        'odd', '${skill.id}', '1.0.0', '${skill.contentSha256}', 'x', 'AUTOMATED',
        '[]'::jsonb, 'COMPLETE', 'DANGEROUS', '[]'::jsonb, '[]'::jsonb,
        '[{"severity":"apocalyptic","title":"?"}]'::jsonb, 0, 0, '{}'::jsonb,
        now(), 'registry', now(), false
      )`),
    );
    const detail = await store.getSkill(skill.id, NOW);
    // Rounding an unreadable severity DOWN is the one direction that can make a
    // dangerous finding look harmless, so it rounds up.
    expect(detail.audits[0]!.findings[0]!.severity).toBe("critical");
  });
});

describe("the read path never throws, the write path deliberately does", () => {
  it("a missing table becomes healthy: false, not an exception", async () => {
    const { db, store } = await freshStore();
    await db.execute(sql.raw("drop table skill_audits"));
    await db.execute(sql.raw("drop table skills"));

    const page = await store.listSkills({}, NOW);
    expect(page.healthy).toBe(false);
    expect(page.items).toEqual([]);
    expect(page.reason).toBeTruthy();

    const detail = await store.getSkill("anything", NOW);
    expect(detail.healthy).toBe(false);

    const auditors = await store.listAuditors(NOW);
    expect(auditors.healthy).toBe(true);
  });

  it("a failed write throws so that it cannot pass unnoticed", async () => {
    const { db, store } = await freshStore();
    await db.execute(sql.raw("drop table skill_audits"));
    await db.execute(sql.raw("drop table skills"));
    await expect(store.putSkill(skillOf("nowhere"))).rejects.toThrow();
  });

  it("a skill whose digest is malformed is refused at the door, before Postgres sees it", async () => {
    const { store } = await freshStore();
    await expect(
      store.putSkill({ ...skillOf("bad"), contentSha256: "nope" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("filtering", () => {
  it("filters by kind and by search, and can hide the examples", async () => {
    const { store } = await freshStore();
    await store.putSkill({ ...skillOf("mcp-thing"), kind: "MCP_SERVER", name: "Alpha" });
    await store.putSkill({ ...skillOf("claude-thing"), kind: "CLAUDE_SKILL", name: "Beta" });
    await store.putSkill({ ...skillOf("an-example"), name: "Gamma", example: true });

    expect((await store.listSkills({ kind: "MCP_SERVER" }, NOW)).items.map((s) => s.id)).toEqual([
      "mcp-thing",
    ]);
    expect((await store.listSkills({ search: "Beta" }, NOW)).items.map((s) => s.id)).toEqual([
      "claude-thing",
    ]);
    const noExamples = await store.listSkills({ includeExamples: false }, NOW);
    expect(noExamples.items.map((s) => s.id).includes("an-example")).toBe(false);
  });

  it("a search term containing LIKE metacharacters matches literally", async () => {
    const { store } = await freshStore();
    await store.putSkill({ ...skillOf("literal"), name: "100% coverage" });
    await store.putSkill({ ...skillOf("other"), name: "unrelated" });
    const page = await store.listSkills({ search: "100%" }, NOW);
    expect(page.items.map((s) => s.id)).toEqual(["literal"]);
  });
});
