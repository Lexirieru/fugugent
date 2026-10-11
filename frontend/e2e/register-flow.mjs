// Registering and listing a new agent from /list, through the real UI, on an anvil fork:
// no terminal, two signatures. Checks that an empty form is refused with field errors,
// that `register` mints an ERC-8004 id owned by the wallet, that step 2 lists that id
// without waiting for any registry sweep, and that the listing carries the chosen
// category and price. Setup as in rating-gate.mjs (full backend on the fork, :3100).
import fs from "node:fs";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const APP = process.env.APP ?? "http://127.0.0.1:3100";
const FORK = "http://127.0.0.1:8546";
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REGISTRY = "0xb2f36070E6eae3353E8e755172B477DF213ae248";
const OUT = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("•", ...a);

const account = privateKeyToAccount(generatePrivateKey());
const chain = { ...bscTestnet, rpcUrls: { default: { http: [FORK] } } };
const wallet = createWalletClient({ account, chain, transport: http(FORK) });
async function rpc(method, params = []) {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
  if (r.error) throw Object.assign(new Error(r.error.message), r.error);
  return r.result;
}
await rpc("anvil_setBalance", [account.address, "0x" + parseEther("1").toString(16)]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 140)));
let approved = false;
await page.exposeBinding("__w", async (_s, method, params) => {
  try {
    switch (method) {
      case "eth_requestAccounts": approved = true; return { ok: [account.address] };
      case "eth_accounts": return { ok: approved ? [account.address] : [] };
      case "eth_chainId": return { ok: "0x61" };
      case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return { ok: null };
      case "wallet_requestPermissions": case "wallet_getPermissions": return { ok: [{ parentCapability: "eth_accounts" }] };
      case "wallet_getCapabilities": return { ok: {} };
      case "eth_sendTransaction": {
        const tx = params[0];
        return { ok: await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n }) };
      }
      default: return { ok: await rpc(method, params) };
    }
  } catch (e) {
    return { err: { message: e.message, code: e.code ?? -32000, data: e.data } };
  }
});
await page.addInitScript(() => {
  const provider = { async request({ method, params }) { const r = await window.__w(method, params ?? []); if (r.err) throw Object.assign(new Error(r.err.message), r.err); return r.ok; }, on() { return provider; }, removeListener() { return provider; } };
  window.ethereum = provider;
  const detail = Object.freeze({ info: { uuid: "7b1f9c3e-0000-4000-8000-0000000000ff", name: "Test Wallet", rdns: "xyz.hellofugu.test", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }, provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce); announce();
});

const pub = createPublicClient({ chain, transport: http(FORK) });
const ABI = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function listingByAgentId(uint256) view returns (uint256)",
  "function getListing(uint256) view returns ((uint256 erc8004AgentId,address owner,address agentWallet,uint8 category,uint128 priceUsd8PerPeriod,uint32 periodSeconds,bool active,bool curated,string metadataURI))",
]);

await page.goto(`${APP}/list`, { waitUntil: "load" });
const form = page.getByTestId("register-agent");
const connect = page.getByRole("button", { name: "Connect wallet" }).first();
const option = page.getByText("Test Wallet").first();
for (let i = 0; i < 5 && !(await option.isVisible()); i++) {
  await connect.click();
  await option.waitFor({ timeout: 8000 }).catch(() => {});
}
await option.click();
await form.waitFor({ timeout: 60000 });
log("connected", account.address);

// An empty form is refused before any signature.
await form.getByRole("button", { name: "Register on ERC-8004" }).click();
await form.getByText("Between 2 and 60 characters.").waitFor();
await form.getByText("A full https:// address where your agent answers.").waitFor();
log("empty form refused with field errors");

await page.locator("#reg-name").fill("E2E Yield Scout");
await page.locator("#reg-category").selectOption("YIELD");
await page.locator("#reg-desc").fill("Finds the best paying lending pool for idle stablecoins and says when moving is worth the fee.");
await page.locator("#reg-endpoint").fill("https://example.com/.well-known/agent-card.json");
await page.locator("#reg-price").fill("0.03");
await form.screenshot({ path: `${OUT}register-1-form.png` });
await form.getByRole("button", { name: "Register on ERC-8004" }).click();
const listBtn = form.getByRole("button", { name: /^List agent #\d+$/ });
await listBtn.waitFor({ timeout: 90000 });
const agentId = BigInt((await listBtn.innerText()).match(/#(\d+)/)[1]);
const owner = await pub.readContract({ address: IDENTITY, abi: ABI, functionName: "ownerOf", args: [agentId] });
if (owner !== account.address) throw new Error(`id ${agentId} owned by ${owner}`);
const uri = await pub.readContract({ address: IDENTITY, abi: ABI, functionName: "tokenURI", args: [agentId] });
const file = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
if (file.name !== "E2E Yield Scout" || file.services[0].name !== "A2A") throw new Error(`registration file: ${JSON.stringify(file)}`);
log(`step 1: ERC-8004 #${agentId} minted to the wallet, file names it and its A2A endpoint`);

await listBtn.click();
await page.getByTestId("register-done").waitFor({ timeout: 90000 });
const listingId = await pub.readContract({ address: REGISTRY, abi: ABI, functionName: "listingByAgentId", args: [agentId] });
const listing = await pub.readContract({ address: REGISTRY, abi: ABI, functionName: "getListing", args: [listingId] });
if (listing.owner !== account.address || listing.category !== 2 || listing.priceUsd8PerPeriod !== 3_000_000n || listing.periodSeconds !== 120) {
  throw new Error(`listing ${listingId}: ${JSON.stringify(listing, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
}
await page.getByTestId("register-done").screenshot({ path: `${OUT}register-2-done.png` });
log(`step 2: listing #${listingId}, YIELD, $0.03 per 2 minutes, owner = the wallet; no sweep waited for`);

await browser.close();
log("E2E PASS");
