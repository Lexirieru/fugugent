/**
 * `GET /api/quest/agent/:id` — the Set and Earn build checklist for one agent.
 *
 * See `sources/readiness.ts`. An answer is held for a minute per agent: the check
 * fetches the agent's own card, and a page refresh must not turn into a probe storm
 * against somebody else's server.
 */
import { Hono } from "hono";
import { redact } from "../service/agents.js";
import type { Readiness, ReadinessAnswer } from "../sources/readiness.js";

const ID = /^\d{1,6}:\d{1,78}$/;
export const READINESS_TTL_MS = 60_000;

export function createQuestRoutes(readiness: Readiness, now: () => number = Date.now): Hono {
  const app = new Hono();
  const held = new Map<string, { at: number; answer: ReadinessAnswer }>();

  app.get("/quest/agent/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    if (!ID.test(id)) return c.json({ error: "bad_request", field: "id", message: "id must look like 97:2480" }, 400);
    const hit = held.get(id);
    if (hit && now() - hit.at < READINESS_TTL_MS) return c.json(hit.answer);
    try {
      const answer = await readiness.check(id);
      if (answer === null) return c.json({ error: "not_found", message: `no agent ${id}` }, 404);
      if (held.size > 500) held.clear();
      // An answer given while the registry was still loading is not held.
      if (answer.complete) held.set(id, { at: now(), answer });
      return c.json(answer);
    } catch (err) {
      return c.json({ error: "unavailable", message: redact(err instanceof Error ? err.message : String(err)) }, 503);
    }
  });

  return app;
}
