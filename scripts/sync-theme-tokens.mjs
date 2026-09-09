#!/usr/bin/env node
/**
 * Copies the canonical theme tokens into each app.
 *
 * The tokens live once, at theme/tokens.css. The two apps used to `@import` that
 * path directly, and it worked on a laptop and nowhere else: Vercel builds inside
 * the project's Root Directory, so a path reaching above it fails in CI with
 * "Can't resolve '../../theme/tokens.css'". Two landing-page deploys died that way
 * and the production alias quietly stayed on a four-hour-old build, which looks
 * exactly like code that was never written.
 *
 * So each app gets a copy, and the copy is committed — a build must never depend on
 * a generation step that the build environment may not be able to run. The source of
 * truth is still one file; CI regenerates and fails on any diff, so the copies cannot
 * drift. A missing source exits non-zero rather than leaving a build to produce an
 * unthemed page that nobody notices until it is live.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "theme", "tokens.css");

const targets = [
  join(root, "landingpage", "src", "theme-tokens.generated.css"),
  join(root, "frontend", "src", "app", "theme-tokens.generated.css"),
];

let css;
try {
  css = readFileSync(source, "utf8");
} catch (err) {
  console.error(`sync-theme-tokens: cannot read ${source}\n${err.message}`);
  process.exit(1);
}

const banner =
  "/* GENERATED FILE - do not edit, and do not delete: the apps import this, not\n" +
  "   the source. Source: theme/tokens.css. Regenerate with\n" +
  "   `node scripts/sync-theme-tokens.mjs`; CI fails if the copies have drifted. */\n\n";

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, banner + css, "utf8");
  console.log(`sync-theme-tokens: wrote ${target.replace(root + "/", "")}`);
}
