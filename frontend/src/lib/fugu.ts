/**
 * Karakter fugu sebagai markup SVG.
 *
 * Ini **port langsung** dari `docs/brand/generate-svg.py` — generator yang sama
 * yang membuat aset di `landingpage/public/brand/`. Alasannya: aset statis itu
 * hanya ada pada satu tingkat kembung untuk tiga dari empat karakter, sedangkan
 * marketplace harus bisa menggambar kombinasi karakter x tingkat mana pun.
 * Karena geometrinya sama persis, fugu di aplikasi dan fugu di landing page
 * adalah ikan yang sama.
 *
 * Keluarannya string, bukan JSX, supaya satu fungsi ini bisa dipakai dua tempat:
 * komponen React dan generator OG image (`ImageResponse` tidak menggambar
 * `<svg>` bersarang, tetapi menerimanya sebagai data URI di `<img>`).
 *
 * Aturan brand yang ditegakkan kode ini, bukan sekadar didokumentasikan:
 * warna badan menyatakan SIAPA agent itu dan tidak pernah berubah karena risiko;
 * bentuk badan dan cincin menyatakan SEBERAPA BERAT risikonya.
 */

import type { BloatLevel } from "@/lib/risk";

const OUTLINE = "#05121A";
const FOAM = "#F4F8F9";
const FOAM2 = "#E3ECEF";
const MUTED = "#6b7e97";

const RISK: Record<BloatLevel, string> = {
  1: "#009E73",
  2: "#F0E442",
  3: "#E69F00",
  4: "#D55E00",
  5: "#A4210E",
};

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
  guardian: { body: "#0072B2", belly: "#58A9E0", ws: 1.06, hs: 0.95 },
  rebalancer: { body: "#CC79A7", belly: "#E9A8CC", ws: 0.94, hs: 1.06 },
  grid: { body: "#56B4E9", belly: "#8FD3F4", ws: 0.98, hs: 1.02 },
  yield: { body: "#E69F00", belly: "#FFC24D", ws: 1.07, hs: 1.06 },
};

const CX = 50;
const CY = 54;

const f = (n: number) => n.toFixed(2);

/**
 * Warna fugu pihak ketiga: hue deterministik dari id agent, saturasi dan
 * lightness DIKUNCI (`characters.md` §7) supaya tidak pernah ada kartu yang menyala
 * lebih terang daripada agent terkurasi. Rentang hijau (95–150) dan merah (0–20)
 * dilewati — dua rentang itu milik semantik risiko, bukan milik identitas.
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
    const tipw = ext < 0.5 ? 2.2 : 0; // tumpul di tingkat 2
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
 * Properti khas tiap karakter — perisai, segitiga tegak, daun, lengan timbangan.
 * Satu fungsi untuk dua penyaji (badan berisi dan siluet berlubang), supaya
 * siluet "tanpa bacaan" tidak pernah kehilangan identitas agent-nya.
 */
function dorsal(kind: FuguKind, rx: number, ry: number, body: string, hollow: boolean): string {
  const fill = (c: string) => (hollow ? "none" : c);
  const out: string[] = [];

  if (kind === "guardian") {
    // Perisai punggung — tepi atas siluet menjadi lurus. Pembeda 48 px Guardian.
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
 * Cincin risiko. **Polanya** yang membawa pesan, bukan warnanya — inilah yang
 * membuat tingkat tetap terbaca dalam grayscale 48 piksel.
 *
 * Berbeda tipis dari generator Python pada tingkat 2: takik jam 12 di sana
 * ditutup persegi berwarna latar, yang hanya benar kalau latarnya diketahui.
 * Di sini takik itu adalah celah busur sungguhan, jadi cincinnya benar di atas
 * latar apa pun.
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
  /** `null` = tidak ada bacaan segar. Digambar berlubang, bukan ditebak. */
  level: BloatLevel | null;
  /** Seed warna untuk `kind: "fallback"`. */
  seed?: string;
  /** Id unik supaya `clipPath`/`pattern` tidak bertabrakan saat banyak fugu sekaligus. */
  uid?: string;
  withRim?: boolean;
  /** Warna latar kotak; `null` berarti transparan. */
  background?: string | null;
}

function charFor(kind: FuguKind, seed: string): CharSpec {
  return kind === "fallback" ? fallbackChar(seed) : CHARS[kind];
}

/**
 * Keadaan "tidak ada bacaan segar": siluet berlubang, tanpa isi, tanpa duri,
 * tanpa cincin. `puff-levels.md` §3 — menebak tingkat dari data lama adalah
 * kebohongan yang paling mahal di produk ini, jadi kita menggambar ketidaktahuan
 * apa adanya.
 */
function hollowBody(kind: FuguKind, c: CharSpec): string {
  const color = c.body;
  const [w, h] = LEVEL_WH[2];
  // Proporsi karakternya dipertahankan, supaya lengan Rebalancer tetap muat di kotak.
  const rx = (w * c.ws) / 2;
  const ry = (h * c.hs) / 2;
  const bx = CX - rx * 0.92;
  const by = CY + ry * 0.08;
  const er = 0.3 * ry;
  const ny = CY - 0.34 * ry;
  const nearx = CX + 0.42 * rx;
  const farx = nearx - 2.15 * er;
  // Identitas tetap terbaca — siluet dan properti khasnya tidak ikut hilang.
  // Yang hilang adalah persis kanal-kanal risiko: isi badan, duri, dan cincin.
  return (
    `<g fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-dasharray="5 4" opacity="0.8">` +
    `<path d="M${f(bx)},${f(by - 7)} L${f(bx - 17)},${f(by - 15)} L${f(bx - 12)},${f(by - 4)} L${f(bx - 19)},${f(by)} L${f(bx - 12)},${f(by + 4)} L${f(bx - 17)},${f(by + 15)} L${f(bx)},${f(by + 7)} Z"/>` +
    dorsal(kind, rx, ry, color, true) +
    `<path d="${ell(CX, CY, rx, ry)}"/>` +
    `</g>` +
    `<g fill="none" stroke="${MUTED}" stroke-width="2.4">` +
    `<circle cx="${f(farx)}" cy="${f(ny)}" r="${f(er * 0.92)}"/>` +
    `<circle cx="${f(nearx)}" cy="${f(ny)}" r="${f(er)}"/>` +
    `</g>`
  );
}

/** Isi kotak 100x100 — tanpa elemen `<svg>` pembungkus. */
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

  // --- di belakang badan ---------------------------------------------------
  const bx = CX - rx * 0.92;
  const by = CY + ry * 0.08;
  g.push(
    `<path fill="${c.body}" d="M${f(bx)},${f(by - 7)} L${f(bx - 17)},${f(by - 15)} L${f(bx - 12)},${f(by - 4)} L${f(bx - 19)},${f(by)} L${f(bx - 12)},${f(by + 4)} L${f(bx - 17)},${f(by + 15)} L${f(bx)},${f(by + 7)} Z"/>`,
  );

  g.push(dorsal(kind, rx, ry, c.body, false));

  g.push(`<g fill="${c.body}">${spikes(rx, ry, ext, level === 5)}</g>`);

  // --- badan ---------------------------------------------------------------
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
    // Bilah meteran health factor di tepi perisai — terisi penuh saat tenang.
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

/** SVG lengkap sebagai string. Dipakai OG image dan komponen React. */
export function fuguSvg(opts: FuguOptions & { size?: number }): string {
  const size = opts.size;
  const dim = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dim}>${fuguInner(opts)}</svg>`;
}

/** Data URI — satu-satunya cara memasukkan fugu ke dalam `ImageResponse`. */
export function fuguDataUri(opts: FuguOptions & { size?: number }): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(fuguSvg(opts))}`;
}
