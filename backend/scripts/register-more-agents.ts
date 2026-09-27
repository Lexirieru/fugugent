/**
 * Registers HelloFugu agents 10 to 20: an ERC-8004 identity each, then a FuguRegistry
 * listing bound to it. BSC testnet only.
 *
 *   cd backend && npx tsx scripts/register-more-agents.ts          # dry run: prints the plan
 *   cd backend && npx tsx scripts/register-more-agents.ts --send   # sends
 *
 * ## Two kinds of agent, and the listing says which
 *
 * - **Variants** run the same tested decision code as an existing Fugu agent with
 *   different settings (Guardian's thresholds are a `createGuardian` config; the other
 *   engines take their band, steps and horizon as inputs). Like their base agent, none
 *   has sent a transaction, and each listing says so.
 * - **Read-only agents** are live endpoints under `https://api.hellofugu.xyz/api/run/`
 *   (`src/routes/tools.ts`). They read the chain and sign nothing; their ERC-8004
 *   registration names the endpoint as a service.
 *
 * ## Order, per agent
 *
 * `register(draft)` → the id is read from the receipt's ERC-721 `Transfer`, never
 * predicted → `setAgentURI(final)` (the final file names its own id) → `list(id, ...)`.
 * `FuguRegistry.list` checks `ownerOf(id) == msg.sender`, so a wrong id reverts rather
 * than binding a listing to someone else's identity.
 *
 * Progress is written to `contracts/deployments/agents-10-20.json` after every
 * transaction, and a re-run resumes from it, so a failure halfway never mints twice.
 *
 * The key is read from `contracts/.env` inside this process and never printed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const PROGRESS = path.join(ROOT, "contracts/deployments/agents-10-20.json");
const SEND = process.argv.includes("--send");

const RPC = "https://bsc-testnet.rpc.sentio.xyz";
const IDENTITY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REGISTRY: Address = "0xb2f36070E6eae3353E8e755172B477DF213ae248";
const DEPLOYER: Address = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E";
const APP = "https://app.hellofugu.xyz";
const API = "https://api.hellofugu.xyz/api/run";

const CATEGORY = {
  REBALANCING: 0,
  GRID: 1,
  YIELD: 2,
  HEALTH_FACTOR: 3,
  HIRING: 4,
  COMMERCE: 5,
  AUTONOMOUS: 6,
  STREAMING: 7,
  TREASURY: 8,
} as const;
type Category = keyof typeof CATEGORY;

interface Plan {
  slug: string;
  name: string;
  category: Category;
  kind: "variant" | "read-only";
  summary: string;
  limits: string;
  verify: string;
  /** Art on hellofugu.xyz, only for variants of the four agents that have some. */
  image: string;
  /** The live endpoint of a read-only agent. */
  endpoint: string;
  priceUsd8: bigint;
}

const VARIANT_LIMITS = (base: string, dir: string) =>
  `Same tested decision code as ${base}, with different settings. Like ${base}, it has never sent a transaction, so hiring it starts nothing yet. Code: ai/${dir}.`;
const READ_ONLY_LIMITS = (what: string) =>
  `Read-only: it reads the chain and answers, and never signs or moves money. ${what} The endpoint is open to anyone; hiring pays the builder.`;

export const PLAN: Plan[] = [
  {
    slug: "guardian-early",
    name: "Fugu Guardian Early",
    category: "HEALTH_FACTOR",
    kind: "variant",
    summary: "Fugu Guardian's rules, set to act sooner. It starts paying a loan back at a health factor of 1.40 instead of 1.20, for people who would rather give up some borrowing room than cut it close.",
    limits: VARIANT_LIMITS("Fugu Guardian", "fuguguardian"),
    verify: "sed -n '49,53p' ai/fuguguardian/app/agent/src/strategy/types.ts  # the defaults this variant raises; createGuardian takes `thresholds`",
    image: "https://hellofugu.xyz/brand/guardian.svg",
    endpoint: "",
    priceUsd8: 5_000_000n,
  },
  {
    slug: "rebalancer-wide",
    name: "Fugu Rebalancer Wide",
    category: "REBALANCING",
    kind: "variant",
    summary: "Fugu Rebalancer with a wider band. It lets your mix drift further before it trades, so it trades less often and pays fewer fees.",
    limits: VARIANT_LIMITS("Fugu Rebalancer", "fugurebalancer"),
    verify: "cd ai/fugurebalancer/app/agent && pnpm test",
    image: "https://hellofugu.xyz/brand/rebalancer.svg",
    endpoint: "",
    priceUsd8: 5_000_000n,
  },
  {
    slug: "rebalancer-stable",
    name: "Fugu Rebalancer Stable",
    category: "REBALANCING",
    kind: "variant",
    summary: "Fugu Rebalancer for stablecoins only. It keeps a split between dollar tokens you choose, so no single one holds more than you meant it to.",
    limits: VARIANT_LIMITS("Fugu Rebalancer", "fugurebalancer"),
    verify: "cd ai/fugurebalancer/app/agent && pnpm test",
    image: "https://hellofugu.xyz/brand/rebalancer.svg",
    endpoint: "",
    priceUsd8: 5_000_000n,
  },
  {
    slug: "grid-wide",
    name: "Fugu Grid Wide",
    category: "GRID",
    kind: "variant",
    summary: "Fugu Grid with fewer, bigger steps. It trades less often and waits for larger moves, which suits a price that swings a lot.",
    limits: VARIANT_LIMITS("Fugu Grid", "fugugrid"),
    verify: "cd ai/fugugrid/app/agent && pnpm test",
    image: "https://hellofugu.xyz/brand/grid.svg",
    endpoint: "",
    priceUsd8: 5_000_000n,
  },
  {
    slug: "grid-tight",
    name: "Fugu Grid Tight",
    category: "GRID",
    kind: "variant",
    summary: "Fugu Grid with more, smaller steps. It trades often on small moves, which suits a price that stays inside a narrow range.",
    limits: VARIANT_LIMITS("Fugu Grid", "fugugrid"),
    verify: "cd ai/fugugrid/app/agent && pnpm test",
    image: "https://hellofugu.xyz/brand/grid.svg",
    endpoint: "",
    priceUsd8: 5_000_000n,
  },
  {
    slug: "yield-patient",
    name: "Fugu Yield Patient",
    category: "YIELD",
    kind: "variant",
    summary: "Fugu Yield for money that stays put for months. Because the cost of moving is spread over a longer stay, it will switch pools for a smaller gap in rates.",
    limits: VARIANT_LIMITS("Fugu Yield", "fuguyield"),
    verify: "cd ai/fuguyield/app/agent && pnpm test",
    image: "https://hellofugu.xyz/brand/yield.svg",
    endpoint: "",
    priceUsd8: 5_000_000n,
  },
  {
    slug: "watch",
    name: "Fugu Watch",
    category: "HEALTH_FACTOR",
    kind: "read-only",
    summary: "Tells you how safe a loan is. Give it a wallet and it reads the loan's health factor and says which of Fugu Guardian's bands it is in.",
    limits: READ_ONLY_LIMITS("It reads the HelloFugu test lending pool only, not Venus or Aave."),
    verify: `curl "${API}/watch?wallet=0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0"`,
    image: "",
    endpoint: `${API}/watch`,
    priceUsd8: 2_000_000n,
  },
  {
    slug: "tally",
    name: "Fugu Tally",
    category: "TREASURY",
    kind: "read-only",
    summary: "Adds up what a wallet has spent hiring agents on HelloFugu, agent by agent, read straight from the contracts.",
    limits: READ_ONLY_LIMITS("It counts HelloFugu hires only."),
    verify: `curl "${API}/tally?wallet=${DEPLOYER}"`,
    image: "",
    endpoint: `${API}/tally`,
    priceUsd8: 2_000_000n,
  },
  {
    slug: "scout",
    name: "Fugu Scout",
    category: "HIRING",
    kind: "read-only",
    summary: "Finds agents for a job. Name a category and it lists who is on offer, read from the ERC-8004 registry on BNB Chain.",
    limits: READ_ONLY_LIMITS("It names agents; it does not hire them for you."),
    verify: `curl "${API}/scout?category=GRID&limit=5"`,
    image: "",
    endpoint: `${API}/scout`,
    priceUsd8: 2_000_000n,
  },
  {
    slug: "keycheck",
    name: "Fugu Keycheck",
    category: "AUTONOMOUS",
    kind: "read-only",
    summary: "Checks whether an agent's key still works. It asks the chain if the agent's session key is still valid, so you know when its permission has run out.",
    limits: READ_ONLY_LIMITS("It checks Altana session keys only."),
    verify: `curl "${API}/keycheck?account=0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0&keyHash=0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377"`,
    image: "",
    endpoint: `${API}/keycheck`,
    priceUsd8: 2_000_000n,
  },
  {
    slug: "quote",
    name: "Fugu Quote",
    category: "COMMERCE",
    kind: "read-only",
    summary: "Turns a price in dollars into BNB at the live rate, the same rate the hire button uses.",
    limits: READ_ONLY_LIMITS("It quotes tBNB on testnet only."),
    verify: `curl "${API}/quote?usd=0.10"`,
    image: "",
    endpoint: `${API}/quote`,
    priceUsd8: 2_000_000n,
  },
];

const IDENTITY_ABI = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const REGISTRY_ABI = parseAbi([
  "function list(uint256 erc8004AgentId, address agentWallet, uint8 category, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI) returns (uint256)",
  "function listingByAgentId(uint256) view returns (uint256)",
  "event Listed(uint256 indexed listingId, address indexed owner, uint8 indexed category, uint256 erc8004AgentId)",
]);

const b64 = (json: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`;

function registration(p: Plan, agentId: bigint | null, listingId: string) {
  const services: { name: string; endpoint: string }[] = [{ name: "web", endpoint: APP }];
  if (p.endpoint) services.push({ name: "API", endpoint: p.endpoint });
  return b64({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: p.name,
    description: `${p.summary} Runs on BNB Chain testnet (chain 97). What it cannot do yet is written into its HelloFugu listing: FuguRegistry ${REGISTRY}${listingId ? `, listing ${listingId}` : ""}.`,
    ...(p.image ? { image: p.image } : {}),
    services,
    registrations: agentId === null ? [] : [{ agentId: Number(agentId), agentRegistry: `eip155:97:${IDENTITY}` }],
    active: true,
    x402Support: false,
    fuguListing: { registry: `eip155:97:${REGISTRY}`, listingId: listingId ? Number(listingId) : null },
  });
}

function listingMetadata(p: Plan, agentId: bigint) {
  return b64({
    name: p.name,
    agent: p.kind === "read-only" ? `api/run/${p.slug}` : `variant:${p.slug}`,
    category: p.category,
    agentWallet: DEPLOYER,
    summary: p.summary,
    onchainExecution: false,
    implemented: p.kind === "read-only",
    ...(p.endpoint ? { endpoint: p.endpoint } : {}),
    limits: p.limits,
    verify: p.verify,
    erc8004Identity: `ERC-8004 identity ${agentId} in the IdentityRegistry ${IDENTITY} on BSC testnet (chain 97), owned by the listing owner. Check: cast call ${IDENTITY} 'ownerOf(uint256)(address)' ${agentId}`,
    chainId: 97,
  });
}

interface Row {
  slug: string;
  name: string;
  category: Category;
  kind: Plan["kind"];
  agentId?: string;
  registerTx?: Hex;
  setUriTx?: Hex;
  listingId?: string;
  listTx?: Hex;
}

function loadProgress(): Record<string, Row> {
  return fs.existsSync(PROGRESS) ? (JSON.parse(fs.readFileSync(PROGRESS, "utf8")).agents as Record<string, Row>) : {};
}

function saveProgress(rows: Record<string, Row>) {
  fs.writeFileSync(
    PROGRESS,
    JSON.stringify(
      {
        note: "HelloFugu agents 10-20, registered by backend/scripts/register-more-agents.ts: an ERC-8004 identity each (IdentityRegistry 0x8004A818BFB912233c491871b3d84c89A494BD9e), then a FuguRegistry listing bound to it. Variants reuse an existing agent's decision code with other settings and have sent no transaction; read-only agents answer at https://api.hellofugu.xyz/api/run/<slug> and sign nothing.",
        chainId: 97,
        owner: DEPLOYER,
        agents: rows,
      },
      null,
      2,
    ) + "\n",
  );
}

async function main() {
  const env = fs.readFileSync(path.join(ROOT, "contracts/.env"), "utf8");
  const key = env.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1] as Hex | undefined;
  if (!key) throw new Error("PRIVATE_KEY not found in contracts/.env");
  const account = privateKeyToAccount(key);
  if (account.address !== DEPLOYER) throw new Error(`sender ${account.address} is not the deployer`);

  const chain = { ...bscTestnet, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  if ((await pub.getChainId()) !== 97) throw new Error("not BSC testnet");

  const rows = loadProgress();
  console.log(`balance ${(await pub.getBalance({ address: DEPLOYER })).toString()} wei, ${SEND ? "SENDING" : "dry run"}`);

  const wait = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== "success") throw new Error(`tx ${hash} reverted`);
    return r;
  };

  for (const p of PLAN) {
    const row: Row = rows[p.slug] ?? { slug: p.slug, name: p.name, category: p.category, kind: p.kind };
    if (row.listTx && row.setUriTx) {
      console.log(`✓ ${p.name}: id ${row.agentId}, listing ${row.listingId}`);
      continue;
    }
    if (!SEND) {
      console.log(`- ${p.name} (${p.category}, ${p.kind}) $${Number(p.priceUsd8) / 1e8}/120s`);
      continue;
    }

    if (!row.agentId) {
      const hash = await wallet.writeContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: "register", args: [registration(p, null, "")] });
      const receipt = await wait(hash);
      const transfer = receipt.logs
        .filter((l) => l.address.toLowerCase() === IDENTITY.toLowerCase())
        .map((l) => {
          try {
            return decodeEventLog({ abi: IDENTITY_ABI, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "Transfer" && e.args.to.toLowerCase() === DEPLOYER.toLowerCase());
      if (!transfer || transfer.eventName !== "Transfer") throw new Error(`no Transfer to us in ${hash}`);
      row.agentId = transfer.args.tokenId.toString();
      row.registerTx = hash;
      rows[p.slug] = row;
      saveProgress(rows);
      console.log(`  ${p.name}: minted ERC-8004 id ${row.agentId} (${hash})`);
    }

    const agentId = BigInt(row.agentId);
    const owner = await pub.readContract({ address: IDENTITY, abi: IDENTITY_ABI, functionName: "ownerOf", args: [agentId] });
    if (owner.toLowerCase() !== DEPLOYER.toLowerCase()) throw new Error(`id ${agentId} is owned by ${owner}`);

    if (!row.listingId) {
      const hash = await wallet.writeContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "list",
        args: [agentId, DEPLOYER, CATEGORY[p.category], p.priceUsd8, 120, listingMetadata(p, agentId)],
      });
      const receipt = await wait(hash);
      const listed = receipt.logs
        .filter((l) => l.address.toLowerCase() === REGISTRY.toLowerCase())
        .map((l) => {
          try {
            return decodeEventLog({ abi: REGISTRY_ABI, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "Listed");
      if (!listed || listed.eventName !== "Listed") throw new Error(`no Listed event in ${hash}`);
      row.listingId = listed.args.listingId.toString();
      row.listTx = hash;
      saveProgress(rows);
      console.log(`  ${p.name}: listing ${row.listingId} (${hash})`);
    }

    if (!row.setUriTx) {
      const hash = await wallet.writeContract({
        address: IDENTITY,
        abi: IDENTITY_ABI,
        functionName: "setAgentURI",
        args: [agentId, registration(p, agentId, row.listingId)],
      });
      await wait(hash);
      row.setUriTx = hash;
      saveProgress(rows);
      console.log(`  ${p.name}: final registration file set (${hash})`);
    }
  }
  console.log(`balance after ${(await pub.getBalance({ address: DEPLOYER })).toString()} wei`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
