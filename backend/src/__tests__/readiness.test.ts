import { describe, expect, it } from "vitest";
import { createApp } from "../routes/app.js";
import { createReadiness, declaredCategories, probeTarget } from "../sources/readiness.js";
import type { RegistrationFile, ResolvedMetadata } from "../sources/registry-metadata.js";
import type { ListingHiresAnswer, TrackingService } from "../sources/tracking.js";
import type { Address, AgentRecord } from "../types.js";

const OWNER: Address = "0x494Ae5cF2729e662Cc05DbD63D2107d707fD00dE";
const AGENT_WALLET: Address = "0x5375f369Bc68b1a930c3942e7DfC09A32217F728";
const CARD = "https://agent.example.com/.well-known/agent-card.json";
const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;

function record(over: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "97:2545",
    tokenId: "2545",
    name: "Aex Rebalancer",
    description: "Keeps a portfolio at target weights.",
    ownerAddress: OWNER,
    agentWallet: AGENT_WALLET,
    classification: null,
    fuguListing: {
      listingId: 21n,
      erc8004AgentId: 2545n,
      owner: OWNER,
      agentWallet: AGENT_WALLET,
      category: "REBALANCING",
      priceUsd8PerPeriod: 5_000_000n,
      periodSeconds: 120,
      active: true,
      curated: false,
    },
    evidence: {
      registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      blockNumber: "1",
      readAt: "2026-10-10T00:00:00.000Z",
      agentURI: "data:",
      metadataStatus: "inline",
      metadataReason: null,
      endpoints: [
        { name: "web", endpoint: "https://agent.example.com", version: null },
        { name: "A2A", endpoint: CARD, version: "0.3.0" },
      ],
      registration: null,
    },
    ...over,
  } as unknown as AgentRecord;
}

const file = (over: Partial<RegistrationFile> = {}): RegistrationFile => ({
  name: "Aex Rebalancer",
  description: "Rebalancing agent for BSC portfolios",
  image: null,
  endpoints: [],
  skills: [],
  domains: [],
  tags: [],
  active: true,
  x402Support: false,
  ...over,
});

function tracking(hires: ListingHiresAnswer["hires"], listed: { owner: Address } | null = { owner: OWNER }): TrackingService {
  return {
    hires: async () => { throw new Error("unused"); },
    agents: async () => { throw new Error("unused"); },
    reviews: async () => { throw new Error("unused"); },
    listingHires: async () => listed === null ? null : ({
      chainId: 97,
      blockNumber: "1",
      readAt: "",
      contracts: { registry: OWNER, subscription: OWNER, reputation: OWNER },
      listingId: "21",
      owner: listed.owner,
      agentWallet: AGENT_WALLET,
      category: "REBALANCING",
      hires,
    }),
  };
}

function readiness(opts: { agent?: AgentRecord | null; probe?: ResolvedMetadata; hires?: ListingHiresAnswer["hires"]; sent?: number; listed?: { owner: Address } | null } = {}) {
  return createReadiness({
    agent: async () => (opts.agent === undefined ? record() : opts.agent),
    tracking: tracking(opts.hires ?? [], opts.listed === undefined ? { owner: OWNER } : opts.listed),
    metadata: { resolve: async () => opts.probe ?? { status: "fetched", reason: null, file: file() } },
    sentCount: async () => opts.sent ?? 0,
    explorer: "https://testnet.bscscan.com",
  });
}

const byId = async (r: ReturnType<typeof readiness>) =>
  Object.fromEntries(((await r.check("97:2545"))?.checks ?? []).map((c) => [c.id, c]));

describe("readiness helpers", () => {
  it("probes A2A before MCP, and never the plain web link", () => {
    expect(probeTarget(record())).toBe(CARD);
    const webOnly = record({ evidence: { ...record().evidence!, endpoints: [{ name: "web", endpoint: "https://x.example", version: null }] } });
    expect(probeTarget(webOnly)).toBeNull();
  });

  it("names the quest categories a text declares", () => {
    expect(declaredCategories("A grid bot that also watches health factor")).toEqual(["grid", "health factor"]);
    expect(declaredCategories("Moves funds to the best lending APY")).toEqual(["yield"]);
    expect(declaredCategories("A friendly chatbot")).toEqual([]);
  });
});

describe("readiness checks", () => {
  it("passes registered, discoverable and live for a listed agent with a working card", async () => {
    const c = await byId(readiness());
    expect(c.registered.status).toBe("pass");
    expect(c.discoverable.status).toBe("pass");
    expect(c.discoverable.detail).toContain("rebalancing");
    expect(c.live.status).toBe("pass");
    expect(c.matches.status).toBe("check");
  });

  it("fails registration when it is not listed, or listed by another wallet", async () => {
    const unlisted = await byId(readiness({ listed: null }));
    expect(unlisted.registered.status).toBe("fail");
    expect(unlisted.hired.status).toBe("fail");
    expect((await byId(readiness({ listed: { owner: w(9) } }))).registered.status).toBe("fail");
  });

  it("fails discoverable when the card never names a quest category", async () => {
    const c = await byId(readiness({ agent: record({ description: "A helpful bot" }), probe: { status: "fetched", reason: null, file: file({ name: "Aex Bot", description: "A helpful bot" }) } }));
    expect(c.discoverable.status).toBe("fail");
    expect(c.live.status).toBe("pass");
  });

  it("fails discoverable and live when the card does not answer", async () => {
    const c = await byId(readiness({ probe: { status: "unreachable", reason: "timed out", file: null } }));
    expect(c.discoverable.status).toBe("fail");
    expect(c.live.status).toBe("fail");
    expect(c.live.detail).toContain("timed out");
  });

  it("counts only completed hires by wallets other than the owner and the agent", async () => {
    const hires: ListingHiresAnswer["hires"] = [
      { subId: "1", subscriber: w(1), status: "ended" },
      { subId: "2", subscriber: w(1), status: "ended" }, // same wallet twice
      { subId: "3", subscriber: w(2), status: "cancelled" },
      { subId: "4", subscriber: w(3), status: "active" },
      { subId: "5", subscriber: OWNER, status: "ended" },
      { subId: "6", subscriber: AGENT_WALLET, status: "ended" },
      { subId: "7", subscriber: w(4), status: "ended" },
    ];
    const c = await byId(readiness({ hires }));
    expect(c.hired.status).toBe("fail");
    expect(c.hired.detail).toMatch(/^2 completed hires here from other wallets, 3 needed/);
    const enough = await byId(readiness({ hires: [...hires, { subId: "8", subscriber: w(5), status: "ended" }] }));
    expect(enough.hired.status).toBe("pass");
  });

  it("fails executes under five transactions, and never claims a pass it cannot date", async () => {
    expect((await byId(readiness({ sent: 2 }))).executes.status).toBe("fail");
    expect((await byId(readiness({ sent: 40 }))).executes.status).toBe("check");
  });

  it("says check, not fail, while the registry is still loading", async () => {
    const r = readiness({ agent: record({ evidence: null }) });
    const answer = await r.check("97:2545");
    expect(answer?.complete).toBe(false);
    expect(answer?.checks.find((c) => c.id === "live")?.status).toBe("check");
  });

  it("returns null for an agent that does not exist", async () => {
    expect(await readiness({ agent: null }).check("97:1")).toBeNull();
  });
});

describe("/api/quest/agent/:id", () => {
  it("rejects a malformed id, 404s an unknown agent, and answers a known one", async () => {
    const app = createApp({ service: {} as never, readiness: readiness() });
    expect((await app.request("/api/quest/agent/nope")).status).toBe(400);
    const missing = createApp({ service: {} as never, readiness: readiness({ agent: null }) });
    expect((await missing.request("/api/quest/agent/97%3A1")).status).toBe(404);
    const res = await app.request("/api/quest/agent/97%3A2545");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agentId: "97:2545", passed: 3 });
  });
});
