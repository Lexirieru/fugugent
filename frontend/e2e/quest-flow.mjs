// Set and Earn, through the real UI, on an anvil fork with a burner wallet:
//   /quest renders its steps and starter picks;
//   a builder's agent page (default 97:2545) shows the six-point checklist;
//   hiring Fugu Watch from a starter pick puts its reading for this wallet on /me,
//   and /quest then counts one agent hired.
// Nothing touches the real chain. The API must serve /api/tracking from the fork:
//
//   anvil --fork-url https://bsc-testnet.rpc.sentio.xyz --chain-id 97 --port 8546 --no-rate-limit
//   (cd backend && RPC_URL=http://127.0.0.1:8546 RPC_FALLBACK_URLS= PORT=8797 npx tsx scripts/serve-no-sweep.ts)
//   a proxy on :8799 sending /api/tracking to :8797 and the rest to api.hellofugu.xyz
//   (cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8799 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546 \
//      NEXT_PUBLIC_REOWN_PROJECT_ID=<id> bun run build && bun run start -p 3000)
//   node e2e/quest-flow.mjs
import fs from "node:fs";
import { chromium } from "playwright";
import { createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const APP = process.env.APP ?? "http://localhost:3000";
const FORK = "http://127.0.0.1:8546";
const BUILDER_AGENT = process.env.BUILDER_AGENT ?? "97:2545";
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

// 1. /quest, before connecting.
await page.goto(`${APP}/quest`, { waitUntil: "load" });
await page.getByRole("heading", { name: "Do Set and Earn from here." }).waitFor();
for (const name of ["Fugu Watch", "Fugu Quote", "Fugu Tally"]) await page.getByText(name, { exact: true }).first().waitFor();
await page.screenshot({ path: `${OUT}quest-1.png`, fullPage: true });
log("/quest renders its four steps and three starter picks");

// 2. A builder's checklist.
await page.goto(`${APP}/agent/${encodeURIComponent(BUILDER_AGENT)}#quest`, { waitUntil: "load" });
const checklist = page.getByTestId("quest-readiness");
await checklist.getByText(/\d of \d/).waitFor({ timeout: 90000 });
const summary = await checklist.getByText(/\d of \d/).innerText();
await checklist.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}quest-2-checklist.png` });
log(`${BUILDER_AGENT} checklist: ${summary} pass`);

// 3. Connect, then hire Fugu Watch from its starter pick.
await page.goto(`${APP}/quest`, { waitUntil: "load" });
const option = page.getByText("Test Wallet").first();
for (let i = 0; i < 5 && !(await option.isVisible()); i++) {
  await page.getByRole("button", { name: "Connect to see your hires here" }).click();
  await option.waitFor({ timeout: 8000 }).catch(() => {});
}
await option.click();
await page.getByTestId("quest-progress").waitFor({ timeout: 60000 });
log("connected:", (await page.getByTestId("quest-progress").innerText()).split("\n")[0]);

await page.getByRole("link", { name: /Fugu Watch/ }).click();
const hire = page.getByRole("button", { name: /^Hire Fugu Watch (again anyway )?for \$/ });
await hire.waitFor({ timeout: 90000 });
await hire.scrollIntoViewIfNeeded();
await hire.click();
await page.getByText("Hired. The transaction is in a block.").waitFor({ timeout: 90000 });
log("hired Fugu Watch on the fork");

// 4. /me shows what it found.
await page.goto(`${APP}/me`, { waitUntil: "load" });
const result = page.getByTestId("agent-result").first();
await result.getByText(/Found for you: (?!asking)/).waitFor({ timeout: 90000 });
await page.waitForFunction(() => !document.querySelector("[data-testid=agent-result]")?.textContent?.includes("asking it"), null, { timeout: 60000 });
const found = await result.innerText();
if (!/health factor|No loan/i.test(found)) throw new Error(`unexpected result: ${found}`);
await page.screenshot({ path: `${OUT}quest-3-me.png` });
log("/me:", found.replace(/\s+/g, " "));

// 5. /quest counts it.
await page.goto(`${APP}/quest`, { waitUntil: "load" });
await page.getByTestId("quest-progress").getByText(/1 of 3/).waitFor({ timeout: 60000 });
await page.getByTestId("quest-progress").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}quest-4-progress.png` });
log("/quest:", (await page.getByTestId("quest-progress").innerText()).split("\n")[0]);

await browser.close();
log("E2E PASS");
