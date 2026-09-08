/**
 * Kontrak HTTP `/api/agents`, `/api/agents/:id`, `/api/categories`.
 *
 * Yang diuji di sini bukan "apakah Hono bekerja", melainkan empat janji yang
 * dibuat backend ini kepada frontend dan kepada juri:
 *
 * 1. Uang tidak pernah menyeberang sebagai `number`, dan `bigint` tidak pernah
 *    lolos mentah (JSON.stringify atas `AgentRecord` **melempar** — itu dikunci
 *    di test pertama supaya premisnya tidak bisa hilang diam-diam).
 * 2. Setiap respons membawa `source` dan `ageSeconds`.
 * 3. Parameter cacat ditolak dengan alasan yang jelas, bukan 500 dan bukan
 *    diam-diam dianggap default.
 * 4. Upstream yang tumbang tidak pernah menjadi 5xx.
 */
import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../types.js";
import { createApp } from "../app.js";
import {
  emptyPageFor,
  fakeService,
  makeDetail,
  makePage,
  makeRecord,
  makeHealth,
} from "./fixtures.js";

async function get(app: ReturnType<typeof createApp>, path: string): Promise<Response> {
  return app.request(`http://api.test${path}`);
}

/** `Response.json()` bertipe `unknown` di typing Node; badan JSON di test memang dinamis. */
// eslint-disable-next-line -eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe("premis serialisasi", () => {
  it("`AgentRecord` mentah memang tidak JSON-serializable", () => {
    expect(() => JSON.stringify(makeRecord())).toThrow(TypeError);
  });
});

describe("GET /api/agents", () => {
  it("mengirim uang sebagai string desimal basis 8, tidak pernah number", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/agents?category=GRID");

    expect(res.status).toBe(200);
    const body = await json(res);
    const listing = body.items[0].fuguListing;
    expect(listing.priceUsd8PerPeriod).toBe("12345678");
    expect(typeof listing.priceUsd8PerPeriod).toBe("string");
    expect(listing.listingId).toBe("1");
    expect(listing.erc8004AgentId).toBe("41");
  });

  it("membawa source dan ageSeconds supaya UI bisa bilang umur datanya", async () => {
    const app = createApp({
      service: fakeService({
        list: async () =>
          makePage({ source: "cache", ageSeconds: 942, stale: true, degraded: true }),
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(body.source).toBe("cache");
    expect(body.ageSeconds).toBe(942);
    expect(body.stale).toBe(true);
    expect(body.degraded).toBe(true);
    expect(typeof body.fetchedAt).toBe("string");
  });

  it("meneruskan limit dan offset apa adanya ke layanan", async () => {
    const service = fakeService();
    const app = createApp({ service });
    await get(app, "/api/agents?category=YIELD&limit=7&offset=14");

    expect(service.listCalls).toHaveLength(1);
    expect(service.listCalls[0].category).toBe("YIELD");
    expect(service.listCalls[0].opts).toMatchObject({ limit: 7, offset: 14 });
  });

  it("tanpa category, menggabungkan keempat kategori", async () => {
    const service = fakeService({
      list: async (category) =>
        makePage({
          items: [makeRecord({ id: `97:${category}`, tokenId: category })],
        }),
    });
    const app = createApp({ service });
    const body = await json(await get(app, "/api/agents"));

    expect(service.listCalls.map((c) => c.category).sort()).toEqual([...CATEGORIES].sort());
    expect(body.items).toHaveLength(4);
    expect(body.category).toBeNull();
  });

  it("halaman kosong yang sah tetap 200 dan tetap sehat", async () => {
    const app = createApp({ service: fakeService({ list: async () => emptyPageFor("seed") }) });
    const res = await get(app, "/api/agents?category=GRID");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items).toEqual([]);
    expect(body.healthy).toBe(true);
    expect(body.ageSeconds).toBeNull();
  });
});

describe("GET /api/agents — parameter cacat", () => {
  const app = createApp({ service: fakeService() });

  it.each([
    ["limit=abc", "limit"],
    ["limit=0", "limit"],
    ["limit=-3", "limit"],
    ["limit=1.5", "limit"],
    ["limit=1e3", "limit"],
    ["limit=101", "limit"],
    ["offset=-1", "offset"],
    ["offset=abc", "offset"],
    ["category=BUKANKATEGORI", "category"],
    ["category=grid", "category"],
  ])("menolak %s dengan 400 dan menyebut field-nya", async (query, field) => {
    const res = await get(app, `/api/agents?${query}`);
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("invalid_query");
    expect(body.field).toBe(field);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("menyebutkan kategori yang sah saat kategori ditolak", async () => {
    const body = await json(await get(app, "/api/agents?category=NOPE"));
    expect(body.allowed).toEqual([...CATEGORIES]);
  });

  it("parameter kosong berarti tidak diisi, bukan cacat", async () => {
    const service = fakeService();
    const local = createApp({ service });
    const res = await get(local, "/api/agents?category=&limit=&offset=");
    expect(res.status).toBe(200);
    expect(service.listCalls).toHaveLength(CATEGORIES.length);
  });

  it("tidak memanggil layanan sama sekali saat parameter cacat", async () => {
    const service = fakeService();
    const local = createApp({ service });
    await get(local, "/api/agents?limit=abc");
    expect(service.listCalls).toHaveLength(0);
  });
});

describe("GET /api/agents — upstream tumbang", () => {
  it("layanan yang melempar tetap menghasilkan 200 dengan amplop jujur", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => {
          throw new Error("Postgres mati");
        },
      }),
    });
    const res = await get(app, "/api/agents?category=GRID");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items).toEqual([]);
    expect(body.healthy).toBe(false);
    expect(body.reason).toContain("Postgres mati");
    expect(body.source).toBe("seed");
  });

  it("tidak pernah membocorkan API key di reason", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => {
          throw new Error("GET https://api.8004scan.io/v1/agents?api_key=sk-RAHASIA-123 gagal");
        },
      }),
    });
    const body = await json(await get(app, "/api/agents?category=GRID"));

    expect(JSON.stringify(body)).not.toContain("sk-RAHASIA-123");
    expect(body.reason).toContain("[redacted]");
  });
});

describe("GET /api/agents/:id", () => {
  it("mengembalikan agent terserialisasi dengan source dan ageSeconds", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/agents/97:41");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agent.id).toBe("97:41");
    expect(body.agent.fuguListing.priceUsd8PerPeriod).toBe("12345678");
    expect(body.source).toBe("scan8004");
    expect(body.ageSeconds).toBe(60);
  });

  it("meneruskan id yang ter-encode apa adanya", async () => {
    const service = fakeService();
    const app = createApp({ service });
    await get(app, "/api/agents/97%3Aseed-fugugrid");
    expect(service.detailCalls).toEqual(["97:seed-fugugrid"]);
  });

  it("404 bila agent memang tidak ada, dengan amplop utuh", async () => {
    const app = createApp({
      service: fakeService({
        detail: async () =>
          makeDetail({
            agent: null,
            source: "seed",
            healthy: true,
            reason: "agent 97:99 tidak ada di seed terkurasi",
            ageSeconds: null,
            degraded: true,
          }),
      }),
    });
    const res = await get(app, "/api/agents/97:99");

    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.agent).toBeNull();
    expect(body.source).toBe("seed");
    expect(body.reason).toContain("tidak ada");
  });

  it("200 — bukan 404 — bila kita tidak bisa memastikan agent-nya ada", async () => {
    const app = createApp({
      service: fakeService({
        detail: async () =>
          makeDetail({ agent: null, healthy: false, reason: "keempat tingkat gagal" }),
      }),
    });
    const res = await get(app, "/api/agents/97:41");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agent).toBeNull();
    expect(body.healthy).toBe(false);
  });

  it("layanan yang melempar tidak menjadi 5xx", async () => {
    const app = createApp({
      service: fakeService({
        detail: async () => {
          throw new Error("RPC timeout");
        },
      }),
    });
    const res = await get(app, "/api/agents/97:41");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.agent).toBeNull();
    expect(body.healthy).toBe(false);
    expect(body.reason).toContain("RPC timeout");
  });

  it("id kosong tidak menjatuhkan layanan", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/agents/%20");
    expect(res.status).toBe(400);
    expect((await json(res)).field).toBe("id");
  });
});

describe("GET /api/categories", () => {
  it("melaporkan jumlah untuk keempat kategori", async () => {
    const counts: Record<string, number> = {
      REBALANCING: 3,
      GRID: 5,
      YIELD: 0,
      HEALTH_FACTOR: 2,
    };
    const app = createApp({
      service: fakeService({
        list: async (category) => makePage({ items: [], total: counts[category] }),
      }),
    });
    const res = await get(app, "/api/categories");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.categories).toEqual([
      expect.objectContaining({ category: "REBALANCING", count: 3 }),
      expect.objectContaining({ category: "GRID", count: 5 }),
      expect.objectContaining({ category: "YIELD", count: 0 }),
      expect.objectContaining({ category: "HEALTH_FACTOR", count: 2 }),
    ]);
    expect(body.total).toBe(10);
  });

  it("setiap baris membawa source dan ageSeconds-nya sendiri", async () => {
    const app = createApp({
      service: fakeService({
        list: async () => makePage({ source: "seed", ageSeconds: 86_400, degraded: true }),
      }),
    });
    const body = await json(await get(app, "/api/categories"));

    expect(body.categories[0].source).toBe("seed");
    expect(body.categories[0].ageSeconds).toBe(86_400);
    expect(body.degraded).toBe(true);
  });

  it("satu kategori yang gagal tidak menghapus tiga lainnya", async () => {
    const app = createApp({
      service: fakeService({
        list: async (category) => {
          if (category === "YIELD") throw new Error("upstream mati");
          return makePage({ items: [], total: 1 });
        },
      }),
    });
    const res = await get(app, "/api/categories");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.categories).toHaveLength(4);
    expect(body.categories.find((c: { category: string }) => c.category === "YIELD")).toMatchObject(
      { count: 0, healthy: false },
    );
    expect(body.healthy).toBe(false);
    expect(body.total).toBe(3);
  });
});

describe("rute tak dikenal", () => {
  it("404 berbentuk JSON, bukan HTML", async () => {
    const app = createApp({ service: fakeService({ health: async () => makeHealth() }) });
    const res = await get(app, "/api/tidak-ada");

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await json(res)).error).toBe("not_found");
  });
});
