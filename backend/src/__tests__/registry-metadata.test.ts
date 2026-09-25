import { describe, expect, it } from "vitest";
import {
  createMetadataResolver,
  decodeInline,
  isNonPublicAddress,
  toRegistrationFile,
  type HostResolver,
} from "../sources/registry-metadata.js";

const PUBLIC_HOST: HostResolver = async () => ["93.184.216.34"];

function b64(json: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

/** A fetch that records every URL it was asked for and answers from a table. */
function fakeFetch(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const route = routes[url];
    if (route === undefined) throw new TypeError(`unexpected fetch ${url}`);
    return route();
  }) as typeof fetch;
  return { impl, seen };
}

describe("isNonPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "not-an-ip",
  ])("refuses %s", (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false);
    },
  );
});

describe("decodeInline", () => {
  it("decodes a base64 data: URI", () => {
    const out = decodeInline(b64({ name: "Grid Runner", description: "grid trading bot" }));
    expect(out?.status).toBe("inline");
    expect(out?.file?.name).toBe("Grid Runner");
  });

  it("decodes a percent-encoded data: URI", () => {
    const out = decodeInline(`data:application/json,${encodeURIComponent('{"name":"Plain"}')}`);
    expect(out?.file?.name).toBe("Plain");
  });

  it("parses raw JSON stored as the URI itself", () => {
    expect(decodeInline('{"active":true,"name":"Raw"}')?.file?.name).toBe("Raw");
  });

  it("says invalid, not absent, for inline content that is broken", () => {
    expect(decodeInline("data:application/json;base64,!!!notjson")?.status).toBe("invalid");
    expect(decodeInline("[1,2,3]")).toBeNull();
    expect(decodeInline('{"unterminated"')?.status).toBe("invalid");
  });

  it("returns null for anything that is not inline", () => {
    expect(decodeInline("https://example.com/agent.json")).toBeNull();
    expect(decodeInline("my-twin")).toBeNull();
  });
});

describe("toRegistrationFile", () => {
  it("reads endpoints from both `endpoints` and `services`, and OASF skills", () => {
    const file = toRegistrationFile({
      name: "A",
      endpoints: [{ name: "A2A", endpoint: "https://a.example/.well-known/agent-card.json", version: "0.3.0" }],
      services: [{ name: "OASF", endpoint: "https://oasf.example", skills: ["defi"], domains: ["finance"] }],
    });
    expect(file?.endpoints.map((e) => e.name)).toEqual(["A2A", "OASF"]);
    expect(file?.skills).toEqual(["defi"]);
    expect(file?.domains).toEqual(["finance"]);
  });

  it("passes on only an https image", () => {
    expect(toRegistrationFile({ image: "https://img.example/a.png" })?.image).toBe("https://img.example/a.png");
    expect(toRegistrationFile({ image: "javascript:alert(1)" })?.image).toBeNull();
    expect(toRegistrationFile({ image: "data:image/png;base64,AAAA" })?.image).toBeNull();
  });

  it("defaults `active` to true and truncates an oversized name", () => {
    const file = toRegistrationFile({ name: "x".repeat(500) });
    expect(file?.active).toBe(true);
    expect(file?.name?.length).toBe(200);
  });
});

describe("createMetadataResolver", () => {
  it("names an empty URI as empty", async () => {
    const out = await createMetadataResolver({ resolveHost: PUBLIC_HOST }).resolve("  ");
    expect(out.status).toBe("empty");
  });

  it("does not fetch http:, bare words, or other schemes", async () => {
    const { impl, seen } = fakeFetch({});
    const resolver = createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST });
    for (const uri of ["http://example.com/a.json", "my-twin", "ar://abc", "rune-twin://x"]) {
      expect((await resolver.resolve(uri)).status).toBe("unsupported");
    }
    expect(seen).toEqual([]);
  });

  it("fetches https and parses the registration file", async () => {
    const { impl } = fakeFetch({
      "https://agent.example/reg.json": () => jsonResponse({ name: "Yield Router", description: "yield farming" }),
    });
    const out = await createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST }).resolve(
      "https://agent.example/reg.json",
    );
    expect(out.status).toBe("fetched");
    expect(out.file?.name).toBe("Yield Router");
  });

  it("goes through the IPFS gateway for ipfs://", async () => {
    const { impl, seen } = fakeFetch({
      "https://ipfs.io/ipfs/bafyabc/reg.json": () => jsonResponse({ name: "On IPFS" }),
    });
    const out = await createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST }).resolve(
      "ipfs://bafyabc/reg.json",
    );
    expect(out.file?.name).toBe("On IPFS");
    expect(seen).toEqual(["https://ipfs.io/ipfs/bafyabc/reg.json"]);
  });

  it("refuses an IP-literal host without fetching", async () => {
    const { impl, seen } = fakeFetch({});
    const resolver = createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST });
    expect((await resolver.resolve("https://169.254.169.254/latest/meta-data")).status).toBe("refused");
    expect((await resolver.resolve("https://[::1]/x")).status).toBe("refused");
    expect(seen).toEqual([]);
  });

  it("refuses a hostname that resolves to a private address", async () => {
    const { impl, seen } = fakeFetch({});
    const resolver = createMetadataResolver({
      fetchImpl: impl,
      resolveHost: async () => ["93.184.216.34", "10.0.0.5"],
    });
    const out = await resolver.resolve("https://sneaky.example/reg.json");
    expect(out.status).toBe("refused");
    expect(seen).toEqual([]);
  });

  it("refuses localhost-style names and URLs with credentials", async () => {
    const resolver = createMetadataResolver({ resolveHost: PUBLIC_HOST });
    expect((await resolver.resolve("https://localhost/x")).status).toBe("refused");
    expect((await resolver.resolve("https://db.internal/x")).status).toBe("refused");
    expect((await resolver.resolve("https://user:pw@agent.example/x")).status).toBe("refused");
  });

  it("re-checks every redirect hop and refuses one into a private network", async () => {
    const { impl, seen } = fakeFetch({
      "https://agent.example/reg.json": () =>
        new Response(null, { status: 302, headers: { location: "https://internal.example/secret" } }),
    });
    const resolver = createMetadataResolver({
      fetchImpl: impl,
      resolveHost: async (host) => (host === "internal.example" ? ["192.168.0.10"] : ["93.184.216.34"]),
    });
    const out = await resolver.resolve("https://agent.example/reg.json");
    expect(out.status).toBe("refused");
    expect(seen).toEqual(["https://agent.example/reg.json"]);
  });

  it("follows a safe redirect", async () => {
    const { impl } = fakeFetch({
      "https://agent.example/reg.json": () =>
        new Response(null, { status: 301, headers: { location: "/v2/reg.json" } }),
      "https://agent.example/v2/reg.json": () => jsonResponse({ name: "Moved" }),
    });
    const out = await createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST }).resolve(
      "https://agent.example/reg.json",
    );
    expect(out.file?.name).toBe("Moved");
  });

  it("stops after too many redirects", async () => {
    const { impl } = fakeFetch({
      "https://agent.example/loop": () => new Response(null, { status: 302, headers: { location: "/loop" } }),
    });
    const out = await createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST }).resolve(
      "https://agent.example/loop",
    );
    expect(out.status).toBe("refused");
  });

  it("abandons a body larger than the cap", async () => {
    const { impl } = fakeFetch({
      "https://agent.example/big.json": () => new Response(`{"name":"${"x".repeat(2000)}"}`),
    });
    const out = await createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST, maxBytes: 1000 }).resolve(
      "https://agent.example/big.json",
    );
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("1000");
  });

  it("reports an error status and a network failure as unreachable", async () => {
    const { impl } = fakeFetch({
      "https://agent.example/404": () => new Response("nope", { status: 404 }),
    });
    const resolver = createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST });
    expect(await resolver.resolve("https://agent.example/404")).toMatchObject({ status: "unreachable", reason: "HTTP 404" });
    expect((await resolver.resolve("https://agent.example/missing")).status).toBe("unreachable");
  });

  it("says invalid for a non-JSON answer", async () => {
    const { impl } = fakeFetch({ "https://agent.example/page": () => new Response("<html></html>") });
    const out = await createMetadataResolver({ fetchImpl: impl, resolveHost: PUBLIC_HOST }).resolve(
      "https://agent.example/page",
    );
    expect(out.status).toBe("invalid");
  });

  it("reports a host that does not resolve as unreachable", async () => {
    const out = await createMetadataResolver({
      resolveHost: async () => {
        throw new Error("ENOTFOUND");
      },
    }).resolve("https://gone.example/reg.json");
    expect(out.status).toBe("unreachable");
  });
});
