#!/usr/bin/env node
/**
 * The facts a "New on HelloFugu" spotlight shows, read from the chain and dated.
 *
 * For each listing: its name, description and endpoint from the ERC-8004 registration
 * file, its price and kind from FuguRegistry, its hires and ratings, and whether its
 * endpoint answered when this ran. A spotlight is only rendered for an agent whose
 * endpoint answered: promoting one that is down sends people to a dead end.
 *
 *   node scripts/data-spotlight.mjs 26 27 28   ->  src/spotlight/data.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";
import { bscTestnet } from "viem/chains";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.hellofugu.xyz";
const REG = "0xb2f36070E6eae3353E8e755172B477DF213ae248";
const REP = "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400";
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const CAT = ["REBALANCING", "GRID", "YIELD", "HEALTH_FACTOR", "HIRING", "COMMERCE", "AUTONOMOUS", "STREAMING", "TREASURY"];

const ids = process.argv.slice(2).map(Number).filter(Boolean);
if (!ids.length) throw new Error("usage: data-spotlight.mjs <listingId> [...]");

const c = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet.rpc.sentio.xyz") });
const abi = parseAbi([
  "function getListing(uint256) view returns ((uint256 erc8004AgentId,address owner,address agentWallet,uint8 category,uint128 priceUsd8PerPeriod,uint32 periodSeconds,bool active,bool curated,string metadataURI))",
  "function reviewCount(uint256) view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
  "function subCount() view returns (uint256)",
  "function getSub(uint256) view returns ((uint256 listingId,address subscriber,address payToken,uint128 deposited,uint128 claimed,uint64 startedAt,uint64 endsAt,bool cancelled,uint16 feeBps))",
]);
const SUB = "0xfdb083371f44Cf53181350389D3217e51B431776";

async function registration(uri) {
  if (uri.startsWith("data:")) return JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return r.json();
}

/** Did the agent's endpoint answer? Any response below 500 counts; a timeout does not. */
async function probe(endpoint) {
  if (!endpoint) return { ok: false, status: null };
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 HelloFugu spotlight check" } });
    return { ok: r.status < 500, status: r.status };
  } catch (e) {
    return { ok: false, status: String(e.cause?.code ?? e.name) };
  }
}

const tracking = await fetch(`${API}/api/tracking`).then((r) => r.json()).catch(() => null);
const team = new Set((tracking?.teamWallets ?? []).map((w) => (w.address ?? w).toLowerCase()));

// Every hire, once: who hired which listing. Hires by team wallets are left out.
const subCount = Number(await c.readContract({ address: SUB, abi, functionName: "subCount" }));
const subs = (
  await c.multicall({
    contracts: Array.from({ length: subCount }, (_, i) => ({ address: SUB, abi, functionName: "getSub", args: [BigInt(i + 1)] })),
    allowFailure: false,
  })
).filter((s) => !team.has(s.subscriber.toLowerCase()));

const agents = [];
for (const id of ids) {
  const l = await c.readContract({ address: REG, abi, functionName: "getListing", args: [BigInt(id)] });
  const uri = await c.readContract({ address: IDENTITY, abi, functionName: "tokenURI", args: [l.erc8004AgentId] });
  const reg = await registration(uri);
  const service = (reg.services ?? reg.endpoints ?? []).find((s) => s.name !== "repo") ?? {};
  const repo = (reg.services ?? []).find((s) => s.name === "repo")?.endpoint ?? null;
  const hired = subs.filter((s) => s.listingId === BigInt(id));
  const endpoint = service.endpoint ?? null;
  agents.push({
    listingId: id,
    id: `97:${l.erc8004AgentId}`,
    name: reg.name,
    description: reg.description,
    category: CAT[l.category],
    price: Number(l.priceUsd8PerPeriod) / 1e8,
    periodSeconds: l.periodSeconds,
    owner: l.owner,
    ours: team.has(l.owner.toLowerCase()),
    active: l.active,
    service: service.name ?? null,
    endpoint,
    repo,
    reviews: Number(await c.readContract({ address: REP, abi, functionName: "reviewCount", args: [BigInt(id)] })),
    hires: hired.length,
    hirers: new Set(hired.map((s) => s.subscriber.toLowerCase())).size,
    probe: await probe(endpoint),
  });
}

mkdirSync(join(ROOT, "src/spotlight"), { recursive: true });
const data = { readAt: new Date().toISOString(), note: "FuguRegistry and ERC-8004 state on BSC testnet at readAt; probe is one GET to the agent's endpoint.", agents };
writeFileSync(join(ROOT, "src/spotlight/data.json"), JSON.stringify(data, null, 2) + "\n");
for (const a of agents) console.log(`#${a.listingId} ${a.id} ${a.name} | ${a.category} $${a.price}/${a.periodSeconds}s | ${a.service} ${a.endpoint} -> ${a.probe.status} ${a.probe.ok ? "OK" : "DOWN"} | repo ${a.repo ?? "-"} | hires ${a.hires} from ${a.hirers} | reviews ${a.reviews}${a.ours ? " | OURS" : ""}`);
