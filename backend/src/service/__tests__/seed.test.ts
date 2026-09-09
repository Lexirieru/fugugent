/**
 * The curated seed — **level four**, the last net before an empty marketplace.
 *
 * What is locked down here is not "it has content" but **its honesty**: every
 * agent in the seed must really exist (its Altana wallet can be checked in
 * `ai/<agent>/app/agent/studio.toml` and in the on-chain Keystore), must admit
 * `source: "seed"`, and must not claim anything that has not happened yet — no
 * fake `FuguRegistry` listing, no invented reputation.
 */
import { describe, expect, it } from "vitest";
import { classify } from "../../classify.js";
import { CATEGORIES, type Category } from "../../types.js";
import {
  CURATED_SEED_AT,
  createSeedSource,
  seedAgents,
} from "../seed.js";

const NOW = new Date("2026-09-10T00:00:00.000Z");

describe("the curated seed", () => {
  it("holds our own four Fugugent agents, one per category", () => {
    const items = seedAgents(NOW);
    expect(items).toHaveLength(4);

    const byCategory = new Map<Category, string>();
    for (const agent of items) {
      const category = agent.classification?.category;
      expect(category).not.toBeNull();
      byCategory.set(category as Category, agent.name);
    }
    expect([...byCategory.keys()].sort()).toEqual([...CATEGORIES].sort());
    expect([...byCategory.values()].sort()).toEqual(
      ["FuguGrid", "FuguGuardian", "FuguRebalancer", "FuguYield"].sort(),
    );
  });

  it("uses the real Altana wallet from each agent's studio.toml", () => {
    const wallets = seedAgents(NOW).map((a) => a.agentWallet);
    expect(wallets.sort()).toEqual(
      [
        "0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866",
        "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
        "0xb8f155D1278f0437b9De7c63911f2C0EDa485941",
        "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0",
      ].sort(),
    );
  });

  it("every record admits source seed and is aged from the curation date", () => {
    const items = seedAgents(NOW);
    for (const agent of items) {
      expect(agent.source).toBe("seed");
      expect(agent.fetchedAt).toBe(CURATED_SEED_AT);
    }
    // Two days after the curation date.
    expect(Math.floor((NOW.getTime() - Date.parse(CURATED_SEED_AT)) / 1000)).toBe(172_800);
  });

  it("CURATED_SEED_AT must be in the past — not a `now` in disguise", () => {
    // The whole honesty of the seed's `ageSeconds` rests on this one constant.
    // Replacing it with `new Date().toISOString()` at the last minute would make
    // curated data appear as fresh data, and the `fetchedAt === CURATED_SEED_AT`
    // assertion above would stay green. So the constant is checked against a real
    // clock, not against itself.
    const parsed = Date.parse(CURATED_SEED_AT);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeLessThanOrEqual(Date.now() - 3_600_000);
  });

  it("claims nothing that has not happened yet", () => {
    for (const agent of seedAgents(NOW)) {
      // No FuguRegistry listing yet, no ERC-8004 agentId yet — inventing either
      // would make the UI show a price that cannot be paid.
      expect(agent.fuguListing).toBeNull();
      expect(agent.agentId).toBeNull();
      expect(agent.registryAddress).toBeNull();
      expect(agent.isVerified).toBe(false);
      expect(agent.isEndpointVerified).toBe(false);
      expect(agent.reputation.totalScore).toBeNull();
      expect(agent.reputation.totalFeedbacks).toBe(0);
      expect(agent.reputation.starCount).toBe(0);
      // Its tokenId is deliberately NOT decimal-shaped: it is not an ERC-8004
      // token, and it must not be mistakable for one.
      expect(agent.tokenId).toMatch(/^seed-/);
      expect(agent.id).toBe(`97:${agent.tokenId}`);
    }
  });

  it("its descriptions are descriptive enough that the classifier agrees with their category", () => {
    // This is what stops the seed from becoming empty marketing copy: if a seed
    // description no longer explains what the agent does, the classifier will
    // disagree with the curated category and this test goes red.
    for (const agent of seedAgents(NOW)) {
      const verdict = classify({ ...agent, classification: null });
      expect(verdict.category).toBe(agent.classification?.category);
      expect(verdict.confidence).toBeGreaterThanOrEqual(0.55);
    }
  });

  it("createSeedSource filters per category and pages", async () => {
    const seed = createSeedSource({ now: () => NOW });

    const grid = await seed.listAgents("GRID", { limit: 10, offset: 0 });
    expect(grid.source).toBe("seed");
    expect(grid.healthy).toBe(true);
    expect(grid.items).toHaveLength(1);
    expect(grid.items[0]!.name).toBe("FuguGrid");
    expect(grid.total).toBe(1);

    const empty = await seed.listAgents("GRID", { limit: 10, offset: 5 });
    expect(empty.items).toHaveLength(0);
    expect(empty.total).toBe(1);
  });

  it("createSeedSource looks up a single agent by id", async () => {
    const seed = createSeedSource({ now: () => NOW });
    const hit = await seed.getAgent("97:seed-fuguguardian");
    expect(hit.agent?.name).toBe("FuguGuardian");
    expect(hit.source).toBe("seed");
    expect(hit.healthy).toBe(true);

    const miss = await seed.getAgent("97:404");
    expect(miss.agent).toBeNull();
    expect(miss.healthy).toBe(true);
    expect(miss.reason).toContain("not in the curated seed");
  });

  it("returns a copy — a caller cannot corrupt the seed for another caller", () => {
    const first = seedAgents(NOW);
    first[0]!.name = "corrupted";
    first[0]!.tags.push("corrupted");
    const second = seedAgents(NOW);
    expect(second[0]!.name).not.toBe("corrupted");
    expect(second[0]!.tags).not.toContain("corrupted");
  });
});
