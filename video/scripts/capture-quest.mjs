#!/usr/bin/env node
/**
 * Stills for the Set and Earn film: /quest, a two-cent hire, what the agent found for
 * the renter on /me, the rating that comes after, and a builder's checklist.
 *
 * /quest and the checklist come from production. The hire, /me and the rating run on a
 * local build against an anvil fork with a burner wallet, so nothing touches the chain.
 * Same fork stack as `capture-launch.mjs`, with the frontend on :3100 and the full
 * backend on the fork:
 *
 *   (cd backend && RPC_URL=http://127.0.0.1:8546 RPC_FALLBACK_URLS= PORT=8799 REGISTRY_FIRST_ID=2470 \
 *      ALLOWED_ORIGINS=http://127.0.0.1:3100 npx tsx src/index.ts)
 *   (cd video && npm run capture:quest)
 */
import fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "quest");
fs.mkdirSync(OUT, { recursive: true });
const PROD = "https://app.hellofugu.xyz";
const LOCAL = process.env.APP ?? "http://127.0.0.1:3100";
const FORK = "http://127.0.0.1:8546";
const VIEW = { width: 1440, height: 900 };
const BUILDER_AGENT = "97:2545";
const meta = { viewport: VIEW, scale: 2, shots: {} };
const log = (...a) => console.log("•", ...a);

async function box(locator) {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`no box for ${locator}`);
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}
async function shot(page, name, extra = {}, opts = {}) {
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
  meta.shots[name] = { file: `quest/${name}.png`, width: VIEW.width, height: opts.clip?.height ?? VIEW.height, ...extra };
  log(name);
}
const settle = async (page, ms = 1200) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

const browser = await chromium.launch();

// ── Production: /quest and a builder's checklist ──────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${PROD}/quest`, { waitUntil: "load" });
  await settle(page, 2000);
  const height = Math.min(2300, await page.evaluate(() => document.documentElement.scrollHeight));
  await shot(
    page,
    "quest-page",
    {
      register: await box(page.getByText("Register on the campaign page")),
      faucet: await box(page.getByText("Open the faucet")),
      watch: await box(page.getByRole("link", { name: /Fugu Watch/ })),
      picks: await box(page.locator("ul", { has: page.getByRole("link", { name: /Fugu Watch/ }) })),
      check: await box(page.getByRole("button", { name: "Check my agent" })),
    },
    { clip: { x: 0, y: 0, width: VIEW.width, height }, fullPage: true },
  );

  await page.goto(`${PROD}/agent/${encodeURIComponent(BUILDER_AGENT)}`, { waitUntil: "load" });
  const card = page.getByTestId("quest-readiness");
  await card.getByText(/\d of 6/).waitFor({ timeout: 90000 });
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(800);
  await shot(page, "checklist", { card: await box(card), score: await box(card.getByText(/\d of 6/)) });
  await ctx.close();
}

// ── Fork: hire Fugu Watch, see what it found, rate it ─────────────────────────────
{
  const account = privateKeyToAccount(generatePrivateKey());
  const chain = { ...bscTestnet, rpcUrls: { default: { http: [FORK] } } };
  const wallet = createWalletClient({ account, chain, transport: http(FORK) });
  const rpc = async (method, params = []) => {
    const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
    if (r.error) throw Object.assign(new Error(r.error.message), r.error);
    return r.result;
  };
  await rpc("anvil_setBalance", [account.address, "0x" + parseEther("1").toString(16)]);

  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
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
    const detail = Object.freeze({ info: { uuid: "7b1f9c3e-0000-4000-8000-0000000000ef", name: "Demo Wallet", rdns: "xyz.hellofugu.demo", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23f97316'/%3E%3C/svg%3E" }, provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  });

  // Connect.
  await page.goto(`${LOCAL}/me`, { waitUntil: "load" });
  const option = page.getByText("Demo Wallet").first();
  for (let i = 0; i < 5 && !(await option.isVisible()); i++) {
    await page.getByRole("button", { name: "Connect wallet" }).last().click();
    await option.waitFor({ timeout: 8000 }).catch(() => {});
  }
  await option.click();
  await page.getByTestId("my-console").waitFor({ timeout: 60000 });

  // Hire Fugu Watch for one period.
  await page.goto(`${LOCAL}/agent/97%3A2513`, { waitUntil: "load" });
  const hire = page.getByRole("button", { name: /^Hire Fugu Watch (again anyway )?for \$/ });
  await hire.waitFor({ timeout: 90000 });
  const one = page.locator("#hire").getByRole("button", { name: "1", exact: true });
  await one.click();
  // The quote is re-read when the period changes; shoot once the price is in.
  await page.locator("#hire").getByText("not read yet").waitFor({ state: "hidden", timeout: 60000 });
  await hire.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 180));
  await page.waitForTimeout(800);
  await shot(page, "watch-hire", { hire: await box(hire), one: await box(one), cost: await box(page.getByText("You pay").locator("..")) });
  await hire.click();
  const hired = page.getByText("Hired. The transaction is in a block.");
  await hired.waitFor({ timeout: 90000 });
  await page.waitForTimeout(1000);
  await shot(page, "watch-hired", { done: await box(hired) });

  // What it found, on /me.
  await page.goto(`${LOCAL}/me`, { waitUntil: "load" });
  const found = page.getByTestId("agent-result").first();
  await found.waitFor({ timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector("[data-testid=agent-result]")?.textContent?.includes("asking it"), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await shot(page, "me-found", { found: await box(found), countdown: await box(page.getByTestId("hire-countdown")) });

  // It finishes; the next agent's page asks for the rating first.
  await rpc("evm_increaseTime", [300]);
  await rpc("evm_mine", []);
  await page.goto(`${LOCAL}/agent/97%3A2514`, { waitUntil: "load" });
  const gate = page.getByTestId("rating-gate");
  await gate.getByText("Rate Fugu Watch before your next hire").waitFor({ timeout: 120000 });
  await gate.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(600);
  const release = gate.getByRole("button", { name: /^Release .+ tBNB to Fugu Watch$/ });
  await release.waitFor({ timeout: 60000 });
  await shot(page, "gate", { gate: await box(gate), release: await box(release) });
  await release.click();
  await gate.getByText("Payment released.").waitFor({ timeout: 60000 });
  await gate.getByRole("button", { name: "Continue to rating" }).click();
  const five = gate.getByRole("radio", { name: "5 of 5" });
  await five.click();
  await page.waitForTimeout(500);
  const rate = gate.getByRole("button", { name: "Rate Fugu Watch 5/5" });
  await shot(page, "gate-stars", { five: await box(five), rate: await box(rate) });
  await rate.click();
  await gate.getByText("Rating recorded on chain.").waitFor({ timeout: 60000 });
  const tally = page.getByRole("button", { name: /^Hire Fugu Tally (again anyway )?for \$/ });
  await tally.waitFor({ timeout: 90000 });
  await tally.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 160));
  await page.waitForTimeout(800);
  await shot(page, "gate-open", { hire: await box(tally) });
  await ctx.close();
}

await browser.close();
fs.mkdirSync(join(ROOT, "src", "quest"), { recursive: true });
fs.writeFileSync(join(ROOT, "src", "quest", "captured.json"), JSON.stringify(meta, null, 2) + "\n");
log("done");
