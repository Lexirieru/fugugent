// "My agents", end to end, on the REAL BSC testnet with a real wallet.
//
// Unlike hire-flow.mjs (a fork and a burner), this one proves the page against the live
// contracts and the production API: connect -> hire Fugu Guardian from its page -> the
// hire shows up under "Running now" on /me with a ticking countdown -> cancel from /me
// -> the refund is shown and the subscription reads `cancelled` on chain.
//
// It spends a little testnet tBNB. The key is read from contracts/.env (PRIVATE_KEY)
// and used only inside this process to sign; it is never typed into a page.
//
//   (cd frontend && NEXT_PUBLIC_API_BASE_URL=https://api.hellofugu.xyz \
//      NEXT_PUBLIC_REOWN_PROJECT_ID=<id> bun run build && \
//      NEXT_PUBLIC_API_BASE_URL=https://api.hellofugu.xyz bun run start -p 3000)
//   node e2e/my-agents-live.mjs
//
// Port 3000 on localhost is the one origin besides production the API allows (CORS).
import fs from "node:fs";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, decodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const APP = process.env.APP ?? "http://localhost:3000";
const RPC = "https://bsc-testnet.rpc.sentio.xyz";
const SUBSCRIPTION = "0xfdb083371f44Cf53181350389D3217e51B431776";
const OUT = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const envFile = new URL("../../contracts/.env", import.meta.url).pathname;
const key = fs.readFileSync(envFile, "utf8").match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
if (!key) throw new Error("PRIVATE_KEY not found in contracts/.env");
const account = privateKeyToAccount(key);
const chain = { ...bscTestnet, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const SUB_ABI = parseAbi([
  "function subCount() view returns (uint256)",
  "function getSub(uint256) view returns ((uint256 listingId,address subscriber,address payToken,uint128 deposited,uint128 claimed,uint64 startedAt,uint64 endsAt,bool cancelled,uint16 feeBps))",
  "function subscribe(uint256,uint32,address,uint256,uint256) payable returns (uint256)",
  "function cancel(uint256)",
]);
const log = (...a) => console.log("•", ...a);

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
  if (r.error) throw Object.assign(new Error(r.error.message), r.error);
  return r.result;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 140)));
let approved = false;
const signed = [];
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
        let call = tx.data?.slice(0, 10);
        try { call = decodeFunctionData({ abi: SUB_ABI, data: tx.data }).functionName; } catch {}
        signed.push(call);
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
  const detail = Object.freeze({ info: { uuid: "7b1f9c3e-0000-4000-8000-0000000000dd", name: "Deployer Wallet", rdns: "xyz.hellofugu.deployer", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" }, provider });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce); announce();
});

// 1. Connect on /me and read the console.
page.setDefaultNavigationTimeout(90000);
await page.goto(`${APP}/me`, { waitUntil: "load" });
// A click before hydration does nothing, and over a slow link that is easy to hit:
// click, and click again until the wallet modal actually shows the option.
const option = page.getByText("Deployer Wallet").first();
for (let attempt = 0; attempt < 5 && !(await option.isVisible()); attempt++) {
  await page.getByRole("button", { name: "Connect wallet" }).last().click();
  await option.waitFor({ timeout: 8000 }).catch(() => {});
}
if (!(await option.isVisible())) {
  await page.screenshot({ path: `${OUT}me-debug-modal.png` });
  throw new Error("wallet modal never showed the injected wallet");
}
await option.click();
await page.getByTestId("my-console").waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}me-1-before.png`, fullPage: true });
log("/me loaded for", account.address);

// 2. Hire Fugu Guardian from its page.
const before = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "subCount" });
await page.goto(`${APP}/agent/97%3A2480`, { waitUntil: "domcontentloaded" });
const hire = page.getByRole("button", { name: /^Hire Fugu Guardian (again anyway )?for \$/ });
await hire.waitFor({ timeout: 90000 });
await hire.scrollIntoViewIfNeeded();
await hire.click();
await page.getByText("Hired. The transaction is in a block.").waitFor({ timeout: 90000 });
const subId = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "subCount" });
const sub = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "getSub", args: [subId] });
if (subId !== before + 1n || sub.subscriber !== account.address) throw new Error("hire did not land");
log(`hired on testnet: sub #${subId}, ends in ${Number(sub.endsAt - sub.startedAt)}s`);

// 3. It shows under "Running now" with a ticking countdown.
await page.goto(`${APP}/me`, { waitUntil: "domcontentloaded" });
const running = page.getByTestId("my-console").getByText(`sub #${subId}`);
await running.waitFor({ timeout: 60000 });
const countdown = page.getByTestId("hire-countdown").first();
const t1 = await countdown.innerText();
await page.waitForTimeout(2200);
const t2 = await countdown.innerText();
if (t1 === t2) throw new Error("countdown is not ticking");
log(`/me shows sub #${subId} under Running now; countdown ${t1.replace(/\s+/g, " ")} -> ${t2.replace(/\s+/g, " ")}`);
await page.screenshot({ path: `${OUT}me-2-running.png`, fullPage: true });

// 4. Cancel it from /me.
await page.getByRole("button", { name: "Cancel Fugu Guardian and refund the rest" }).first().click();
await page.getByRole("button", { name: "Yes, cancel and refund" }).click();
await page.getByTestId("console-cancelled").waitFor({ timeout: 90000 });
const note = await page.getByTestId("console-cancelled").innerText();
const after = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "getSub", args: [subId] });
if (!after.cancelled) throw new Error("cancel did not land");
log("/me says:", note.replace(/\s+/g, " "));
await page.screenshot({ path: `${OUT}me-3-cancelled.png`, fullPage: true });
log("signed:", JSON.stringify(signed));
await browser.close();
log("E2E PASS (live testnet)");
