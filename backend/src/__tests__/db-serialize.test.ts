import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../types.js";
import {
  decodeMoney,
  deserializeAgentRecord,
  encodeMoney,
  fromAgentRow,
  serializeAgentRecord,
  toAgentRow,
} from "../db/serialize.js";

const FETCHED_AT = "2026-09-08T12:00:00.000Z";

/** Nilai uang paling ekstrem yang bisa muncul on-chain: `type(uint256).max` (78 digit). */
const MAX_UINT256 = 2n ** 256n - 1n;

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "97:49637",
    chainId: 97,
    tokenId: "49637",
    registryAddress: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
    agentId: "97:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:49637",
    name: "Fugu Grid",
    description: "Agent grid trading di PancakeSwap v3",
    imageUrl: "https://api.8004scan.io/api/v1/media/agents/97/49637/image",
    agentType: "trading",
    tags: ["grid", "defi"],
    categories: ["analytics"],
    skills: ["market-making"],
    domains: ["finance"],
    supportedProtocols: ["MCP", "A2A"],
    ownerAddress: "0x0d68a153897b73a6e4d2eaa9b0d4802bae69532d",
    ownerUsername: "fugugent",
    ownerPublisherTier: "VERIFIED",
    agentWallet: "0x1111111111111111111111111111111111111111",
    isActive: true,
    isVerified: false,
    isEndpointVerified: true,
    x402Supported: false,
    reputation: {
      totalScore: 49.06,
      healthScore: 100,
      totalFeedbacks: 3,
      averageScore: 100,
      starCount: 8,
    },
    classification: { category: "GRID", confidence: 0.82, reason: "kata kunci: grid, range" },
    fuguListing: {
      listingId: 1n,
      erc8004AgentId: 49637n,
      owner: "0x2222222222222222222222222222222222222222",
      agentWallet: "0x1111111111111111111111111111111111111111",
      category: "GRID",
      priceUsd8PerPeriod: 1_500_000_000n,
      periodSeconds: 2_592_000,
      active: true,
      curated: true,
      metadataURI: "ipfs://bafy",
    },
    source: "scan8004",
    fetchedAt: FETCHED_AT,
    createdAt: "2026-03-23T23:54:44Z",
    updatedAt: "2026-09-08T00:41:11.096927Z",
    similarityScore: null,
    ...overrides,
  };
}

describe("encodeMoney / decodeMoney — uang tidak pernah lewat number", () => {
  it("mengkodekan bigint menjadi string desimal tanpa notasi ilmiah", () => {
    expect(encodeMoney(MAX_UINT256)).toBe(
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    );
    expect(encodeMoney(0n)).toBe("0");
  });

  it("mendekode string desimal kembali ke bigint yang persis sama", () => {
    expect(decodeMoney(encodeMoney(MAX_UINT256))).toBe(MAX_UINT256);
  });

  it("menolak `number` — presisi sudah hilang sebelum kita sempat memeriksanya", () => {
    expect(() => decodeMoney(1_500_000_000 as unknown as string)).toThrow(/number/i);
  });

  it("menolak string yang bukan bilangan bulat desimal", () => {
    expect(() => decodeMoney("15.5")).toThrow();
    expect(() => decodeMoney("")).toThrow();
    expect(() => decodeMoney("1e9")).toThrow();
  });

  it("menerima bigint apa adanya (idempoten)", () => {
    expect(decodeMoney(42n)).toBe(42n);
  });
});

describe("serializeAgentRecord — AgentRecord mentah tidak JSON-serializable", () => {
  it("JSON.stringify pada record mentah melempar karena bigint — inilah alasan lapisan ini ada", () => {
    expect(() => JSON.stringify(makeRecord())).toThrow(TypeError);
  });

  it("bentuk terserialisasi aman untuk JSON.stringify", () => {
    const json = serializeAgentRecord(makeRecord());
    expect(() => JSON.stringify(json)).not.toThrow();
    expect(json.fuguListing?.priceUsd8PerPeriod).toBe("1500000000");
  });

  it("bolak-balik lewat JSON.stringify/parse mengembalikan bigint yang persis sama", () => {
    const record = makeRecord({
      fuguListing: {
        ...makeRecord().fuguListing!,
        priceUsd8PerPeriod: MAX_UINT256,
        listingId: MAX_UINT256 - 1n,
        erc8004AgentId: 0n,
      },
    });
    const wire = JSON.parse(JSON.stringify(serializeAgentRecord(record)));
    const back = deserializeAgentRecord(wire);
    expect(back.fuguListing?.priceUsd8PerPeriod).toBe(MAX_UINT256);
    expect(back.fuguListing?.listingId).toBe(MAX_UINT256 - 1n);
    expect(back.fuguListing?.erc8004AgentId).toBe(0n);
    expect(back).toEqual(record);
  });

  it("membuang `raw` — cache tidak menyimpan payload mentah", () => {
    const json = serializeAgentRecord(makeRecord({ raw: { huge: "payload" } }));
    expect(json).not.toHaveProperty("raw");
    expect(deserializeAgentRecord(JSON.parse(JSON.stringify(json)))).not.toHaveProperty("raw");
  });

  it("meneruskan fuguListing null tanpa mengarang nilai", () => {
    const json = serializeAgentRecord(makeRecord({ fuguListing: null }));
    expect(json.fuguListing).toBeNull();
    expect(deserializeAgentRecord(JSON.parse(JSON.stringify(json))).fuguListing).toBeNull();
  });
});

describe("toAgentRow / fromAgentRow — pemetaan baris Postgres", () => {
  it("menyimpan uang sebagai string desimal, bukan number", () => {
    const row = toAgentRow(makeRecord());
    expect(row.fuguPriceUsd8PerPeriod).toBe("1500000000");
    expect(typeof row.fuguPriceUsd8PerPeriod).toBe("string");
    expect(typeof row.fuguListingId).toBe("string");
  });

  it("menyimpan fetchedAt sebagai Date dan mengembalikannya sebagai ISO yang sama", () => {
    const row = toAgentRow(makeRecord());
    expect(row.fetchedAt).toBeInstanceOf(Date);
    expect(fromAgentRow(row).fetchedAt).toBe(FETCHED_AT);
  });

  it("bolak-balik mempertahankan seluruh record (tanpa raw)", () => {
    const record = makeRecord();
    expect(fromAgentRow(toAgentRow(record))).toEqual(record);
  });

  it("bolak-balik mempertahankan nilai uang ekstrem", () => {
    const record = makeRecord({
      fuguListing: { ...makeRecord().fuguListing!, priceUsd8PerPeriod: MAX_UINT256 },
    });
    expect(fromAgentRow(toAgentRow(record)).fuguListing?.priceUsd8PerPeriod).toBe(MAX_UINT256);
  });

  it("bolak-balik pada record paling kosong sekalipun", () => {
    const record = makeRecord({
      registryAddress: null,
      agentId: null,
      imageUrl: null,
      agentType: null,
      tags: [],
      categories: [],
      skills: [],
      domains: [],
      supportedProtocols: [],
      ownerAddress: null,
      ownerUsername: null,
      ownerPublisherTier: null,
      agentWallet: null,
      reputation: {
        totalScore: null,
        healthScore: null,
        totalFeedbacks: 0,
        averageScore: null,
        starCount: 0,
      },
      classification: null,
      fuguListing: null,
      createdAt: null,
      updatedAt: null,
      similarityScore: null,
    });
    expect(fromAgentRow(toAgentRow(record))).toEqual(record);
  });

  it("id baris selalu `${chainId}:${tokenId}`", () => {
    expect(toAgentRow(makeRecord({ id: "salah" })).id).toBe("97:49637");
  });
});
