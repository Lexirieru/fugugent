import { describe, expect, it } from "vitest";
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult } from "viem";
import { bscTestnet } from "viem/chains";
import { CONTRACT_ADDRESSES, loadConfig } from "../config.js";
import { createOnchainSource, FUGU_REGISTRY_ABI } from "../sources/onchain.js";

const FETCHED_AT = new Date("2026-09-08T12:00:00.000Z");
const now = () => FETCHED_AT;

interface RawListing {
  erc8004AgentId: bigint;
  owner: `0x${string}`;
  agentWallet: `0x${string}`;
  category: number;
  priceUsd8PerPeriod: bigint;
  periodSeconds: number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

function listing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    erc8004AgentId: 1675n,
    owner: "0x1111111111111111111111111111111111111111",
    agentWallet: "0x2222222222222222222222222222222222222222",
    category: 0,
    priceUsd8PerPeriod: 1_500_000_000n,
    periodSeconds: 2_592_000,
    active: true,
    curated: true,
    metadataURI: "ipfs://Qm-rebalancer",
    ...overrides,
  };
}

interface FakeChain {
  listingCount: bigint | (() => bigint);
  listings: Map<bigint, RawListing | "revert">;
}

/** Transport viem palsu — test TIDAK PERNAH menyentuh RPC sungguhan. */
function fakeTransport(chainState: FakeChain) {
  const calls: {
    to: string;
    functionName: string;
    args: readonly unknown[];
  }[] = [];

  const client = createPublicClient({
    chain: bscTestnet,
    transport: custom(
      {
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method === "eth_chainId") return "0x61";
          if (method !== "eth_call") throw new Error(`metode tak terduga: ${method}`);
          const call = (params as [{ to: string; data: `0x${string}` }])[0];
          const decoded = decodeFunctionData({
            abi: FUGU_REGISTRY_ABI,
            data: call.data,
          });
          calls.push({
            to: call.to,
            functionName: decoded.functionName,
            args: (decoded.args ?? []) as readonly unknown[],
          });

          if (decoded.functionName === "listingCount") {
            const count =
              typeof chainState.listingCount === "function"
                ? chainState.listingCount()
                : chainState.listingCount;
            return encodeFunctionResult({
              abi: FUGU_REGISTRY_ABI,
              functionName: "listingCount",
              result: count,
            });
          }

          const id = (decoded.args as readonly bigint[])[0]!;
          const found = chainState.listings.get(id);
          if (found === undefined || found === "revert") {
            throw new Error("execution reverted: ListingNotFound");
          }
          return encodeFunctionResult({
            abi: FUGU_REGISTRY_ABI,
            functionName: "getListing",
            result: found,
          });
        },
      },
      // Tanpa ini viem mengulang setiap panggilan yang gagal tiga kali dengan
      // jeda — test revert jadi lambat dan menghitung ulang jumlah panggilan.
      { retryCount: 0 },
    ),
  });

  return { client, calls };
}

function makeSource(chainState: FakeChain) {
  const { client, calls } = fakeTransport(chainState);
  const source = createOnchainSource({
    client,
    config: loadConfig({ RPC_URL: "https://rpc.test" }),
    now,
  });
  return { source, calls };
}

describe("readFuguListings", () => {
  it("memanggil alamat FuguRegistry yang diambil dari config, bukan hardcode di modul", async () => {
    const { source, calls } = makeSource({
      listingCount: 0n,
      listings: new Map(),
    });

    await source.readFuguListings();

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.to.toLowerCase()).toBe(CONTRACT_ADDRESSES.registry.toLowerCase());
    }
  });

  it("listingCount 0 menghasilkan daftar kosong yang tetap dianggap sehat", async () => {
    const { source } = makeSource({ listingCount: 0n, listings: new Map() });

    const page = await source.readFuguListings();
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.healthy).toBe(true);
    expect(page.source).toBe("onchain");
    expect(page.fetchedAt).toBe(FETCHED_AT.toISOString());
  });

  it("membaca listing mulai dari id 1 dan memetakannya ke AgentRecord", async () => {
    const { source, calls } = makeSource({
      listingCount: 2n,
      listings: new Map([
        [1n, listing()],
        [
          2n,
          listing({
            erc8004AgentId: 99n,
            category: 3,
            metadataURI: "ipfs://Qm-guardian",
          }),
        ],
      ]),
    });

    const page = await source.readFuguListings();

    expect(calls.some((c) => c.functionName === "getListing" && c.args[0] === 1n)).toBe(true);
    expect(calls.some((c) => c.functionName === "getListing" && c.args[0] === 0n)).toBe(false);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
    expect(page.healthy).toBe(true);

    const first = page.items[0]!;
    expect(first.chainId).toBe(97);
    expect(first.tokenId).toBe("1675");
    expect(first.id).toBe("97:1675");
    expect(first.source).toBe("onchain");
    expect(first.registryAddress).toBe(CONTRACT_ADDRESSES.registry);
  });

  it("menyimpan seluruh nilai uang on-chain sebagai bigint", async () => {
    const { source } = makeSource({
      listingCount: 1n,
      listings: new Map([[1n, listing({ priceUsd8PerPeriod: 1_500_000_000n })]]),
    });

    const page = await source.readFuguListings();
    const l = page.items[0]!.fuguListing!;
    expect(typeof l.priceUsd8PerPeriod).toBe("bigint");
    expect(l.priceUsd8PerPeriod).toBe(1_500_000_000n);
    expect(typeof l.listingId).toBe("bigint");
    expect(l.listingId).toBe(1n);
    expect(typeof l.erc8004AgentId).toBe("bigint");
    expect(l.curated).toBe(true);
    expect(l.metadataURI).toBe("ipfs://Qm-rebalancer");
  });

  it("kategori on-chain dipakai sebagai klasifikasi dengan kepercayaan penuh", async () => {
    const { source } = makeSource({
      listingCount: 2n,
      listings: new Map([
        [1n, listing({ category: 1 })],
        [2n, listing({ erc8004AgentId: 7n, category: 3 })],
      ]),
    });

    const page = await source.readFuguListings();
    expect(page.items[0]!.fuguListing!.category).toBe("GRID");
    expect(page.items[0]!.classification).toEqual({
      category: "GRID",
      confidence: 1,
      reason: "kategori on-chain dari FuguRegistry",
    });
    expect(page.items[1]!.fuguListing!.category).toBe("HEALTH_FACTOR");
  });

  it("satu getListing yang revert tidak menjatuhkan listing lain", async () => {
    const { source } = makeSource({
      listingCount: 3n,
      listings: new Map<bigint, RawListing | "revert">([
        [1n, listing()],
        [2n, "revert"],
        [3n, listing({ erc8004AgentId: 3n })],
      ]),
    });

    const page = await source.readFuguListings();
    expect(page.items).toHaveLength(2);
    expect(page.healthy).toBe(true);
    expect(page.reason).toContain("1");
  });

  it("listingCount yang gagal menghasilkan daftar kosong dan sumber tidak sehat, bukan lemparan", async () => {
    const { source } = makeSource({
      listingCount: () => {
        throw new Error("RPC tumbang");
      },
      listings: new Map(),
    });

    let page!: Awaited<ReturnType<typeof source.readFuguListings>>;
    await expect(
      (async () => {
        page = await source.readFuguListings();
      })(),
    ).resolves.toBeUndefined();
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
    expect(page.reason).toBeTruthy();
  });

  it("menghormati limit dan offset atas rentang listing id", async () => {
    const { source, calls } = makeSource({
      listingCount: 5n,
      listings: new Map([
        [1n, listing({ erc8004AgentId: 1n })],
        [2n, listing({ erc8004AgentId: 2n })],
        [3n, listing({ erc8004AgentId: 3n })],
        [4n, listing({ erc8004AgentId: 4n })],
        [5n, listing({ erc8004AgentId: 5n })],
      ]),
    });

    const page = await source.readFuguListings({ limit: 2, offset: 2 });
    expect(page.items.map((i) => i.tokenId)).toEqual(["3", "4"]);
    expect(page.total).toBe(5);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(2);
    expect(calls.filter((c) => c.functionName === "getListing")).toHaveLength(2);
  });
});

describe("readFuguListing", () => {
  it("mengembalikan satu record untuk listing yang ada", async () => {
    const { source } = makeSource({
      listingCount: 1n,
      listings: new Map([[1n, listing()]]),
    });

    const res = await source.readFuguListing(1n);
    expect(res.agent?.tokenId).toBe("1675");
    expect(res.healthy).toBe(true);
  });

  it("listing yang revert menghasilkan agent null tanpa melempar", async () => {
    const { source } = makeSource({ listingCount: 1n, listings: new Map() });

    const res = await source.readFuguListing(42n);
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(false);
  });
});
