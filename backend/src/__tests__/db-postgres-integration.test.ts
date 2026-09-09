/**
 * An integration test against a **real** Postgres.
 *
 * Skipped by default. Run it deliberately:
 *
 * ```bash
 * FUGU_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/fugugent_test pnpm test
 * ```
 *
 * This test creates the schema in the database it is pointed at and **truncates
 * all three of its tables**. Never point it at a database holding data you care
 * about. Without that env var `pnpm test` stays green on a machine with no
 * Postgres — not one other test in this file touches the network.
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { AgentRecord } from "../types.js";
import { closeDb, connectDb, ensureSchema } from "../db/client.js";
import { getCachedAgents, recordSourceHealth, getLatestSourceHealth, upsertAgents } from "../db/repo.js";

const url = process.env.FUGU_TEST_DATABASE_URL;

const record: AgentRecord = {
  id: "97:900001",
  chainId: 97,
  tokenId: "900001",
  registryAddress: null,
  agentId: null,
  name: "Fugu Integration",
  description: "an integration test record",
  imageUrl: null,
  agentType: null,
  tags: ["integration"],
  categories: [],
  skills: [],
  domains: [],
  supportedProtocols: [],
  ownerAddress: null,
  ownerUsername: null,
  ownerPublisherTier: null,
  agentWallet: null,
  isActive: true,
  isVerified: false,
  isEndpointVerified: false,
  x402Supported: false,
  reputation: {
    totalScore: null,
    healthScore: null,
    totalFeedbacks: 0,
    averageScore: null,
    starCount: 0,
  },
  classification: { category: "YIELD", confidence: 0.55, reason: "integration" },
  fuguListing: {
    listingId: 1n,
    erc8004AgentId: 900001n,
    owner: "0x2222222222222222222222222222222222222222",
    agentWallet: "0x1111111111111111111111111111111111111111",
    category: "YIELD",
    priceUsd8PerPeriod: 2n ** 200n,
    periodSeconds: 86_400,
    active: true,
    curated: false,
    metadataURI: "ipfs://integration",
  },
  source: "scan8004",
  fetchedAt: "2026-09-08T12:00:00.000Z",
  createdAt: null,
  updatedAt: null,
  similarityScore: null,
};

const handle = url ? connectDb(url) : null;

afterAll(async () => {
  if (handle) await closeDb(handle);
});

describe.skipIf(!handle)("real Postgres integration (requires FUGU_TEST_DATABASE_URL)", () => {
  it("creates the schema, upserts idempotently, and returns bigints exactly as written", async () => {
    const db = handle!.db;
    await ensureSchema(db);
    await db.execute(sql`truncate table agent_categories, agents, source_health`);

    await upsertAgents(db, [record]);
    await upsertAgents(db, [record]);

    const page = await getCachedAgents(db, { category: "YIELD" }, new Date("2026-09-08T12:00:30.000Z"));
    expect(page.total).toBe(1);
    expect(page.items[0]!.fuguListing?.priceUsd8PerPeriod).toBe(2n ** 200n);
    expect(page.ageSeconds).toBe(30);

    // The merge rules run through SQL (`coalesce`/`nullif`/`case`), so they must
    // be proven on a real Postgres, not only on PGlite.
    await upsertAgents(db, [
      { ...record, name: "Fugu Integration v2", fuguListing: null, classification: null },
    ]);
    const merged = await getCachedAgents(db, { onlyListed: true });
    expect(merged.total).toBe(1);
    expect(merged.items[0]!.name).toBe("Fugu Integration v2");
    expect(merged.items[0]!.fuguListing?.priceUsd8PerPeriod).toBe(2n ** 200n);
    expect((await getCachedAgents(db, { category: "YIELD" })).total).toBe(1);

    await recordSourceHealth(db, {
      source: "scan8004",
      healthy: true,
      reason: null,
      checkedAt: "2026-09-08T12:00:00.000Z",
    });
    expect((await getLatestSourceHealth(db))[0]!.source).toBe("scan8004");
  });
});
