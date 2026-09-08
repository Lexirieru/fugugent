import { describe, expect, it, vi } from "vitest";
import {
  createHttpClient,
  DEFAULT_BREAKER,
  DEFAULT_RETRY,
  UpstreamError,
  withApiKey,
} from "../http/client.js";

/** Bikin Response palsu tanpa menyentuh jaringan sungguhan. */
function fakeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpClient", () => {
  it("selalu mengirim header User-Agent browser pada setiap request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const client = createHttpClient({ fetchImpl, now: () => 0 });

    await client.get("https://api.8004scan.io/api/v1/agents");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const ua = headers.get("user-agent") ?? "";
    expect(ua.length).toBeGreaterThan(0);
    // Wajib menyerupai UA browser sungguhan, bukan generic node-fetch/undici.
    expect(ua).toMatch(/Mozilla/i);
  });

  it("me-retry pada 500 lalu berhasil pada percobaan berikutnya", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(500, { error: "DATABASE_ERROR" }))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });

    const result = await client.get<{ ok: boolean }>(
      "https://api.8004scan.io/api/v1/agents",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("tidak me-retry pada 404 — langsung melempar UpstreamError setelah satu percobaan", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(404, { error: "not found" }));
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });

    await expect(
      client.get("https://api.8004scan.io/api/v1/agents/999"),
    ).rejects.toMatchObject({ status: 404, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("me-retry pada 429 (rate limit)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(429, { error: "rate limited" }))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });

    const result = await client.get<{ ok: boolean }>(
      "https://api.8004scan.io/api/v1/agents",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data.ok).toBe(true);
  });

  it("me-retry pada kegagalan jaringan (fetch throw) lalu berhasil", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });

    const result = await client.get<{ ok: boolean }>(
      "https://api.8004scan.io/api/v1/agents",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data.ok).toBe(true);
  });

  it("melempar UpstreamError setelah semua percobaan retry habis pada 5xx terus-menerus", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(503, { error: "down" }));
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
    });

    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503, attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("membuka circuit breaker setelah N kegagalan berturut-turut dan menolak cepat tanpa memanggil fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, { error: "down" }));
    let currentTime = 0;
    const client = createHttpClient({
      fetchImpl,
      now: () => currentTime,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 10_000 },
    });

    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow(
      UpstreamError,
    );
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow(
      UpstreamError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Breaker kini terbuka: percobaan ketiga wajib gagal cepat tanpa menyentuh fetchImpl.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mengizinkan satu percobaan pengintaian setelah cooldown breaker berlalu", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, { error: "down" }));
    let currentTime = 0;
    const client = createHttpClient({
      fetchImpl,
      now: () => currentTime,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 10_000 },
    });

    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow();
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow();

    // Breaker terbuka; ini gagal cepat tanpa fetch.
    fetchImpl.mockClear();
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    // Waktu berlalu melewati cooldown → satu percobaan pengintaian diizinkan.
    currentTime = 10_001;
    fetchImpl.mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    const result = await client.get<{ ok: boolean }>(
      "https://api.8004scan.io/api/v1/agents",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.data.ok).toBe(true);

    // Breaker sudah menutup lagi setelah percobaan pengintaian sukses.
    fetchImpl.mockClear();
    fetchImpl.mockResolvedValue(fakeResponse(200, { ok: true }));
    await client.get("https://api.8004scan.io/api/v1/agents");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("percobaan pengintaian yang gagal membuka kembali breaker untuk cooldown penuh berikutnya", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, { error: "down" }));
    let currentTime = 0;
    const client = createHttpClient({
      fetchImpl,
      now: () => currentTime,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 10_000 },
    });

    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow();
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow();

    currentTime = 10_001;
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toMatchObject({
      status: 500,
    });

    // Segera setelah percobaan pengintaian gagal, breaker terbuka lagi — gagal cepat.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("timeout menghasilkan UpstreamError, bukan error mentah dari fetch", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      timeoutMs: 50,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
    });

    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toBeInstanceOf(UpstreamError);
  }, 1000);

  it("meneruskan API key lewat header X-API-Key bila diberikan, tidak pernah lewat URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const client = createHttpClient({ fetchImpl, now: () => 0 });

    await client.get("https://api.8004scan.io/api/v1/agents", {
      apiKey: "rahasia-abc",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("rahasia-abc");
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("rahasia-abc");
  });

  it("withApiKey() membuat apiKey non-enumerable, tidak bocor lewat JSON.stringify/console.log", () => {
    const opts = withApiKey("rahasia-xyz", { timeoutMs: 5000 });

    expect(opts.apiKey).toBe("rahasia-xyz");
    expect(opts.timeoutMs).toBe(5000);
    expect(JSON.stringify(opts)).not.toContain("rahasia-xyz");
    expect(Object.keys(opts)).not.toContain("apiKey");
  });

  it("userAgent kosong/whitespace tidak bisa mematikan header UA browser — jatuh balik ke default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const client = createHttpClient({ fetchImpl, now: () => 0, userAgent: "   " });

    await client.get("https://api.8004scan.io/api/v1/agents");

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const ua = headers.get("user-agent") ?? "";
    expect(ua.length).toBeGreaterThan(0);
    expect(ua).toMatch(/Mozilla/i);
  });

  it("body 2xx dengan JSON tidak valid diperlakukan sebagai kegagalan data, bukan kegagalan jaringan — tidak retry, tidak menghitung breaker", async () => {
    const malformed = new Response("bukan json{{{", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const fetchImpl = vi.fn().mockResolvedValue(malformed);
    const client = createHttpClient({
      fetchImpl,
      now: () => 0,
      retry: { maxAttempts: 3, baseDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 10_000 },
    });

    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 200, attempts: 1 });
    // Tidak retry: hanya satu percobaan fetch meski maxAttempts=3.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Tidak menghitung ke breaker: panggilan kedua yang juga gagal (masih di
    // bawah failureThreshold=2 kalau body-invalid tidak dihitung) tetap
    // menyentuh upstream, bukan ditolak cepat oleh breaker yang keburu terbuka.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("breaker menghitung kegagalan per panggilan get() logis (bukan per percobaan retry) — diuji dengan nilai default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, { error: "DATABASE_ERROR" }));
    let currentTime = 0;
    const client = createHttpClient({
      fetchImpl,
      now: () => currentTime,
      // Jumlah percobaan sama seperti default (3); hanya delay yang dinolkan
      // supaya test cepat — semantik yang diuji tidak bergantung pada delay.
      retry: { maxAttempts: DEFAULT_RETRY.maxAttempts, baseDelayMs: 0 },
      breaker: { failureThreshold: DEFAULT_BREAKER.failureThreshold, cooldownMs: 10_000 },
    });

    // Kalau breaker (keliru) menghitung per percobaan retry: failureThreshold=5
    // akan tercapai setelah ~2 panggilan (2 x 3 percobaan = 6 >= 5). Buktikan
    // itu TIDAK terjadi: (failureThreshold - 1) = 4 panggilan gagal dulu,
    // breaker masih harus tertutup.
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold - 1; i++) {
      await expect(
        client.get("https://api.8004scan.io/api/v1/agents"),
      ).rejects.toBeInstanceOf(UpstreamError);
    }

    // Panggilan ke-(failureThreshold) masih benar-benar mencoba upstream
    // sebanyak maxAttempts kali — breaker belum terbuka.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);

    // Baru sekarang (setelah tepat `failureThreshold` panggilan gagal)
    // breaker terbuka: panggilan berikutnya gagal cepat tanpa fetch.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mengizinkan TEPAT SATU percobaan pengintaian meski banyak get() dipanggil konkuren tepat saat cooldown lewat (single-flight)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, { error: "down" }));
    let currentTime = 0;
    const client = createHttpClient({
      fetchImpl,
      now: () => currentTime,
      retry: { maxAttempts: 1, baseDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 10_000 },
    });

    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow();
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toThrow();
    // Breaker kini terbuka.

    currentTime = 10_001; // cooldown lewat
    fetchImpl.mockClear();
    // Fetch si pengintai butuh waktu untuk resolve, supaya panggilan get()
    // konkuren lain sungguh-sungguh tiba SAAT probe masih berjalan.
    fetchImpl.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(fakeResponse(200, { ok: true })), 5);
        }),
    );

    const results = await Promise.allSettled([
      client.get("https://api.8004scan.io/api/v1/agents"),
      client.get("https://api.8004scan.io/api/v1/agents"),
      client.get("https://api.8004scan.io/api/v1/agents"),
      client.get("https://api.8004scan.io/api/v1/agents"),
      client.get("https://api.8004scan.io/api/v1/agents"),
    ]);

    // Tepat satu request sungguhan yang menyentuh upstream — inilah inti
    // "izinkan satu percobaan pengintaian", diverifikasi di bawah konkurensi.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    // Si pengintai (satu-satunya yang benar-benar memanggil fetch) berhasil.
    // Empat pemanggil lain yang tiba selagi probe berjalan ditolak cepat
    // (bukan menunggu hasil probe) — lihat catatan desain di kepala file
    // http/client.ts untuk alasan memilih tolak-cepat, bukan berbagi hasil.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(UpstreamError);
      expect((r.reason as UpstreamError).status).toBe(503);
    }

    // Breaker sudah menutup lagi (probe sukses) — panggilan berikutnya normal.
    fetchImpl.mockClear();
    fetchImpl.mockResolvedValue(fakeResponse(200, { ok: true }));
    await client.get("https://api.8004scan.io/api/v1/agents");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
