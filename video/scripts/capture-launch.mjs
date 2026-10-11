#!/usr/bin/env node
/**
 * Records the stills the launch film is cut from.
 *
 * Every frame is a 2x screenshot of the real site, not a mockup. The camera moves, the
 * cursor and the zooms are done afterwards in Remotion, which is what keeps them smooth
 * and the text sharp at 2x zoom: a screen recording would be soft the moment the camera
 * pushed in. Alongside each still it writes where the things the camera visits are
 * (`launch.json`), measured from the DOM, so a zoom lands on the button and not near it.
 *
 * Where it reads from:
 *   - the landing page and the catalogue: production, so the numbers are live;
 *   - the hire and My agents: a local build on an anvil fork of BSC testnet, with a
 *     burner wallet. Nothing is sent to the real chain.
 *
 *   anvil --fork-url https://bsc-testnet-rpc.publicnode.com --chain-id 97 --port 8546
 *   (cd backend && RPC_URL=http://127.0.0.1:8546 RPC_FALLBACK_URLS= PORT=8799 npx tsx src/index.ts)
 *   (cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8799 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546 \
 *      bun run build && NEXT_PUBLIC_API_BASE_URL=http://localhost:8799 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546 bun run start -p 3000)
 *   (cd video && npm run capture:launch)
 */
import fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "launch");
fs.mkdirSync(OUT, { recursive: true });

const LANDING = "https://hellofugu.xyz";
const PROD_APP = "https://app.hellofugu.xyz";
const LOCAL_APP = "http://localhost:3000";
const FORK = "http://127.0.0.1:8546";
const PLANE = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260801_022931_e13cbef4-690a-42d2-b5ee-5b3b1f483c83.mp4";
const VIEW = { width: 1440, height: 900 };

// ONLY=landing,app,fork records a subset and keeps the other shots from the last run.
const ONLY = new Set((process.env.ONLY ?? "landing,app,fork").split(","));
const META_FILE = join(ROOT, "src", "launch", "captured.json");
const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, "utf8")) : { viewport: VIEW, scale: 2, shots: {} };
const log = (...a) => console.log("•", ...a);

/** A box in CSS pixels, relative to the screenshot it belongs to. */
async function box(locator, offsetY = 0) {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error(`no box for ${locator}`);
  return { x: Math.round(b.x), y: Math.round(b.y + offsetY), w: Math.round(b.width), h: Math.round(b.height) };
}

async function shot(page, name, extra = {}, opts = {}) {
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
  const size = opts.fullPage
    ? await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))
    : VIEW;
  meta.shots[name] = { file: `launch/${name}.png`, ...size, ...extra };
  log(name);
}

async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch();

// ── Landing ───────────────────────────────────────────────────────────────────────
if (ONLY.has("landing")) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(LANDING, { waitUntil: "load" });
  await settle(page, 2000);

  // The aircraft video is its own layer in the film: the UI is shot on a transparent
  // background with the video hidden, and the video is laid back underneath it.
  const video = await box(page.locator(".ph-video"));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".ph-page")).backgroundColor);
  await page.addStyleTag({ content: "html,body,.ph-page{background:transparent!important}.ph-video{visibility:hidden!important}" });
  await shot(page, "landing-hero-ui", { video, bg }, { omitBackground: true });
  await page.addStyleTag({ content: ".ph-video{visibility:visible!important}html,body{background:var(--bg)!important}" });

  // The page under the hero, for a scroll.
  await page.evaluate(() => window.scrollTo(0, 0));
  const heroH = await page.evaluate(() => document.querySelector(".ph-page").getBoundingClientRect().height);
  await page.evaluate((y) => window.scrollTo(0, y), heroH);
  await settle(page, 1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: ".ph-page{display:none!important}" });
  await settle(page, 800);
  await shot(page, "landing-below", {}, { clip: { x: 0, y: 0, width: VIEW.width, height: 2700 }, fullPage: true });
  meta.shots["landing-below"].height = 2700;
  await ctx.close();

  if (!fs.existsSync(join(OUT, "plane.mp4"))) {
    const r = await fetch(PLANE);
    fs.writeFileSync(join(OUT, "plane.mp4"), Buffer.from(await r.arrayBuffer()));
    log("plane.mp4");
  }
}

// ── Catalogue and an agent page, from production ──────────────────────────────────
if (ONLY.has("app")) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(PROD_APP, { waitUntil: "load" });
  await settle(page, 2500);
  await shot(page, "app-home", {}, { clip: { x: 0, y: 0, width: VIEW.width, height: 1800 }, fullPage: true });
  meta.shots["app-home"].height = 1800;

  await page.goto(`${PROD_APP}/agents`, { waitUntil: "load" });
  await settle(page, 2500);
  const tab = page.getByRole("link", { name: /^Health factor/ });
  await page.evaluate(() => window.scrollTo(0, 260));
  await page.waitForTimeout(600);
  await shot(page, "agents-all", { tab: await box(tab) });

  await page.goto(`${PROD_APP}/agents?category=HEALTH_FACTOR`, { waitUntil: "load" });
  await settle(page, 2500);
  await page.evaluate(() => window.scrollTo(0, 260));
  await page.waitForTimeout(600);
  const guardianCard = page.locator("article", { hasText: "Fugu Guardian" }).filter({ hasNotText: "Early" });
  await shot(page, "agents-hf", { tab: await box(page.getByRole("link", { name: /^Health factor/ })), card: await box(guardianCard) });

  await page.goto(`${PROD_APP}/agent/97%3A2480`, { waitUntil: "load" });
  await settle(page, 3000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  // The evidence block is filled from the API after load; wait for it, generously.
  await page.getByText("Registry contract").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(400);
  await shot(
    page,
    "agent-page",
    {
      title: await box(page.getByRole("heading", { level: 1 })),
      evidence: await box(page.getByText("Registry contract")),
      registered: await box(page.getByText("Registered in")),
    },
    { clip: { x: 0, y: 0, width: VIEW.width, height: 3000 }, fullPage: true },
  );
  meta.shots["agent-page"].height = 3000;
  await ctx.close();
}

// ── Hire and My agents, on the fork ───────────────────────────────────────────────
if (ONLY.has("fork")) {
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
    const detail = Object.freeze({ info: { uuid: "7b1f9c3e-0000-4000-8000-0000000000ee", name: "Demo Wallet", rdns: "xyz.hellofugu.demo", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23f97316'/%3E%3C/svg%3E" }, provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  });

  // Connect from /me.
  await page.goto(`${LOCAL_APP}/me`, { waitUntil: "load" });
  await settle(page, 2000);
  const connect = page.getByRole("button", { name: "Connect wallet" }).last();
  await shot(page, "me-connect", { connect: await box(connect) });
  const option = page.getByText("Demo Wallet").first();
  for (let i = 0; i < 5 && !(await option.isVisible()); i++) {
    await connect.click();
    await option.waitFor({ timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await shot(page, "me-modal", { option: await box(option) });
  await option.click();
  await page.getByTestId("my-console").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);

  // Hire Fugu Guardian.
  await page.goto(`${LOCAL_APP}/agent/97%3A2480`, { waitUntil: "load" });
  const hire = page.getByRole("button", { name: /^Hire Fugu Guardian (again anyway )?for \$/ });
  await hire.waitFor({ timeout: 90000 });
  await hire.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(1200);
  const panel = page.locator("section", { has: hire }).last();
  await shot(page, "hire-before", { hire: await box(hire), panel: await box(panel) });
  await hire.click();
  await page.getByText("Hired. The transaction is in a block.").waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await shot(page, "hire-after", { done: await box(page.getByText("Hired. The transaction is in a block.")) });

  // My agents: the running hire and its countdown, one still a second.
  await page.goto(`${LOCAL_APP}/me`, { waitUntil: "load" });
  await page.getByTestId("hire-countdown").first().waitFor({ timeout: 90000 });
  await page.waitForTimeout(1500);
  const countdown = page.getByTestId("hire-countdown").first();
  const row = page.locator("li", { has: countdown }).first();
  for (let i = 0; i < 5; i++) {
    await shot(page, `me-running-${i}`, { countdown: await box(countdown), row: await box(row) });
    await page.waitForTimeout(1000 - 120);
  }
  const cancel = page.getByRole("button", { name: "Cancel Fugu Guardian and refund the rest" }).first();
  meta.shots["me-running-0"].cancel = await box(cancel);
  await cancel.click();
  const yes = page.getByRole("button", { name: "Yes, cancel and refund" });
  await yes.waitFor();
  await page.waitForTimeout(500);
  await shot(page, "me-confirm", { yes: await box(yes) });
  await yes.click();
  await page.getByTestId("console-cancelled").waitFor({ timeout: 90000 });
  await page.waitForTimeout(1200);
  await shot(page, "me-cancelled", { notice: await box(page.getByTestId("console-cancelled")) });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + "\n");
log("done");
