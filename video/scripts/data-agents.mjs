#!/usr/bin/env node
/**
 * The numbers and words the agents film shows, read live and dated.
 *
 * Every agent output on screen is a real answer from api.hellofugu.xyz at the moment
 * this ran, and every name and price comes from the FuguRegistry listings on BSC
 * testnet. The file records when, so the film never shows a number without a date
 * behind it. Run it again before rendering a new cut.
 *
 *   node scripts/data-agents.mjs   ->  src/agents/data.json
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";
import { bscTestnet } from "viem/chains";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.hellofugu.xyz";
const REG = "0xb2f36070E6eae3353E8e755172B477DF213ae248";
const REP = "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400";
const TEAM = "0x56a2950dde6b1040d1dcc4b4c4fc314bd56efb0e";
const GUARDIAN = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0";
const GUARDIAN_KEY = "0x1a64e047eee99ee93787c6418709a907c1501693ae24ccaba864ff7aaec79b2c";
const CAT = ["REBALANCING", "GRID", "YIELD", "HEALTH_FACTOR", "HIRING", "COMMERCE", "AUTONOMOUS", "STREAMING", "TREASURY"];

const get = async (p) => {
  const r = await fetch(`${API}${p}`);
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
};
const c = createPublicClient({ chain: bscTestnet, transport: http("https://bsc-testnet.rpc.sentio.xyz") });
const abi = parseAbi([
  "function listingCount() view returns (uint256)",
  "function getListing(uint256) view returns ((uint256 erc8004AgentId,address owner,address agentWallet,uint8 category,uint128 priceUsd8PerPeriod,uint32 periodSeconds,bool active,bool curated,string metadataURI))",
  "function reviewCount(uint256) view returns (uint256)",
]);
const metaName = (uri) => {
  try {
    return JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString()).name ?? null;
  } catch {
    return null;
  }
};

const n = await c.readContract({ address: REG, abi, functionName: "listingCount" });
const listings = [];
for (let i = 1n; i <= n; i++) {
  const l = await c.readContract({ address: REG, abi, functionName: "getListing", args: [i] });
  const id = `97:${l.erc8004AgentId}`;
  let name = l.metadataURI.startsWith("data:") ? metaName(l.metadataURI) : null;
  if (!name) name = (await get(`/api/agents/${encodeURIComponent(id)}`).catch(() => null))?.agent?.name ?? `Agent #${l.erc8004AgentId}`;
  listings.push({
    listingId: Number(i),
    id,
    name,
    category: CAT[l.category],
    price: Number(l.priceUsd8PerPeriod) / 1e8,
    periodSeconds: l.periodSeconds,
    ours: l.owner.toLowerCase() === TEAM,
    reviews: Number(await c.readContract({ address: REP, abi, functionName: "reviewCount", args: [i] })),
  });
}

const [stats, categories, watch, quote, keycheck, tally] = await Promise.all([
  get("/api/stats"),
  get("/api/categories"),
  get(`/api/run/watch?wallet=${GUARDIAN}`),
  get("/api/run/quote?usd=1"),
  get(`/api/run/keycheck?account=${GUARDIAN}&keyHash=${GUARDIAN_KEY}`),
  get(`/api/run/tally?wallet=${TEAM}`),
]);
const scout = {};
for (const cat of ["YIELD", "GRID", "REBALANCING", "HEALTH_FACTOR"]) {
  scout[cat] = (await get(`/api/run/scout?category=${cat}&limit=3`)).picks.map((p) => p.name);
}

const data = {
  readAt: new Date().toISOString(),
  note: "Live reads for the agents film. Agent outputs are /api/run answers at readAt; listings are FuguRegistry state on BSC testnet.",
  stats: { listings: stats.listings, ours: stats.ourListings, others: stats.otherListings, builders: stats.otherBuilders, hiresByOthers: stats.hiresByOthers, hirers: stats.hirers },
  categories: Object.fromEntries(categories.categories.map((x) => [x.category, x.count])),
  registryAgents: categories.categories.reduce((s, x) => s + x.count, 0),
  listings,
  outputs: {
    watch: { wallet: GUARDIAN, healthFactor: watch.healthFactor, says: watch.says, block: watch.blockNumber },
    quote: { usd: 1, tbnb: quote.amountTbnb, bnbUsd: Number(quote.bnbPriceUsd8) / 1e8, block: quote.blockNumber },
    keycheck: { valid: keycheck.valid, block: keycheck.blockNumber },
    tally: { hires: tally.hires, spentTbnb: tally.spentTbnb, block: tally.blockNumber },
    scout,
  },
  guardianProof: {
    tx: "0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc",
    hfBefore: "1.14",
    hfAfter: "1.50",
    repaid: "$4.03",
    block: 129852222,
  },
};
writeFileSync(join(ROOT, "src/agents/data.json"), JSON.stringify(data, null, 2) + "\n");
console.log(`src/agents/data.json: ${listings.length} listings, read ${data.readAt}`);
console.log(JSON.stringify({ stats: data.stats, outputs: { ...data.outputs, scout: Object.keys(scout).length } }, null, 1));
