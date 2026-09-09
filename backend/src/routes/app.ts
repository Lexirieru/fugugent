/**
 * HTTP application assembly. A pure function from dependencies to `Hono` — it
 * opens no connections, reads no environment, starts no server.
 *
 * That is what makes the entire HTTP contract testable through
 * `app.request(...)` without touching the network, Postgres, or RPC;
 * `src/index.ts` deals with the real world.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { redact, type AgentService } from "../service/agents.js";
import { createAgentRoutes } from "./agents.js";
import { createHealthRoutes } from "./health.js";

export interface ApiDeps {
  service: AgentService;
  /** Injected so failure-envelope timestamps are deterministic in tests. */
  now?: () => Date;
}

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  // The marketplace is served from another domain (`app.fugugent.xyz` → `api.fugugent.xyz`).
  // GET only: this backend has not a single state-changing endpoint.
  app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

  app.route("/api", createAgentRoutes(deps));
  app.route("/api", createHealthRoutes(deps));

  // JSON on every path, including the wrong ones: this client can only read
  // JSON, and an HTML "Not Found" page would reach it as a confusing parse
  // error instead of as a clear 404.
  app.notFound((c) =>
    c.json({ error: "not_found", message: `no route ${c.req.method} ${c.req.path}` }, 404),
  );

  app.onError((err, c) => {
    // Upstream failures are already handled in each handler; getting here means
    // a defect in our own code — e.g. an error from middleware, or from
    // response serialization, which sits OUTSIDE the handler's `try/catch`.
    //
    // `redact` is mandatory precisely here: messages that reach this path have
    // never passed through any redaction, and HTTP client error messages have
    // carried URLs along with their credentials before. "An API key never
    // appears in a response" must not have an accidental exception.
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return c.json({ error: "internal_error", message: redact(message) }, 500);
  });

  return app;
}
