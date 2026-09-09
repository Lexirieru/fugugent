import { describe, expect, it, vi } from "vitest";
import {
  createHttpClient,
  DEFAULT_BREAKER,
  DEFAULT_RETRY,
  UpstreamError,
  withApiKey,
} from "../http/client.js";

/** Build a fake Response without touching a real network. */
function fakeResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpClient", () => {
  it("always sends a browser User-Agent header on every request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const client = createHttpClient({ fetchImpl, now: () => 0 });

    await client.get("https://api.8004scan.io/api/v1/agents");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const ua = headers.get("user-agent") ?? "";
    expect(ua.length).toBeGreaterThan(0);
    // It must resemble a real browser UA, not a generic node-fetch/undici one.
    expect(ua).toMatch(/Mozilla/i);
  });

  it("retries on a 500 and then succeeds on the next attempt", async () => {
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

  it("does not retry on a 404 — it throws an UpstreamError straight after one attempt", async () => {
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

  it("retries on a 429 (rate limit)", async () => {
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

  it("retries on a network failure (a throwing fetch) and then succeeds", async () => {
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

  it("throws an UpstreamError once every retry attempt is spent on a persistent 5xx", async () => {
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

  it("opens the circuit breaker after N consecutive failures and rejects fast without calling fetch", async () => {
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

    // The breaker is now open: the third attempt must fail fast without touching fetchImpl.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows one probe attempt once the breaker cooldown has elapsed", async () => {
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

    // The breaker is open; this fails fast with no fetch.
    fetchImpl.mockClear();
    await expect(client.get("https://api.8004scan.io/api/v1/agents")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    // Time moves past the cooldown → one probe attempt is allowed.
    currentTime = 10_001;
    fetchImpl.mockResolvedValueOnce(fakeResponse(200, { ok: true }));
    const result = await client.get<{ ok: boolean }>(
      "https://api.8004scan.io/api/v1/agents",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.data.ok).toBe(true);

    // The breaker has closed again after the successful probe attempt.
    fetchImpl.mockClear();
    fetchImpl.mockResolvedValue(fakeResponse(200, { ok: true }));
    await client.get("https://api.8004scan.io/api/v1/agents");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a failed probe attempt reopens the breaker for another full cooldown", async () => {
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

    // Immediately after the probe attempt fails, the breaker is open again — fail fast.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a timeout produces an UpstreamError, not a raw error from fetch", async () => {
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

  it("passes the API key through the X-API-Key header when given, never through the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const client = createHttpClient({ fetchImpl, now: () => 0 });

    await client.get("https://api.8004scan.io/api/v1/agents", {
      apiKey: "secret-abc",
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-abc");
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("secret-abc");
  });

  it("withApiKey() makes apiKey non-enumerable, so it does not leak through JSON.stringify/console.log", () => {
    const opts = withApiKey("secret-xyz", { timeoutMs: 5000 });

    expect(opts.apiKey).toBe("secret-xyz");
    expect(opts.timeoutMs).toBe(5000);
    expect(JSON.stringify(opts)).not.toContain("secret-xyz");
    expect(Object.keys(opts)).not.toContain("apiKey");
  });

  it("an empty/whitespace userAgent cannot switch off the browser UA header — it falls back to the default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { ok: true }));
    const client = createHttpClient({ fetchImpl, now: () => 0, userAgent: "   " });

    await client.get("https://api.8004scan.io/api/v1/agents");

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const ua = headers.get("user-agent") ?? "";
    expect(ua.length).toBeGreaterThan(0);
    expect(ua).toMatch(/Mozilla/i);
  });

  it("a 2xx body with invalid JSON is treated as a data failure, not a network failure — no retry, not counted toward the breaker", async () => {
    const malformed = new Response("not json{{{", {
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
    // No retry: only one fetch attempt even though maxAttempts=3.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Not counted toward the breaker: a second call that also fails (still below
    // failureThreshold=2 if an invalid body is not counted) still reaches
    // upstream, rather than being rejected fast by a breaker that opened early.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("the breaker counts failures per logical get() call (not per retry attempt) — tested with the default values", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, { error: "DATABASE_ERROR" }));
    let currentTime = 0;
    const client = createHttpClient({
      fetchImpl,
      now: () => currentTime,
      // The same attempt count as the default (3); only the delay is zeroed so
      // the test is fast — the semantics under test do not depend on the delay.
      retry: { maxAttempts: DEFAULT_RETRY.maxAttempts, baseDelayMs: 0 },
      breaker: { failureThreshold: DEFAULT_BREAKER.failureThreshold, cooldownMs: 10_000 },
    });

    // If the breaker (wrongly) counted per retry attempt: failureThreshold=5
    // would be reached after ~2 calls (2 x 3 attempts = 6 >= 5). Prove that does
    // NOT happen: after (failureThreshold - 1) = 4 failed calls, the breaker must
    // still be closed.
    for (let i = 0; i < DEFAULT_BREAKER.failureThreshold - 1; i++) {
      await expect(
        client.get("https://api.8004scan.io/api/v1/agents"),
      ).rejects.toBeInstanceOf(UpstreamError);
    }

    // Call number (failureThreshold) still genuinely tries upstream maxAttempts
    // times — the breaker is not open yet.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);

    // Only now (after exactly `failureThreshold` failed calls) does the breaker
    // open: the next call fails fast with no fetch.
    fetchImpl.mockClear();
    await expect(
      client.get("https://api.8004scan.io/api/v1/agents"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows EXACTLY ONE probe attempt even when many get() calls arrive concurrently right as the cooldown elapses (single-flight)", async () => {
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
    // The breaker is now open.

    currentTime = 10_001; // the cooldown has elapsed
    fetchImpl.mockClear();
    // The prober's fetch needs time to resolve, so the other concurrent get()
    // calls genuinely arrive WHILE the probe is still running.
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

    // Exactly one real request reaches upstream — this is the core of "allow one
    // probe attempt", verified under concurrency.
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    // The prober (the only one that actually called fetch) succeeded. The four
    // other callers that arrived while the probe was running are rejected fast
    // (rather than waiting for the probe's result) — see the design note at the
    // top of http/client.ts for why reject-fast was chosen over sharing the
    // result.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(UpstreamError);
      expect((r.reason as UpstreamError).status).toBe(503);
    }

    // The breaker has closed again (the probe succeeded) — the next call is normal.
    fetchImpl.mockClear();
    fetchImpl.mockResolvedValue(fakeResponse(200, { ok: true }));
    await client.get("https://api.8004scan.io/api/v1/agents");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
