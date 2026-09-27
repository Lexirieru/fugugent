import { describe, expect, it } from "vitest";
import { createApp } from "../routes/app.js";
import { RUN_AGENTS, usdToUsd8 } from "../routes/tools.js";
import { createTools, fixed18, watchVerdict, type ToolsChain } from "../sources/tools.js";
import type { HiresAnswer, TrackingService } from "../sources/tracking.js";
import type { Address } from "../types.js";

const ALICE: Address = "0xA11ce00000000000000000000000000000000001";
const NATIVE: Address = "0x0000000000000000000000000000000000000000";
const E18 = 10n ** 18n;

function chain(over: Partial<ToolsChain> = {}): ToolsChain {
  return {
    blockNumber: async () => 100n,
    accountData: async () => ({ collateral: 1000n * 10n ** 8n, debt: 500n * 10n ** 8n, healthFactor: (115n * E18) / 100n }),
    isValidKey: async () => true,
    quoteNative: async (usd8) => ({ amountWei: (usd8 * E18) / (600n * 10n ** 8n), priceUsd8: 600n * 10n ** 8n }),
    ...over,
  };
}

function hires(rows: Partial<HiresAnswer["hires"][number]>[]): TrackingService {
  const answer: HiresAnswer = {
    chainId: 97,
    blockNumber: "100",
    readAt: "2026-09-27T00:00:00.000Z",
    contracts: { registry: NATIVE, subscription: NATIVE, reputation: NATIVE },
    wallet: ALICE,
    categoriesHired: [],
    hires: rows.map((r, i) => ({
      subId: String(i + 1),
      listingId: "1",
      erc8004AgentId: "2480",
      agentKey: "97:2480",
      agentName: "Fugu Guardian",
      category: "HEALTH_FACTOR",
      payToken: NATIVE,
      deposited: "0",
      claimedByAgent: "0",
      startedAt: "",
      endsAt: "",
      status: "ended",
      ...r,
    })),
  };
  return { hires: async () => answer, agents: async () => { throw new Error("unused"); }, reviews: async () => { throw new Error("unused"); } };
}

function tools(over: { chain?: ToolsChain; tracking?: TrackingService } = {}) {
  return createTools({
    chain: over.chain ?? chain(),
    tracking: over.tracking ?? hires([]),
    chainId: 97,
    catalogue: async (category, limit) => ({
      total: 7,
      source: "registry",
      items: Array.from({ length: limit }, (_, i) => ({ id: `97:${i}`, name: `${category} agent ${i}`, source: "registry" })),
    }),
  });
}

function app(t = tools()) {
  return createApp({ service: {} as never, tools: t });
}

describe("read-only agents", () => {
  it("fixed18 rounds without floats", () => {
    expect(fixed18((1149n * E18) / 1000n)).toBe("1.149");
    expect(fixed18(5n * 10n ** 14n, 6)).toBe("0.000500");
    expect(fixed18(0n)).toBe("0.000");
  });

  it("Watch uses Fugu Guardian's bands", () => {
    expect(watchVerdict(0n, 0n)).toBe("no-loan");
    expect(watchVerdict(1n, (16n * E18) / 10n)).toBe("safe");
    expect(watchVerdict(1n, (14n * E18) / 10n)).toBe("warn");
    expect(watchVerdict(1n, (115n * E18) / 100n)).toBe("repay");
    expect(watchVerdict(1n, (105n * E18) / 100n)).toBe("deleverage");
  });

  it("Watch reports a loan with its health factor and the block", async () => {
    const r = await tools().watch(ALICE);
    expect(r).toMatchObject({ agent: "Fugu Watch", blockNumber: "100", healthFactor: "1.150", verdict: "repay" });
  });

  it("Watch says there is nothing to watch when there is no debt", async () => {
    const r = await tools({ chain: chain({ accountData: async () => ({ collateral: 0n, debt: 0n, healthFactor: 2n ** 256n - 1n }) }) }).watch(ALICE);
    expect(r.healthFactor).toBeNull();
    expect(r.verdict).toBe("no-loan");
  });

  it("Tally sums native spend per agent and counts running hires", async () => {
    const t = tools({
      tracking: hires([
        { deposited: String(E18 / 1000n), status: "cancelled" },
        { deposited: String(E18 / 500n), status: "active" },
        { deposited: "999", payToken: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", agentName: "Fugu Grid" },
      ]),
    });
    const r = await t.tally(ALICE);
    expect(r).toMatchObject({ hires: 3, running: 1, spentTbnb: "0.003000" });
    expect(r.byAgent).toEqual([
      { agent: "Fugu Guardian", hires: 2, spentWei: String((3n * E18) / 1000n), spentTbnb: "0.003000" },
      { agent: "Fugu Grid", hires: 1, spentWei: "0", spentTbnb: "0.000000" },
    ]);
  });

  it("Quote converts dollars at the oracle price", async () => {
    const r = await tools().quote(usdToUsd8("6"));
    expect(r).toMatchObject({ amountTbnb: "0.010000", bnbPriceUsd8: "60000000000" });
  });
});

describe("/api/run routes", () => {
  it("lists all five agents with an endpoint each", async () => {
    const body = (await (await app().request("/api/run")).json()) as { agents: { slug: string; endpoint: string }[] };
    expect(body.agents.map((a) => a.slug)).toEqual(RUN_AGENTS.map((a) => a.slug));
    for (const a of body.agents) expect(a.endpoint).toMatch(/^https:\/\/api\.hellofugu\.xyz\/api\/run\//);
  });

  it("rejects a bad wallet with a 400 that names the field", async () => {
    const res = await app().request("/api/run/watch?wallet=nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field: "wallet" });
  });

  it("rejects a bad category, limit, keyHash and amount", async () => {
    expect((await app().request("/api/run/scout?category=CATS")).status).toBe(400);
    expect((await app().request("/api/run/scout?category=GRID&limit=99")).status).toBe(400);
    expect((await app().request(`/api/run/keycheck?account=${ALICE}&keyHash=0x12`)).status).toBe(400);
    expect((await app().request("/api/run/quote?usd=-1")).status).toBe(400);
    expect((await app().request("/api/run/quote?usd=0")).status).toBe(400);
  });

  it("answers Scout from the catalogue, case-insensitively", async () => {
    const body = (await (await app().request("/api/run/scout?category=grid&limit=3")).json()) as { picks: unknown[]; category: string };
    expect(body.category).toBe("GRID");
    expect(body.picks).toHaveLength(3);
  });

  it("answers Keycheck", async () => {
    const res = await app().request(`/api/run/keycheck?account=${ALICE}&keyHash=0x${"ab".repeat(32)}`);
    expect(await res.json()).toMatchObject({ valid: true });
  });

  it("turns a failed chain read into a 503, not an empty 200", async () => {
    const broken = tools({ chain: chain({ blockNumber: async () => { throw new Error("rpc down"); } }) });
    const res = await app(broken).request(`/api/run/watch?wallet=${ALICE}`);
    expect(res.status).toBe(503);
  });

  it("usdToUsd8 is exact", () => {
    expect(usdToUsd8("0.10")).toBe(10_000_000n);
    expect(usdToUsd8("12")).toBe(1_200_000_000n);
  });
});
