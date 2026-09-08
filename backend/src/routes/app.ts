/**
 * Perakitan aplikasi HTTP. Murni fungsi dari dependensi ke `Hono` — tidak
 * membuka koneksi, tidak membaca environment, tidak menyalakan server.
 *
 * Itu yang membuat seluruh kontrak HTTP bisa diuji lewat `app.request(...)`
 * tanpa menyentuh jaringan, Postgres, atau RPC; `src/index.ts` yang mengurus
 * dunia nyata.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AgentService } from "../service/agents.js";
import { createAgentRoutes } from "./agents.js";
import { createHealthRoutes } from "./health.js";

export interface ApiDeps {
  service: AgentService;
  /** Disuntikkan supaya cap waktu amplop kegagalan deterministik di test. */
  now?: () => Date;
}

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  // Marketplace dilayani dari domain lain (`app.fugugent.xyz` → `api.fugugent.xyz`).
  // Hanya GET: backend ini tidak punya satu pun endpoint yang mengubah keadaan.
  app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

  app.route("/api", createAgentRoutes(deps));
  app.route("/api", createHealthRoutes(deps));

  // JSON di semua jalur, termasuk yang salah: klien ini hanya bisa membaca JSON,
  // dan halaman HTML "Not Found" akan sampai kepadanya sebagai galat parse yang
  // membingungkan alih-alih sebagai 404 yang jelas.
  app.notFound((c) =>
    c.json({ error: "not_found", message: `tidak ada rute ${c.req.method} ${c.req.path}` }, 404),
  );

  app.onError((err, c) => {
    // Kegagalan upstream sudah ditangani di tiap handler; sampai di sini berarti
    // cacat di kode kita sendiri. Tetap tanpa stack trace dan tanpa kredensial.
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return c.json({ error: "internal_error", message }, 500);
  });

  return app;
}
