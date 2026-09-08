/**
 * Uji integrasi terhadap Postgres **sungguhan**.
 *
 * Dilewati secara bawaan. Jalankan dengan sengaja:
 *
 * ```bash
 * FUGU_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/fugugent_test pnpm test
 * ```
 *
 * Test ini membuat skema di database yang ditunjuk dan **menghapus isi ketiga
 * tabelnya**. Jangan pernah arahkan ke database berisi data yang kamu sayangi.
 * Tanpa env tersebut `pnpm test` tetap hijau di mesin tanpa Postgres — tidak ada
 * satu pun test lain di berkas ini yang menyentuh jaringan.
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
  name: "Integrasi Fugu",
  description: "record uji integrasi",
  imageUrl: null,
  agentType: null,
  tags: ["integrasi"],
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
  classification: { category: "YIELD", confidence: 0.55, reason: "integrasi" },
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
    metadataURI: "ipfs://integrasi",
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

describe.skipIf(!handle)("integrasi Postgres sungguhan (butuh FUGU_TEST_DATABASE_URL)", () => {
  it("membuat skema, upsert idempoten, dan mengembalikan bigint persis sama", async () => {
    const db = handle!.db;
    await ensureSchema(db);
    await db.execute(sql`truncate table agent_categories, agents, source_health`);

    await upsertAgents(db, [record]);
    await upsertAgents(db, [record]);

    const page = await getCachedAgents(db, { category: "YIELD" }, new Date("2026-09-08T12:00:30.000Z"));
    expect(page.total).toBe(1);
    expect(page.items[0]!.fuguListing?.priceUsd8PerPeriod).toBe(2n ** 200n);
    expect(page.ageSeconds).toBe(30);

    await recordSourceHealth(db, {
      source: "scan8004",
      healthy: true,
      reason: null,
      checkedAt: "2026-09-08T12:00:00.000Z",
    });
    expect((await getLatestSourceHealth(db))[0]!.source).toBe("scan8004");
  });
});
