import { describe, expect, it } from "vitest";
import {
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

/** Bentuk item agent seperti yang benar-benar dibalas 8004scan (riset live 8 Sep 2026). */
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

describe("unwrapEnvelope — tiga bentuk respons 8004scan yang terverifikasi", () => {
  it("mengenali bentuk datar {items,total,limit,offset}", () => {
    const env = unwrapEnvelope({ items: [liveAgentItem], total: 309444, limit: 1, offset: 0 });
    expect(env.kind).toBe("list");
    if (env.kind !== "list") throw new Error("bentuk salah");
    expect(env.items).toHaveLength(1);
    expect(env.total).toBe(309444);
  });

  it("mengenali bentuk terbungkus {success:true,data}", () => {
    const env = unwrapEnvelope({ success: true, data: { items: [liveAgentItem], total: 1 } });
    expect(env.kind).toBe("list");
  });

  it("mengenali bentuk error {success:false,error}", () => {
    const env = unwrapEnvelope({
      success: false,
      error: { code: "DATABASE_ERROR", message: "transient" },
    });
    expect(env.kind).toBe("error");
    if (env.kind !== "error") throw new Error("bentuk salah");
    expect(env.code).toBe("DATABASE_ERROR");
  });

  it("tidak melempar pada bentuk yang sama sekali tak dikenal", () => {
    for (const body of [null, undefined, "<html>502 Bad Gateway</html>", 42, true]) {
      expect(() => unwrapEnvelope(body)).not.toThrow();
      expect(unwrapEnvelope(body).kind).toBe("unknown");
    }
  });
});

describe("normalizeAgentListBody", () => {
  it("bentuk {items} menghasilkan daftar terisi dan sumber sehat", () => {
    const page = normalizeAgentListBody({ items: [liveAgentItem], total: 309444 }, ctx);
    expect(page.healthy).toBe(true);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(309444);
    expect(page.items[0]!.id).toBe("56:49637");
    expect(page.items[0]!.fetchedAt).toBe(FETCHED_AT);
    expect(page.items[0]!.source).toBe("scan8004");
  });

  it("bentuk {success,data} menghasilkan daftar terisi", () => {
    const page = normalizeAgentListBody({ success: true, data: { items: [liveAgentItem] } }, ctx);
    expect(page.healthy).toBe(true);
    expect(page.items).toHaveLength(1);
  });

  it("bentuk {success,data} berisi satu objek agent menghasilkan satu item", () => {
    const page = normalizeAgentListBody({ success: true, data: liveAgentItem }, ctx);
    expect(page.items).toHaveLength(1);
    expect(page.healthy).toBe(true);
  });

  it("bentuk {success:false,error} menghasilkan daftar kosong dan menandai sumber tidak sehat", () => {
    const page = normalizeAgentListBody(
      { success: false, error: { code: "DATABASE_ERROR", message: "transient" } },
      ctx,
    );
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(false);
    expect(page.reason).toContain("DATABASE_ERROR");
  });

  it("bentuk tak dikenal TIDAK melempar — daftar kosong plus sumber tidak sehat", () => {
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

  it("melewati item yang tidak punya identitas tanpa menggagalkan seluruh daftar", () => {
    const page = normalizeAgentListBody(
      { items: [{ name: "tanpa identitas" }, liveAgentItem] },
      ctx,
    );
    expect(page.items).toHaveLength(1);
    expect(page.healthy).toBe(true);
  });

  it("daftar kosong yang sah tetap dianggap sehat", () => {
    const page = normalizeAgentListBody({ items: [], total: 0 }, ctx);
    expect(page.items).toEqual([]);
    expect(page.healthy).toBe(true);
  });
});

describe("normalizeAgent", () => {
  it("memetakan field 8004scan ke AgentRecord", () => {
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

  it("menurunkan token_id dari agent_id komposit bila token_id hilang", () => {
    const rec = normalizeAgent(
      { agent_id: "97:0x8004A818BFB912233c491871b3d84c89A494BD9e:1675", name: "X" },
      ctx,
    );
    expect(rec).not.toBeNull();
    expect(rec!.tokenId).toBe("1675");
    expect(rec!.chainId).toBe(97);
  });

  it("mengembalikan null bila identitas tidak bisa ditetapkan", () => {
    expect(normalizeAgent({ name: "tanpa id" }, ctx)).toBeNull();
    expect(normalizeAgent(null, ctx)).toBeNull();
    expect(normalizeAgent("bukan objek", ctx)).toBeNull();
  });

  it("tidak melempar saat tipe field upstream berubah jadi sampah", () => {
    let rec: ReturnType<typeof normalizeAgent>;
    expect(() => {
      rec = normalizeAgent(
        {
          token_id: 4242,
          chain_id: "97",
          name: 12345,
          description: null,
          tags: "bukan array",
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

  it("mengumpulkan OASF skill/domain dari beberapa lokasi yang mungkin", () => {
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
  it("membaca objek agent datar (tanpa pembungkus)", () => {
    const res = normalizeAgentDetailBody(liveAgentItem, ctx);
    expect(res.healthy).toBe(true);
    expect(res.agent?.tokenId).toBe("49637");
  });

  it("membaca objek agent terbungkus {success,data}", () => {
    const res = normalizeAgentDetailBody({ success: true, data: liveAgentItem }, ctx);
    expect(res.agent?.tokenId).toBe("49637");
  });

  it("bentuk error menghasilkan agent null dan sumber tidak sehat", () => {
    const res = normalizeAgentDetailBody(
      { success: false, error: { code: "NOT_FOUND", message: "no such agent" } },
      ctx,
    );
    expect(res.agent).toBeNull();
    expect(res.healthy).toBe(false);
    expect(res.reason).toContain("NOT_FOUND");
  });
});
