/**
 * The `node:http` bridge in `src/index.ts`.
 *
 * Hand-written to avoid adding a dependency, and precisely for that reason it
 * must be tested against a real server rather than against a fake object: what
 * can go wrong here only shows up on the wire — a malformed `Host`, a header
 * that must not be joined, and an error escaping to the last-resort net.
 *
 * The server listens on `127.0.0.1:0` (a borrowed port) and touches no external
 * network, no Postgres, and no RPC.
 */
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRequestListener, describeFailure } from "../../index.js";

const SECRET = "sk-SECRET-123";

let running: Server | null = null;

afterEach(async () => {
  if (running === null) return;
  const server = running;
  running = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Start a server on a borrowed port with a stand-in Fetch application. */
async function serve(fetchImpl: (request: Request) => Response | Promise<Response>): Promise<number> {
  const server = createServer(createRequestListener({ fetch: fetchImpl }));
  running = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("unknown port");
  return address.port;
}

/**
 * Send a raw HTTP request. Needed because `fetch` refuses to build a malformed
 * `Host` — which is exactly what has to be tested.
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

describe("the node:http bridge", () => {
  it("a malformed Host is answered with 400, not 500", async () => {
    const port = await serve(() => new Response("must not reach here"));
    const raw = await rawRequest(port, ["GET / HTTP/1.1", "Host: bad host", "Connection: close"]);

    // This is a client error, triggerable by anyone without authentication. A 500
    // would pollute the 5xx metrics with requests that were never wrong on our side.
    expect(raw).toContain("HTTP/1.1 400");
    expect(raw).not.toContain("HTTP/1.1 500");
    expect(raw).toContain("bad_request");
  });

  it("an ordinary request still gets through", async () => {
    const port = await serve((request) =>
      Response.json({ path: new URL(request.url).pathname, method: request.method }),
    );
    const res = await fetch(`http://127.0.0.1:${port}/api/agents?category=GRID`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/api/agents", method: "GET" });
  });

  it("multiple Set-Cookie headers stay separate, not merged into one", async () => {
    const port = await serve(() => {
      const headers = new Headers();
      headers.append("set-cookie", "a=1; Path=/");
      headers.append("set-cookie", "b=2; Path=/");
      return new Response("ok", { headers });
    });
    const res = await fetch(`http://127.0.0.1:${port}/`);

    // Fails if `writeResponse` goes back to overwriting `headers["set-cookie"]`
    // on every `forEach` iteration — only the last value used to get through.
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("an ordinary duplicated header stays intact", async () => {
    const port = await serve(() => {
      const headers = new Headers();
      headers.append("x-dup", "1");
      headers.append("x-dup", "2");
      return new Response("ok", { headers });
    });
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.headers.get("x-dup")).toBe("1, 2");
  });

  it("an application that throws becomes a JSON 500 with no credentials", async () => {
    const port = await serve(() => {
      throw new Error(`GET https://api.8004scan.io/api/v1/agents?api_key=${SECRET} failed`);
    });
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const raw = await res.text();

    expect(res.status).toBe(500);
    // Fails if `describeFailure` in `index.ts` stops calling `redact`.
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain("[redacted]");
    expect(JSON.parse(raw).error).toBe("internal_error");
  });

  it("an empty body and a 204 status are passed through verbatim", async () => {
    const port = await serve(() => new Response(null, { status: 204 }));
    const res = await fetch(`http://127.0.0.1:${port}/`);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("HEAD carries no body", async () => {
    const port = await serve(() => Response.json({ present: true }));
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});

describe("describeFailure", () => {
  it("redacts the api key and trims the stack trace", () => {
    const message = describeFailure(
      new Error(`fetch failed: https://api.8004scan.io?api_key=${SECRET}\n  at somewhere`),
    );

    expect(message).not.toContain(SECRET);
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("at somewhere");
  });

  it("is safe for a value that is not an Error", () => {
    expect(describeFailure("an ordinary failure")).toBe("an ordinary failure");
  });
});
