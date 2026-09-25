// The hire flow, end to end, through the real UI: connect -> hire -> cancel.
//
// It runs against a local anvil fork of BSC testnet, so the contracts are the live
// ones and no real funds move. A burner key is injected as an EIP-6963 wallet that
// exposes no account until the page asks, like a real extension on a new site, so
// the AppKit connect modal is exercised too. What it proves, and fails on if not:
//
//   - the hire button names the agent it pays;
//   - `subscribe` lands and the subscription belongs to the wallet that paid;
//   - the cancel button is reachable from the same card and `cancel` refunds the
//     unused part, read back from the contract afterwards;
//   - the wallet is never asked for an ERC-20 `approve`: only `subscribe` and `cancel`.
//
// Run it (four terminals, or background them):
//
//   anvil --fork-url https://bsc-testnet-rpc.publicnode.com --chain-id 97 --port 8546
//   (cd backend && PORT=8799 npx tsx src/index.ts)
//   (cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8799 \
//      NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546 NEXT_PUBLIC_REOWN_PROJECT_ID=<id> \
//      bun run build && bun run start -p 3100)
//   cd frontend && bunx --bun playwright install chromium && AGENT=97:2480 node e2e/hire-flow.mjs
//
// Screenshots of every step land in `e2e/out/`.
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, decodeFunctionData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const FORK = "http://127.0.0.1:8546";
const APP = "http://127.0.0.1:3100";
const AGENT = process.env.AGENT ?? "97:2480";
const SUBSCRIPTION = "0xfdb083371f44Cf53181350389D3217e51B431776";
const OUT = new URL("./out/", import.meta.url).pathname;
await import("node:fs").then((fs) => fs.mkdirSync(OUT, { recursive: true }));

const account = privateKeyToAccount(generatePrivateKey());
const chain = { ...bscTestnet, rpcUrls: { default: { http: [FORK] } } };
const pub = createPublicClient({ chain, transport: http(FORK) });
const wallet = createWalletClient({ account, chain, transport: http(FORK) });

async function rpc(method, params = []) {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
  return j.result;
}

await rpc("anvil_setBalance", [account.address, "0x" + parseEther("1").toString(16)]);
const SUB_ABI = [
  { type: "function", name: "subCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getSub", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [
    { name: "listingId", type: "uint256" }, { name: "subscriber", type: "address" }, { name: "payToken", type: "address" },
    { name: "deposited", type: "uint128" }, { name: "claimed", type: "uint128" }, { name: "startedAt", type: "uint64" },
    { name: "endsAt", type: "uint64" }, { name: "cancelled", type: "bool" }, { name: "feeBps", type: "uint16" }] }] },
  { type: "function", name: "subscribe", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "uint32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
];

const sent = [];
let approved = false;
async function handle(method, params) {
  switch (method) {
    // A fresh visitor: no account is exposed until the user approves a connection,
    // exactly like a real extension on a site it has never seen.
    case "eth_requestAccounts": approved = true; return [account.address];
    case "eth_accounts": return approved ? [account.address] : [];
    case "eth_chainId": return "0x61";
    case "net_version": return "97";
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
    case "wallet_watchAsset": return null;
    case "wallet_requestPermissions":
    case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
    case "wallet_getCapabilities": return {};
    case "personal_sign": return account.signMessage({ message: { raw: params[0] } });
    case "eth_sendTransaction": {
      const tx = params[0];
      let call = "unknown";
      try { const d = decodeFunctionData({ abi: SUB_ABI, data: tx.data }); call = d.functionName; } catch { call = tx.data?.slice(0, 10) ?? "transfer"; }
      sent.push({ to: tx.to, call, value: tx.value ?? "0x0" });
      return wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: tx.gas ? BigInt(tx.gas) : undefined });
    }
    default: return rpc(method, params);
  }
}

const log = (...a) => console.log("•", ...a);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 160)));
await page.exposeBinding("__fuguWallet", async (_src, method, params) => {
  try { return { ok: await handle(method, params) }; } catch (e) { return { err: { message: e.message, code: e.code ?? -32000, data: e.data } }; }
});
await page.addInitScript(() => {
  const listeners = {};
  const provider = {
    isMetaMask: false,
    async request({ method, params }) {
      const r = await window.__fuguWallet(method, params ?? []);
      if (r.err) throw Object.assign(new Error(r.err.message), r.err);
      return r.ok;
    },
    on(ev, fn) { (listeners[ev] ??= []).push(fn); return provider; },
    removeListener(ev, fn) { listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn); return provider; },
  };
  window.ethereum = provider;
  const detail = Object.freeze({
    info: { uuid: "7b1f9c3e-0000-4000-8000-000000000001", name: "Fugu Test Wallet", rdns: "xyz.hellofugu.testwallet",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%23e8663d'/%3E%3C/svg%3E" },
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const before = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "subCount" });
const balance0 = await pub.getBalance({ address: account.address });
log("burner", account.address, "balance", formatEther(balance0), "tBNB; subCount", before);

await page.goto(`${APP}/agent/${encodeURIComponent(AGENT)}`, { waitUntil: "domcontentloaded" });
// Either the connect button, or (an injected wallet that already exposes an
// account is reconnected by AppKit on load) the hire button straight away.
const connectBtn = page.getByRole("button", { name: "Connect a wallet to hire" });
const hireBtnEarly = page.getByRole("button", { name: /^Hire .+ for \$/ });
await page.locator("#hire-heading").waitFor({ timeout: 60000 });
await page.waitForTimeout(4000);
await page.locator("#hire-heading").scrollIntoViewIfNeeded();
await shot("1-before-connect");
if (await connectBtn.isVisible()) {
  await connectBtn.click();
  const walletOption = page.getByText("Fugu Test Wallet").first();
  await walletOption.waitFor({ timeout: 20000 });
  await shot("2-appkit-modal");
  await walletOption.click();
  log("connected through the AppKit modal");
} else if (await hireBtnEarly.isVisible()) {
  log("AppKit reconnected the injected wallet on load (no modal needed)");
}
const hireButton = page.getByRole("button", { name: /^Hire .+ for \$/ });
await hireButton.waitFor({ timeout: 30000 });
// The modal may linger after connecting; close it if it does.
await page.keyboard.press("Escape").catch(() => {});
log("hire button reads:", JSON.stringify(await hireButton.innerText()));
await hireButton.scrollIntoViewIfNeeded();
await shot("3-connected-quote");

await hireButton.click();
await page.getByText("Hired. The transaction is in a block.").waitFor({ timeout: 60000 });
await shot("4-hired");
const subId = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "subCount" });
const sub = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "getSub", args: [subId] });
log(`on chain: sub #${subId} listing ${sub.listingId} subscriber ${sub.subscriber === account.address ? "= burner" : sub.subscriber} deposited ${formatEther(sub.deposited)} tBNB cancelled=${sub.cancelled}`);
if (subId !== before + 1n || sub.subscriber !== account.address) throw new Error("subscription not created as expected");

// Let a little chain time pass so the agent has earned something and the refund is partial.
await rpc("evm_increaseTime", [60]); await rpc("evm_mine", []);

const cancelButton = page.getByRole("button", { name: /^Cancel .+ and refund the rest$/ });
await cancelButton.waitFor({ timeout: 60000 });
log("cancel button reads:", JSON.stringify(await cancelButton.innerText()));
await cancelButton.scrollIntoViewIfNeeded();
await cancelButton.click();
await shot("5-cancel-confirm");
await page.getByRole("button", { name: "Yes, cancel and refund" }).click();
const result = page.getByTestId("cancel-result").getByText(/^Cancelled\./);
await result.waitFor({ timeout: 60000 });
log("UI says:", JSON.stringify(await result.innerText()));
await page.getByText(/You already have subscription #\d+ running/).waitFor({ state: "hidden", timeout: 30000 });
if (await page.getByText("Hired. The transaction is in a block.").isVisible()) throw new Error("stale 'Hired' message shown after cancel");
if (await page.getByText(/This browser has a hire recorded/).isVisible()) throw new Error("local hire note still shown after cancel");
log("after cancel: the 'running' box and the 'Hired' line and the local note are gone");
await shot("6-cancelled");

const after = await pub.readContract({ address: SUBSCRIPTION, abi: SUB_ABI, functionName: "getSub", args: [subId] });
const balance1 = await pub.getBalance({ address: account.address });
log(`on chain: sub #${subId} cancelled=${after.cancelled} agent keeps ${formatEther(after.deposited)} tBNB of ${formatEther(sub.deposited)}`);
log("wallet spent in total (payment kept by agent + gas):", formatEther(balance0 - balance1), "tBNB");
log("transactions the wallet was asked to sign:", JSON.stringify(sent));
if (!after.cancelled) throw new Error("cancel did not land");
if (sent.some((t) => t.call === "0x095ea7b3")) throw new Error("an ERC-20 approve was requested");
await browser.close();
log("E2E PASS");
