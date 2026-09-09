import { source } from "@/lib/data";

/**
 * Is the catalogue answering right now?
 *
 * This route exists so the browser never has to talk to `api.hellofugu.xyz` itself.
 * Two reasons, and the second is the binding one:
 *
 * 1. The backend's CORS list is an allowlist, so a browser fetch works only from an
 *    origin somebody remembered to add. A same-origin route cannot be broken by a
 *    deployment that forgot one.
 * 2. **The API key stays on the server.** `frontend/CLAUDE.md` and the repository
 *    rules both say so, and the moment a page fetches the catalogue from the browser
 *    the key has to travel with it. Nothing here reaches the browser except the three
 *    fields below.
 *
 * It answers a question, not a page of data. `LiveData` polls it; when the catalogue
 * is answering and the server-rendered page has gone past its own declared maximum
 * age, the page re-runs its own server render. The data on screen therefore stays
 * server-rendered, with every failure state it already had, and it stops being stale
 * while a tab sits open.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const src = source();
  const health = await src.health();
  return Response.json(
    {
      source: health.source,
      healthy: health.healthy,
      reason: health.reason,
      checkedAt: health.checkedAt,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
