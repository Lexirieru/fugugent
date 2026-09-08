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
import { shouldAlarm } from "../health.js";
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

/**
 * Temuan I2. Tanpa mode ini tidak ada satu jalur otomatis pun — status code
 * maupun badan — yang bisa dipakai uptime monitor, liveness probe, atau
 * `curl -f` untuk tahu kami sedang berjalan dari jaring pengaman: `healthy`
 * tingkat atas praktis konstan `true` karena `seed` selalu disisipkan sehat
 * di `service/agents.ts`. `?strict=1` memberi mereka satu bit yang jujur
 * tanpa mengubah apa yang dilihat pembaca badan respons.
 *
 * Seluruh test di bawah gagal bila cabang `strict && degraded` dicabut.
 */
describe("GET /api/health?strict=1", () => {
  const degradedHealth = async () =>
    makeHealth({
      healthy: true,
      degraded: true,
      sources: [
        { source: "scan8004", healthy: false, reason: "500 DATABASE_ERROR", checkedAt: FIXED_NOW },
        { source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW },
      ],
    });

  it("503 saat degraded, dengan badan yang persis sama", async () => {
    const app = createApp({ service: fakeService({ health: degradedHealth }) });

    const lenient = await get(app, "/api/health");
    const strict = await get(app, "/api/health?strict=1");

    expect(lenient.status).toBe(200);
    expect(strict.status).toBe(503);
    // Badannya identik: yang berbeda hanya bit yang bisa dibaca monitor.
    expect(await json(strict)).toEqual(await json(lenient));
  });

  it("200 saat tidak degraded", async () => {
    const app = createApp({ service: fakeService() });
    const res = await get(app, "/api/health?strict=1");

    expect(res.status).toBe(200);
    expect((await json(res)).degraded).toBe(false);
  });

  it("503 juga saat getHealth sendiri melempar", async () => {
    const app = createApp({
      service: fakeService({
        health: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      }),
    });
    const res = await get(app, "/api/health?strict=1");

    expect(res.status).toBe(503);
    expect((await json(res)).reason).toContain("ECONNREFUSED");
  });

  it("strict=0 dan strict kosong berarti mode bawaan", async () => {
    const app = createApp({ service: fakeService({ health: degradedHealth }) });

    expect((await get(app, "/api/health?strict=0")).status).toBe(200);
    expect((await get(app, "/api/health?strict=")).status).toBe(200);
  });

  /**
   * Regresi utama: **hanya Postgres yang mati**, 8004scan segar.
   *
   * Mutu data yang dilihat pengguna memang tidak turun — `degraded: false`,
   * `healthy: true` — jadi syarat lama (`strict && degraded`) membalas 200 dan
   * monitor tidak pernah tahu satu sumber benar-benar tumbang. Diukur di
   * container hidup sebelum perbaikan ini.
   *
   * Gagal bila klausa `liveBroken` dicabut dari `shouldAlarm`.
   */
  it("503 saat HANYA cache mati walau degraded: false dan healthy: true", async () => {
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
                reason: "probe: kueri cache gagal — ECONNREFUSED 127.0.0.1:5432",
                checkedAt: FIXED_NOW,
              },
              { source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW },
            ],
          }),
      }),
    });

    const strict = await get(app, "/api/health?strict=1");
    const lenient = await get(app, "/api/health");

    expect(strict.status).toBe(503);
    // Mode bawaan tetap 200: pengguna memang belum merasakan apa pun.
    expect(lenient.status).toBe(200);
    const body = await json(strict);
    expect(body.degraded).toBe(false);
    expect(body.healthy).toBe(true);
    expect(body.reason).toContain("cache tidak sehat");
  });

  it("503 saat HANYA on-chain mati", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: false,
            sources: [
              { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW },
              { source: "cache", healthy: true, reason: null, checkedAt: FIXED_NOW },
              { source: "onchain", healthy: false, reason: "RPC timeout", checkedAt: FIXED_NOW },
            ],
          }),
      }),
    });

    expect((await get(app, "/api/health?strict=1")).status).toBe(503);
  });

  /**
   * "Tidak dipasang" bukan "rusak". Backend tanpa `DATABASE_URL` adalah
   * konfigurasi yang sah — `index.ts` sengaja mengizinkannya — dan tidak boleh
   * membuat monitor merah selamanya. `cache` tidak muncul di `sources` sama
   * sekali pada keadaan itu.
   */
  it("200 saat cache tidak dipasang dan sisanya sehat", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: false,
            sources: [
              { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW },
              { source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW },
            ],
          }),
      }),
    });

    expect((await get(app, "/api/health?strict=1")).status).toBe(200);
  });

  /**
   * `seed` bukan sumber sungguhan: ia berkas di dalam bundel proses ini.
   * Gagal bila `LIVE_SOURCES` diganti "semua sumber".
   */
  it("200 saat hanya seed yang dilaporkan tidak sehat", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: false,
            sources: [
              { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW },
              { source: "cache", healthy: true, reason: null, checkedAt: FIXED_NOW },
              { source: "seed", healthy: false, reason: "observasi basi", checkedAt: FIXED_NOW },
            ],
          }),
      }),
    });

    expect((await get(app, "/api/health?strict=1")).status).toBe(200);
  });

  it("503 saat belum ada satu pun sumber sungguhan yang terkonfirmasi sehat", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            // Persis keadaan sesaat setelah boot: belum ada observasi apa pun.
            healthy: false,
            degraded: true,
            sources: [{ source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW }],
          }),
      }),
    });

    expect((await get(app, "/api/health?strict=1")).status).toBe(503);
  });

  /**
   * Observasi kedaluwarsa berarti **belum diperiksa ulang**, bukan gagal.
   * `onchain` hanya tersentuh ketika tingkat 1 dan 2 gagal, jadi observasinya
   * nyaris selalu melewati TTL; menghitungnya sebagai kerusakan membuat monitor
   * merah permanen — sama tidak bergunanya dengan monitor yang hijau permanen.
   * Terukur di container hidup sebelum pengecualian ini dipasang.
   *
   * Gagal bila syarat `source.stale !== true` dicabut.
   */
  it("200 saat satu-satunya sumber tidak sehat hanyalah observasi yang stale", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: false,
            sources: [
              { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW, stale: false },
              {
                source: "onchain",
                healthy: false,
                reason: "observasi berumur 2061 dtk, melewati ambang 30 dtk — belum diperiksa ulang",
                checkedAt: FIXED_NOW,
                stale: true,
              },
            ],
          }),
      }),
    });

    expect((await get(app, "/api/health?strict=1")).status).toBe(200);
  });

  it("503 tetap berbunyi bila sumber yang sama gagal SEGAR, bukan kedaluwarsa", async () => {
    const app = createApp({
      service: fakeService({
        health: async () =>
          makeHealth({
            healthy: true,
            degraded: false,
            sources: [
              { source: "scan8004", healthy: true, reason: null, checkedAt: FIXED_NOW, stale: false },
              {
                source: "onchain",
                healthy: false,
                reason: "RPC timeout",
                checkedAt: FIXED_NOW,
                stale: false,
              },
            ],
          }),
      }),
    });

    expect((await get(app, "/api/health?strict=1")).status).toBe(503);
  });

  it("ejaan lain ditolak 400, bukan diam-diam dianggap mati", async () => {
    const app = createApp({ service: fakeService({ health: degradedHealth }) });
    const res = await get(app, "/api/health?strict=yes");

    // `?strict=yes` yang diam-diam berarti mati akan membuat monitor melapor
    // hijau selamanya tanpa pernah memberi tahu ia tidak memeriksa apa pun.
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("invalid_query");
    expect(body.field).toBe("strict");
  });
});

/**
 * Kontrak `shouldAlarm` diuji juga secara langsung, bukan hanya lewat rute.
 *
 * Alasannya sama dengan pelajaran C1: rute tidak boleh menggantungkan
 * kebenarannya pada invariant yang kebetulan berlaku di `service/` hari ini.
 * Kombinasi `healthy: false` + `degraded: false` misalnya **tidak bisa**
 * dihasilkan definisi `getHealth()` saat ini (`degraded: false` berarti
 * 8004scan sehat, dan itu sendiri sudah membuat `healthy: true`). Justru karena
 * itu ia diuji di sini: bila definisi salah satunya berubah kelak, klausa
 * ketiga adalah yang menahan monitor tetap berbunyi.
 */
describe("shouldAlarm", () => {
  const ok = { source: "scan8004" as const, healthy: true, reason: null, checkedAt: FIXED_NOW };

  it("berbunyi bila tidak ada sumber sungguhan yang terkonfirmasi sehat, walau degraded: false", () => {
    expect(shouldAlarm({ healthy: false, degraded: false, sources: [ok] })).toBe(true);
  });

  it("berbunyi bila ada sumber sungguhan yang rusak", () => {
    expect(
      shouldAlarm({
        healthy: true,
        degraded: false,
        sources: [
          ok,
          { source: "cache", healthy: false, reason: "ECONNREFUSED", checkedAt: FIXED_NOW },
        ],
      }),
    ).toBe(true);
  });

  it("berbunyi bila degraded, walau daftar sumbernya kosong", () => {
    expect(shouldAlarm({ healthy: true, degraded: true, sources: [] })).toBe(true);
  });

  it("diam bila satu-satunya yang tidak sehat adalah observasi kedaluwarsa", () => {
    expect(
      shouldAlarm({
        healthy: true,
        degraded: false,
        sources: [
          { ...ok, stale: false },
          {
            source: "cache",
            healthy: false,
            reason: "observasi kedaluwarsa",
            checkedAt: FIXED_NOW,
            stale: true,
          },
        ],
      }),
    ).toBe(false);
  });

  it("berbunyi bila kegagalannya segar, bukan kedaluwarsa", () => {
    expect(
      shouldAlarm({
        healthy: true,
        degraded: false,
        sources: [
          { ...ok, stale: false },
          {
            source: "cache",
            healthy: false,
            reason: "ECONNREFUSED",
            checkedAt: FIXED_NOW,
            stale: false,
          },
        ],
      }),
    ).toBe(true);
  });

  it("diam bila jalur utama sehat dan tidak ada bukti kerusakan", () => {
    expect(
      shouldAlarm({
        healthy: true,
        degraded: false,
        sources: [ok, { source: "seed", healthy: true, reason: null, checkedAt: FIXED_NOW }],
      }),
    ).toBe(false);
  });
});
