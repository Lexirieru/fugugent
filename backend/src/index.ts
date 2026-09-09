/**
 * The `api.hellofugu.xyz` entry point.
 *
 * The only file that touches the real world: it reads the environment, opens
 * connections, and starts the server. The HTTP contract itself is assembled in
 * `src/routes/app.ts` as a pure function, so it can be tested without a network,
 * without Postgres, and without RPC.
 *
 * ## Three things done deliberately this way
 *
 * 1. **Postgres is optional.** Without `DATABASE_URL` the service still starts
 *    with level 2 marked `unavailable`. A backend that refuses to boot because
 *    the cache is missing would die in precisely the situation this whole
 *    fallback exists to survive; an `/api/health` that reports the cache is
 *    missing is far more useful than a process that never answers.
 * 2. **A schema failure does not take the boot down.** An `ensureSchema` that
 *    fails (Postgres not ready, insufficient privileges) withdraws level 2, not
 *    the whole API.
 * 3. **The `node:http` adapter is hand-written.** Adding a dependency just for
 *    ~30 lines bridging `IncomingMessage` to `Request` is not worth it;
 *    `app.fetch` is the standard interface and that is all that is needed.
 *
 * `RPC_URL` must be overridden: the SDK default uses the `binance.org` domain,
 * which is blocked from Indonesia. `loadConfig()` already uses the right
 * endpoint.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { createPublicClient, http as viemHttp } from "viem";
import { bscTestnet } from "viem/chains";
import { loadConfig } from "./config.js";
import { connectDb, ensureSchema, type DbHandle } from "./db/client.js";
import { createHttpClient } from "./http/client.js";
import { createAgentService, createDbAgentCache, redact } from "./service/agents.js";
import { createOnchainSource } from "./sources/onchain.js";
import { createScan8004Source } from "./sources/scan8004.js";
import { createApp } from "./routes/app.js";

export { createApp } from "./routes/app.js";
export type { ApiDeps } from "./routes/app.js";

export const DEFAULT_PORT = 8787;

/**
 * An error message safe to send to the client.
 *
 * `redact` is not decoration: the last-resort net below catches errors that
 * passed through no redaction at all, and HTTP client error messages have
 * carried URLs along with their credentials before. The rule "an API key never
 * appears in a response" must not have an accidental exception.
 */
export function describeFailure(err: unknown): string {
  return redact(
    err instanceof Error ? `${err.name}: ${err.message.split("\n")[0]}` : String(err),
  );
}

const describe = describeFailure;

export interface BuiltServer {
  app: ReturnType<typeof createApp>;
  config: ReturnType<typeof loadConfig>;
  hasCache: boolean;
  close: () => Promise<void>;
}

/**
 * Assembles the whole service from the environment. Returns `close` so a process
 * receiving SIGTERM can close the connection pool instead of abandoning it.
 */
export function buildServer(env: NodeJS.ProcessEnv = process.env): BuiltServer {
  const config = loadConfig(env);

  const httpClient = createHttpClient({ fetchImpl: fetch, now: () => Date.now() });
  const scan8004 = createScan8004Source({ http: httpClient, config });

  const onchain = createOnchainSource({
    client: createPublicClient({ chain: bscTestnet, transport: viemHttp(config.rpcUrl) }),
    config,
  });

  let dbHandle: DbHandle | null = null;
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    dbHandle = connectDb(databaseUrl);
    // Best-effort: a schema that fails to be created withdraws level 2, not the
    // whole API.
    void ensureSchema(dbHandle.db).catch((err: unknown) => {
      console.error("[fugugent] ensureSchema failed, cache skipped:", describe(err));
    });
  }

  const service = createAgentService({
    scan8004,
    onchain,
    cache: dbHandle === null ? undefined : createDbAgentCache(dbHandle.db),
  });

  const handle = dbHandle;
  return {
    app: createApp({ service }),
    config,
    hasCache: handle !== null,
    close: async (): Promise<void> => {
      if (handle !== null) await handle.close();
    },
  };
}

// ---------------------------------------------------------------------------
// The node:http to Fetch API bridge
// ---------------------------------------------------------------------------

/**
 * `IncomingMessage` → `Request`, or the reason the request is invalid.
 *
 * A malformed `Host` (`Host: bad host`) makes `new URL` throw. That is a
 * **client** error, triggerable by anyone without authentication, and letting it
 * fall through to the last-resort net would mean a 500 — polluting the 5xx
 * metrics with requests that were never wrong on our side. So it is
 * distinguished here and answered with a 400.
 */
export function toRequest(req: IncomingMessage): { request: Request } | { badRequest: string } {
  const host = req.headers.host ?? "localhost";
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${host}`);
  } catch {
    return { badRequest: "invalid Host header or request target" };
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  // This backend only reads; no route has a request body.
  return { request: new Request(url, { method: req.method ?? "GET", headers }) };
}

export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    // `Set-Cookie` is the one header that must not be joined with commas, and
    // `forEach` presents it already joined. `getSetCookie()` returns each value
    // intact; without it only the last one would get through.
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;

  res.writeHead(response.status, headers);
  res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()));
}

/** A `node:http` handler for a Fetch application. Exported so it can be tested. */
export function createRequestListener(app: { fetch: (request: Request) => Response | Promise<Response> }) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      try {
        const converted = toRequest(req);
        if ("badRequest" in converted) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "bad_request", message: converted.badRequest }));
          return;
        }
        await writeResponse(res, await app.fetch(converted.request));
      } catch (err) {
        // The last-resort net. Still JSON: this client cannot read anything else.
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error", message: describeFailure(err) }));
      }
    })();
  };
}

export function startServer(port = Number(process.env.PORT ?? DEFAULT_PORT)) {
  const built = buildServer();

  const server = createServer(createRequestListener(built.app));

  server.listen(port, () => {
    console.log(
      `[fugugent] api listening on :${port} - chain ${built.config.chainId}, ` +
        `cache ${built.hasCache ? "active" : "not installed"}`,
    );
  });

  const shutdown = (): void => {
    server.close(() => {
      void built.close().finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return server;
}

/**
 * Only starts when this file is the one being run. `import`ing this module from
 * a test must never open a port.
 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  startServer();
}
