/**
 * `/api/health` — endpoint yang membuat klaim ketahanan bisa **diperiksa**.
 *
 * Juri akan mematikan 8004scan lalu membuka endpoint ini. Kalau ia menjawab
 * "semua hijau", seluruh cerita ketahanan produk ini runtuh; kalau ia ikut
 * mati bersama Postgres, ia hilang persis pada saat ia paling dibutuhkan.
 * Kedua kegagalan itu punya test sendiri di bawah.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { fakeService, makeHealth, FIXED_NOW } from "./fixtures.js";

async function get(app: ReturnType<typeof createApp>, path: string): Promise<Response> {
  return app.request(`http://api.test${path}`);
}

/** `Response.json()` bertipe `unknown` di typing Node; badan JSON di test memang dinamis. */
// eslint-disable-next-line -eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

describe("GET /api/health", () => {
  it("melaporkan status tiap sumber apa adanya", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/health");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.healthy).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.sources.map((s: { source: string }) => s.source)).toContain("scan8004");
    expect(body.checkedAt).toBe(FIXED_NOW);
  });

  it("mengaku saat 8004scan tumbang, bukan menampilkan semua hijau", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: true,
            sources: [
              {
                source: "scan8004",
                healthy: false,
                reason: "UpstreamError: 500 DATABASE_ERROR",
                checkedAt: FIXED_NOW,
              },
              { source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW },
            ],
          }),
      }),
    });
    const res = await get(app, "/api/health");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.degraded).toBe(true);
    const scan = body.sources.find((s: { source: string }) => s.source === "scan8004");
    expect(scan.healthy).toBe(false);
    expect(scan.reason).toContain("DATABASE_ERROR");
    // Masih melayani — dari jaring pengaman, dan mengatakannya.
    expect(body.healthy).toBe(true);
    expect(body.source).toBe("seed");
  });

  it("tidak 500 saat Postgres mati — justru saat itu ia paling dibutuhkan", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: false,
            sources: [
              { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW },
              {
                source: "cache",
                healthy: false,
                reason: "Error: connect ECONNREFUSED 127.0.0.1:5432",
                checkedAt: FIXED_NOW,
              },
            ],
          }),
      }),
    });
    const res = await get(app, "/api/health");

    expect(res.status).toBe(200);
    const body = await json(res);
    const cache = body.sources.find((s: { source: string }) => s.source === "cache");
    expect(cache.healthy).toBe(false);
    expect(cache.reason).toContain("ECONNREFUSED");
  });

  it("tetap menjawab 200 walau getHealth sendiri melempar", async () => {
    const app = createApp({
      service: fakeService({
        health: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      }),
    });
    const res = await get(app, "/api/health");

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.healthy).toBe(false);
    expect(body.degraded).toBe(true);
    expect(body.reason).toContain("ECONNREFUSED");
    expect(Array.isArray(body.sources)).toBe(true);
  });

  it("tidak pernah memuat API key, termasuk di reason tiap sumber", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            degraded: true,
            sources: [
              {
                source: "scan8004",
                healthy: false,
                reason: "GET /agents X-API-Key: sk-RAHASIA-123 -> 401",
                checkedAt: FIXED_NOW,
              },
            ],
          }),
      }),
    });
    const body = await json(await get(app, "/api/health"));

    expect(JSON.stringify(body)).not.toContain("sk-RAHASIA-123");
    expect(body.sources[0].reason).toContain("[redacted]");
  });

  it("melaporkan healthy: false hanya bila tidak ada satu pun sumber sehat", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: false,
            degraded: true,
            sources: [
              { source: "scan8004", healthy: false, reason: "mati", checkedAt: FIXED_NOW },
              { source: "cache", healthy: false, reason: "mati", checkedAt: FIXED_NOW },
            ],
          }),
      }),
    });
    const res = await get(app, "/api/health");

    // Tetap 200: endpoint ini melaporkan kesehatan, bukan ikut mati bersamanya.
    expect(res.status).toBe(200);
    expect((await json(res)).healthy).toBe(false);
  });
});
