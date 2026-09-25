import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { createApp } from "../routes/app.js";
import { TRACKED_EVENTS } from "../routes/tracking.js";
import {
  createTrackingService,
  type ChainSnapshot,
  type RawListing,
  type RawSub,
  type TrackingChain,
} from "../sources/tracking.js";
import type { Address, AgentRecord } from "../types.js";

const ALICE: Address = "0xA11ce00000000000000000000000000000000001";
const BOB: Address = "0xB0b0000000000000000000000000000000000002";
const OWNER: Address = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E";
const CONTRACTS = {
  registry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  subscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
  reputation: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
} as const;
const NOW_TS = 1_790_000_000n;

function listing(id: bigint, agent: bigint, category: RawListing["category"], owner: Address = OWNER): RawListing {
  return {
    listingId: id,
    erc8004AgentId: agent,
    owner,
    agentWallet: owner,
    category,
    priceUsd8PerPeriod: 10_000_000n,
    periodSeconds: 120,
    active: true,
  };
}

function sub(id: bigint, listingId: bigint, subscriber: Address, over: Partial<RawSub> = {}): RawSub {
  return {
    subId: id,
    listingId,
    subscriber,
    payToken: "0x0000000000000000000000000000000000000000",
    deposited: 1000n,
    claimed: 0n,
    startedAt: NOW_TS - 60n,
    endsAt: NOW_TS + 60n,
    cancelled: false,
    ...over,
  };
}

function fakeChain(snapshot: ChainSnapshot, reviewedBy: Record<string, bigint[]> = {}) {
  let reads = 0;
  const chain: TrackingChain = {
    async snapshot() {
      reads++;
      return snapshot;
    },
    async reviewed(ids, wallet) {
      const mine = reviewedBy[wallet.toLowerCase()] ?? [];
      return ids.map((id) => mine.includes(id));
    },
  };
  return { chain, reads: () => reads };
}

const SNAPSHOT: ChainSnapshot = {
  blockNumber: 133_000_000n,
  blockTimestamp: NOW_TS,
  listings: [
    listing(1n, 2480n, "HEALTH_FACTOR"),
    listing(2n, 2481n, "REBALANCING"),
    listing(3n, 2482n, "GRID"),
    listing(4n, 900n, "YIELD", BOB),
  ],
  subs: [
    sub(1n, 1n, ALICE),
    sub(2n, 3n, ALICE, { endsAt: NOW_TS - 1n }),
    sub(3n, 2n, ALICE, { cancelled: true }),
    sub(4n, 1n, BOB),
    sub(5n, 3n, ALICE),
  ],
};

function registryAgent(tokenId: string, name: string, owner: Address): AgentRecord {
  return { id: `97:${tokenId}`, tokenId, name, ownerAddress: owner } as AgentRecord;
}

function service(extra: { reviewedBy?: Record<string, bigint[]> } = {}) {
  const { chain, reads } = fakeChain(SNAPSHOT, extra.reviewedBy);
  const tracking = createTrackingService({
    chain,
    chainId: 97,
    contracts: CONTRACTS,
    registryAgents: () => [
      registryAgent("2480", "Fugu Guardian", OWNER),
      registryAgent("2481", "Fugu Rebalancer", OWNER),
      registryAgent("2482", "Fugu Grid", OWNER),
      registryAgent("77", "An unlisted agent of ours", OWNER),
      registryAgent("900", "Bob's agent", BOB),
    ],
    registryBlock: () => "132999999",
    now: () => new Date("2026-09-25T00:00:00.000Z"),
  });
  return { tracking, reads };
}

describe("tracking: hires per wallet", () => {
  it("lists every hire by the wallet with its declared category and status", async () => {
    const { tracking } = service();
    const out = await tracking.hires(ALICE);
    expect(out.blockNumber).toBe("133000000");
    expect(out.hires.map((h) => [h.subId, h.category, h.status])).toEqual([
      ["1", "HEALTH_FACTOR", "active"],
      ["2", "GRID", "ended"],
      ["3", "REBALANCING", "cancelled"],
      ["5", "GRID", "active"],
    ]);
    expect(out.hires[0]).toMatchObject({ erc8004AgentId: "2480", agentKey: "97:2480", agentName: "Fugu Guardian" });
  });

  it("counts a cancelled hire's category, since the hire and its payment happened", async () => {
    const { tracking } = service();
    expect((await tracking.hires(ALICE)).categoriesHired.sort()).toEqual(["GRID", "HEALTH_FACTOR", "REBALANCING"]);
  });

  it("matches the wallet case-insensitively and returns nothing for a stranger", async () => {
    const { tracking } = service();
    expect((await tracking.hires(ALICE.toLowerCase() as Address)).hires).toHaveLength(4);
    expect((await tracking.hires("0x0000000000000000000000000000000000000009")).hires).toEqual([]);
  });

  it("reuses one chain read for a burst of calls", async () => {
    const { tracking, reads } = service();
    await Promise.all([tracking.hires(ALICE), tracking.hires(BOB), tracking.agents(OWNER)]);
    expect(reads()).toBe(1);
  });
});

describe("tracking: agents per owner", () => {
  it("returns the owner's listings and ERC-8004 identities, and says which are listed", async () => {
    const { tracking } = service();
    const out = await tracking.agents(OWNER);
    expect(out.listings.map((l) => [l.listingId, l.agentKey, l.category])).toEqual([
      ["1", "97:2480", "HEALTH_FACTOR"],
      ["2", "97:2481", "REBALANCING"],
      ["3", "97:2482", "GRID"],
    ]);
    expect(out.identities.map((i) => [i.agentKey, i.listingId])).toEqual([
      ["97:2480", "1"],
      ["97:2481", "2"],
      ["97:2482", "3"],
      ["97:77", null],
    ]);
    expect(out.identitiesBlockNumber).toBe("132999999");
  });
});

describe("tracking: ratings per wallet", () => {
  it("returns the listings the wallet has reviewed", async () => {
    const { tracking } = service({ reviewedBy: { [ALICE.toLowerCase()]: [3n] } });
    expect((await tracking.reviews(ALICE)).reviewedListings).toEqual([
      { listingId: "3", erc8004AgentId: "2482", agentKey: "97:2482", category: "GRID" },
    ]);
  });
});

describe("tracking routes", () => {
  function app(tracking = service().tracking) {
    return createApp({
      service: {} as never,
      tracking: { tracking, chainId: 97, contracts: { ...CONTRACTS, identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e" } },
    });
  }

  it("every published topic0 is the keccak of its canonical signature", () => {
    for (const event of TRACKED_EVENTS) {
      expect(keccak256(toBytes(event.canonical)), event.canonical).toBe(event.topic0);
    }
  });

  it("names every action the brief asks for", () => {
    const actions = TRACKED_EVENTS.map((e) => e.action);
    for (const needed of ["hire", "deposit", "job completion", "rating"]) expect(actions).toContain(needed);
  });

  it("serves the spec, and the per-wallet answers", async () => {
    const spec = (await (await app().request("/api/tracking")).json()) as { contracts: { erc8004IdentityRegistry: string } };
    expect(spec.contracts.erc8004IdentityRegistry).toBe("0x8004A818BFB912233c491871b3d84c89A494BD9e");
    const res = await app().request(`/api/tracking/hires?wallet=${ALICE}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hires: unknown[] }).hires).toHaveLength(4);
  });

  it("answers a malformed or missing address with a 400 naming the field", async () => {
    for (const path of ["/api/tracking/hires?wallet=0x123", "/api/tracking/agents", "/api/tracking/reviews?wallet=abc"]) {
      const res = await app().request(path);
      expect(res.status, path).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_query");
    }
  });

  it("a failed chain read is a 503 with a reason, never an empty 200", async () => {
    const broken = createTrackingService({
      chain: { snapshot: async () => { throw new Error("rpc down"); }, reviewed: async () => [] },
      chainId: 97,
      contracts: CONTRACTS,
    });
    const res = await app(broken).request(`/api/tracking/hires?wallet=${ALICE}`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain("rpc down");
  });
});
