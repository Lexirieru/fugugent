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

// ---------------------------------------------------------------------------
// Regresi review putaran 1 — Critical 3.1
//
// Sebelum perbaikan, `upsertAgents` menimpa SELURUH kolom dengan `excluded.*`
// dan menghapus `agent_categories` untuk semua id yang disentuh. Akibatnya
// penyegaran 8004scan yang BERHASIL menghapus listing first-party kita sendiri
// beserta hasil classifier — persis sebelum cache ini dibutuhkan sebagai
// tingkat kedua fallback. Setiap test di blok ini gagal bila perbaikan itu
// dibatalkan.
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

/** Bentuk record seperti yang benar-benar disusun `readFuguListings()`. */
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
    classification: { category: "YIELD", confidence: 0.95, reason: "kategori on-chain" },
    ...overrides,
  });
}

/** Bentuk record seperti yang disusun normalizer 8004scan: kaya metadata, buta listing. */
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

describe("penggabungan lintas sumber — penulisan satu sumber tidak menghapus milik sumber lain", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("penyegaran 8004scan tidak menghapus listing FuguRegistry yang dibaca on-chain", async () => {
    await upsertAgents(db, [onchainRecord()]);
    await upsertAgents(db, [scanRecord()]);

    const page = await getCachedAgents(db);
    const agent = page.items[0]!;

    // yang HILANG sebelum perbaikan:
    expect(agent.fuguListing?.priceUsd8PerPeriod).toBe(1_500_000_000n);
    expect(agent.fuguListing?.curated).toBe(true);
    expect((await getCachedAgents(db, { onlyListed: true })).total).toBe(1);
    expect((await getCachedAgents(db, { onlyCurated: true })).total).toBe(1);

    // yang memang seharusnya diperbarui oleh 8004scan:
    expect(agent.name).toBe("OpenOdds.Ai");
    expect(agent.tags).toEqual(["prediction", "sports"]);
    expect(agent.reputation.starCount).toBe(8);
  });

  it("penyegaran 8004scan tidak menghapus klasifikasi maupun baris agent_categories", async () => {
    await upsertAgents(db, [onchainRecord()]);
    await upsertAgents(db, [scanRecord()]);

    // kolom klasifikasi bertahan…
    const page = await getCachedAgents(db);
    expect(page.items[0]!.classification).toEqual({
      category: "YIELD",
      confidence: 0.95,
      reason: "kategori on-chain",
    });
    // …dan navigasi per kategori tetap menemukannya
    expect((await getCachedAgents(db, { category: "YIELD" })).total).toBe(1);
  });

  it("pembacaan on-chain tidak mengganti nama sungguhan dengan placeholder `Agent #…`", async () => {
    await upsertAgents(db, [scanRecord()]);
    await upsertAgents(db, [onchainRecord({ classification: null })]);

    const agent = (await getCachedAgents(db)).items[0]!;
    expect(agent.name).toBe("OpenOdds.Ai");
    expect(agent.description).toBe("Verifiable pre-match football odds prediction agent");
    expect(agent.tags).toEqual(["prediction", "sports"]);
    expect(agent.supportedProtocols).toEqual(["MCP", "A2A", "Web"]);
    expect(agent.reputation.starCount).toBe(8);
    expect(agent.reputation.totalScore).toBe(49.06);

    // …sementara listing yang memang hanya diketahui on-chain tetap masuk
    expect(agent.fuguListing?.priceUsd8PerPeriod).toBe(1_500_000_000n);
  });

  it("urutan penulisan tidak mengubah hasil akhir", async () => {
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

  it("penggabungan tidak membekukan status: `isActive` tetap bisa diubah menjadi false", async () => {
    await upsertAgents(db, [scanRecord()]);
    await upsertAgents(db, [scanRecord({ isActive: false })]);
    expect((await getCachedAgents(db, { onlyActive: true })).total).toBe(0);
  });

  it("sumber yang sama tetap boleh memperbarui metadatanya sendiri", async () => {
    await upsertAgents(db, [scanRecord()]);
    await upsertAgents(db, [scanRecord({ name: "OpenOdds.Ai v2", tags: ["prediction"] })]);
    const agent = (await getCachedAgents(db)).items[0]!;
    expect(agent.name).toBe("OpenOdds.Ai v2");
    expect(agent.tags).toEqual(["prediction"]);
  });
});

describe("record cacat dilewati, batch tetap tersimpan", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("satu `fetchedAt` tidak sah tidak menjatuhkan 2 record sehat", async () => {
    const skipped: { id: string; reason: string }[] = [];
    const written = await upsertAgents(
      db,
      [
        makeRecord({ tokenId: "1" }),
        makeRecord({ tokenId: "2", fetchedAt: "kemarin sore" }),
        makeRecord({ tokenId: "3" }),
      ],
      { onSkipped: (entry) => skipped.push(entry) },
    );

    expect(written).toBe(2);
    expect((await getCachedAgents(db)).total).toBe(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/fetchedAt/);
  });

  it("`tokenId` yang bukan bilangan bulat desimal dilewati, bukan menjadi kunci primer palsu", async () => {
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

  it("nilai uang yang tidak muat numeric(78,0) dilewati, bukan melempar dari tengah transaksi", async () => {
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

  it("batch yang seluruhnya cacat mengembalikan 0 tanpa menyentuh database", async () => {
    expect(await upsertAgents(db, [makeRecord({ tokenId: "1.5" })])).toBe(0);
    expect((await getCachedAgents(db)).total).toBe(0);
  });
});

describe("kegagalan infrastruktur — pelaporan kesehatan tetap hidup", () => {
  let db: FuguDb;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("`recordSourceHealth` mengembalikan false alih-alih melempar saat tabelnya hilang", async () => {
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

  it("`getLatestSourceHealth` melaporkan cache-nya sendiri sakit, bukan melempar", async () => {
    await db.execute(sql`drop table source_health`);
    const latest = await getLatestSourceHealth(db, new Date("2026-09-08T12:00:00.000Z"));
    expect(latest).toHaveLength(1);
    expect(latest[0]!.source).toBe("cache");
    expect(latest[0]!.healthy).toBe(false);
    expect(latest[0]!.reason).toMatch(/cache Postgres gagal/);
    expect(latest[0]!.checkedAt).toBe("2026-09-08T12:00:00.000Z");
  });

  it("`upsertAgents` sengaja tetap melempar — penulisan yang gagal harus terlihat", async () => {
    await db.execute(sql`drop table agent_categories`);
    await db.execute(sql`drop table agents`);
    await expect(upsertAgents(db, [makeRecord()])).rejects.toThrow();
  });
});
