#!/usr/bin/env node
/**
 * Fetches the film's third-party assets into public/film/ (gitignored, like every
 * other generated asset here) and checks each against the hash it was cut with.
 *
 *   - studio_small_09_1k.hdr: "Studio Small 09" by Sergej Majboroda, Poly Haven, CC0.
 *   - techno-0-pro-sensory.mp3: "Techno" from Pro Sensory's "Electronic" pack,
 *     OpenGameArt (opengameart.org/content/electronic), CC0.
 *
 * The brand marks are copied from the landing page. The fish art comes from the
 * fugu-art step (`frontend/src/lib/fugu.ts`, see README); run it first, and this
 * rasterises its coin face into the PNG the 3D coin wears.
 *
 *   node scripts/assets-film.mjs
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/film");
mkdirSync(OUT, { recursive: true });

const FILES = [
  { name: "studio_small_09_1k.hdr", url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr", md5: "d5d7eb9d26d341d6aa4d11c1a54fd97c" },
  { name: "techno-0-pro-sensory.mp3", url: "https://opengameart.org/sites/default/files/Techno_0.mp3", md5: "f4d1d5a751abae9435412af3732c7ca6" },
];
const md5 = (buf) => createHash("md5").update(buf).digest("hex");

for (const f of FILES) {
  const path = join(OUT, f.name);
  if (existsSync(path) && md5(readFileSync(path)) === f.md5) {
    console.log(`${f.name}: present`);
    continue;
  }
  const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
  if (md5(buf) !== f.md5) throw new Error(`${f.name}: md5 ${md5(buf)}, expected ${f.md5}; the source changed, re-check its licence and the cut`);
  writeFileSync(path, buf);
  console.log(`${f.name}: downloaded`);
}
for (const [from, to] of [["../landingpage/public/brand/maskot.svg", "maskot.svg"], ["../landingpage/public/logos/tracks/bnb-chain.svg", "bnb-chain.svg"]]) {
  copyFileSync(join(ROOT, from), join(OUT, to));
}
console.log("brand marks copied");

// The coin's face as a PNG texture, rasterised from the fugu-art step's SVG.
const face = join(OUT, "coin-face.svg");
if (existsSync(face)) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<body style="margin:0;background:transparent">${readFileSync(face, "utf8")}</body>`);
  await page.screenshot({ path: join(OUT, "coin-face.png"), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  await browser.close();
  console.log("coin-face.png rasterised");
} else {
  console.log("coin-face.svg missing: run the fugu-art step first (README)");
}
