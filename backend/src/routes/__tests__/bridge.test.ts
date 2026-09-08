/**
 * Jembatan `node:http` di `src/index.ts`.
 *
 * Ditulis tangan supaya tidak perlu menambah dependensi, dan justru karena itu
 * ia harus diuji terhadap server sungguhan alih-alih terhadap objek palsu:
 * yang bisa salah di sini adalah hal-hal yang hanya muncul di kawat — `Host`
 * cacat, header yang tidak boleh digabung, dan galat yang lolos ke jaring
 * terakhir.
 *
 * Servernya mendengarkan di `127.0.0.1:0` (port pinjaman), tidak menyentuh
 * jaringan luar, Postgres, maupun RPC.
 */
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRequestListener, describeFailure } from "../../index.js";

const SECRET = "sk-RAHASIA-123";

let running: Server | null = null;

afterEach(async () => {
  if (running === null) return;
  const server = running;
  running = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Nyalakan server di port pinjaman dengan aplikasi Fetch tiruan. */
async function serve(fetchImpl: (request: Request) => Response | Promise<Response>): Promise<number> {
  const server = createServer(createRequestListener({ fetch: fetchImpl }));
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port tidak diketahui");
  return address.port;
}

/**
 * Kirim permintaan HTTP mentah. Dibutuhkan karena `fetch` menolak menyusun
 * `Host` yang cacat — padahal justru itu yang harus diuji.
 */
function rawRequest(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
    let out = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      out += chunk;
    });
    socket.on("end", () => resolve(out));
    socket.on("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
  });
}

describe("jembatan node:http", () => {
  it("Host cacat dijawab 400, bukan 500", async () => {
    const port = await serve(() => new Response("tidak boleh sampai sini"));
    const raw = await rawRequest(port, ["GET / HTTP/1.1", "Host: bad host", "Connection: close"]);

    // Ini kesalahan klien, bisa dipicu siapa saja tanpa autentikasi. 500 akan
    // mengotori metrik 5xx dengan permintaan yang tidak pernah salah di sisi kita.
    expect(raw).toContain("HTTP/1.1 400");
    expect(raw).not.toContain("HTTP/1.1 500");
    expect(raw).toContain("bad_request");
  });

  it("permintaan biasa tetap lewat", async () => {
    const port = await serve((request) =>
      Response.json({ path: new URL(request.url).pathname, method: request.method }),
    );
    const res = await fetch(`http://127.0.0.1:${port}/api/agents?category=GRID`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/api/agents", method: "GET" });
  });

  it("beberapa Set-Cookie tetap terpisah, tidak menyatu jadi satu", async () => {
    const port = await serve(() => {
      const headers = new Headers();
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return new Response("ok", { headers });
    });
    const res = await fetch(`http://127.0.0.1:${port}/`);

    // Gagal bila `writeResponse` kembali menimpa `headers["set-cookie"]`
    // di tiap iterasi `forEach` — dulu hanya nilai terakhir yang lolos.
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("header biasa yang ganda tetap utuh", async () => {
    const port = await serve(() => {
      const headers = new Headers();
      headers.append("x-dup", "1");
      headers.append("x-dup", "2");
      return new Response("ok", { headers });
    });
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.headers.get("x-dup")).toBe("1, 2");
  });

  it("aplikasi yang melempar menjadi 500 JSON tanpa kredensial", async () => {
    const port = await serve(() => {
      throw new Error(`GET https://api.8004scan.io/api/v1/agents?api_key=${SECRET} gagal`);
    });
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const raw = await res.text();

    expect(res.status).toBe(500);
    // Gagal bila `describeFailure` di `index.ts` berhenti memanggil `redact`.
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain("[redacted]");
    expect(JSON.parse(raw).error).toBe("internal_error");
  });

  it("badan kosong dan status 204 diteruskan apa adanya", async () => {
    const port = await serve(() => new Response(null, { status: 204 }));
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("HEAD tidak membawa badan", async () => {
    const port = await serve(() => Response.json({ ada: true }));
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("describeFailure", () => {
  it("menyunting api key dan memotong stack trace", () => {
    const message = describeFailure(
      new Error(`fetch gagal: https://api.8004scan.io?api_key=${SECRET}\n  at somewhere`),
    );

    expect(message).not.toContain(SECRET);
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("at somewhere");
  });

  it("aman untuk nilai yang bukan Error", () => {
    expect(describeFailure("gagal biasa")).toBe("gagal biasa");
  });
});
