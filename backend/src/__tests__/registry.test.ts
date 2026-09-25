import { describe, expect, it } from "vitest";
import {
  createRegistryIndex,
  toRegistryRecord,
  type IdentityRegistryReader,
  type RawIdentity,
} from "../sources/registry.js";
import type { MetadataResolver, ResolvedMetadata } from "../sources/registry-metadata.js";
import {
  createRegistrationProver,
  REGISTERED_TOPIC,
  type ReceiptReader,
} from "../sources/registry-proof.js";
import type { Address } from "../types.js";

const REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const OWNER: Address = "0x1111111111111111111111111111111111111111";
const READ_AT = new Date("2026-09-25T08:00:00.000Z");
const now = () => READ_AT;

function b64(json: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`;
}

/** A registry of `uris.length` agents; `null` entries are burned ids. */
function fakeReader(uris: (string | null)[], opts: { failOnce?: boolean; failAlways?: boolean } = {}) {
  const calls: bigint[][] = [];
  let failures = 0;
  const reader: IdentityRegistryReader = {
    blockNumber: async () => 1234n,
    async readIds(ids) {
      calls.push([...ids]);
      if (opts.failAlways || (opts.failOnce && failures === 0)) {
        failures++;
        throw new Error("rpc hiccup");
      }
      return ids.map((id): RawIdentity | null => {
        const uri = uris[Number(id)];
        if (uri === undefined || uri === null) return null;
        return { tokenId: id, owner: OWNER, agentURI: uri, agentWallet: null };
      });
    },
  };
  return { reader, calls };
}

/** Inline decoding only — the index's logic is under test here, not the fetcher. */
const inlineOnly: MetadataResolver = {
  async resolve(uri): Promise<ResolvedMetadata> {
    if (uri === "") return { status: "empty", reason: "empty", file: null };
    if (!uri.startsWith("data:")) return { status: "unsupported", reason: "not inline", file: null };
    const json = JSON.parse(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8"));
    return {
      status: "inline",
      reason: null,
      file: {
        name: json.name ?? null,
        description: json.description ?? null,
        image: null,
        endpoints: json.endpoints ?? [],
        skills: [],
        domains: [],
        tags: [],
        active: true,
        x402Support: false,
      },
    };
  },
};

const GRID = b64({ name: "Grid Runner", description: "A grid trading bot that places grid orders across price levels." });
const HEALTH = b64({ name: "Liq Shield", description: "Health factor monitor that repays debt to avoid liquidation." });
const YIELD = b64({ name: "Yield Router", description: "Yield farming optimizer that auto-compounds rewards for the best APY." });

function index(uris: (string | null)[], extra: Partial<Parameters<typeof createRegistryIndex>[0]> = {}) {
  const { reader, calls } = fakeReader(uris);
  const idx = createRegistryIndex({
    reader,
    metadata: inlineOnly,
    registryAddress: REGISTRY,
    chainId: 97,
    now,
    batchSize: 4,
    gapLimit: 4,
    ...extra,
  });
  return { idx, calls };
}

describe("toRegistryRecord", () => {
  it("builds a classified record carrying its evidence", () => {
    const record = toRegistryRecord(
      { tokenId: 7n, owner: OWNER, agentURI: GRID, agentWallet: null },
      {
        status: "inline",
        reason: null,
        file: {
          name: "Grid Runner",
          description: "A grid trading bot that places grid orders across price levels.",
          image: null,
          endpoints: [{ name: "A2A", endpoint: "https://a.example", version: null }],
          skills: [],
          domains: [],
          tags: [],
          active: true,
          x402Support: false,
        },
      },
      { chainId: 97, registryAddress: REGISTRY, blockNumber: 99n, readAt: READ_AT.toISOString() },
    );
    expect(record.id).toBe("97:7");
    expect(record.source).toBe("registry");
    expect(record.classification?.category).toBe("GRID");
    expect(record.supportedProtocols).toEqual(["A2A"]);
    expect(record.evidence).toMatchObject({
      registryAddress: REGISTRY,
      blockNumber: "99",
      readAt: READ_AT.toISOString(),
      metadataStatus: "inline",
      registration: null,
    });
    // Nothing in the registry verifies anyone, so no badge is invented.
    expect(record.isVerified).toBe(false);
  });

  it("falls back to `Agent #id`, never to the raw URI, when there is no file", () => {
    const record = toRegistryRecord(
      { tokenId: 12n, owner: OWNER, agentURI: "user-c0352ec5", agentWallet: null },
      { status: "unsupported", reason: "neither a URL nor inline JSON", file: null },
      { chainId: 97, registryAddress: REGISTRY, blockNumber: 1n, readAt: READ_AT.toISOString() },
    );
    expect(record.name).toBe("Agent #12");
    expect(record.evidence?.metadataReason).toBe("neither a URL nor inline JSON");
    expect(record.classification?.category ?? null).toBeNull();
  });
});

describe("createRegistryIndex", () => {
  it("is not healthy before its first sweep, and says so", () => {
    const { idx } = index([GRID]);
    const page = idx.list("GRID", { limit: 10, offset: 0 });
    expect(page.healthy).toBe(false);
    expect(page.reason).toContain("first registry sweep");
    expect(idx.status().ready).toBe(false);
  });

  it("reads every id until the gap limit, pinned to one block", async () => {
    const { idx, calls } = index([GRID, HEALTH, null, YIELD, "", GRID]);
    const report = await idx.refresh();
    expect(report.ok).toBe(true);
    expect(report.agents).toBe(5);
    expect(report.blockNumber).toBe("1234");
    // ids 0–3, 4–7 (6 and 7 missing), 8–11 (all missing -> gap reached)
    expect(calls.length).toBe(3);
    expect(idx.all().map((r) => r.tokenId)).toEqual(["0", "1", "3", "4", "5"]);
  });

  it("serves categories from the snapshot, with the total the category really has", async () => {
    const { idx } = index([GRID, GRID, HEALTH, YIELD]);
    await idx.refresh();
    const grid = idx.list("GRID", { limit: 1, offset: 0 });
    expect(grid.healthy).toBe(true);
    expect(grid.total).toBe(2);
    expect(grid.items).toHaveLength(1);
    expect(grid.fetchedAt).toBe(READ_AT.toISOString());
    expect(idx.list("REBALANCING", { limit: 10, offset: 0 })).toMatchObject({ healthy: true, total: 0 });
  });

  it("ranks agents with a readable file first, then newest first", async () => {
    const unreadableGridName = "not-inline";
    const { idx } = index([GRID, GRID, unreadableGridName]);
    await idx.refresh();
    const ids = idx.list("GRID", { limit: 10, offset: 0 }).items.map((r) => r.tokenId);
    expect(ids).toEqual(["1", "0"]);
  });

  it("finds one agent by id and names the block when it is not there", async () => {
    const { idx } = index([GRID]);
    await idx.refresh();
    expect(idx.get("97:0").agent?.name).toBe("Grid Runner");
    const missing = idx.get("97:42");
    expect(missing.healthy).toBe(true);
    expect(missing.agent).toBeNull();
    expect(missing.reason).toContain("1234");
  });

  it("retries a batch once, then succeeds", async () => {
    const { reader, calls } = fakeReader([GRID], { failOnce: true });
    const idx = createRegistryIndex({ reader, metadata: inlineOnly, registryAddress: REGISTRY, chainId: 97, now, batchSize: 4, gapLimit: 4 });
    expect((await idx.refresh()).ok).toBe(true);
    expect(calls[0]).toEqual(calls[1]);
  });

  it("never publishes a partial read, and keeps the previous snapshot on failure", async () => {
    let broken = false;
    const reader: IdentityRegistryReader = {
      blockNumber: async () => 1n,
      async readIds(ids) {
        if (broken) throw new Error("rpc down");
        return ids.map((id) => (id < 2n ? { tokenId: id, owner: OWNER, agentURI: GRID, agentWallet: null } : null));
      },
    };
    const idx = createRegistryIndex({ reader, metadata: inlineOnly, registryAddress: REGISTRY, chainId: 97, now, batchSize: 4, gapLimit: 4 });
    await idx.refresh();
    broken = true;
    const report = await idx.refresh();
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("previous snapshot kept");
    expect(idx.list("GRID", { limit: 10, offset: 0 }).total).toBe(2);
    expect(idx.status()).toMatchObject({ ready: true, healthy: false });
  });

  it("refuses to publish an empty registry as a snapshot", async () => {
    const { idx } = index([]);
    const report = await idx.refresh();
    expect(report.ok).toBe(false);
    expect(idx.status().ready).toBe(false);
  });

  it("shares one sweep between concurrent refreshes", async () => {
    const { idx, calls } = index([GRID]);
    await Promise.all([idx.refresh(), idx.refresh(), idx.refresh()]);
    expect(calls.length).toBe(2);
  });

  it("hands every published snapshot to onSnapshot, and survives it throwing", async () => {
    const seen: number[] = [];
    const { idx } = index([GRID, HEALTH], {
      onSnapshot: (records) => {
        seen.push(records.length);
        throw new Error("postgres down");
      },
    });
    expect((await idx.refresh()).ok).toBe(true);
    expect(seen).toEqual([2]);
  });

  it("does not re-resolve an unchanged URI on the next sweep", async () => {
    let resolved = 0;
    const counting: MetadataResolver = {
      resolve: (uri) => {
        resolved++;
        return inlineOnly.resolve(uri);
      },
    };
    const { idx } = index([GRID, HEALTH], { metadata: counting });
    await idx.refresh();
    await idx.refresh();
    expect(resolved).toBe(2);
  });
});

describe("createRegistrationProver", () => {
  const HASH = `0x${"ab".repeat(32)}` as const;
  const topicFor = (id: bigint) => `0x${id.toString(16).padStart(64, "0")}`;

  function receipts(logs: { address: string; topics: string[] }[], status: "success" | "reverted" = "success"): ReceiptReader {
    return {
      receipt: async () => ({ status, blockNumber: 500n, logs }),
      blockTimestamp: async () => 1_790_000_000n,
    };
  }

  it("accepts a hint only when the receipt shows this registry minting this id", async () => {
    const prover = createRegistrationProver({
      hint: async () => HASH,
      receipts: receipts([{ address: REGISTRY.toLowerCase(), topics: [REGISTERED_TOPIC, topicFor(7n)] }]),
      registryAddress: REGISTRY,
    });
    const proof = await prover.prove("7");
    expect(proof).toMatchObject({ txHash: HASH, blockNumber: "500", hintedBy: "8004scan" });
    expect(proof?.registeredAt).toBe(new Date(1_790_000_000_000).toISOString());
    expect(prover.peek("7")).toEqual(proof);
  });

  it.each([
    ["another id", [{ address: REGISTRY, topics: [REGISTERED_TOPIC, topicFor(8n)] }], "success"],
    ["another contract", [{ address: OWNER, topics: [REGISTERED_TOPIC, topicFor(7n)] }], "success"],
    ["another event", [{ address: REGISTRY, topics: [`0x${"00".repeat(32)}`, topicFor(7n)] }], "success"],
    ["a reverted tx", [{ address: REGISTRY, topics: [REGISTERED_TOPIC, topicFor(7n)] }], "reverted"],
  ] as const)("drops a hint whose receipt shows %s", async (_label, logs, status) => {
    const prover = createRegistrationProver({
      hint: async () => HASH,
      receipts: receipts(logs.map((l) => ({ address: l.address, topics: [...l.topics] })), status),
      registryAddress: REGISTRY,
    });
    expect(await prover.prove("7")).toBeNull();
    expect(prover.peek("7")).toBeNull();
  });

  it("does not repeat a failed lookup until the retry pause has passed", async () => {
    let hints = 0;
    let clock = 0;
    const prover = createRegistrationProver({
      hint: async () => {
        hints++;
        return null;
      },
      receipts: receipts([]),
      registryAddress: REGISTRY,
      nowMs: () => clock,
    });
    await prover.prove("7");
    await prover.prove("7");
    expect(hints).toBe(1);
    clock = 11 * 60_000;
    await prover.prove("7");
    expect(hints).toBe(2);
  });

  it("never throws, even when the hint does", async () => {
    const prover = createRegistrationProver({
      hint: async () => {
        throw new Error("8004scan down");
      },
      receipts: receipts([]),
      registryAddress: REGISTRY,
    });
    await expect(prover.prove("7")).resolves.toBeNull();
  });
});
