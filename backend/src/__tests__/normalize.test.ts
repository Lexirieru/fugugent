import { describe, expect, it } from "vitest";
import {
  MAX_ENVELOPE_DEPTH,
  normalizeAgent,
  normalizeAgentDetailBody,
  normalizeAgentListBody,
  unwrapEnvelope,
  type NormalizeContext,
} from "../sources/normalize.js";

const FETCHED_AT = "2026-09-08T12:00:00.000Z";

const ctx: NormalizeContext = {
  source: "scan8004",
  fetchedAt: FETCHED_AT,
  chainId: 97,
  limit: 20,
  offset: 0,
};

/** An agent item exactly as 8004scan really answers it (live research 8 Sep 2026). */
const liveAgentItem = {
  id: "1a629df6-cec2-4251-839c-dfba07e604e3",
  agent_id: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:49637",
  token_id: "49637",
  chain_id: 56,
  chain_type: "evm",
  contract_address: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
  is_testnet: false,
  owner_address: "0x0d68a153897b73a6e4d2eaa9b0d4802bae69532d",
  owner_username: "OpenOdds.Ai",
  owner_publisher_tier: "VERIFIED",
  name: "OpenOdds.Ai",
  description: "Verifiable pre-match football odds prediction agent",
  image_url: "https://api.8004scan.io/api/v1/media/agents/56/49637/image",
  is_verified: false,
  star_count: 8,
  supported_protocols: ["MCP", "A2A", "Web"],
  x402_supported: false,
  total_score: 49.06,
  health_score: 100.0,
  total_feedbacks: 3,
  average_score: 100.0,
  tags: ["prediction", "sports"],
  categories: ["analytics"],
  created_at: "2026-03-23T23:54:44Z",
  updated_at: "2026-09-08T00:41:11.096927Z",
};

describe("unwrapEnvelope — the three verified 8004scan response shapes", () => {
  it("recognizes the flat {items,total,limit,offset} shape", () => {
    const env = unwrapEnvelope({ items: [liveAgentItem], total: 309444, limit: 1, offset: 0 });
    expect(env.kind).toBe("list");
    if (env.kind !== "list") throw new Error("wrong shape");
    expect(env.items).toHaveLength(1);
    expect(env.total).toBe(309444);
  });

  it("recognizes the enveloped {success:true,data} shape", () => {
    const env = unwrapEnvelope({ success: true, data: { items: [liveAgentItem], total: 1 } });
    expect(env.kind).toBe("list");
  });

  it("recognizes the error {success:false,error} shape", () => {
    const env = unwrapEnvelope({
      success: false,
      error: { code: "DATABASE_ERROR", message: "transient" },
    });
    expect(env.kind).toBe("error");
    if (env.kind !== "error") throw new Error("wrong shape");
    expect(env.code).toBe("DATABASE_ERROR");
  });

  it("does not throw on a completely unknown shape", () => {
    for (const body of [null, undefined, "<html>502 Bad Gateway</html>", 42, true]) {
      expect(() => unwrapEnvelope(body)).not.toThrow();
      expect(unwrapEnvelope(body).kind).toBe("unknown");
    }
  });

  it("strips nested envelopes up to the MAX_ENVELOPE_DEPTH limit", () => {
    // One layer and two layers are still stripped.
    expect(unwrapEnvelope({ success: true, data: { items: [] } }).kind).toBe("list");
    expect(
      unwrapEnvelope({ success: true, data: { success: true, data: { items: [] } } }).kind,
    ).toBe("list");
    expect(MAX_ENVELOPE_DEPTH).toBe(2);
  });

  it("nesting deeper than the limit becomes `unknown`, NOT a throw", () => {
    const overLimit = { success: true, data: { success: true, data: { success: true, data: { items: [] } } } };
    const env = unwrapEnvelope(overLimit);
    expect(env.kind).toBe("unknown");
    if (env.kind !== "unknown") throw new Error("wrong shape");
    expect(env.message).toContain("nested");
  });

  it("20,000 nested layers do not exhaust the call stack", () => {
    // Important 2.4 regression: before the depth counter existed, this shape
    // threw a RangeError — breaking the rule "an unknown shape does not throw".
    let body: unknown = { items: [] };
    for (let i = 0; i < 20_000; i++) body = { success: true, data: body };

    expect(() => unwrapEnvelope(body)).not.toThrow();
    expect(unwrapEnvelope(body).kind).toBe("unknown");

    // And through the normalizer path, with no caller's `try` net.
    let page!: ReturnType<typeof normalizeAgentListBody>;
    expect(() => {
      page = normalizeAgentListBody(body, ctx);
    }).not.toThrow();
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
  });
});

describe("normalizeAgentListBody", () => {
  it("the {items} shape yields a populated list and a healthy source", () => {
    const page = normalizeAgentListBody({ items: [liveAgentItem], total: 309444 }, ctx);
    expect(page.healthy).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(309444);
    expect(page.items[0]!.id).toBe("56:49637");
    expect(page.items[0]!.fetchedAt).toBe(FETCHED_AT);
    expect(page.items[0]!.source).toBe("scan8004");
  });

  it("the {success,data} shape yields a populated list", () => {
    const page = normalizeAgentListBody({ success: true, data: { items: [liveAgentItem] } }, ctx);
    expect(page.healthy).toBe(true);
    expect(page.items).toHaveLength(1);
  });

  it("a {success,data} holding a single agent object yields one item", () => {
    const page = normalizeAgentListBody({ success: true, data: liveAgentItem }, ctx);
    expect(page.items).toHaveLength(1);
    expect(page.healthy).toBe(true);
  });

  it("the {success:false,error} shape yields an empty list and marks the source unhealthy", () => {
    const page = normalizeAgentListBody(
      { success: false, error: { code: "DATABASE_ERROR", message: "transient" } },
      ctx,
    );
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
    expect(page.reason).toContain("DATABASE_ERROR");
  });

  it("an unknown shape does NOT throw — an empty list plus an unhealthy source", () => {
    for (const body of [null, "<html>502</html>", 42, { foo: "bar" }, { success: true }]) {
      let page!: ReturnType<typeof normalizeAgentListBody>;
      expect(() => {
        page = normalizeAgentListBody(body, ctx);
      }).not.toThrow();
      expect(page.items).toEqual([]);
      expect(page.healthy).toBe(false);
      expect(page.reason).toBeTruthy();
    }
  });

  it("skips an item with no identity without failing the whole list", () => {
    const page = normalizeAgentListBody(
      { items: [{ name: "no identity" }, liveAgentItem] },
      ctx,
    );
    expect(page.items).toHaveLength(1);
    expect(page.healthy).toBe(true);
  });

  it("a legitimately empty list is still considered healthy", () => {
    const page = normalizeAgentListBody({ items: [], total: 0 }, ctx);
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(true);
  });
});

describe("normalizeAgent", () => {
  it("maps the 8004scan fields onto an AgentRecord", () => {
    const rec = normalizeAgent(liveAgentItem, ctx);
    expect(rec).not.toBeNull();
    expect(rec!.chainId).toBe(56);
    expect(rec!.tokenId).toBe("49637");
    expect(rec!.name).toBe("OpenOdds.Ai");
    expect(rec!.tags).toEqual(["prediction", "sports"]);
    expect(rec!.supportedProtocols).toEqual(["MCP", "A2A", "Web"]);
    expect(rec!.ownerPublisherTier).toBe("VERIFIED");
    expect(rec!.reputation.totalScore).toBe(49.06);
    expect(rec!.reputation.starCount).toBe(8);
    expect(rec!.fuguListing).toBeNull();
    expect(rec!.classification).toBeNull();
  });

  it("derives token_id from the composite agent_id when token_id is missing", () => {
    const rec = normalizeAgent(
      { agent_id: "97:0x8004A818BFB912233c491871b3d84c89A494BD9e:1675", name: "X" },
      ctx,
    );
    expect(rec).not.toBeNull();
    expect(rec!.tokenId).toBe("1675");
    expect(rec!.chainId).toBe(97);
  });

  it("returns null when the identity cannot be established", () => {
    expect(normalizeAgent({ name: "no id" }, ctx)).toBeNull();
    expect(normalizeAgent(null, ctx)).toBeNull();
    expect(normalizeAgent("not an object", ctx)).toBeNull();
  });

  it("rejects a token_id that is not a decimal integer — `id` is the primary key", () => {
    // Minor 2.5 regression: these values used to slip through as `id`s like
    // "97:1.5" and "97:1e+21", then spread into cache keys and detail URLs.
    for (const tokenId of [1.5, 1e21, -3, Number.NaN, "1e21", "12.0", " ", "0x1f", "abc"]) {
      expect(normalizeAgent({ token_id: tokenId, chain_id: 97 }, ctx)).toBeNull();
    }
  });

  it("accepts a decimal token_id as either a string or a whole number", () => {
    expect(normalizeAgent({ token_id: "49637", chain_id: 56 }, ctx)!.id).toBe("56:49637");
    expect(normalizeAgent({ token_id: 4242, chain_id: 97 }, ctx)!.id).toBe("97:4242");
    expect(normalizeAgent({ token_id: 0, chain_id: 97 }, ctx)!.id).toBe("97:0");
  });

  it("falls back to the composite agent_id when token_id is present but invalid", () => {
    const rec = normalizeAgent(
      { token_id: 1.5, agent_id: "97:0x8004A818BFB912233c491871b3d84c89A494BD9e:1675" },
      ctx,
    );
    expect(rec!.tokenId).toBe("1675");
  });

  it("does not throw when the upstream field types turn to garbage", () => {
    let rec: ReturnType<typeof normalizeAgent>;
    expect(() => {
      rec = normalizeAgent(
        {
          token_id: 4242,
          chain_id: "97",
          name: 12345,
          description: null,
          tags: "not an array",
          categories: [1, "ok", null],
          supported_protocols: null,
          total_score: "abc",
          star_count: "9",
          is_active: "yes",
        },
        ctx,
      );
    }).not.toThrow();
    expect(rec!).not.toBeNull();
    expect(rec!.tokenId).toBe("4242");
    expect(rec!.chainId).toBe(97);
    expect(rec!.tags).toEqual([]);
    expect(rec!.categories).toEqual(["ok"]);
    expect(rec!.supportedProtocols).toEqual([]);
    expect(rec!.reputation.totalScore).toBeNull();
  });

  it("collects OASF skills/domains from several possible locations", () => {
    const rec = normalizeAgent(
      {
        token_id: "1",
        chain_id: 97,
        oasf_skills: ["Data Analysis"],
        oasf_domains: [{ name: "finance" }],
        raw_metadata: { offchain_content: { skills: ["Rebalancing"] } },
      },
      ctx,
    );
    expect(rec!.skills).toContain("Data Analysis");
    expect(rec!.skills).toContain("Rebalancing");
    expect(rec!.domains).toEqual(["finance"]);
  });
});

describe("normalizeAgentDetailBody", () => {
  it("reads a flat agent object (no envelope)", () => {
    const res = normalizeAgentDetailBody(liveAgentItem, ctx);
    expect(res.healthy).toBe(true);
    expect(res.agent?.tokenId).toBe("49637");
  });

  it("reads an agent object enveloped in {success,data}", () => {
    const res = normalizeAgentDetailBody({ success: true, data: liveAgentItem }, ctx);
    expect(res.agent?.tokenId).toBe("49637");
  });

  it("the error shape yields a null agent and an unhealthy source", () => {
    const res = normalizeAgentDetailBody(
      { success: false, error: { code: "DATABASE_ERROR", message: "transient" } },
      ctx,
    );
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(false);
    expect(res.reason).toContain("DATABASE_ERROR");
  });

  it("a legitimately empty list means NOT FOUND, not a sick source", () => {
    // Minor 2.6 regression: an agent that genuinely does not exist is not a sign
    // that 8004scan is down. Marking it `healthy:false` turns the /api/health
    // light red for a user who merely mistyped a token id.
    for (const body of [{ items: [] }, [], { success: true, data: { items: [] } }]) {
      const res = normalizeAgentDetailBody(body, ctx);
      expect(res.agent).toBeNull();
      expect(res.healthy).toBe(true);
      expect(res.reason).toContain("not found");
    }
  });

  it("a NOT_FOUND error from upstream is not a sign of a sick source either", () => {
    const res = normalizeAgentDetailBody(
      { success: false, error: { code: "NOT_FOUND", message: "no such agent" } },
      ctx,
    );
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(true);
    expect(res.reason).toContain("NOT_FOUND");
  });

  it("an object that is not an agent is still treated as an unknown shape", () => {
    const res = normalizeAgentDetailBody({ foo: "bar" }, ctx);
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(false);
  });
});
