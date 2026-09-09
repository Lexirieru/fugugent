#!/usr/bin/env node
/**
 * Records the live site straight from Chrome, through the DevTools Protocol.
 *
 * Not a desktop screen recorder: `Page.startScreencast` gives frames from the page
 * itself, so there is no window chrome, no cursor from another app, and no dependence
 * on what happens to be on this machine's screen. It also means the recording is
 * reproducible, which matters more than it sounds: a demo video that cannot be
 * regenerated goes stale the first time the product changes.
 *
 * Frames are pulled one at a time with `Page.captureScreenshot`, and the scroll
 * position is set explicitly for each one. That is deliberate and was arrived at the
 * hard way: `Page.startScreencast` only emits a frame when the page repaints, so a
 * still page delivers one frame and then nothing. The first run of this script
 * recorded 110 frames for the landing page, 2 for another scene, and 0 for three
 * more. Stepping the scroll ourselves makes the frame count exact, the motion
 * perfectly even, and the whole recording reproducible.
 *
 * Two more traps, both of which have faked results on this machine before:
 *
 *   1. `--window-size=390` renders at 500 and crops. Widths come from CDP
 *      `Emulation.setDeviceMetricsOverride` instead, which is the real thing.
 *   2. Headless with no display never runs the rendering lifecycle, so
 *      IntersectionObserver and `whileInView` never fire and the page records blank.
 *      Capturing a screenshot is itself what forces a frame, which is the second
 *      reason to pull rather than subscribe.
 *
 * Scenes are declared below rather than driven by hand, so re-recording is one
 * command and the video cannot go stale without anyone noticing.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Written straight into `public/`, which is where Remotion resolves `staticFile()`.
 *
 * These used to be written to `assets/capture` and copied across by hand. A re-record then
 * landed in one place while the render read the other, and the video came out mixing an old
 * take with a new script. One directory removes the possibility.
 */
const OUT = join(ROOT, "public", "capture");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 24;

/**
 * One entry per shot. `actions` runs against the live page; anything it cannot do
 * without inventing state, it does not do. No fake wallet, no fake balance.
 */
const SCENES = [
  { id: "landing",      url: "https://hellofugu.xyz/",                          seconds: 5, from: 0,    to: 0 },
  { id: "landing-rails", url: "https://hellofugu.xyz/",                         seconds: 6, from: 200,  to: 1500 },
  { id: "marketplace",  url: "https://app.hellofugu.xyz/agents",                seconds: 6, from: 0,    to: 900 },
  { id: "ready-filter", url: "https://app.hellofugu.xyz/agents?available=yes",  seconds: 6, from: 0,    to: 800 },
  { id: "agent-detail", url: "https://app.hellofugu.xyz/agent/97:8004",         seconds: 6, from: 300,  to: 1000 },
  { id: "agent-proof",  url: "https://app.hellofugu.xyz/agent/97:8004",         seconds: 7, from: 1150, to: 1390 },
  { id: "skills",       url: "https://app.hellofugu.xyz/skills",                seconds: 5, from: 0,    to: 700 },
];

async function cdp(port, sessionId, method, params, ws) {
  return ws.send(method, params, sessionId);
}

/** A tiny CDP client over the WebSocket the browser exposes. No dependency needed. */
async function connect(wsUrl) {
  const { WebSocket } = await import("node:http").then(() => import("ws")).catch(() => ({}));
  if (!WebSocket) throw new Error("ws module missing");
  const socket = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => {
    socket.once("open", res);
    socket.once("error", rej);
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      (listeners.get(msg.method) ?? []).forEach((fn) => fn(msg.params, msg.sessionId));
    }
  });
  return {
    send(method, params = {}, sessionId) {
      const msgId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(msgId, { resolve, reject });
        socket.send(JSON.stringify({ id: msgId, method, params, sessionId }));
      });
    },
    on(method, fn) {
      listeners.set(method, [...(listeners.get(method) ?? []), fn]);
    },
    close: () => socket.close(),
  };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

async function main() {
  const width = Number(process.env.CAPTURE_WIDTH ?? 1440);
  const height = Number(process.env.CAPTURE_HEIGHT ?? 900);

  // CAPTURE_ONLY re-records a subset. Without it every scene is recorded from scratch,
  // which is the right default: a partial re-record is how a video ends up mixing two
  // versions of the product.
  const only = (process.env.CAPTURE_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const wanted = only.length > 0 ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
  if (only.length === 0) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const port = 9333;
  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${width},${height}`,
  ]);
  chrome.stderr.on("data", () => {});

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(500);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await r.json()).webSocketDebuggerUrl;
    } catch {}
  }
  if (!wsUrl) throw new Error("Chrome never opened its debugging port");

  const ws = await connect(wsUrl);

  for (const scene of wanted) {
    const { targetId } = await ws.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await ws.send("Target.attachToTarget", { targetId, flatten: true });

    await ws.send("Page.enable", {}, sessionId);
    await ws.send("Runtime.enable", {}, sessionId);
    // The real width, not the window flag. See the note at the top of this file.
    await ws.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 2, mobile: false },
      sessionId,
    );

    const dir = join(OUT, scene.id);
    await mkdir(dir, { recursive: true });

    await ws.send("Page.navigate", { url: scene.url }, sessionId);
    // Long enough for fonts, images and the first data fetch. A short wait here shows
    // up as a scene that starts on a half-drawn page, which reads as a broken product.
    await sleep(4000);

    // Motion is not left to the browser. `scrollTo({behavior:"smooth"})` finishes on its
    // own schedule, so the recording would be a different length every run. Stepping the
    // position per frame with an ease makes it identical every time.
    const total = Math.round(FPS * scene.seconds);
    for (let f = 0; f < total; f++) {
      const t = total === 1 ? 1 : f / (total - 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const top = Math.round(scene.from + (scene.to - scene.from) * eased);
      await ws.send("Runtime.evaluate", { expression: `window.scrollTo(0, ${top})` }, sessionId);
      const shot = await ws.send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        sessionId,
      );
      await writeFile(join(dir, `${String(f).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
    }

    await ws.send("Target.closeTarget", { targetId });
    console.log(`captured ${scene.id}: ${total} frames`);
    await writeFile(join(dir, "frames.json"), JSON.stringify({ frames: total, seconds: scene.seconds }));
  }

  ws.close();
  chrome.kill();

  // One mp4 per scene. The frame count is exact, so the rate is simply FPS.
  for (const scene of wanted) {
    const dir = join(OUT, scene.id);
    if (!existsSync(join(dir, "00000.png"))) {
      console.warn(`! ${scene.id} produced no frames, skipping`);
      continue;
    }
    await run("ffmpeg", [
      "-y", "-loglevel", "error",
      "-framerate", String(FPS),
      "-i", join(dir, "%05d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
      join(OUT, `${scene.id}.mp4`),
    ]);
    console.log(`encoded ${scene.id}.mp4`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
