/**
 * The fugu characters as SVG markup.
 *
 * This is a **direct port** of `docs/brand/generate-svg.py` — the same generator that
 * produced the assets in `landingpage/public/brand/`. The reason: those static assets
 * exist at a single puff level only, for three of the four characters, whereas the
 * marketplace has to be able to draw any character x level combination. Because the
 * geometry is identical, the fugu in the app and the fugu on the landing page are
 * the same fish.
 *
 * The output is a string rather than JSX, so this one function serves two places: a
 * React component and the OG image generator (`ImageResponse` does not draw a nested
 * `<svg>`, but it does accept one as a data URI in an `<img>`).
 *
 * The brand rules this code enforces rather than merely documents: the body colour says
 * WHO the agent is and never changes because of risk; the body shape and the ring say
 * HOW HEAVY the risk is.
 */

import type { BloatLevel } from "@/lib/risk";
import { AGENT, ILLUSTRATION, RISK as RISK_COLOURS } from "@/lib/theme";

/*
 * Every colour below comes from `lib/theme.ts`, the server-side projection of the
 * shared `theme/tokens.css`. This file used to carry its own hex literals, which is
 * how the app's fish and the brand's fish were free to drift apart.
 *
 * The illustration colours (outline, foam, bellies, body colours) are byte-identical
 * to `docs/brand/generate-svg.py`, so the fish here really is the fish on the landing
 * page. The one part that is NOT identical is the risk ring: the static plates in
 * `landingpage/public/brand/guardian-kembung-*.svg` paint their own #0B1E2B tile and
 * therefore keep the original dark-ground Okabe–Ito rings, while the fish here is drawn
 * inline on a cream card and uses the light-ground ring colours. Same hues, same order,
 * different ground — see the puff-level block in theme/tokens.css.
 */
const OUTLINE = ILLUSTRATION.outline;
const FOAM = ILLUSTRATION.foam;
const FOAM2 = ILLUSTRATION.foam2;
const MUTED = ILLUSTRATION.hollow;

const RISK: Record<BloatLevel, string> = RISK_COLOURS;

const LEVEL_WH: Record<BloatLevel, [number, number]> = {
  1: [56, 52],
  2: [64, 58],
  3: [72, 66],
  4: [80, 74],
  5: [86, 82],
};

const LEVEL_EXT: Record<BloatLevel, number> = { 1: 0, 2: 0.25, 3: 0.6, 4: 1, 5: 1 };

export type FuguKind = "guardian" | "rebalancer" | "grid" | "yield" | "fallback";

interface CharSpec {
  body: string;
  belly: string;
  ws: number;
  hs: number;
}

const CHARS: Record<Exclude<FuguKind, "fallback">, CharSpec> = {
  guardian: { ...AGENT.guardian, ws: 1.06, hs: 0.95 },
  rebalancer: { ...AGENT.rebalancer, ws: 0.94, hs: 1.06 },
  grid: { ...AGENT.grid, ws: 0.98, hs: 1.02 },
  yield: { ...AGENT.yield, ws: 1.07, hs: 1.06 },
};

const CX = 50;
const CY = 54;

const f = (n: number) => n.toFixed(2);

/**
 * The colour of a third-party fugu: a deterministic hue from the agent id, with
 * saturation and lightness LOCKED (`characters.md` §7) so no card ever glows brighter
 * than a curated agent. The green range (95–150) and the red range (0–20) are skipped —
 * those two belong to the risk semantics, not to identity.
 */
export function fallbackChar(seed: string): CharSpec {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let hue = Math.abs(h) % 360;
  if (hue >= 95 && hue <= 150) hue = (hue + 60) % 360;
  if (hue <= 20) hue = hue + 200;
  return {
    body: `hsl(${hue} 42% 52%)`,
    belly: `hsl(${hue} 42% 68%)`,
    ws: 1,
    hs: 1,
  };
}

function ell(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)},${f(cy)} a${f(rx)},${f(ry)} 0 1,0 ${f(2 * rx)},0 a${f(rx)},${f(ry)} 0 1,0 ${f(-2 * rx)},0 Z`;
}

function spikes(rx: number, ry: number, ext: number, secondary: boolean): string {
  if (ext <= 0) return "";
  const L = 10.5 * ext;
  const base = [185, 207, 229, 251, 273, 295, 317, 339, 356];
  const angles = secondary ? [...base, 196, 218, 240, 262, 284, 306, 328, 348] : base;
  const out: string[] = [];
  angles.forEach((a, i) => {
    const sec = secondary && i >= 9;
    const ln = L * (sec ? 0.55 : 1);
    const t = (a * Math.PI) / 180;
    const bx = CX + rx * Math.cos(t);
    const by = CY + ry * Math.sin(t);
    let nx = Math.cos(t) / rx;
    let ny = Math.sin(t) / ry;
    const n = Math.hypot(nx, ny);
    nx /= n;
    ny /= n;
    const tx = -ny;
    const ty = nx;
    const hw = 3.8 * (sec ? 0.6 : 1);
    const tipw = ext < 0.5 ? 2.2 : 0; // blunt at level 2
    const p1 = [bx + tx * hw, by + ty * hw];
    const p2 = [bx - tx * hw, by - ty * hw];
    if (tipw > 0) {
      const t1 = [bx + nx * ln + tx * tipw, by + ny * ln + ty * tipw];
      const t2 = [bx + nx * ln - tx * tipw, by + ny * ln - ty * tipw];
      out.push(
        `<path d="M${f(p1[0])},${f(p1[1])} L${f(t1[0])},${f(t1[1])} L${f(t2[0])},${f(t2[1])} L${f(p2[0])},${f(p2[1])} Z"/>`,
      );
    } else {
      const tp = [bx + nx * ln, by + ny * ln];
      out.push(
        `<path d="M${f(p1[0])},${f(p1[1])} L${f(tp[0])},${f(tp[1])} L${f(p2[0])},${f(p2[1])} Z"/>`,
      );
    }
  });
  return out.join("");
}

function eyes(rx: number, ry: number, level: BloatLevel, kind: FuguKind): string {
  const er = 0.3 * ry;
  const ny = CY - 0.34 * ry;
  const nearx = CX + 0.42 * rx;
  const farx = nearx - 2.15 * er;
  const g: string[] = [];

  for (const [cx, r] of [
    [farx, er * 0.92],
    [nearx, er],
  ] as const) {
    g.push(
      `<circle cx="${f(cx)}" cy="${f(ny)}" r="${f(r)}" fill="${FOAM}" stroke="${OUTLINE}" stroke-width="2.4"/>`,
    );
    if (level === 5) {
      const k = r * 0.52;
      g.push(
        `<path d="M${f(cx - k)},${f(ny - k)} L${f(cx + k)},${f(ny + k)} M${f(cx + k)},${f(ny - k)} L${f(cx - k)},${f(ny + k)}" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
      );
    } else {
      const pr = r * (level === 4 ? 0.24 : 0.5);
      const px = cx + r * 0.16;
      const py = ny + r * 0.06;
      g.push(`<circle cx="${f(px)}" cy="${f(py)}" r="${f(pr)}" fill="${OUTLINE}"/>`);
      g.push(
        `<circle cx="${f(px - r * 0.3)}" cy="${f(py - r * 0.34)}" r="${f(r * 0.15)}" fill="${FOAM}"/>`,
      );
      if (level === 1 || level === 3) {
        const kk = level === 1 ? -0.62 * r : -0.08 * r;
        const ww = Math.sqrt(Math.max(r * r - kk * kk, 0));
        const yy = ny + kk;
        g.push(
          `<path d="M${f(cx - ww)},${f(yy)} A${f(r)},${f(r)} 0 0,1 ${f(cx + ww)},${f(yy)} Z" fill="${OUTLINE}"/>`,
        );
      }
    }
  }

  if (level === 2) {
    g.push(
      `<path d="M${f(nearx - er)},${f(ny - er * 1.5)} L${f(nearx + er)},${f(ny - er * 1.9)}" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/>`,
    );
  }
  if (level === 4) {
    const sx = nearx + er * 1.5;
    const sy = ny - er * 0.4;
    g.push(
      `<path d="M${f(sx)},${f(sy)} q3.2,4.0 0,6.4 q-3.2,-2.4 0,-6.4 Z" fill="${FOAM}" stroke="${OUTLINE}" stroke-width="1.6"/>`,
    );
  }
  if (kind === "guardian" && level !== 5) {
    for (const cx of [farx, nearx]) {
      g.push(
        `<path d="M${f(cx - er * 0.95)},${f(ny - er * 1.62)} L${f(cx + er * 0.95)},${f(ny - er * 1.95)}" stroke="${OUTLINE}" stroke-width="2.8" stroke-linecap="round"/>`,
      );
    }
  }
  if (kind === "grid") {
    g.push(
      `<rect x="${f(farx - er * 1.25)}" y="${f(ny - er * 0.85)}" width="${f(nearx - farx + er * 2.5)}" height="${f(er * 0.55)}" rx="${f(er * 0.2)}" fill="${OUTLINE}"/>`,
    );
  }
  return g.join("");
}

function mouth(rx: number, ry: number, level: BloatLevel): string {
  const mx = CX + 0.3 * rx;
  const my = CY + 0.12 * ry;
  const w = 0.14 * rx;
  if (level <= 2) {
    return `<path d="M${f(mx - w)},${f(my)} q${f(w * 0.5)},${f(w * 0.8)} ${f(w)},0 q${f(w * 0.5)},${f(w * 0.8)} ${f(w)},0" fill="none" stroke="${OUTLINE}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  if (level === 3) {
    return `<ellipse cx="${f(mx)}" cy="${f(my)}" rx="${f(w * 0.55)}" ry="${f(w * 0.45)}" fill="${OUTLINE}"/>`;
  }
  if (level === 4) {
    return `<ellipse cx="${f(mx)}" cy="${f(my)}" rx="${f(w * 0.7)}" ry="${f(w * 0.8)}" fill="${OUTLINE}"/>`;
  }
  return `<ellipse cx="${f(mx)}" cy="${f(my)}" rx="${f(w)}" ry="${f(w * 1.25)}" fill="${OUTLINE}"/>`;
}

/**
 * Each character's distinguishing prop — shield, upright triangle, leaf, scale arms.
 * One function for both renderers (the filled body and the hollow silhouette), so that
 * the "no reading" silhouette never loses the agent's identity.
 */
function dorsal(kind: FuguKind, rx: number, ry: number, body: string, hollow: boolean): string {
  const fill = (c: string) => (hollow ? "none" : c);
  const out: string[] = [];

  if (kind === "guardian") {
    // The dorsal shield — it makes the top edge of the silhouette straight. Guardian's
    // 48 px differentiator.
    const sw = rx * 1.58;
    const sh = ry * 0.62;
    const sx = CX - sw / 2;
    const sy = CY - ry - 5.5;
    out.push(
      `<path fill="${fill(FOAM2)}" d="M${f(sx)},${f(sy + 6)} q0,-6 6,-6 L${f(sx + sw - 6)},${f(sy)} q6,0 6,6 L${f(sx + sw)},${f(sy + sh)} L${f(sx)},${f(sy + sh)} Z"/>`,
    );
  }
  if (kind === "grid") {
    out.push(
      `<path fill="${fill(body)}" d="M${f(CX - 9)},${f(CY - ry + 2)} L${f(CX + 1)},${f(CY - ry - 15)} L${f(CX + 9)},${f(CY - ry + 2)} Z"/>`,
    );
  }
  if (kind === "yield") {
    out.push(
      `<path fill="${fill(body)}" d="M${f(CX - 2)},${f(CY - ry + 3)} Q${f(CX + 14)},${f(CY - ry - 20)} ${f(CX + 22)},${f(CY - ry - 6)} Q${f(CX + 16)},${f(CY - ry + 3)} ${f(CX + 10)},${f(CY - ry + 4)} Z"/>`,
    );
  }
  if (kind === "rebalancer") {
    const ay = CY - ry * 0.15;
    for (const sgn of [-1, 1]) {
      const x0 = CX + sgn * rx * 0.55;
      const x1 = CX + sgn * (rx + 15);
      out.push(
        `<path fill="${fill(FOAM)}" d="M${f(x0)},${f(ay - 5)} L${f(x1)},${f(ay - 3.5)} L${f(x1)},${f(ay + 3.5)} L${f(x0)},${f(ay + 5)} Z"/>`,
      );
    }
    out.push(`<circle cx="${f(CX - (rx + 15) - 4)}" cy="${f(ay)}" r="4.6" fill="${fill(FOAM)}"/>`);
    out.push(`<circle cx="${f(CX + (rx + 15) + 3)}" cy="${f(ay)}" r="3.0" fill="${fill(FOAM)}"/>`);
  }
  return out.join("");
}

function polar(r: number, deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [50 + r * Math.cos(t), 50 + r * Math.sin(t)];
}

/**
 * The risk ring. It is the **pattern** that carries the message, not the colour — that
 * is what keeps the level readable in grayscale at 48 pixels.
 *
 * One small difference from the Python generator, at level 2: there, the twelve o'clock
 * notch is covered by a rectangle painted in the background colour, which is only
 * correct when the background is known. Here the notch is a real gap in the arc, so the
 * ring is correct over any background.
 */
function rim(level: BloatLevel, uid: string): string {
  if (level === 1) {
    const [x0, y0] = polar(45, 198);
    const [x1, y1] = polar(45, 342);
    return `<path d="M${f(x0)},${f(y0)} A45,45 0 0,1 ${f(x1)},${f(y1)}" fill="none" stroke="${RISK[1]}" stroke-width="2" stroke-linecap="round"/>`;
  }
  if (level === 2) {
    const [x0, y0] = polar(45, -85);
    const [x1, y1] = polar(45, -95);
    return `<path d="M${f(x0)},${f(y0)} A45,45 0 1,1 ${f(x1)},${f(y1)}" fill="none" stroke="${RISK[2]}" stroke-width="3" stroke-linecap="butt"/>`;
  }
  if (level === 3) {
    return `<circle cx="50" cy="50" r="45" fill="none" stroke="${RISK[3]}" stroke-width="3" stroke-dasharray="6 4"/>`;
  }
  if (level === 4) {
    return (
      `<circle cx="50" cy="50" r="46" fill="none" stroke="${RISK[4]}" stroke-width="2"/>` +
      `<circle cx="50" cy="50" r="42" fill="none" stroke="${RISK[4]}" stroke-width="2"/>`
    );
  }
  return (
    `<circle cx="50" cy="50" r="45" fill="none" stroke="url(#hz-${uid})" stroke-width="8"/>` +
    `<circle cx="50" cy="50" r="49" fill="none" stroke="${OUTLINE}" stroke-width="1"/>` +
    `<circle cx="50" cy="50" r="41" fill="none" stroke="${OUTLINE}" stroke-width="1"/>`
  );
}

export interface FuguOptions {
  kind: FuguKind;
  /** `null` = no fresh reading. Drawn hollow rather than guessed. */
  level: BloatLevel | null;
  /** The colour seed for `kind: "fallback"`. */
  seed?: string;
  /** A unique id so `clipPath`/`pattern` do not collide when many fugu render at once. */
  uid?: string;
  withRim?: boolean;
  /** The background colour of the box; `null` means transparent. */
  background?: string | null;
}

function charFor(kind: FuguKind, seed: string): CharSpec {
  return kind === "fallback" ? fallbackChar(seed) : CHARS[kind];
}

/**
 * The "no fresh reading" state: a hollow silhouette, no fill, no spikes, no ring.
 * `puff-levels.md` §3 — guessing a level from stale data is the most expensive lie this
 * product could tell, so we draw the not-knowing exactly as it is.
 */
function hollowBody(kind: FuguKind, c: CharSpec): string {
  const color = c.body;
  const [w, h] = LEVEL_WH[2];
  // The character's proportions are kept, so the Rebalancer's arms still fit the box.
  const rx = (w * c.ws) / 2;
  const ry = (h * c.hs) / 2;
  const bx = CX - rx * 0.92;
  const by = CY + ry * 0.08;
  const er = 0.3 * ry;
  const ny = CY - 0.34 * ry;
  const nearx = CX + 0.42 * rx;
  const farx = nearx - 2.15 * er;
  // Identity stays readable — the silhouette and the distinguishing prop do not
  // disappear with it. What disappears is exactly the risk channels: the body fill,
  // the spikes, and the ring.
  //
  // The halo underneath is what makes that survive a light page. Everywhere else an
  // agent's colour is a FILL inside a 3px #05121A outline, and it is the outline that
  // carries the shape; here the identity colour IS the stroke, with nothing under it.
  // On cream that leaves #E69F00 (Yield) at 1.84:1 and #56B4E9 (Grid) at 1.88:1 — the
  // fish all but evaporates. Drawing the same three paths first in the outline colour,
  // one unit wider and at 0.3, gives the silhouette a dark edge on any ground without
  // touching the identity colour itself, which the brand rule fixes.
  const shape =
    `<path d="M${f(bx)},${f(by - 7)} L${f(bx - 17)},${f(by - 15)} L${f(bx - 12)},${f(by - 4)} L${f(bx - 19)},${f(by)} L${f(bx - 12)},${f(by + 4)} L${f(bx - 17)},${f(by + 15)} L${f(bx)},${f(by + 7)} Z"/>` +
    dorsal(kind, rx, ry, color, true) +
    `<path d="${ell(CX, CY, rx, ry)}"/>`;
  return (
    `<g fill="none" stroke="${OUTLINE}" stroke-width="4.4" stroke-linejoin="round" stroke-dasharray="5 4" opacity="0.3">` +
    shape +
    `</g>` +
    `<g fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-dasharray="5 4" opacity="0.9">` +
    shape +
    `</g>` +
    `<g fill="none" stroke="${MUTED}" stroke-width="2.4">` +
    `<circle cx="${f(farx)}" cy="${f(ny)}" r="${f(er * 0.92)}"/>` +
    `<circle cx="${f(nearx)}" cy="${f(ny)}" r="${f(er)}"/>` +
    `</g>`
  );
}

/** The contents of the 100x100 box — without a wrapping `<svg>` element. */
export function fuguInner(opts: FuguOptions): string {
  const { kind, level, seed = kind, withRim = true, background = null } = opts;
  const uid = opts.uid ?? `${kind}-${level ?? "none"}`;
  const s: string[] = [];
  if (background) s.push(`<rect width="100" height="100" fill="${background}"/>`);

  if (level === null) {
    s.push(hollowBody(kind, charFor(kind, seed)));
    return s.join("");
  }

  const c = charFor(kind, seed);
  const [w, h] = LEVEL_WH[level];
  const rx = (w * c.ws) / 2;
  const ry = (h * c.hs) / 2;
  const ext = LEVEL_EXT[level];
  const body = ell(CX, CY, rx, ry);

  s.push("<defs>");
  s.push(`<clipPath id="cp-${uid}"><path d="${body}"/></clipPath>`);
  if (level === 5) {
    s.push(
      `<pattern id="hz-${uid}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        `<rect width="8" height="8" fill="${FOAM}"/><rect width="4" height="8" fill="${OUTLINE}"/></pattern>`,
    );
  }
  s.push("</defs>");

  const g: string[] = [`<g stroke="${OUTLINE}" stroke-width="3" stroke-linejoin="round">`];

  // --- behind the body -----------------------------------------------------
  const bx = CX - rx * 0.92;
  const by = CY + ry * 0.08;
  g.push(
    `<path fill="${c.body}" d="M${f(bx)},${f(by - 7)} L${f(bx - 17)},${f(by - 15)} L${f(bx - 12)},${f(by - 4)} L${f(bx - 19)},${f(by)} L${f(bx - 12)},${f(by + 4)} L${f(bx - 17)},${f(by + 15)} L${f(bx)},${f(by + 7)} Z"/>`,
  );

  g.push(dorsal(kind, rx, ry, c.body, false));

  g.push(`<g fill="${c.body}">${spikes(rx, ry, ext, level === 5)}</g>`);

  // --- the body ------------------------------------------------------------
  g.push(`<path d="${body}" fill="${c.body}"/>`);
  g.push(`<g clip-path="url(#cp-${uid})" stroke="none">`);
  g.push(
    `<ellipse cx="${f(CX)}" cy="${f(CY + 0.4 * ry)}" rx="${f(0.84 * rx)}" ry="${f(0.62 * ry)}" fill="${c.belly}"/>`,
  );
  if (kind === "grid") {
    const step = rx * 0.42;
    for (const i of [-1, 0, 1]) {
      g.push(
        `<path d="M${f(CX + i * step)},${f(CY - ry)} V${f(CY + ry)}" stroke="${OUTLINE}" stroke-width="1.4" opacity="0.20"/>`,
      );
      g.push(
        `<path d="M${f(CX - rx)},${f(CY + i * step * 0.8)} H${f(CX + rx)}" stroke="${OUTLINE}" stroke-width="1.4" opacity="0.20"/>`,
      );
    }
    g.push(
      `<rect x="${f(CX - step * 1.5)}" y="${f(CY - step * 1.6)}" width="${f(step)}" height="${f(step * 0.8)}" fill="${OUTLINE}" opacity="0.30"/>`,
    );
  }
  g.push(
    `<path fill-rule="evenodd" fill="${OUTLINE}" opacity="0.14" d="M0,0 H100 V100 H0 Z ${ell(CX + 5, CY - 4, rx, ry)}"/>`,
  );
  g.push("</g>");
  g.push(`<path d="${body}" fill="none"/>`);

  const fx = CX - 0.52 * rx;
  const fy = CY + 0.42 * ry;
  g.push(
    `<ellipse cx="${f(fx)}" cy="${f(fy)}" rx="${f(0.17 * rx)}" ry="${f(0.085 * ry)}" fill="${c.belly}" stroke-width="2.4" transform="rotate(-28 ${f(fx)} ${f(fy)})"/>`,
  );

  if (kind === "guardian") {
    // The health factor gauge bar on the edge of the shield — full when calm.
    const fill: Record<BloatLevel, number> = { 1: 1, 2: 0.75, 3: 0.5, 4: 0.3, 5: 0.08 };
    const gx = CX + rx * 0.6;
    const gy = CY - ry - 3.5;
    const gw = 4.6;
    const gh = ry * 0.52;
    g.push(
      `<rect x="${f(gx)}" y="${f(gy)}" width="${gw}" height="${f(gh)}" rx="1.6" fill="${FOAM}" stroke-width="2"/>`,
    );
    g.push(
      `<rect x="${f(gx + 1.1)}" y="${f(gy + gh * (1 - fill[level]) + 1.1)}" width="${gw - 2.2}" height="${f(Math.max(gh * fill[level] - 2.2, 0.8))}" rx="0.8" fill="${RISK[level]}" stroke="none"/>`,
    );
  }
  if (kind === "yield") {
    for (const [dx, dy, r] of [
      [-2, -14, 3.2],
      [-7, -20, 2.3],
      [-11, -25, 1.6],
    ]) {
      g.push(`<circle cx="${f(bx + dx)}" cy="${f(by + dy)}" r="${r}" fill="none" stroke-width="2"/>`);
    }
  }

  g.push(eyes(rx, ry, level, kind));
  g.push(mouth(rx, ry, level));
  g.push("</g>");
  s.push(g.join(""));
  if (withRim) s.push(rim(level, uid));
  return s.join("");
}

/** A complete SVG as a string. Used by the OG image and by the React component. */
export function fuguSvg(opts: FuguOptions & { size?: number }): string {
  const size = opts.size;
  const dim = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dim}>${fuguInner(opts)}</svg>`;
}

/** A data URI — the only way to get a fugu into an `ImageResponse`. */
export function fuguDataUri(opts: FuguOptions & { size?: number }): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(fuguSvg(opts))}`;
}
