import { PGlite } from "@electric-sql/pglite";
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
    description: "Agent grid trading di PancakeSwap v3",
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

  it("menyimpan record dan mengembalikannya lewat getCachedAgents", async () => {
    await upsertAgents(db, [makeRecord()]);
    const page = await getCachedAgents(db);
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.name).toBe("Fugu Grid");
    expect(page.items[0]!.id).toBe("97:49637");
  });

  it("idempoten — dua kali dengan data sama tidak menghasilkan duplikat", async () => {
    const records = [makeRecord(), makeRecord({ tokenId: "2" })];
    await upsertAgents(db, records);
    await upsertAgents(db, records);
    const page = await getCachedAgents(db);
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id).sort()).toEqual(["97:2", "97:49637"]);
  });

  it("memperbarui baris yang sudah ada, bukan menambah baris baru", async () => {
    await upsertAgents(db, [makeRecord()]);
    await upsertAgents(db, [makeRecord({ name: "Fugu Grid v2", fetchedAt: "2026-09-08T13:00:00.000Z" })]);
    const page = await getCachedAgents(db);
    expect(page.total).toBe(1);
    expect(page.items[0]!.name).toBe("Fugu Grid v2");
    expect(page.items[0]!.fetchedAt).toBe("2026-09-08T13:00:00.000Z");
  });

  it("mengembalikan jumlah record yang ditulis", async () => {
    expect(await upsertAgents(db, [makeRecord(), makeRecord({ tokenId: "2" })])).toBe(2);
    expect(await upsertAgents(db, [])).toBe(0);
  });

  it("mempertahankan nilai uang bigint ekstrem lewat Postgres tanpa kehilangan presisi", async () => {
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

  it("menulis klasifikasi ke agent_categories dan tidak menggandakannya saat di-upsert ulang", async () => {
    const classified = makeRecord({
      classification: { category: "GRID", confidence: 0.9, reason: "kata kunci grid" },
    });
    await upsertAgents(db, [classified]);
    await upsertAgents(db, [classified]);
    const page = await getCachedAgents(db, { category: "GRID" });
    expect(page.total).toBe(1);
    expect(page.items[0]!.classification).toEqual({
      category: "GRID",
      confidence: 0.9,
      reason: "kata kunci grid",
    });
  });

  it("mengganti kategori lama saat classifier berubah pikiran", async () => {
    await upsertAgents(db, [
      makeRecord({ classification: { category: "GRID", confidence: 0.9, reason: "a" } }),
    ]);
    await upsertAgents(db, [
      makeRecord({ classification: { category: "YIELD", confidence: 0.7, reason: "b" } }),
    ]);
    expect((await getCachedAgents(db, { category: "GRID" })).total).toBe(0);
    expect((await getCachedAgents(db, { category: "YIELD" })).total).toBe(1);
  });

  it("record tanpa klasifikasi tidak menghasilkan baris kategori", async () => {
    await upsertAgents(db, [makeRecord()]);
    expect((await getCachedAgents(db, { category: "GRID" })).total).toBe(0);
    expect((await getCachedAgents(db)).total).toBe(1);
  });
});

describe("getCachedAgents — umur data selalu ikut terbawa", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("melaporkan umur data dalam detik relatif terhadap `now` yang disuntikkan", async () => {
    await upsertAgents(db, [makeRecord()]);
    const page = await getCachedAgents(db, {}, new Date("2026-09-08T12:00:42.000Z"));
    expect(page.ageSeconds).toBe(42);
    expect(page.oldestFetchedAt).toBe(T0);
    expect(page.newestFetchedAt).toBe(T0);
  });

  it("umur dihitung dari record tertua di halaman", async () => {
    await upsertAgents(db, [
      makeRecord({ tokenId: "1", fetchedAt: "2026-09-08T12:00:00.000Z" }),
      makeRecord({ tokenId: "2", fetchedAt: "2026-09-08T11:00:00.000Z" }),
    ]);
    const page = await getCachedAgents(db, {}, new Date("2026-09-08T12:01:00.000Z"));
    expect(page.ageSeconds).toBe(3660);
    expect(page.freshestAgeSeconds).toBe(60);
  });

  it("menandai stale ketika lebih tua dari maxAgeSeconds, tanpa menyembunyikan datanya", async () => {
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

  it("cache kosong tetap sehat: tidak ada umur untuk dilaporkan", async () => {
    const page = await getCachedAgents(db);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.healthy).toBe(true);
    expect(page.ageSeconds).toBeNull();
    expect(page.stale).toBe(false);
  });

  it("selalu menandai dirinya sebagai sumber cache", async () => {
    await upsertAgents(db, [makeRecord()]);
    const page = await getCachedAgents(db);
    expect(page.source).toBe("cache");
    expect(page.items[0]!.source).toBe("cache");
    expect(page.reason).toBeNull();
  });

  it("agentAgeSeconds menghitung umur satu record", () => {
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

  it("menyaring per chainId", async () => {
    expect((await getCachedAgents(db, { chainId: 56 })).total).toBe(1);
    expect((await getCachedAgents(db, { chainId: 97 })).total).toBe(2);
  });

  it("menyaring per kategori Fugu", async () => {
    const page = await getCachedAgents(db, { category: "REBALANCING" });
    expect(page.items.map((i) => i.name)).toEqual(["Rebalancer Pro"]);
  });

  it("menyaring per ambang kepercayaan klasifikasi", async () => {
    expect((await getCachedAgents(db, { category: "GRID", minConfidence: 0.5 })).total).toBe(0);
    expect((await getCachedAgents(db, { category: "GRID", minConfidence: 0.3 })).total).toBe(1);
  });

  it("mencari pada nama dan deskripsi tanpa peduli huruf besar-kecil", async () => {
    expect((await getCachedAgents(db, { search: "grid bot" })).total).toBe(1);
    expect((await getCachedAgents(db, { search: "pancakeswap" })).total).toBe(3);
  });

  it("menyaring hanya yang aktif", async () => {
    expect((await getCachedAgents(db, { onlyActive: true })).total).toBe(2);
  });

  it("menyaring hanya yang terdaftar di FuguRegistry dan yang terkurasi", async () => {
    expect((await getCachedAgents(db, { onlyListed: true })).total).toBe(1);
    expect((await getCachedAgents(db, { onlyCurated: true })).items[0]!.name).toBe("Grid Bot");
  });

  it("menyaring per skor reputasi minimum", async () => {
    expect((await getCachedAgents(db, { minTotalScore: 80 })).total).toBe(1);
  });

  it("mengurutkan skor tertinggi lebih dulu secara bawaan", async () => {
    const page = await getCachedAgents(db, { chainId: 97 });
    expect(page.items.map((i) => i.name)).toEqual(["Rebalancer Pro", "Grid Bot"]);
  });

  it("memberi halaman: limit, offset, dan total keseluruhan", async () => {
    const page = await getCachedAgents(db, { limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it("getCachedAgent mengembalikan satu agent beserta umurnya", async () => {
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

  it("mencatat riwayat dan mengembalikan status terakhir per sumber", async () => {
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

  it("menyimpan alasan kegagalan apa adanya", async () => {
    await recordSourceHealth(db, {
      source: "cache",
      healthy: false,
      reason: "koneksi Postgres putus",
      checkedAt: "2026-09-08T12:00:00.000Z",
    });
    expect((await getLatestSourceHealth(db))[0]!.reason).toBe("koneksi Postgres putus");
  });

  it("tanpa catatan sama sekali mengembalikan daftar kosong", async () => {
    expect(await getLatestSourceHealth(db)).toEqual([]);
  });
});
