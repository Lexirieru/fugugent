import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentRecord } from "../types.js";
import { ensureSchema, type FuguDb } from "../db/client.js";
import {
  agentAgeSeconds,
  getCachedAgent,
  getCachedAgents,
  getLatestSourceHealth,
  recordSourceHealth,
  upsertAgents,
} from "../db/repo.js";

const T0 = "2026-09-08T12:00:00.000Z";
const MAX_UINT256 = 2n ** 256n - 1n;

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  const chainId = overrides.chainId ?? 97;
  const tokenId = overrides.tokenId ?? "49637";
  return {
    id: `${chainId}:${tokenId}`,
    chainId,
    tokenId,
    registryAddress: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
    agentId: null,
    name: "Fugu Grid",
    description: "Grid trading agent on PancakeSwap v3",
    imageUrl: null,
    agentType: "trading",
    tags: ["grid"],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: ["MCP"],
    ownerAddress: null,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: null,
    isActive: true,
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: 50,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },
    classification: null,
    fuguListing: null,
    source: "scan8004",
    fetchedAt: T0,
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
    ...overrides,
  };
}

async function freshDb(): Promise<FuguDb> {
  const db = drizzle(new PGlite()) as unknown as FuguDb;
  await ensureSchema(db);
  return db;
}

describe("upsertAgents", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("stores a record and returns it through getCachedAgents", async () => {
    await upsertAgents(db, [makeRecord()]);
    const page = await getCachedAgents(db);
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.name).toBe("Fugu Grid");
    expect(page.items[0]!.id).toBe("97:49637");
  });

  it("idempotent — twice with the same data produces no duplicate", async () => {
    const records = [makeRecord(), makeRecord({ tokenId: "2" })];
    await upsertAgents(db, records);
    await upsertAgents(db, records);
    const page = await getCachedAgents(db);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id).sort()).toEqual(["97:2", "97:49637"]);
  });

  it("updates the existing row rather than adding a new one", async () => {
    await upsertAgents(db, [makeRecord()]);
    await upsertAgents(db, [makeRecord({ name: "Fugu Grid v2", fetchedAt: "2026-09-08T13:00:00.000Z" })]);
    const page = await getCachedAgents(db);
    expect(page.total).toBe(1);
    expect(page.items[0]!.name).toBe("Fugu Grid v2");
    expect(page.items[0]!.fetchedAt).toBe("2026-09-08T13:00:00.000Z");
  });

  it("returns the number of records written", async () => {
    expect(await upsertAgents(db, [makeRecord(), makeRecord({ tokenId: "2" })])).toBe(2);
    expect(await upsertAgents(db, [])).toBe(0);
  });

  it("preserves extreme bigint money values through Postgres without losing precision", async () => {
    await upsertAgents(db, [
      makeRecord({
        fuguListing: {
          listingId: 7n,
          erc8004AgentId: 49637n,
          owner: "0x2222222222222222222222222222222222222222",
          agentWallet: "0x1111111111111111111111111111111111111111",
          category: "GRID",
          priceUsd8PerPeriod: MAX_UINT256,
          periodSeconds: 2_592_000,
          active: true,
          curated: true,
          metadataURI: "ipfs://bafy",
        },
      }),
    ]);
    const page = await getCachedAgents(db);
    expect(page.items[0]!.fuguListing?.priceUsd8PerPeriod).toBe(MAX_UINT256);
    expect(page.items[0]!.fuguListing?.listingId).toBe(7n);
  });

  it("writes the classification into agent_categories and does not duplicate it on re-upsert", async () => {
    const classified = makeRecord({
      classification: { category: "GRID", confidence: 0.9, reason: "grid keyword" },
    });
    await upsertAgents(db, [classified]);
    await upsertAgents(db, [classified]);
    const page = await getCachedAgents(db, { category: "GRID" });
    expect(page.total).toBe(1);
    expect(page.items[0]!.classification).toEqual({
      category: "GRID",
      confidence: 0.9,
      reason: "grid keyword",
    });
  });

  it("replaces the old category when the classifier changes its mind", async () => {
    await upsertAgents(db, [
      makeRecord({ classification: { category: "GRID", confidence: 0.9, reason: "a" } }),
    ]);
    await upsertAgents(db, [
      makeRecord({ classification: { category: "YIELD", confidence: 0.7, reason: "b" } }),
    ]);
    expect((await getCachedAgents(db, { category: "GRID" })).total).toBe(0);
    expect((await getCachedAgents(db, { category: "YIELD" })).total).toBe(1);
  });

  it("a record with no classification produces no category row", async () => {
    await upsertAgents(db, [makeRecord()]);
    expect((await getCachedAgents(db, { category: "GRID" })).total).toBe(0);
    expect((await getCachedAgents(db)).total).toBe(1);
  });
});

describe("getCachedAgents — the age of the data always travels with it", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("reports the data age in seconds relative to the injected `now`", async () => {
    await upsertAgents(db, [makeRecord()]);
    const page = await getCachedAgents(db, {}, new Date("2026-09-08T12:00:42.000Z"));
    expect(page.ageSeconds).toBe(42);
    expect(page.oldestFetchedAt).toBe(T0);
    expect(page.newestFetchedAt).toBe(T0);
  });

  it("the age is computed from the oldest record on the page", async () => {
    await upsertAgents(db, [
      makeRecord({ tokenId: "1", fetchedAt: "2026-09-08T12:00:00.000Z" }),
      makeRecord({ tokenId: "2", fetchedAt: "2026-09-08T11:00:00.000Z" }),
    ]);
    const page = await getCachedAgents(db, {}, new Date("2026-09-08T12:01:00.000Z"));
    expect(page.ageSeconds).toBe(3660);
    expect(page.freshestAgeSeconds).toBe(60);
  });

  it("flags stale once older than maxAgeSeconds, without hiding the data", async () => {
    await upsertAgents(db, [makeRecord()]);
    const stale = await getCachedAgents(
      db,
      { maxAgeSeconds: 60 },
      new Date("2026-09-08T12:05:00.000Z"),
    );
    expect(stale.stale).toBe(true);
    expect(stale.items).toHaveLength(1);

    const fresh = await getCachedAgents(
      db,
      { maxAgeSeconds: 60 },
      new Date("2026-09-08T12:00:30.000Z"),
    );
    expect(fresh.stale).toBe(false);
  });

  it("an empty cache is still healthy: there is no age to report", async () => {
    const page = await getCachedAgents(db);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.healthy).toBe(true);
    expect(page.ageSeconds).toBeNull();
    expect(page.stale).toBe(false);
  });

  it("always marks itself as the cache source", async () => {
    await upsertAgents(db, [makeRecord()]);
    const page = await getCachedAgents(db);
    expect(page.source).toBe("cache");
    expect(page.items[0]!.source).toBe("cache");
    expect(page.reason).toBeNull();
  });

  it("agentAgeSeconds computes the age of a single record", () => {
    expect(agentAgeSeconds(makeRecord(), new Date("2026-09-08T12:00:10.000Z"))).toBe(10);
  });
});

describe("getCachedAgents — filter", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
    await upsertAgents(db, [
      makeRecord({
        tokenId: "1",
        name: "Rebalancer Pro",
        classification: { category: "REBALANCING", confidence: 0.9, reason: "r" },
        reputation: {
          totalScore: 90,
          healthScore: null,
          totalFeedbacks: 0,
          averageScore: null,
          starCount: 0,
        },
      }),
      makeRecord({
        tokenId: "2",
        name: "Grid Bot",
        isActive: false,
        classification: { category: "GRID", confidence: 0.4, reason: "g" },
        reputation: {
          totalScore: 70,
          healthScore: null,
          totalFeedbacks: 0,
          averageScore: null,
          starCount: 0,
        },
        fuguListing: {
          listingId: 1n,
          erc8004AgentId: 2n,
          owner: "0x2222222222222222222222222222222222222222",
          agentWallet: "0x1111111111111111111111111111111111111111",
          category: "GRID",
          priceUsd8PerPeriod: 1_500_000_000n,
          periodSeconds: 2_592_000,
          active: true,
          curated: true,
          metadataURI: "ipfs://bafy",
        },
      }),
      makeRecord({ tokenId: "3", name: "Yield Hunter", chainId: 56 }),
    ]);
  });

  it("filters by chainId", async () => {
    expect((await getCachedAgents(db, { chainId: 56 })).total).toBe(1);
    expect((await getCachedAgents(db, { chainId: 97 })).total).toBe(2);
  });

  it("filters by Fugu category", async () => {
    const page = await getCachedAgents(db, { category: "REBALANCING" });
    expect(page.items.map((i) => i.name)).toEqual(["Rebalancer Pro"]);
  });

  it("filters by the classification confidence threshold", async () => {
    expect((await getCachedAgents(db, { category: "GRID", minConfidence: 0.5 })).total).toBe(0);
    expect((await getCachedAgents(db, { category: "GRID", minConfidence: 0.3 })).total).toBe(1);
  });

  it("searches the name and the description case-insensitively", async () => {
    expect((await getCachedAgents(db, { search: "grid bot" })).total).toBe(1);
    expect((await getCachedAgents(db, { search: "pancakeswap" })).total).toBe(3);
  });

  it("filters to active ones only", async () => {
    expect((await getCachedAgents(db, { onlyActive: true })).total).toBe(2);
  });

  it("filters to only those listed in FuguRegistry and those curated", async () => {
    expect((await getCachedAgents(db, { onlyListed: true })).total).toBe(1);
    expect((await getCachedAgents(db, { onlyCurated: true })).items[0]!.name).toBe("Grid Bot");
  });

  it("filters by minimum reputation score", async () => {
    expect((await getCachedAgents(db, { minTotalScore: 80 })).total).toBe(1);
  });

  it("orders the highest score first by default", async () => {
    const page = await getCachedAgents(db, { chainId: 97 });
    expect(page.items.map((i) => i.name)).toEqual(["Rebalancer Pro", "Grid Bot"]);
  });

  it("pages: limit, offset, and the overall total", async () => {
    const page = await getCachedAgents(db, { limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it("getCachedAgent returns a single agent along with its age", async () => {
    const hit = await getCachedAgent(db, "97:1", new Date("2026-09-08T12:00:05.000Z"));
    expect(hit.agent?.name).toBe("Rebalancer Pro");
    expect(hit.ageSeconds).toBe(5);
    expect(hit.source).toBe("cache");

    const miss = await getCachedAgent(db, "97:404");
    expect(miss.agent).toBeNull();
    expect(miss.ageSeconds).toBeNull();
    expect(miss.healthy).toBe(true);
  });
});

describe("recordSourceHealth", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("records history and returns the latest status per source", async () => {
    await recordSourceHealth(db, {
      source: "scan8004",
      healthy: false,
      reason: "500 DATABASE_ERROR",
      checkedAt: "2026-09-08T12:00:00.000Z",
    });
    await recordSourceHealth(db, {
      source: "scan8004",
      healthy: true,
      reason: null,
      checkedAt: "2026-09-08T12:05:00.000Z",
    });
    await recordSourceHealth(db, {
      source: "onchain",
      healthy: true,
      reason: null,
      checkedAt: "2026-09-08T12:01:00.000Z",
    });

    const latest = await getLatestSourceHealth(db);
    expect(latest).toHaveLength(2);
    const scan = latest.find((h) => h.source === "scan8004")!;
    expect(scan.healthy).toBe(true);
    expect(scan.reason).toBeNull();
    expect(scan.checkedAt).toBe("2026-09-08T12:05:00.000Z");
    expect(latest.find((h) => h.source === "onchain")!.healthy).toBe(true);
  });

  it("stores the failure reason verbatim", async () => {
    await recordSourceHealth(db, {
      source: "cache",
      healthy: false,
      reason: "Postgres connection dropped",
      checkedAt: "2026-09-08T12:00:00.000Z",
    });
    expect((await getLatestSourceHealth(db))[0]!.reason).toBe("Postgres connection dropped");
  });

  it("with no records at all it returns an empty list", async () => {
    expect(await getLatestSourceHealth(db)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Review round 1 regression — Critical 3.1
//
// Before the fix, `upsertAgents` overwrote EVERY column with `excluded.*` and
// deleted `agent_categories` for every id it touched. As a result, a SUCCESSFUL
// 8004scan refresh erased our own first-party listing along with the classifier
// output — right before this cache was needed as the second fallback level.
// Every test in this block fails if that fix is reverted.
// ---------------------------------------------------------------------------

const LISTING = {
  listingId: 7n,
  erc8004AgentId: 49637n,
  owner: "0x2222222222222222222222222222222222222222" as const,
  agentWallet: "0x1111111111111111111111111111111111111111" as const,
  category: "YIELD" as const,
  priceUsd8PerPeriod: 1_500_000_000n,
  periodSeconds: 2_592_000,
  active: true,
  curated: true,
  metadataURI: "ipfs://bafy",
};

/** The record shape `readFuguListings()` actually builds. */
function onchainRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return makeRecord({
    source: "onchain",
    name: "Agent #49637",
    description: "",
    tags: [],
    supportedProtocols: [],
    isVerified: true,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },
    fuguListing: LISTING,
    classification: { category: "YIELD", confidence: 0.95, reason: "on-chain category" },
    ...overrides,
  });
}

/** The record shape the 8004scan normalizer builds: rich in metadata, blind to listings. */
function scanRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return makeRecord({
    source: "scan8004",
    name: "OpenOdds.Ai",
    description: "Verifiable pre-match football odds prediction agent",
    tags: ["prediction", "sports"],
    supportedProtocols: ["MCP", "A2A", "Web"],
    isVerified: true,
    reputation: {
      totalScore: 49.06,
      healthScore: 100,
      totalFeedbacks: 3,
      averageScore: 100,
      starCount: 8,
    },
    fuguListing: null,
    classification: null,
    ...overrides,
  });
}

describe("cross-source merging — one source's write never erases another source's data", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("an 8004scan refresh does not erase the FuguRegistry listing read on-chain", async () => {
    await upsertAgents(db, [onchainRecord()]);
    await upsertAgents(db, [scanRecord()]);

    const page = await getCachedAgents(db);
    const agent = page.items[0]!;

    // what was LOST before the fix:
    expect(agent.fuguListing?.priceUsd8PerPeriod).toBe(1_500_000_000n);
    expect(agent.fuguListing?.curated).toBe(true);
    expect((await getCachedAgents(db, { onlyListed: true })).total).toBe(1);
    expect((await getCachedAgents(db, { onlyCurated: true })).total).toBe(1);

    // what 8004scan really should be updating:
    expect(agent.name).toBe("OpenOdds.Ai");
    expect(agent.tags).toEqual(["prediction", "sports"]);
    expect(agent.reputation.starCount).toBe(8);
  });

  it("an 8004scan refresh erases neither the classification nor the agent_categories rows", async () => {
    await upsertAgents(db, [onchainRecord()]);
    await upsertAgents(db, [scanRecord()]);

    // the classification columns survive…
    const page = await getCachedAgents(db);
    expect(page.items[0]!.classification).toEqual({
      category: "YIELD",
      confidence: 0.95,
      reason: "on-chain category",
    });
    // …and per-category navigation still finds it
    expect((await getCachedAgents(db, { category: "YIELD" })).total).toBe(1);
  });

  it("the on-chain read does not replace a real name with an `Agent #…` placeholder", async () => {
    await upsertAgents(db, [scanRecord()]);
    await upsertAgents(db, [onchainRecord({ classification: null })]);

    const agent = (await getCachedAgents(db)).items[0]!;
    expect(agent.name).toBe("OpenOdds.Ai");
    expect(agent.description).toBe("Verifiable pre-match football odds prediction agent");
    expect(agent.tags).toEqual(["prediction", "sports"]);
    expect(agent.supportedProtocols).toEqual(["MCP", "A2A", "Web"]);
    expect(agent.reputation.starCount).toBe(8);
    expect(agent.reputation.totalScore).toBe(49.06);

    // …while the listing only the on-chain read knows about still goes in
    expect(agent.fuguListing?.priceUsd8PerPeriod).toBe(1_500_000_000n);
  });

  it("the write order does not change the final result", async () => {
    await upsertAgents(db, [onchainRecord(), scanRecord()]);
    const forward = (await getCachedAgents(db)).items[0]!;

    const other = await freshDb();
    await upsertAgents(other, [scanRecord()]);
    await upsertAgents(other, [onchainRecord()]);
    const backward = (await getCachedAgents(other)).items[0]!;

    expect(forward.name).toBe(backward.name);
    expect(forward.fuguListing?.priceUsd8PerPeriod).toBe(backward.fuguListing?.priceUsd8PerPeriod);
    expect(forward.classification?.category).toBe(backward.classification?.category);
  });

  it("merging does not freeze the status: `isActive` can still be changed to false", async () => {
    await upsertAgents(db, [scanRecord()]);
    await upsertAgents(db, [scanRecord({ isActive: false })]);
    expect((await getCachedAgents(db, { onlyActive: true })).total).toBe(0);
  });

  it("the same source may still update its own metadata", async () => {
    await upsertAgents(db, [scanRecord()]);
    await upsertAgents(db, [scanRecord({ name: "OpenOdds.Ai v2", tags: ["prediction"] })]);
    const agent = (await getCachedAgents(db)).items[0]!;
    expect(agent.name).toBe("OpenOdds.Ai v2");
    expect(agent.tags).toEqual(["prediction"]);
  });
});

describe("a malformed record is skipped, the batch is still stored", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("one invalid `fetchedAt` does not take down 2 healthy records", async () => {
    const skipped: { id: string; reason: string }[] = [];
    const written = await upsertAgents(
      db,
      [
        makeRecord({ tokenId: "1" }),
        makeRecord({ tokenId: "2", fetchedAt: "yesterday afternoon" }),
        makeRecord({ tokenId: "3" }),
      ],
      { onSkipped: (entry) => skipped.push(entry) },
    );

    expect(written).toBe(2);
    expect((await getCachedAgents(db)).total).toBe(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/fetchedAt/);
  });

  it("a `tokenId` that is not a decimal integer is skipped, not turned into a fake primary key", async () => {
    const skipped: { id: string; reason: string }[] = [];
    const written = await upsertAgents(
      db,
      [
        makeRecord({ tokenId: "1e+21" }),
        makeRecord({ tokenId: "1.5" }),
        makeRecord({ tokenId: "42" }),
      ],
      { onSkipped: (entry) => skipped.push(entry) },
    );

    expect(written).toBe(1);
    expect((await getCachedAgents(db)).items.map((i) => i.id)).toEqual(["97:42"]);
    expect(skipped).toHaveLength(2);
    expect(skipped[0]!.reason).toMatch(/tokenId/);
  });

  it("a money value that does not fit numeric(78,0) is skipped, not thrown from mid-transaction", async () => {
    const skipped: { id: string; reason: string }[] = [];
    const written = await upsertAgents(
      db,
      [
        makeRecord({
          tokenId: "1",
          fuguListing: { ...LISTING, priceUsd8PerPeriod: 10n ** 78n },
        }),
        makeRecord({ tokenId: "2" }),
      ],
      { onSkipped: (entry) => skipped.push(entry) },
    );

    expect(written).toBe(1);
    expect((await getCachedAgents(db)).total).toBe(1);
    expect(skipped[0]!.reason).toMatch(/numeric\(78, 0\)/);
  });

  it("an entirely malformed batch returns 0 without touching the database", async () => {
    expect(await upsertAgents(db, [makeRecord({ tokenId: "1.5" })])).toBe(0);
    expect((await getCachedAgents(db)).total).toBe(0);
  });
});

describe("infrastructure failure — health reporting stays alive", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("`recordSourceHealth` returns false rather than throwing when its table is gone", async () => {
    await db.execute(sql`drop table source_health`);
    await expect(
      recordSourceHealth(db, {
        source: "scan8004",
        healthy: false,
        reason: "500 DATABASE_ERROR",
        checkedAt: "2026-09-08T12:00:00.000Z",
      }),
    ).resolves.toBe(false);
  });

  it("`getLatestSourceHealth` reports its own cache as sick rather than throwing", async () => {
    await db.execute(sql`drop table source_health`);
    const latest = await getLatestSourceHealth(db, new Date("2026-09-08T12:00:00.000Z"));
    expect(latest).toHaveLength(1);
    expect(latest[0]!.source).toBe("cache");
    expect(latest[0]!.healthy).toBe(false);
    expect(latest[0]!.reason).toMatch(/Postgres cache failed/);
    expect(latest[0]!.checkedAt).toBe("2026-09-08T12:00:00.000Z");
  });

  it("`upsertAgents` deliberately still throws — a failed write must be visible", async () => {
    await db.execute(sql`drop table agent_categories`);
    await db.execute(sql`drop table agents`);
    await expect(upsertAgents(db, [makeRecord()])).rejects.toThrow();
  });
});
