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

/** The most extreme money value that can appear on-chain: `type(uint256).max` (78 digits). */
const MAX_UINT256 = 2n ** 256n - 1n;

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "97:49637",
    chainId: 97,
    tokenId: "49637",
    registryAddress: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
    agentId: "97:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:49637",
    name: "Fugu Grid",
    description: "Grid trading agent on PancakeSwap v3",
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
    classification: { category: "GRID", confidence: 0.82, reason: "keywords: grid, range" },
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

describe("encodeMoney / decodeMoney — money never passes through a number", () => {
  it("encodes a bigint into a decimal string with no scientific notation", () => {
    expect(encodeMoney(MAX_UINT256)).toBe(
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    );
    expect(encodeMoney(0n)).toBe("0");
  });

  it("decodes a decimal string back to exactly the same bigint", () => {
    expect(decodeMoney(encodeMoney(MAX_UINT256))).toBe(MAX_UINT256);
  });

  it("rejects a `number` — its precision was lost before we could check it", () => {
    expect(() => decodeMoney(1_500_000_000 as unknown as string)).toThrow(/number/i);
  });

  it("rejects a string that is not a decimal integer", () => {
    expect(() => decodeMoney("15.5")).toThrow();
    expect(() => decodeMoney("")).toThrow();
    expect(() => decodeMoney("1e9")).toThrow();
  });

  it("accepts a bigint verbatim (idempotent)", () => {
    expect(decodeMoney(42n)).toBe(42n);
  });
});

describe("serializeAgentRecord — a raw AgentRecord is not JSON-serializable", () => {
  it("JSON.stringify on a raw record throws because of the bigints — this is why this layer exists", () => {
    expect(() => JSON.stringify(makeRecord())).toThrow(TypeError);
  });

  it("the serialized shape is safe for JSON.stringify", () => {
    const json = serializeAgentRecord(makeRecord());
    expect(() => JSON.stringify(json)).not.toThrow();
    expect(json.fuguListing?.priceUsd8PerPeriod).toBe("1500000000");
  });

  it("a round trip through JSON.stringify/parse returns exactly the same bigints", () => {
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

  it("drops `raw` — the cache does not store the raw payload", () => {
    const json = serializeAgentRecord(makeRecord({ raw: { huge: "payload" } }));
    expect(json).not.toHaveProperty("raw");
    expect(deserializeAgentRecord(JSON.parse(JSON.stringify(json)))).not.toHaveProperty("raw");
  });

  it("passes a null fuguListing through without inventing values", () => {
    const json = serializeAgentRecord(makeRecord({ fuguListing: null }));
    expect(json.fuguListing).toBeNull();
    expect(deserializeAgentRecord(JSON.parse(JSON.stringify(json))).fuguListing).toBeNull();
  });
});

describe("toAgentRow / fromAgentRow — the Postgres row mapping", () => {
  it("stores money as a decimal string, not a number", () => {
    const row = toAgentRow(makeRecord());
    expect(row.fuguPriceUsd8PerPeriod).toBe("1500000000");
    expect(typeof row.fuguPriceUsd8PerPeriod).toBe("string");
    expect(typeof row.fuguListingId).toBe("string");
  });

  it("stores fetchedAt as a Date and returns it as the same ISO string", () => {
    const row = toAgentRow(makeRecord());
    expect(row.fetchedAt).toBeInstanceOf(Date);
    expect(fromAgentRow(row).fetchedAt).toBe(FETCHED_AT);
  });

  it("a round trip preserves the whole record (minus raw)", () => {
    const record = makeRecord();
    expect(fromAgentRow(toAgentRow(record))).toEqual(record);
  });

  it("a round trip preserves extreme money values", () => {
    const record = makeRecord({
      fuguListing: { ...makeRecord().fuguListing!, priceUsd8PerPeriod: MAX_UINT256 },
    });
    expect(fromAgentRow(toAgentRow(record)).fuguListing?.priceUsd8PerPeriod).toBe(MAX_UINT256);
  });

  it("a round trip even on the emptiest possible record", () => {
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

  it("the row id is always `${chainId}:${tokenId}`", () => {
    expect(toAgentRow(makeRecord({ id: "wrong" })).id).toBe("97:49637");
  });
});

describe("toAgentRow — a malformed record is rejected at the edge, not mid-transaction", () => {
  it("rejects a tokenId that is not a decimal integer", () => {
    expect(() => toAgentRow(makeRecord({ tokenId: "1e+21" }))).toThrow(/tokenId/);
    expect(() => toAgentRow(makeRecord({ tokenId: "1.5" }))).toThrow(/tokenId/);
    expect(() => toAgentRow(makeRecord({ tokenId: "" }))).toThrow(/tokenId/);
  });

  it("rejects a fetchedAt that is not ISO 8601", () => {
    expect(() => toAgentRow(makeRecord({ fetchedAt: "yesterday afternoon" }))).toThrow(/fetchedAt/);
  });

  it("rejects a money value that does not fit numeric(78, 0)", () => {
    const listing = { ...makeRecord().fuguListing!, priceUsd8PerPeriod: 10n ** 78n };
    expect(() => toAgentRow(makeRecord({ fuguListing: listing }))).toThrow(/numeric\(78, 0\)/);
    // Exactly 78 digits still fits — the maximum `uint256` must not be rejected too
    expect(() =>
      toAgentRow(makeRecord({ fuguListing: { ...listing, priceUsd8PerPeriod: MAX_UINT256 } })),
    ).not.toThrow();
  });
});

describe("fromAgentRow — invents no values for a half-filled row", () => {
  it("reports no listing instead of an owner `0x` and a fake category", () => {
    const row = toAgentRow(makeRecord());
    expect(fromAgentRow({ ...row, fuguOwner: null }).fuguListing).toBeNull();
    expect(fromAgentRow({ ...row, fuguCategory: null }).fuguListing).toBeNull();
    expect(fromAgentRow({ ...row, fuguPeriodSeconds: null }).fuguListing).toBeNull();
  });

  it("an unknown category is reported as not classified yet", () => {
    const row = toAgentRow(makeRecord());
    const back = fromAgentRow({
      ...row,
      classificationCategory: "SCALPING" as never,
    });
    expect(back.classification?.category).toBeNull();
    expect(back.fuguListing).not.toBeNull();
  });
});
