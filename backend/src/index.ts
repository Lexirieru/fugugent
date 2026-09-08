/**
 * Titik masuk `api.fugugent.xyz`.
 *
 * Satu-satunya berkas yang menyentuh dunia nyata: membaca environment, membuka
 * koneksi, dan menyalakan server. Seluruh kontrak HTTP-nya sendiri dirakit di
 * `src/routes/app.ts` sebagai fungsi murni, sehingga bisa diuji tanpa jaringan,
 * tanpa Postgres, dan tanpa RPC.
 *
 * ## Tiga hal yang sengaja dilakukan begini
 *
 * 1. **Postgres opsional.** Tanpa `DATABASE_URL`, layanan tetap menyala dengan
 *    tingkat 2 berstatus `unavailable`. Backend yang menolak boot karena cache
 *    tidak ada akan mati persis pada keadaan yang seluruh fallback ini dibuat
 *    untuk bertahan; `/api/health` yang melaporkan cache tidak ada jauh lebih
 *    berguna daripada proses yang tidak pernah menjawab.
 * 2. **Kegagalan skema tidak menjatuhkan boot.** `ensureSchema` yang gagal
 *    (Postgres belum siap, izin kurang) mencabut tingkat 2, bukan seluruh API.
 * 3. **Adapter `node:http` ditulis sendiri.** Menambah dependensi hanya untuk
 *    ~30 baris jembatan `IncomingMessage` ke `Request` tidak sepadan; `app.fetch`
 *    adalah antarmuka standar dan itu semua yang dibutuhkan.
 *
 * `RPC_URL` wajib di-override: default SDK memakai domain `binance.org` yang
 * diblokir dari Indonesia. `loadConfig()` sudah memakai endpoint yang benar.
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
 * Pesan galat yang aman untuk klien.
 *
 * `redact` bukan hiasan: jaring terakhir di bawah menangkap galat yang tidak
 * pernah melewati penyuntingan mana pun, dan pesan galat klien HTTP pernah
 * membawa URL beserta kredensialnya. Aturan "API key tidak pernah muncul di
 * respons" tidak boleh punya pengecualian yang kebetulan.
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
 * Rakit seluruh layanan dari environment. Mengembalikan `close` supaya proses
 * yang menerima SIGTERM bisa menutup kolam koneksi alih-alih meninggalkannya.
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
    // Best-effort: skema yang gagal dibuat mencabut tingkat 2, bukan seluruh API.
    void ensureSchema(dbHandle.db).catch((err: unknown) => {
      console.error("[fugugent] ensureSchema gagal, cache dilewati:", describe(err));
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
// Jembatan node:http ke Fetch API
// ---------------------------------------------------------------------------

/**
 * `IncomingMessage` → `Request`, atau alasan kenapa permintaannya tidak sah.
 *
 * `Host` yang cacat (`Host: bad host`) membuat `new URL` melempar. Itu
 * kesalahan **klien**, bisa dipicu siapa saja tanpa autentikasi, dan
 * membiarkannya jatuh ke jaring terakhir berarti 500 — mengotori metrik 5xx
 * dengan permintaan yang tidak pernah salah di sisi kita. Karena itu ia
 * dibedakan di sini dan dijawab 400.
 */
export function toRequest(req: IncomingMessage): { request: Request } | { badRequest: string } {
  const host = req.headers.host ?? "localhost";
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${host}`);
  } catch {
    return { badRequest: "header Host atau target permintaan tidak sah" };
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  // Backend ini hanya membaca; tidak ada rute yang punya badan permintaan.
  return { request: new Request(url, { method: req.method ?? "GET", headers }) };
}

export async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    // `Set-Cookie` adalah satu-satunya header yang tidak boleh digabung dengan
    // koma, dan `forEach` menyajikannya sudah tergabung. `getSetCookie()`
    // mengembalikan tiap nilai utuh; tanpa itu hanya yang terakhir yang lolos.
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;

  res.writeHead(response.status, headers);
  res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()));
}

/** Handler `node:http` untuk sebuah aplikasi Fetch. Diekspor supaya bisa diuji. */
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
        // Jaring terakhir. Tetap JSON: klien ini tidak bisa membaca apa pun lain.
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
      `[fugugent] api mendengarkan di :${port} - chain ${built.config.chainId}, ` +
        `cache ${built.hasCache ? "aktif" : "tidak dipasang"}`,
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
 * Hanya menyala bila berkas ini yang dijalankan. Meng-`import` modul ini dari
 * test tidak boleh pernah membuka port.
 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  startServer();
}
