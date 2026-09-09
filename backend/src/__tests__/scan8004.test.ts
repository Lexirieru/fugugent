import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { UpstreamError, type HttpClient, type HttpGetOptions, type HttpResult } from "../http/client.js";
import { createScan8004Source, DEFAULT_SPAM_FILTERS } from "../sources/scan8004.js";

const FETCHED_AT = new Date("2026-09-08T12:00:00.000Z");
const now = () => FETCHED_AT;

interface Recorded {
  url: string;
  opts?: HttpGetOptions;
}

/** A fake HTTP client — the tests NEVER touch a real network. */
function fakeHttp(
  handler: (url: string, opts?: HttpGetOptions) => unknown | Promise<unknown>,
): { http: HttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const http: HttpClient = {
    async get<T>(url: string, opts?: HttpGetOptions): Promise<HttpResult<T>> {
      calls.push({ url, opts });
      const data = await handler(url, opts);
      return { data: data as T, status: 200, attempts: 1 };
    },
  };
  return { http, calls };
}

const agentItem = {
  agent_id: "97:0x8004A818BFB912233c491871b3d84c89A494BD9e:1675",
  token_id: "1675",
  chain_id: 97,
  name: "bnb-lending-guardian.agent",
  description: "monitors health factor",
  total_score: 42.5,
};

function configWithoutKey() {
  return loadConfig({ RPC_URL: "https://rpc.test" });
}

function configWithKey() {
  return loadConfig({ RPC_URL: "https://rpc.test", SCAN8004_API_KEY: "secret-key-123" });
}

describe("createScan8004Source.listAgents", () => {
  it("sends the is_registered, min_score, and has_a2a spam filters as real query parameters", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [agentItem], total: 1 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents();

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("is_registered")).toBe("true");
    expect(url.searchParams.get("min_score")).toBe(String(DEFAULT_SPAM_FILTERS.minScore));
    expect(url.searchParams.get("has_a2a")).toBe("true");
    expect(url.searchParams.get("is_active")).toBe("true");
    expect(url.pathname).toBe("/api/v1/agents");
  });

  it("uses the chainId from the config and the requested pagination", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents({ limit: 50, offset: 100 });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("chain_id")).toBe("97");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("100");
  });

  it("caller-supplied filters override the defaults, including turning one off with undefined", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents({
      filters: { hasA2a: undefined, minScore: 80, hasMcp: true, ownerPublisherTier: "OFFICIAL" },
    });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.has("has_a2a")).toBe(false);
    expect(url.searchParams.get("min_score")).toBe("80");
    expect(url.searchParams.get("has_mcp")).toBe("true");
    expect(url.searchParams.get("owner_publisher_tier")).toBe("OFFICIAL");
  });

  it("repeats the oasf_skill and oasf_domain parameters (upstream OR logic)", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents({
      filters: { oasfSkill: ["NLP", "Data Analysis"], oasfDomain: ["finance"] },
    });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.getAll("oasf_skill")).toEqual(["NLP", "Data Analysis"]);
    expect(url.searchParams.getAll("oasf_domain")).toEqual(["finance"]);
  });

  it("the API key is sent through the client header, never appearing in the URL nor in the options JSON", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithKey(), now });

    await source.listAgents();

    const { url, opts } = calls[0]!;
    expect(url).not.toContain("secret-key-123");
    expect(JSON.stringify(opts)).not.toContain("secret-key-123");
    expect(opts?.apiKey).toBe("secret-key-123");
  });

  it("without an API key, the options carry no apiKey at all", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents();
    expect(calls[0]!.opts?.apiKey).toBeUndefined();
  });

  it("an upstream failure (500 DATABASE_ERROR) yields an empty list, not a throw", async () => {
    const { http } = fakeHttp(() => {
      throw new UpstreamError("upstream answered with status 500", 500, 3);
    });
    const source = createScan8004Source({ http, config: configWithKey(), now });

    const page = await source.listAgents();
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
    expect(page.reason).toContain("500");
    expect(page.reason).not.toContain("secret-key-123");
    expect(page.source).toBe("scan8004");
    expect(page.fetchedAt).toBe(FETCHED_AT.toISOString());
  });

  it("an unknown response shape yields an empty list plus an unhealthy source", async () => {
    const { http } = fakeHttp(() => "<html>502 Bad Gateway</html>");
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const page = await source.listAgents();
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
  });
});

describe("createScan8004Source.semanticSearch", () => {
  it("sends q, semantic_weight, and similarity_threshold per the spec", async () => {
    const { http, calls } = fakeHttp(() => ({
      items: [{ ...agentItem, similarity_score: 0.8043 }],
      total: 1,
    }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const page = await source.semanticSearch("health factor liquidation");

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/v1/agents/search/semantic");
    expect(url.searchParams.get("q")).toBe("health factor liquidation");
    expect(url.searchParams.get("semantic_weight")).toBe("0.7");
    expect(url.searchParams.get("similarity_threshold")).toBe("0.55");
    expect(url.searchParams.get("chain_id")).toBe("97");
    expect(page.items[0]!.similarityScore).toBeCloseTo(0.8043);
  });

  it("an empty query does not call upstream at all", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [] }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const page = await source.semanticSearch("   ");
    expect(calls).toHaveLength(0);
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
  });
});

describe("createScan8004Source.getAgent", () => {
  it("uses the /agents/{chain_id}/{token_id} path", async () => {
    const { http, calls } = fakeHttp(() => agentItem);
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const res = await source.getAgent(97, "1675");
    expect(new URL(calls[0]!.url).pathname).toBe("/api/v1/agents/97/1675");
    expect(res.agent?.id).toBe("97:1675");
    expect(res.healthy).toBe(true);
  });

  it("a 404 yields a null agent WITHOUT marking the source sick", async () => {
    // Minor 2.6 regression: an agent that genuinely does not exist means upstream
    // ANSWERED correctly. Marking it unhealthy pushes the whole system into the
    // fallbacks while 8004scan is perfectly fine.
    const { http } = fakeHttp(() => {
      throw new UpstreamError("upstream answered with status 404", 404, 1);
    });
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const res = await source.getAgent(97, 1675n);
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(true);
    expect(res.reason).toContain("not found");
  });

  it("a 500 still marks the source sick", async () => {
    const { http } = fakeHttp(() => {
      throw new UpstreamError("upstream answered with status 500", 500, 3);
    });
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const res = await source.getAgent(97, "1675");
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(false);
    expect(res.reason).toContain("500");
  });
});
