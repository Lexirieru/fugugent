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
