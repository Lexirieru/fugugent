/**
 * `metadataURI` is a string an arbitrary lister wrote on-chain, so this file is
 * mostly a list of ways it can be wrong. The binding rule for all of them: the
 * reader declines, it never throws, and the caller keeps the placeholder name.
 *
 * The one test that would matter most if it regressed is the last group: a
 * malformed listing must not take anything else down with it.
 */
import { describe, expect, it } from "vitest";
import type { Address, AgentRecord, Category } from "../../types.js";
import { makeAgentKey } from "../../types.js";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_METADATA_URI_LENGTH,
  MAX_NAME_LENGTH,
  applyListingMetadata,
  parseListingMetadata,
} from "../metadata.js";

const AGENT_WALLET = "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9" as Address;
const DEPLOYER_EOA = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as Address;

function dataUri(body: unknown, opts: { base64?: boolean; mediatype?: string } = {}): string {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  const mediatype = opts.mediatype ?? "application/json";
  return opts.base64 === false
    ? `data:${mediatype},${encodeURIComponent(json)}`
    : `data:${mediatype};base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

function listed(
  metadataURI: string,
  agentWallet: Address = AGENT_WALLET,
  category: Category = "GRID",
): AgentRecord {
  return {
    id: makeAgentKey(97, "8006"),
    chainId: 97,
    tokenId: "8006",
    registryAddress: "0xb2f36070E6eae3353E8e755172B477DF213ae248" as Address,
    agentId: null,
    name: "Agent #8006",
    description: "",
    imageUrl: null,
    agentType: null,
    tags: [],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: [],
    ownerAddress: DEPLOYER_EOA,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet,
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
    classification: { category, confidence: 1, reason: "on-chain category" },
    fuguListing: {
      listingId: 3n,
      erc8004AgentId: 8006n,
      owner: DEPLOYER_EOA,
      agentWallet,
      category,
      priceUsd8PerPeriod: 5_000_000n,
      periodSeconds: 120,
      active: true,
      curated: false,
      metadataURI,
    },
    source: "onchain",
    fetchedAt: "2026-09-09T00:00:00.000Z",
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
  };
}

describe("parseListingMetadata — the real payload", () => {
  it("reads name, summary and onchainExecution from what registration actually writes", () => {
    // Shape copied from the live listing for 97:8006.
    const uri = dataUri({
      name: "Fugu Grid",
      agent: "fugugrid",
      category: "GRID",
      agentWallet: AGENT_WALLET,
      summary: "Grid trading on PancakeSwap v3: line spacing must be at least 2x the cost.",
      onchainExecution: false,
      limits: "Deterministic decision engine and backtest only.",
      verify: "cd ai/fugugrid/app/agent && corepack pnpm test",
      chainId: 97,
    });

    const parsed = parseListingMetadata(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Fugu Grid");
    expect(parsed!.description).toContain("Grid trading on PancakeSwap v3");
    expect(parsed!.onchainExecution).toBe(false);
    expect(parsed!.limits).toContain("backtest only");
    expect(parsed!.verify).toContain("pnpm test");
    expect(parsed!.declaredAgentWallet).toBe(AGENT_WALLET);
  });

  it("accepts `description` as well as `summary`", () => {
    expect(parseListingMetadata(dataUri({ description: "Written the obvious way" }))!.description).toBe(
      "Written the obvious way",
    );
  });

  it("prefers `description` when both are present", () => {
    const parsed = parseListingMetadata(dataUri({ description: "primary", summary: "secondary" }));
    expect(parsed!.description).toBe("primary");
  });

  it("accepts a non-base64 data URI too", () => {
    const parsed = parseListingMetadata(dataUri({ name: "Fugu Yield" }, { base64: false }));
    expect(parsed!.name).toBe("Fugu Yield");
  });

  it("`onchainExecution: true` is preserved — it is not assumed false", () => {
    expect(parseListingMetadata(dataUri({ onchainExecution: true }))!.onchainExecution).toBe(true);
  });
});

describe("parseListingMetadata — every way it can be wrong", () => {
  const declined: Array<[string, unknown]> = [
    ["not a string at all", 42],
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["a different scheme (ipfs)", "ipfs://QmSomething"],
    ["a different scheme (https)", "https://example.com/meta.json"],
    ["data: with no comma", "data:application/json;base64"],
    ["a non-JSON mediatype", "data:image/png;base64,iVBORw0KGgo="],
    ["invalid base64", "data:application/json;base64,!!!!not base64!!!!"],
    ["valid base64 of non-JSON", `data:application/json;base64,${Buffer.from("hello").toString("base64")}`],
    ["empty base64 payload", "data:application/json;base64,"],
    ["JSON that is an array", dataUri([{ name: "nope" }])],
    ["JSON that is a number", dataUri(7)],
    ["JSON that is a string", dataUri('"just a string"')],
    ["JSON that is null", dataUri(null)],
    ["truncated JSON", "data:application/json,%7B%22name%22%3A%22oops"],
    ["malformed percent-encoding", "data:application/json,%zz"],
    ["an object with no recognised field", dataUri({ unrelated: "value", chainId: 97 })],
    ["fields of the wrong type", dataUri({ name: {}, summary: [], onchainExecution: "false" })],
    ["a name that is only control characters", dataUri({ name: "\u0000\u0001\u0002" })],
  ];

  it.each(declined)("declines %s without throwing", (_label, input) => {
    expect(() => parseListingMetadata(input)).not.toThrow();
    expect(parseListingMetadata(input)).toBeNull();
  });

  it("declines a URI longer than the cap without decoding it", () => {
    const huge = `data:application/json;base64,${"A".repeat(MAX_METADATA_URI_LENGTH)}`;
    expect(parseListingMetadata(huge)).toBeNull();
  });

  it("declines a payload that decodes to more than the byte cap", () => {
    const big = JSON.stringify({ name: "x", summary: "y".repeat(40_000) });
    expect(parseListingMetadata(dataUri(big === "" ? {} : JSON.parse(big)))).toBeNull();
  });

  it("caps an over-long name instead of rejecting the whole document", () => {
    const parsed = parseListingMetadata(dataUri({ name: "N".repeat(MAX_NAME_LENGTH + 500) }));
    expect(parsed!.name).toHaveLength(MAX_NAME_LENGTH);
  });

  it("caps an over-long description", () => {
    const parsed = parseListingMetadata(
      dataUri({ name: "ok", summary: "D".repeat(MAX_DESCRIPTION_LENGTH + 500) }),
    );
    expect(parsed!.description).toHaveLength(MAX_DESCRIPTION_LENGTH);
  });

  it("strips control characters and collapses whitespace in a name", () => {
    const parsed = parseListingMetadata(dataUri({ name: "  Fugu\u0000\u0007  Grid \n " }));
    expect(parsed!.name).toBe("Fugu Grid");
  });

  it("ignores a declared wallet that is not an address", () => {
    const parsed = parseListingMetadata(dataUri({ name: "ok", agentWallet: "0xnope" }));
    expect(parsed!.declaredAgentWallet).toBeNull();
  });

  it("`\"false\"` is not `false` — a string never becomes a boolean", () => {
    const parsed = parseListingMetadata(dataUri({ name: "ok", onchainExecution: "false" }));
    expect(parsed!.onchainExecution).toBeNull();
  });
});

describe("applyListingMetadata", () => {
  it("replaces the placeholder name with the real one", () => {
    const { record, ok } = applyListingMetadata(
      listed(dataUri({ name: "Fugu Grid", summary: "Grid trading on PancakeSwap v3." })),
    );
    expect(ok).toBe(true);
    expect(record.name).toBe("Fugu Grid");
    expect(record.description).toBe("Grid trading on PancakeSwap v3.");
  });

  it("promotes onchainExecution so the UI cannot miss it", () => {
    const { record } = applyListingMetadata(
      listed(dataUri({ name: "Fugu Grid", onchainExecution: false })),
    );
    expect(record.onchainExecution).toBe(false);
    expect(record.listingMetadata?.onchainExecution).toBe(false);
  });

  it("leaves the placeholder in place when the metadata is unreadable, and says so", () => {
    const { record, ok } = applyListingMetadata(listed("data:application/json;base64,!!!!"));
    expect(ok).toBe(false);
    expect(record.name).toBe("Agent #8006");
    expect(record.description).toBe("");
    expect((record as { listingMetadata?: unknown }).listingMetadata).toBeUndefined();
  });

  it("a listing with no metadata at all is not counted as a failure", () => {
    const { ok, record } = applyListingMetadata(listed(""));
    expect(ok).toBe(true);
    expect(record.name).toBe("Agent #8006");
  });

  it("never overwrites the on-chain agentWallet from metadata", () => {
    // Listing 1 (Guardian) still points at the deployer EOA. Metadata claiming
    // the Altana wallet must not be allowed to paper over that.
    const { record } = applyListingMetadata(
      listed(dataUri({ name: "Fugu Guardian", agentWallet: AGENT_WALLET }), DEPLOYER_EOA),
    );
    expect(record.agentWallet).toBe(DEPLOYER_EOA);
    expect(record.fuguListing!.agentWallet).toBe(DEPLOYER_EOA);
    expect(record.listingMetadata?.declaredAgentWallet).toBe(AGENT_WALLET);
    // The disagreement is reported, so nothing here can be shown as proof.
    expect(record.listingMetadata?.agentWalletMatchesListing).toBe(false);
  });

  it("reports agreement when the two wallets do match", () => {
    const { record } = applyListingMetadata(
      listed(dataUri({ name: "Fugu Grid", agentWallet: AGENT_WALLET }), AGENT_WALLET),
    );
    expect(record.listingMetadata?.agentWalletMatchesListing).toBe(true);
  });

  it("money is untouched by metadata handling", () => {
    const { record } = applyListingMetadata(listed(dataUri({ name: "Fugu Grid" })));
    expect(typeof record.fuguListing!.priceUsd8PerPeriod).toBe("bigint");
    expect(record.fuguListing!.priceUsd8PerPeriod).toBe(5_000_000n);
  });

  it("does not mutate the record it was given", () => {
    const original = listed(dataUri({ name: "Fugu Grid" }));
    applyListingMetadata(original);
    expect(original.name).toBe("Agent #8006");
  });
});

describe("parseListingMetadata — guards that only bite on a crafted payload", () => {
  it("base64 with foreign characters is rejected, not silently repaired", () => {
    // `Buffer.from(..., "base64")` DROPS characters outside the alphabet, so
    // without an explicit check an invalid payload decodes to something that
    // happens to parse — and a lister could smuggle a name through a URI that is
    // not valid base64 at all. Here the sprinkled characters are dropped and the
    // remainder is perfectly good JSON, which is exactly the case a
    // "just try to decode it" implementation lets through.
    const valid = Buffer.from(JSON.stringify({ name: "Injected" }), "utf8").toString("base64");
    const sprinkled = valid.split("").join("*");
    expect(Buffer.from(sprinkled, "base64").toString("utf8")).toBe(JSON.stringify({ name: "Injected" }));

    expect(parseListingMetadata(`data:application/json;base64,${sprinkled}`)).toBeNull();
  });

  it("an over-long URI is declined even when its payload would decode fine", () => {
    // Small enough to pass the byte cap, long enough to be abusive as a URI.
    // Padding chosen so percent-encoding inflates the URI past the URI cap while
    // the decoded payload stays under the byte cap.
    const body = JSON.stringify({ name: "Injected", pad: "\u00e9".repeat(11_000) });
    const uri = `data:application/json,${encodeURIComponent(body)}`;
    expect(uri.length).toBeGreaterThan(MAX_METADATA_URI_LENGTH);
    expect(parseListingMetadata(uri)).toBeNull();
  });

  it("a non-`data:` scheme is declined even when it looks decodable", () => {
    // Without an explicit scheme check, the header/payload split alone would
    // accept this: everything before the comma merely has to mention json.
    const smuggled = `ftp:x/json,${encodeURIComponent(JSON.stringify({ name: "Injected" }))}`;
    expect(parseListingMetadata(smuggled)).toBeNull();
  });
});

/**
 * The regression this file exists for.
 *
 * `proof` was written into every listing by the registration script and dropped
 * here, so the marketplace showed "No transactions yet" for an agent whose
 * evidence was on chain. A parser that silently discards a field it does not
 * recognise is how a published claim disappears one layer later.
 */
describe("proof survives the parse", () => {
  it("keeps the evidence paragraph the listing published", () => {
    const proof = "Raised a health factor from 1.14 to 1.50 by repaying $4.03, tx 0x619cfbe3.";
    const uri = dataUri({ name: "Fugu Guardian", summary: "watches a loan", proof });

    expect(parseListingMetadata(uri)?.proof).toBe(proof);
  });

  it("is null, not an empty string, when the listing published none", () => {
    const uri = dataUri({ name: "Fugu Guardian", summary: "watches a loan" });

    expect(parseListingMetadata(uri)?.proof).toBeNull();
  });

  it("alone is enough to make a document usable", () => {
    // A listing that declares nothing but its evidence still says something worth
    // showing, so it must not be discarded as unreadable metadata.
    const uri = dataUri({ proof: "tx 0x619cfbe3" });

    expect(parseListingMetadata(uri)?.proof).toBe("tx 0x619cfbe3");
  });
});
