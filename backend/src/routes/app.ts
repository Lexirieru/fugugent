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
import { DEFAULT_ALLOWED_ORIGINS } from "../config.js";
import { redact, type AgentService } from "../service/agents.js";
import type { SkillService } from "../skills/service.js";
import { createAgentRoutes } from "./agents.js";
import { createHealthRoutes } from "./health.js";
import { createSkillRoutes } from "./skills.js";

export interface ApiDeps {
  service: AgentService;
  /**
   * Browser origins allowed to read this API cross-site. Defaults to
   * `DEFAULT_ALLOWED_ORIGINS`, so a caller that forgets to pass it gets the
   * production list rather than a wildcard.
   */
  allowedOrigins?: readonly string[];
  /**
   * The audited-skill marketplace. **Optional**: an instance without it serves
   * the agent routes exactly as before, and `/api/skills` answers 404 like any
   * other unknown path. Mounting it conditionally rather than always keeps the
   * two features independent — a defect in one cannot take the other's routes
   * with it.
   */
  skills?: SkillService;
  /** Injected so failure-envelope timestamps are deterministic in tests. */
  now?: () => Date;
}

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  // The marketplace is served from another domain (`app.hellofugu.xyz` calling
  // `api.hellofugu.xyz`), so it needs CORS at all. `POST` is allowed for exactly
  // one route, `POST /api/skills`, which registers a skill for audit. Every other
  // endpoint is read-only.
  //
  // The list is an allowlist rather than `*`. What that is worth is written at
  // `DEFAULT_ALLOWED_ORIGINS` in config.ts, including what it does not protect.
  //
  // Hono's `origin` callback returns the origin to echo back, or `undefined` to
  // send no `Access-Control-Allow-Origin` header at all. Returning `undefined`
  // is what makes the browser refuse the response; returning the request's own
  // origin unconditionally would be a wildcard wearing a disguise.
  const allowed = new Set(deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowed.has(origin) ? origin : undefined),
      allowMethods: ["GET", "POST", "OPTIONS"],
      // Without this, a proxy or CDN could hand a response cached for one
      // allowed origin to a page on another.
      credentials: false,
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    // The response body is identical for every origin, but the
    // `Access-Control-Allow-Origin` header is not. Anything caching by URL alone
    // would serve one origin's header to another.
    c.header("Vary", "Origin", { append: true });
  });

  app.route("/api", createAgentRoutes(deps));
  app.route("/api", createHealthRoutes(deps));
  if (deps.skills !== undefined) {
    app.route("/api", createSkillRoutes({ service: deps.skills, now: deps.now }));
  }

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
