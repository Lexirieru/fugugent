/**
 * Reading the catalog.
 *
 * Two things are being guarded here. The first is that a listing this build cannot
 * understand is recorded rather than dropped, because a catalog that silently shrinks
 * turns "the cheapest agent for this job" into "the cheapest agent this bug let through".
 * The second is that the metadata reader never touches the network: the address it reads
 * is a string a stranger wrote, inside a process that holds a spending key.
 */
import { describe, expect, it, vi } from "vitest";
import {
  readCatalog,
  readListingMetadata,
  toCatalogListing,
  type RawListing,
} from "../chain/registry.js";
import { CatalogError } from "../types.js";

function raw(over: Partial<RawListing> = {}): RawListing {
  return {
    erc8004AgentId: 8004n,
    owner: "0x1111111111111111111111111111111111111111",
    agentWallet: "0x2222222222222222222222222222222222222222",
    category: 2,
    priceUsd8PerPeriod: 5_000_000n,
    periodSeconds: 120,
    active: true,
    curated: false,
    metadataURI: "",
    ...over,
  };
}

function dataUri(value: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(value)).toString("base64")}`;
}

describe("readListingMetadata", () => {
  it("reads a name and the claim about carrying out work from metadata carried in the listing", () => {
    const uri = dataUri({ name: "Fugu Guardian", onchainExecution: true });
    expect(readListingMetadata(uri)).toEqual({ name: "Fugu Guardian", onchainExecution: true });
  });

  it("refuses an address that points somewhere else, and never fetches it", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const uri of [
      "https://example.com/agent.json",
      "ipfs://fugu-guardian-v1",
      "file:///etc/passwd",
      "",
    ]) {
      expect(readListingMetadata(uri)).toEqual({ name: "", onchainExecution: false });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("refuses metadata that is readable but was not carried inside the listing", () => {
    // This is the case the prefix check exists for, and the only one where removing it
    // changes the answer rather than merely moving where the failure happens. The string
    // below decodes cleanly to {"name":"Hijacked","onchainExecution":true}: without the
    // check, a listing could put a name and a capability claim anywhere it liked and this
    // agent would read them.
    const smuggled = Buffer.from(
      JSON.stringify({ name: "Hijacked", onchainExecution: true }),
    ).toString("base64");
    expect(readListingMetadata(smuggled)).toEqual({ name: "", onchainExecution: false });
    expect(readListingMetadata(`ipfs://${smuggled}`)).toEqual({ name: "", onchainExecution: false });
    // The same bytes, carried inside the listing, ARE read.
    expect(readListingMetadata(`data:application/json;base64,${smuggled}`)).toEqual({
      name: "Hijacked",
      onchainExecution: true,
    });
  });

  it("treats broken metadata as absent rather than failing the whole read", () => {
    expect(readListingMetadata("data:application/json;base64,not-base64-json")).toEqual({
      name: "",
      onchainExecution: false,
    });
    expect(readListingMetadata(dataUri(["a", "b"]))).toEqual({ name: "", onchainExecution: false });
    expect(readListingMetadata(dataUri(null))).toEqual({ name: "", onchainExecution: false });
  });

  it("accepts only the boolean true as a claim that the listing carries out work", () => {
    expect(readListingMetadata(dataUri({ onchainExecution: "yes" })).onchainExecution).toBe(false);
    expect(readListingMetadata(dataUri({ onchainExecution: 1 })).onchainExecution).toBe(false);
    expect(readListingMetadata(dataUri({ onchainExecution: true })).onchainExecution).toBe(true);
  });
});

describe("toCatalogListing", () => {
  it("turns a stored listing into the shape the engine reads", () => {
    const listing = toCatalogListing(3n, raw({ metadataURI: dataUri({ name: "Fugu Grid" }) }));
    expect(listing.listingId).toBe(3n);
    expect(listing.category).toBe("YIELD");
    expect(listing.periodSeconds).toBe(120n);
    expect(listing.name).toBe("Fugu Grid");
  });

  it("refuses a capability index this build does not know", () => {
    expect(() => toCatalogListing(1n, raw({ category: 42 }))).toThrow(CatalogError);
  });
});

describe("readCatalog", () => {
  it("reads ids from 1 to the count, because id 0 never exists", async () => {
    const seen: bigint[] = [];
    await readCatalog(3n, async (id) => {
      seen.push(id);
      return raw();
    });
    expect(seen).toEqual([1n, 2n, 3n]);
  });

  it("returns an empty catalog for an empty registry without calling anything", async () => {
    const getListing = vi.fn(async () => raw());
    const result = await readCatalog(0n, getListing);
    expect(result.listings).toHaveLength(0);
    expect(getListing).not.toHaveBeenCalled();
  });

  it("records a listing it cannot read instead of dropping it in silence", async () => {
    const result = await readCatalog(3n, async (id) => {
      if (id === 2n) throw new Error("the node timed out");
      return raw();
    });
    expect(result.listings.map((l) => l.listingId)).toEqual([1n, 3n]);
    expect(result.unreadable).toEqual([{ listingId: 2n, reason: "the node timed out" }]);
  });

  it("records a listing whose capability this build does not know", async () => {
    const result = await readCatalog(1n, async () => raw({ category: 42 }));
    expect(result.listings).toHaveLength(0);
    expect(result.unreadable[0]?.reason).toContain("capabilities this");
  });

  it("refuses a count that is not a count", async () => {
    await expect(readCatalog(-1n, async () => raw())).rejects.toThrow(CatalogError);
  });
});
