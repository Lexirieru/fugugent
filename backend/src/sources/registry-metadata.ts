/**
 * Turns an ERC-8004 `agentURI` into a registration file — **safely**.
 *
 * The URI is chosen by whoever registered the agent, and this server fetches it.
 * That makes every rule below a security rule first and a data rule second:
 * without them, anyone could register an agent whose URI points at our own
 * Postgres, at the cloud metadata endpoint, or at a 2 GB file, and our indexer
 * would dutifully go and read it.
 *
 * ## What is fetched, and what is not
 *
 * | URI | What happens |
 * |---|---|
 * | `data:application/json[;base64],…` | decoded in place, nothing fetched |
 * | raw JSON (`{"name":…}`) | parsed in place — 49 real agents register this way |
 * | `https://…` | fetched, under every guard below |
 * | `ipfs://<cid>` | fetched through one public gateway |
 * | `http://…`, `ar://…`, `"my-twin"`, anything else | **not fetched** — `unsupported` |
 *
 * ## The guards on a fetch
 *
 * 1. **HTTPS only.** Plain `http://` is refused rather than upgraded: an owner
 *    who published over HTTP did not publish over HTTPS, and guessing is how a
 *    card ends up showing somebody else's file.
 * 2. **No private destinations.** IP-literal hosts are refused outright, and a
 *    hostname is resolved first and refused if *any* address it resolves to is
 *    loopback, private, link-local, or otherwise not public. Known gap, stated
 *    rather than hidden: the resolution and the fetch are two lookups, so a DNS
 *    server that answers differently the second time (rebinding) is not stopped
 *    by this check alone.
 * 3. **Redirects are followed by hand**, at most three, and every hop passes the
 *    same checks. An automatic redirect would carry the request to wherever the
 *    first server says, which is the whole attack.
 * 4. **A time limit and a size limit.** 5 seconds, 256 KiB; the body is read as
 *    a stream and abandoned at the limit instead of being buffered first.
 *
 * This module never throws. Every failure is a {@link MetadataStatus} plus a
 * reason, because "the owner's server is down" is a fact about the agent the
 * page should state, not an exception.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AgentEndpoint, MetadataStatus } from "../types.js";

/** One public gateway. The CID is content-addressed, so which gateway does not change what is read. */
export const IPFS_GATEWAY = "https://ipfs.io/ipfs/";
export const METADATA_TIMEOUT_MS = 5_000;
export const METADATA_MAX_BYTES = 256 * 1024;
export const METADATA_MAX_REDIRECTS = 3;

/** A registration file after parsing: the fields the marketplace reads, nothing more. */
export interface RegistrationFile {
  name: string | null;
  description: string | null;
  image: string | null;
  endpoints: AgentEndpoint[];
  /** OASF skills/domains declared on an `OASF` endpoint, if any. */
  skills: string[];
  domains: string[];
  tags: string[];
  /** ERC-8004 `active`. Absent means active: the field is optional in the spec. */
  active: boolean;
  x402Support: boolean;
}

export interface ResolvedMetadata {
  status: MetadataStatus;
  reason: string | null;
  file: RegistrationFile | null;
}

/** Resolves a hostname to every address it has. Injected so tests never touch DNS. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export interface MetadataResolverOptions {
  fetchImpl?: typeof fetch;
  resolveHost?: HostResolver;
  timeoutMs?: number;
  maxBytes?: number;
}

const defaultResolveHost: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isNonPublicIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/**
 * `true` for any address a server-side fetch must not reach. Deliberately
 * conservative: an IPv6 address is public only if it is global unicast
 * (`2000::/3`) and not an IPv4-mapped form of a private address.
 */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isNonPublicIpv4(address);
  if (family !== 6) return true;

  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped !== null) return isNonPublicIpv4(mapped[1]!);
  const first = Number.parseInt(lower.split(":")[0] || "0", 16);
  return !(first >= 0x2000 && first <= 0x3fff);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function stringList(value: unknown, max = 32): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 120))
    .filter((item): item is string => item !== null)
    .slice(0, max);
}

/**
 * ERC-8004 registration files name their endpoint list `endpoints` in the
 * version BNB Agent Studio emits and `services` in later drafts. Both are read;
 * neither is required.
 */
function parseEndpoints(file: Record<string, unknown>): {
  endpoints: AgentEndpoint[];
  skills: string[];
  domains: string[];
} {
  const endpoints: AgentEndpoint[] = [];
  const skills: string[] = [];
  const domains: string[] = [];
  const entries = [
    ...(Array.isArray(file.endpoints) ? file.endpoints : []),
    ...(Array.isArray(file.services) ? file.services : []),
  ];
  for (const entry of entries.slice(0, 16)) {
    if (!isPlainObject(entry)) continue;
    const name = text(entry.name ?? entry.type, 40);
    const endpoint = text(entry.endpoint ?? entry.url, 512);
    if (name === null || endpoint === null) continue;
    endpoints.push({ name, endpoint, version: text(entry.version, 40) });
    if (name.toUpperCase() === "OASF") {
      skills.push(...stringList(entry.skills));
      domains.push(...stringList(entry.domains));
    }
  }
  return { endpoints, skills, domains };
}

/** A parsed JSON value to a registration file, or `null` when it is not an object. */
export function toRegistrationFile(json: unknown): RegistrationFile | null {
  if (!isPlainObject(json)) return null;
  const { endpoints, skills, domains } = parseEndpoints(json);
  const image = text(json.image, 1024);
  return {
    name: text(json.name, 200),
    description: text(json.description, 4000),
    // Only an HTTPS image is passed on: the marketplace renders it in a
    // visitor's browser, and a `data:` or `javascript:` value has no business
    // reaching an `<img src>`.
    image: image !== null && image.startsWith("https://") ? image : null,
    endpoints,
    skills: [...skills, ...stringList(json.skills)].slice(0, 32),
    domains: [...domains, ...stringList(json.domains)].slice(0, 32),
    tags: stringList(json.tags),
    active: typeof json.active === "boolean" ? json.active : true,
    x402Support: json.x402support === true || json.x402Support === true,
  };
}

/**
 * Decode a URI that carries its own content. `null` means "not inline", which
 * is different from "inline but broken" (that is `invalid`).
 */
export function decodeInline(uri: string): ResolvedMetadata | null {
  let body: string;
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    if (comma < 0) return { status: "invalid", reason: "data: URI without a comma", file: null };
    const header = uri.slice(5, comma);
    const payload = uri.slice(comma + 1);
    try {
      body = header.includes(";base64")
        ? Buffer.from(payload, "base64").toString("utf8")
        : decodeURIComponent(payload);
    } catch {
      return { status: "invalid", reason: "data: URI payload could not be decoded", file: null };
    }
  } else if (uri.trimStart().startsWith("{")) {
    body = uri;
  } else {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: "invalid", reason: "inline metadata is not valid JSON", file: null };
  }
  const file = toRegistrationFile(json);
  return file === null
    ? { status: "invalid", reason: "inline metadata is not a JSON object", file: null }
    : { status: "inline", reason: null, file };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type UrlCheck = { ok: true; url: URL } | { ok: false; status: MetadataStatus; reason: string };

async function checkUrl(raw: string, resolveHost: HostResolver): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: "unsupported", reason: "not a URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, status: "unsupported", reason: `${url.protocol} is not fetched, only https:` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, status: "refused", reason: "URL carries credentials" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    return { ok: false, status: "refused", reason: "IP-literal hosts are not fetched" };
  }
  const lowered = host.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered.endsWith(".local") || lowered.endsWith(".internal")) {
    return { ok: false, status: "refused", reason: `${host} is not a public host` };
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    return { ok: false, status: "unreachable", reason: `${host} does not resolve` };
  }
  if (addresses.length === 0 || addresses.some(isNonPublicAddress)) {
    return { ok: false, status: "refused", reason: `${host} resolves to a non-public address` };
  }
  return { ok: true, url };
}

/** Read at most `maxBytes` of a body; `null` when it is larger. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface MetadataResolver {
  resolve(agentURI: string): Promise<ResolvedMetadata>;
}

export function createMetadataResolver(options: MetadataResolverOptions = {}): MetadataResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? METADATA_MAX_BYTES;

  async function fetchJson(start: string): Promise<ResolvedMetadata> {
    let target = start;
    const signal = AbortSignal.timeout(timeoutMs);
    for (let hop = 0; hop <= METADATA_MAX_REDIRECTS; hop++) {
      const check = await checkUrl(target, resolveHost);
      if (!check.ok) return { status: check.status, reason: check.reason, file: null };

      let response: Response;
      try {
        response = await fetchImpl(check.url, {
          redirect: "manual",
          signal,
          headers: { accept: "application/json" },
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "Error";
        return {
          status: "unreachable",
          reason: name === "TimeoutError" || name === "AbortError" ? `no answer within ${timeoutMs} ms` : `request failed (${name})`,
          file: null,
        };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) return { status: "unreachable", reason: `HTTP ${response.status} without a Location`, file: null };
        target = new URL(location, check.url).toString();
        continue;
      }
      if (!response.ok) return { status: "unreachable", reason: `HTTP ${response.status}`, file: null };

      let body: string | null;
      try {
        body = await readCapped(response, maxBytes);
      } catch {
        return { status: "unreachable", reason: "the body could not be read", file: null };
      }
      if (body === null) return { status: "invalid", reason: `larger than ${maxBytes} bytes`, file: null };

      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return { status: "invalid", reason: "the response is not JSON", file: null };
      }
      const file = toRegistrationFile(json);
      return file === null
        ? { status: "invalid", reason: "the response is not a JSON object", file: null }
        : { status: "fetched", reason: null, file };
    }
    return { status: "refused", reason: `more than ${METADATA_MAX_REDIRECTS} redirects`, file: null };
  }

  return {
    async resolve(agentURI: string): Promise<ResolvedMetadata> {
      const uri = agentURI.trim();
      if (uri === "") return { status: "empty", reason: "the registry holds an empty agentURI", file: null };

      const inline = decodeInline(uri);
      if (inline !== null) return inline;

      if (uri.startsWith("ipfs://")) {
        const path = uri.slice("ipfs://".length).replace(/^ipfs\//, "");
        if (!/^[A-Za-z0-9]+(\/[A-Za-z0-9._\-/]*)?$/.test(path)) {
          return { status: "unsupported", reason: "malformed ipfs:// URI", file: null };
        }
        return fetchJson(`${IPFS_GATEWAY}${path}`);
      }
      if (/^https?:\/\//i.test(uri)) return fetchJson(uri);
      return { status: "unsupported", reason: "neither a URL nor inline JSON", file: null };
    },
  };
}
