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

/** Klien HTTP palsu — test TIDAK PERNAH menyentuh jaringan sungguhan. */
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
  return loadConfig({ RPC_URL: "https://rpc.test", SCAN8004_API_KEY: "kunci-rahasia-123" });
}

describe("createScan8004Source.listAgents", () => {
  it("mengirim filter spam is_registered, min_score, dan has_a2a sebagai query sungguhan", async () => {
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

  it("memakai chainId dari config dan pagination yang diminta", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents({ limit: 50, offset: 100 });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("chain_id")).toBe("97");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("100");
  });

  it("filter yang dioper pemanggil menimpa default, termasuk mematikan filter dengan undefined", async () => {
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

  it("mengulang parameter oasf_skill dan oasf_domain (logika OR upstream)", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents({
      filters: { oasfSkill: ["NLP", "Data Analysis"], oasfDomain: ["finance"] },
    });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.getAll("oasf_skill")).toEqual(["NLP", "Data Analysis"]);
    expect(url.searchParams.getAll("oasf_domain")).toEqual(["finance"]);
  });

  it("API key dikirim lewat header klien, tidak pernah muncul di URL maupun JSON opsi", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithKey(), now });

    await source.listAgents();

    const { url, opts } = calls[0]!;
    expect(url).not.toContain("kunci-rahasia-123");
    expect(JSON.stringify(opts)).not.toContain("kunci-rahasia-123");
    expect(opts?.apiKey).toBe("kunci-rahasia-123");
  });

  it("tanpa API key, opsi tidak membawa apiKey sama sekali", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [], total: 0 }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    await source.listAgents();
    expect(calls[0]!.opts?.apiKey).toBeUndefined();
  });

  it("upstream gagal (500 DATABASE_ERROR) menghasilkan daftar kosong, bukan lemparan", async () => {
    const { http } = fakeHttp(() => {
      throw new UpstreamError("upstream membalas status 500", 500, 3);
    });
    const source = createScan8004Source({ http, config: configWithKey(), now });

    const page = await source.listAgents();
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
    expect(page.reason).toContain("500");
    expect(page.reason).not.toContain("kunci-rahasia-123");
    expect(page.source).toBe("scan8004");
    expect(page.fetchedAt).toBe(FETCHED_AT.toISOString());
  });

  it("bentuk respons tak dikenal menghasilkan daftar kosong plus sumber tidak sehat", async () => {
    const { http } = fakeHttp(() => "<html>502 Bad Gateway</html>");
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const page = await source.listAgents();
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
  });
});

describe("createScan8004Source.semanticSearch", () => {
  it("mengirim q, semantic_weight, dan similarity_threshold sesuai spec", async () => {
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

  it("query kosong tidak memanggil upstream sama sekali", async () => {
    const { http, calls } = fakeHttp(() => ({ items: [] }));
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const page = await source.semanticSearch("   ");
    expect(calls).toHaveLength(0);
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
  });
});

describe("createScan8004Source.getAgent", () => {
  it("memakai path /agents/{chain_id}/{token_id}", async () => {
    const { http, calls } = fakeHttp(() => agentItem);
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const res = await source.getAgent(97, "1675");
    expect(new URL(calls[0]!.url).pathname).toBe("/api/v1/agents/97/1675");
    expect(res.agent?.id).toBe("97:1675");
    expect(res.healthy).toBe(true);
  });

  it("404 menghasilkan agent null tanpa melempar", async () => {
    const { http } = fakeHttp(() => {
      throw new UpstreamError("upstream membalas status 404", 404, 1);
    });
    const source = createScan8004Source({ http, config: configWithoutKey(), now });

    const res = await source.getAgent(97, 1675n);
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(false);
    expect(res.reason).toContain("404");
  });
});
