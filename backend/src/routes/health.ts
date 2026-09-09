/**
 * `/api/health` — the endpoint that makes the resilience claims **checkable**.
 *
 * Not a liveness probe. This is a report on the state of **each source**,
 * including the ones that are down, and that is the whole point: anyone may take
 * 8004scan down and then check whether we admit it. A health endpoint that is
 * always green proves nothing.
 *
 * Two rules bind this file:
 *
 * 1. **Never a 5xx.** Including when Postgres is down — that is precisely when
 *    it is needed most. A `getHealth()` that throws becomes an honest
 *    `healthy: false` report, not an error page.
 * 2. **Never contains credentials.** Every `reason` — including ones that came
 *    from an upstream error message — is redacted through `redact` before it
 *    leaves.
 *
 * ## Two modes, because there are two readers
 *
 * - **Default: always 200**, even when `healthy: false`. Its readers are the UI
 *   and humans, who read the response body. (`fetch` itself does not discard the
 *   body on a 503 — what discards it is `getJson` in the frontend, which throws
 *   on a non-2xx. So the 200 here is a choice made for that client, not a
 *   property of HTTP.)
 * - **`?strict=1`: 503 when there is evidence of breakage** (see
 *   {@link shouldAlarm}). Its readers are uptime monitors, liveness probes, and
 *   `curl -f` — which only see the status code and cannot read anything. The body
 *   is still complete and identical to the default mode.
 */
import { Hono } from "hono";
import {
  LIVE_SOURCES,
  redact,
  type AgentService,
  type ObservedSourceHealth,
} from "../service/agents.js";
import type { AgentSource, SourceHealth } from "../types.js";
import { QueryError } from "./query.js";

export interface HealthRoutesDeps {
  service: AgentService;
  now?: () => Date;
}

/** The fallback order — used to name which source is currently serving. */
const SOURCE_ORDER: readonly AgentSource[] = ["scan8004", "cache", "onchain", "seed"];

export interface HealthResponse {
  healthy: boolean;
  /** `true` when 8004scan is unhealthy — we are running from the safety net. */
  degraded: boolean;
  /**
   * The topmost source that is still healthy: this is most likely where the next
   * request will be served from. `"seed"` when nothing is healthy.
   */
  source: AgentSource;
  /** A summary of the unhealthy sources. `null` when everything is healthy. */
  reason: string | null;
  /** Each row carries the age of its observation (`ageSeconds`, `stale`). */
  sources: ObservedSourceHealth[];
  checkedAt: string;
}

function scrub(health: ObservedSourceHealth): ObservedSourceHealth {
  return { ...health, reason: health.reason === null ? null : redact(health.reason) };
}

/**
 * **The `?strict=1` contract.** This is what other people will rely on, so it is
 * written as one named function rather than as an expression inside the handler.
 *
 * The alarm sounds when **there is evidence of breakage**, not only once the user
 * has felt it:
 *
 * 1. **A live source is known to be unhealthy.** This is what used to be
 *    missing. `degraded` alone is not enough: if **only** Postgres is down while
 *    8004scan is fresh, the quality of the data the user sees really has not
 *    dropped — `degraded: false`, `healthy: true` — and the monitor sees a 200
 *    while a source is genuinely down. That is precisely the state worth catching
 *    **before** it becomes a problem: a dead cache is a missing net, and it is
 *    only felt at the exact moment 8004scan goes down too.
 * 2. **`degraded`** — 8004scan is not known to be healthy. It stays even though
 *    point 1 covers most of it: if 8004scan has never been observed at all, it
 *    does not appear in `sources`, yet `degraded` is still `true`. Letting
 *    `strict` answer 200 while its body says `degraded: true` would make two
 *    readers of the same endpoint contradict each other.
 * 3. **`!healthy`** — not a single live source is confirmed healthy. This
 *    includes the "nothing is known yet" state just after boot: the absence of
 *    evidence of health is not evidence of health, and a monitor that raises the
 *    alarm in the not-yet-known state is behaving correctly. It goes quiet by
 *    itself once the first request has gone through.
 *
 * What does **not** sound the alarm:
 *
 * - **A live source that has never been observed.** A backend deliberately run
 *   without `DATABASE_URL` is a valid configuration, not breakage; `cache` never
 *   appears in `sources` and must not turn the monitor red forever. "Not
 *   installed" is not "broken" — the same distinction `/api/agents/:id` uses so
 *   as not to erase a real agent.
 * - **`seed`.** It is a file inside this process's own bundle, not a live source
 *   ({@link LIVE_SOURCES}); it cannot go down on its own, so it cannot be
 *   evidence of infrastructure breakage.
 * - **A `stale` observation.** `observe()` in `service/agents.ts` withdraws the
 *   health claim of an observation past its TTL — a `healthy: false` there means
 *   "not re-checked yet", not "failed". Counting it as breakage would make the
 *   monitor permanently red: `onchain` is only touched when levels 1 and 2 fail,
 *   so its observation is almost always expired. This is exactly the same
 *   distinction `/api/agents/:id` uses: **not knowing is not being broken**, just
 *   as not knowing is not not existing. Measured on a live container: without
 *   this exception, `strict=1` answers 503 even though nothing is broken.
 */
export function shouldAlarm(health: {
  healthy: boolean;
  degraded: boolean;
  sources: readonly ObservedSourceHealth[];
}): boolean {
  const liveBroken = health.sources.some(
    (source) =>
      LIVE_SOURCES.includes(source.source) && !source.healthy && source.stale !== true,
  );
  return liveBroken || health.degraded || !health.healthy;
}

/**
 * `?strict=1` — on only for `1` or `true`.
 *
 * Any other spelling is rejected rather than treated as "off": a `?strict=yes`
 * that silently means off would make a monitor report green forever without ever
 * telling anyone that it is checking nothing.
 */
export function parseStrict(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new QueryError("strict", `strict only accepts 1/true/0/false, not ${JSON.stringify(raw)}`);
}

function servingSource(sources: readonly SourceHealth[]): AgentSource {
  for (const source of SOURCE_ORDER) {
    if (sources.some((health) => health.source === source && health.healthy)) return source;
  }
  return "seed";
}

export function createHealthRoutes(deps: HealthRoutesDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());

  app.get("/health", async (c) => {
    let strict: boolean;
    try {
      strict = parseStrict(c.req.query("strict"));
    } catch (err) {
      const qe = err as QueryError;
      return c.json({ error: "invalid_query", field: qe.field, message: qe.message }, 400);
    }

    try {
      const health = await deps.service.getHealth();
      const sources = health.sources.map(scrub);
      const unhealthy = sources.filter((s) => !s.healthy);

      const body: HealthResponse = {
        healthy: health.healthy,
        degraded: health.degraded,
        source: servingSource(sources),
        reason:
          unhealthy.length === 0
            ? null
            : redact(
                unhealthy
                  .map((s) => `${s.source} unhealthy${s.reason ? `: ${s.reason}` : ""}`)
                  .join("; "),
              ),
        sources,
        checkedAt: health.checkedAt,
      };
      // Exactly the same body; only the status code speaks to the reader that
      // cannot read a body.
      return strict && shouldAlarm(body) ? c.json(body, 503) : c.json(body);
    } catch (err) {
      // The service promises not to throw; if it throws anyway, that is the most
      // important health fact there is to report — not a reason to die with it.
      const message =
        err instanceof Error ? `${err.name}: ${err.message.split("\n")[0]}` : String(err);
      const body: HealthResponse = {
        healthy: false,
        degraded: true,
        source: "seed",
        reason: redact(message),
        sources: [],
        checkedAt: now().toISOString(),
      };
      return strict ? c.json(body, 503) : c.json(body);
    }
  });

  return app;
}
