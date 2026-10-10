// Rating before the next hire, through the real UI, on an anvil fork with a burner:
//   hire Fugu Quote for one period, let it finish (anvil time warp);
//   its own page then says "rate it below" instead of offering another hire;
//   any other agent's page puts the rating where the Hire button was;
//   release the payment, rate 5/5, and the Hire button comes back.
// Setup as in quest-flow.mjs, but with the full backend on the fork (it must read
// /api/tracking from the fork):
//   (cd backend && RPC_URL=http://127.0.0.1:8546 RPC_FALLBACK_URLS= PORT=8799 REGISTRY_FIRST_ID=2470 \
//      ALLOWED_ORIGINS=http://127.0.0.1:3100 npx tsx src/index.ts)
//   APP=http://127.0.0.1:3100 node e2e/rating-gate.mjs
import fs from "node:fs";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const APP = process.env.APP ?? "http://127.0.0.1:3100";
const FORK = "http://127.0.0.1:8546";
const REPUTATION = "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400";
const QUOTE = { id: "97:2517", listing: 20n, name: "Fugu Quote" };
const TALLY = { id: "97:2514", name: "Fugu Tally" };
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
const REP_ABI = parseAbi(["function reviewCount(uint256) view returns (uint256)", "function hasReviewed(uint256,address) view returns (bool)"]);
const hireButton = (name) => page.getByRole("button", { name: new RegExp(`^Hire ${name} (again anyway )?for \\$`) });

// 1. Connect.
await page.goto(`${APP}/me`, { waitUntil: "load" });
const option = page.getByText("Test Wallet").first();
for (let i = 0; i < 5 && !(await option.isVisible()); i++) {
  await page.getByRole("button", { name: "Connect wallet" }).last().click();
  await option.waitFor({ timeout: 8000 }).catch(() => {});
}
await option.click();
await page.getByTestId("my-console").waitFor({ timeout: 60000 });
log("connected", account.address);

// 2. Hire Fugu Quote for one period.
await page.goto(`${APP}/agent/${encodeURIComponent(QUOTE.id)}`, { waitUntil: "load" });
await hireButton(QUOTE.name).waitFor({ timeout: 90000 });
await page.locator("#hire").getByRole("button", { name: "1", exact: true }).click();
await hireButton(QUOTE.name).click();
try {
  await page.getByText("Hired. The transaction is in a block.").waitFor({ timeout: 90000 });
} catch (e) {
  await page.locator("#hire").screenshot({ path: `${OUT}gate-debug-hire.png` });
  console.log((await page.locator("#hire").innerText()).slice(-600));
  throw e;
}
log("hired Fugu Quote for one period");

// 3. Let it finish.
await rpc("evm_increaseTime", [300]);
await rpc("evm_mine", []);

// 4. Its own page: rate it below, no second hire.
await page.goto(`${APP}/agent/${encodeURIComponent(QUOTE.id)}`, { waitUntil: "load" });
await page.getByTestId("rating-gate").getByText("Rate it below").waitFor({ timeout: 90000 });
if (await hireButton(QUOTE.name).isVisible()) throw new Error("hire offered before rating, same agent");
log("Fugu Quote's page: hire replaced by 'Rate it below'");

// 5. Another agent's page: the rating sits where the Hire button was.
await page.goto(`${APP}/agent/${encodeURIComponent(TALLY.id)}`, { waitUntil: "load" });
const gate = page.getByTestId("rating-gate");
await gate.getByText(`Rate ${QUOTE.name} before your next hire`).waitFor({ timeout: 90000 });
if (await hireButton(TALLY.name).isVisible()) throw new Error("hire offered before rating, other agent");
await gate.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}gate-1-blocked.png` });
log("Fugu Tally's page: hire replaced by the Fugu Quote rating");

const release = gate.getByRole("button", { name: new RegExp(`^Release .+ tBNB to ${QUOTE.name}$`) });
await release.waitFor({ timeout: 60000 });
await release.click();
await gate.getByText("Payment released.").waitFor({ timeout: 60000 });
await gate.getByRole("button", { name: "Continue to rating" }).click();
await gate.getByRole("radio", { name: "5 of 5" }).click();
await gate.getByRole("button", { name: `Rate ${QUOTE.name} 5/5` }).click();
await gate.getByText("Rating recorded on chain.").waitFor({ timeout: 60000 });
const reviewed = await pub.readContract({ address: REPUTATION, abi: REP_ABI, functionName: "hasReviewed", args: [QUOTE.listing, account.address] });
if (!reviewed) throw new Error("rating not on chain");
log("released the payment and rated 5/5; hasReviewed = true on chain");

// 6. The Hire button comes back on its own.
await hireButton(TALLY.name).waitFor({ timeout: 90000 });
await page.screenshot({ path: `${OUT}gate-2-unlocked.png` });
log("Hire Fugu Tally is back without a reload");

await browser.close();
log("E2E PASS");
