// The builder path and the rating path, end to end, through the real UI on a fork.
//
// What the Set and Earn quest asks a participant to do, minus the real chain:
//   1. a wallet that does not own an ERC-8004 agent tries to list it -> the contract refuses;
//   2. the owner opens /list, finds the agent, and lists it through the form;
//   3. another wallet hires it, the agent earns, the payment is released, and that
//      wallet rates it 5/5 through the Ratings panel.
// Every step is read back from the contracts.
//
// Setup (see hire-flow.mjs for the servers): the backend and frontend must point at an
// anvil fork on :8546, and BUILDER.json must name a fork wallet that registered an
// ERC-8004 agent before the backend's last sweep:
//   {"builder":{"key":"0x…","address":"0x…"},"stranger":{"key":"0x…","address":"0x…"},"agentId":"2503"}
//   BUILDER=path/to/builder.json node e2e/builder-flow.mjs
import fs from "node:fs";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const FORK = "http://127.0.0.1:8546";
const APP = "http://127.0.0.1:3100";
const REGISTRY = "0xb2f36070E6eae3353E8e755172B477DF213ae248";
const REPUTATION = "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400";
const OUT = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const cfg = JSON.parse(fs.readFileSync(process.env.BUILDER, "utf8"));
const agentId = BigInt(cfg.agentId);
const chain = { ...bscTestnet, rpcUrls: { default: { http: [FORK] } } };
const pub = createPublicClient({ chain, transport: http(FORK) });
const REG_ABI = parseAbi([
  "function list(uint256,address,uint8,uint128,uint32,string) returns (uint256)",
  "function listingByAgentId(uint256) view returns (uint256)",
  "function getListing(uint256) view returns ((uint256 erc8004AgentId,address owner,address agentWallet,uint8 category,uint128 priceUsd8PerPeriod,uint32 periodSeconds,bool active,bool curated,string metadataURI))",
  "error NotAgentIdentityOwner(uint256 erc8004AgentId,address caller,address identityOwner)",
]);
const REP_ABI = parseAbi([
  "function reviewCount(uint256) view returns (uint256)",
  "function hasReviewed(uint256,address) view returns (bool)",
]);
const log = (...a) => console.log("•", ...a);

async function rpc(method, params = []) {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
  return j.result;
}

/** A browser context with an EIP-6963 wallet that signs with `key` on the fork. */
async function walletPage(browser, key, name) {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http(FORK) });
  let approved = false;
  const sent = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [${name} pageerror]`, e.message.slice(0, 140)));
  await page.exposeBinding("__fuguWallet", async (_s, method, params) => {
    try {
      switch (method) {
        case "eth_requestAccounts": approved = true; return { ok: [account.address] };
        case "eth_accounts": return { ok: approved ? [account.address] : [] };
        case "eth_chainId": return { ok: "0x61" };
        case "net_version": return { ok: "97" };
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return { ok: null };
        case "wallet_requestPermissions": case "wallet_getPermissions": return { ok: [{ parentCapability: "eth_accounts" }] };
        case "wallet_getCapabilities": return { ok: {} };
        case "personal_sign": return { ok: await account.signMessage({ message: { raw: params[0] } }) };
        case "eth_sendTransaction": {
          const tx = params[0];
          sent.push(tx.data?.slice(0, 10));
          return { ok: await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: tx.gas ? BigInt(tx.gas) : undefined }) };
        }
        default: return { ok: await rpc(method, params) };
      }
    } catch (e) {
      return { err: { message: e.message, code: e.code ?? -32000, data: e.data } };
    }
  });
  await page.addInitScript((label) => {
    const provider = {
      async request({ method, params }) {
        const r = await window.__fuguWallet(method, params ?? []);
        if (r.err) throw Object.assign(new Error(r.err.message), r.err);
        return r.ok;
      },
      on() { return provider; },
      removeListener() { return provider; },
    };
    window.ethereum = provider;
    const detail = Object.freeze({
      info: { uuid: "7b1f9c3e-0000-4000-8000-00000000000" + label.length, name: `Test Wallet ${label}`, rdns: `xyz.hellofugu.test.${label}`, icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" },
      provider,
    });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, name);
  async function connect(connectButtonName) {
    await page.getByRole("button", { name: connectButtonName }).click();
    const option = page.getByText(`Test Wallet ${name}`).first();
    await option.waitFor({ timeout: 20000 });
    await option.click();
  }
  return { page, account, sent, connect, close: () => ctx.close() };
}

for (const who of [cfg.builder.address, cfg.stranger.address]) {
  await rpc("anvil_setBalance", [who, "0x" + parseEther("1").toString(16)]);
}
const browser = await chromium.launch();

// 1. A stranger cannot list somebody else's agent: the contract checks ERC-8004 ownership.
const stranger = createWalletClient({ account: privateKeyToAccount(cfg.stranger.key), chain, transport: http(FORK) });
try {
  await pub.simulateContract({ address: REGISTRY, abi: REG_ABI, functionName: "list", args: [agentId, cfg.stranger.address, 1, 5_000_000n, 120, "data:,x"], account: stranger.account });
  throw new Error("a stranger was allowed to list the builder's agent");
} catch (e) {
  if (!String(e.message).includes("NotAgentIdentityOwner")) throw e;
  log("stranger listing someone else's agent: refused with NotAgentIdentityOwner");
}

// 2. The owner lists it through /list and the form.
const builder = await walletPage(browser, cfg.builder.key, "builder");
await builder.page.goto(`${APP}/list`, { waitUntil: "domcontentloaded" });
await builder.connect("Connect a wallet to find your agents");
const listLink = builder.page.getByRole("link", { name: /^List E2E Grid Runner$/ });
await listLink.waitFor({ timeout: 30000 });
await builder.page.screenshot({ path: `${OUT}builder-1-my-agents.png`, fullPage: true });
log("/list shows the builder's agent with a List button");
await listLink.click();
const listButton = builder.page.getByRole("button", { name: /^List it as .+ at \$/ });
await listButton.waitFor({ timeout: 30000 });
await listButton.scrollIntoViewIfNeeded();
await builder.page.screenshot({ path: `${OUT}builder-2-form.png` });
log("form button reads:", JSON.stringify(await listButton.innerText()));
await listButton.click();
await builder.page.getByText("Listed. The transaction is in a block.").waitFor({ timeout: 60000 });
await builder.page.screenshot({ path: `${OUT}builder-3-listed.png` });
const listingId = await pub.readContract({ address: REGISTRY, abi: REG_ABI, functionName: "listingByAgentId", args: [agentId] });
const listing = await pub.readContract({ address: REGISTRY, abi: REG_ABI, functionName: "getListing", args: [listingId] });
if (listingId === 0n || listing.owner !== cfg.builder.address) throw new Error("listing not created for the owner");
log(`on chain: listing #${listingId} for agent ${listing.erc8004AgentId}, owner = builder, price ${listing.priceUsd8PerPeriod} usd8 per ${listing.periodSeconds}s`);
await builder.close();

// 3. Another wallet hires it, the agent earns, the payment is released, and it is rated.
await new Promise((r) => setTimeout(r, 20000)); // the backend holds FuguRegistry reads for 15 s
const renter = await walletPage(browser, cfg.stranger.key, "renter");
await renter.page.goto(`${APP}/agent/97%3A${agentId}`, { waitUntil: "domcontentloaded" });
await renter.connect("Connect a wallet to hire");
const hire = renter.page.getByRole("button", { name: /^Hire E2E Grid Runner for \$/ });
await hire.waitFor({ timeout: 30000 });
await hire.click();
await renter.page.getByText("Hired. The transaction is in a block.").waitFor({ timeout: 60000 });
log("renter hired it through the UI");
await rpc("evm_increaseTime", [300]);
await rpc("evm_mine", []);
await renter.page.reload({ waitUntil: "domcontentloaded" });
const release = renter.page.getByRole("button", { name: /^Release .+ tBNB to E2E Grid Runner$/ });
await release.waitFor({ timeout: 60000 });
await release.scrollIntoViewIfNeeded();
await renter.page.screenshot({ path: `${OUT}rating-1-release.png` });
await release.click();
await renter.page.getByText("Payment released.").waitFor({ timeout: 60000 });
await renter.page.getByRole("button", { name: "Continue to rating" }).click();
await renter.page.getByRole("radio", { name: "5 of 5" }).waitFor({ timeout: 30000 });
await renter.page.getByRole("radio", { name: "5 of 5" }).click();
await renter.page.getByRole("button", { name: "Rate E2E Grid Runner 5/5" }).click();
await renter.page.getByText("Rating recorded on chain.").waitFor({ timeout: 60000 });
// The totals above the panel update on their own; nobody should have to press Done.
await renter.page.getByText("5.0 from 1").waitFor({ timeout: 30000 });
log("the ratings summary reads 5.0 from 1 without a reload");
await renter.page.screenshot({ path: `${OUT}rating-2-recorded.png` });
const count = await pub.readContract({ address: REPUTATION, abi: REP_ABI, functionName: "reviewCount", args: [listingId] });
const reviewed = await pub.readContract({ address: REPUTATION, abi: REP_ABI, functionName: "hasReviewed", args: [listingId, cfg.stranger.address] });
if (count !== 1n || !reviewed) throw new Error("rating not recorded");
log(`on chain: listing #${listingId} reviewCount=${count}, renter hasReviewed=${reviewed}`);
log("renter signed:", JSON.stringify(renter.sent), "(subscribe, claim, review; no approve)");
if (renter.sent.includes("0x095ea7b3")) throw new Error("an ERC-20 approve was requested");
await renter.close();
await browser.close();
log("E2E PASS");
