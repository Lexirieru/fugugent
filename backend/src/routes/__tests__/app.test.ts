/**
 * Application-level behaviour: the error path that sits **outside** each
 * handler's `try/catch`.
 *
 * `app.onError` is the only path whose message never passes through any
 * redaction before reaching the client — and precisely for that reason it is the
 * one most likely to leak credentials. The tests below fail the moment `redact`
 * is removed from `app.ts`.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { fakeService } from "./fixtures.js";

const SECRET = "sk-SECRET-123";

describe("app.onError", () => {
  function appThatThrows(message: string) {
    const app = createApp({ service: fakeService() });
    // A synthetic route: it stands for an error escaping from outside a
    // handler's `try/catch` (middleware, or response serialization), which only
    // `onError` catches.
    app.get("/api/boom", () => {
      throw new Error(message);
    });
    return app;
  }

  it("redacts credentials from an uncaught error message", async () => {
    const app = appThatThrows(
      `GET https://api.8004scan.io/api/v1/agents?api_key=${SECRET} failed`,
    );
    const res = await app.request("http://api.test/api/boom");

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain("[redacted]");
    expect(JSON.parse(raw).error).toBe("internal_error");
  });

  it("redacts the Authorization header from an uncaught error message", async () => {
    const app = appThatThrows(`upstream refused: Bearer ${SECRET}`);
    const raw = await (await app.request("http://api.test/api/boom")).text();

    expect(raw).not.toContain(SECRET);
    expect(raw).toContain("[redacted]");
  });

  it("stays JSON, not HTML", async () => {
    const app = appThatThrows("an ordinary failure");
    const res = await app.request("http://api.test/api/boom");

    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(await res.text()) as { message: string };
    expect(body.message).toContain("an ordinary failure");
  });
});

/**
 * The CORS allowlist.
 *
 * These tests exist because the previous value was `origin: "*"`, which reads as
 * harmless on a read-only API and is not: `POST /api/skills` writes, and with a
 * wildcard any page a visitor happens to open could register a skill using their
 * browser. The tests below fail if the allowlist is widened back to a wildcard,
 * or if the callback is changed to echo whatever origin asked.
 */
describe("CORS allowlist", () => {
  const ALLOWED = ["https://app.hellofugu.xyz"] as const;

  function app() {
    return createApp({ service: fakeService(), allowedOrigins: ALLOWED });
  }

  it("echoes an allowed origin back", async () => {
    const res = await app().request("http://api.test/api/agents", {
      headers: { Origin: "https://app.hellofugu.xyz" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.hellofugu.xyz");
  });

  it("sends no allow-origin header for an origin that is not on the list", async () => {
    const res = await app().request("http://api.test/api/agents", {
      headers: { Origin: "https://not-ours.example" },
    });

    // Not a 403: the request itself is fine, and the API answers it. What stops
    // the other page reading the answer is the missing header.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses the preflight for a POST from an origin that is not on the list", async () => {
    const res = await app().request("http://api.test/api/skills", {
      method: "OPTIONS",
      headers: {
        Origin: "https://not-ours.example",
        "Access-Control-Request-Method": "POST",
      },
    });

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("varies on Origin, so a cache cannot serve one origin's header to another", async () => {
    const res = await app().request("http://api.test/api/agents", {
      headers: { Origin: "https://app.hellofugu.xyz" },
    });

    expect(res.headers.get("vary") ?? "").toContain("Origin");
  });
});
