#!/usr/bin/env python3
"""Generator SVG karakter Fugugent. Geometri mengikuti docs/brand/characters.md
dan docs/brand/puff-levels.md. Semua ukuran dalam kotak 100x100 unit."""
import math, os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "."

OUTLINE = "#05121A"
BG = "#0B1E2B"
FOAM = "#F4F8F9"
FOAM2 = "#E3ECEF"

RISK = {1: "#009E73", 2: "#F0E442", 3: "#E69F00", 4: "#D55E00", 5: "#A4210E"}
# lebar,tinggi dasar per tingkat (unit)
LEVEL_WH = {1: (56, 52), 2: (64, 58), 3: (72, 66), 4: (80, 74), 5: (86, 82)}
LEVEL_EXT = {1: 0.0, 2: 0.25, 3: 0.60, 4: 1.0, 5: 1.0}

CHARS = {
    "guardian":   dict(body="#0072B2", belly="#58A9E0", ws=1.06, hs=0.95),
    "rebalancer": dict(body="#CC79A7", belly="#E9A8CC", ws=0.94, hs=1.06),
    "grid":       dict(body="#56B4E9", belly="#8FD3F4", ws=0.98, hs=1.02),
    "yield":      dict(body="#E69F00", belly="#FFC24D", ws=1.07, hs=1.06),
    "maskot":     dict(body="#0E7C86", belly="#9CE9EE", ws=1.02, hs=1.00),
    "fallback":   dict(body="#6E8C6E", belly="#94AE94", ws=1.00, hs=1.00),
}

CX, CY = 50.0, 54.0


def ell(cx, cy, rx, ry):
    return (f"M{cx - rx:.2f},{cy:.2f} a{rx:.2f},{ry:.2f} 0 1,0 {2 * rx:.2f},0 "
            f"a{rx:.2f},{ry:.2f} 0 1,0 {-2 * rx:.2f},0 Z")


def spikes(rx, ry, ext, secondary=False):
    """Duri di lima baris mengikuti punggung dan sisi. ext 0..1."""
    if ext <= 0:
        return ""
    L = 10.5 * ext
    out = []
    angles = [185, 207, 229, 251, 273, 295, 317, 339, 356]
    if secondary:
        angles = angles + [196, 218, 240, 262, 284, 306, 328, 348]
    for i, a in enumerate(angles):
        sec = secondary and i >= 9
        ln = L * (0.55 if sec else 1.0)
        t = math.radians(a)
        bx, by = CX + rx * math.cos(t), CY + ry * math.sin(t)
        nx, ny = math.cos(t) / rx, math.sin(t) / ry
        n = math.hypot(nx, ny)
        nx, ny = nx / n, ny / n
        tx, ty = -ny, nx
        hw = 3.8 * (0.6 if sec else 1.0)
        tipw = 2.2 if ext < 0.5 else 0.0          # tumpul di tingkat 2
        p1 = (bx + tx * hw, by + ty * hw)
        p2 = (bx - tx * hw, by - ty * hw)
        if tipw > 0:
            t1 = (bx + nx * ln + tx * tipw, by + ny * ln + ty * tipw)
            t2 = (bx + nx * ln - tx * tipw, by + ny * ln - ty * tipw)
            out.append(f'<path d="M{p1[0]:.2f},{p1[1]:.2f} L{t1[0]:.2f},{t1[1]:.2f} '
                       f'L{t2[0]:.2f},{t2[1]:.2f} L{p2[0]:.2f},{p2[1]:.2f} Z"/>')
        else:
            tp = (bx + nx * ln, by + ny * ln)
            out.append(f'<path d="M{p1[0]:.2f},{p1[1]:.2f} L{tp[0]:.2f},{tp[1]:.2f} '
                       f'L{p2[0]:.2f},{p2[1]:.2f} Z"/>')
    return "".join(out)


def eyes(rx, ry, level, kind):
    er = 0.30 * ry
    ny_ = CY - 0.34 * ry
    nearx = CX + 0.42 * rx
    farx = nearx - 2.15 * er
    g = []
    for cx_, r_ in ((farx, er * 0.92), (nearx, er)):
        g.append(f'<circle cx="{cx_:.2f}" cy="{ny_:.2f}" r="{r_:.2f}" fill="{FOAM}" '
                 f'stroke="{OUTLINE}" stroke-width="2.4"/>')
        if level == 5:
            k = r_ * 0.52
            g.append(f'<path d="M{cx_ - k:.2f},{ny_ - k:.2f} L{cx_ + k:.2f},{ny_ + k:.2f} '
                     f'M{cx_ + k:.2f},{ny_ - k:.2f} L{cx_ - k:.2f},{ny_ + k:.2f}" '
                     f'stroke="{OUTLINE}" stroke-width="3" stroke-linecap="round" fill="none"/>')
        else:
            pr = r_ * (0.24 if level == 4 else 0.50)
            px, py = cx_ + r_ * 0.16, ny_ + r_ * 0.06
            g.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="{pr:.2f}" fill="{OUTLINE}"/>')
            g.append(f'<circle cx="{px - r_ * 0.30:.2f}" cy="{py - r_ * 0.34:.2f}" '
                     f'r="{r_ * 0.15:.2f}" fill="{FOAM}"/>')
            if level in (1, 3):  # kelopak: segmen lingkaran di atas tali busur
                kk = -0.62 * r_ if level == 1 else -0.08 * r_
                ww = math.sqrt(max(r_ * r_ - kk * kk, 0.0))
                yy = ny_ + kk
                g.append(f'<path d="M{cx_ - ww:.2f},{yy:.2f} A{r_:.2f},{r_:.2f} 0 0,1 '
                         f'{cx_ + ww:.2f},{yy:.2f} Z" fill="{OUTLINE}"/>')
    if level == 2:  # satu alis naik
        g.append(f'<path d="M{nearx - er:.2f},{ny_ - er * 1.5:.2f} '
                 f'L{nearx + er:.2f},{ny_ - er * 1.9:.2f}" stroke="{OUTLINE}" '
                 f'stroke-width="3" stroke-linecap="round"/>')
    if level == 4:  # tetes keringat
        sx, sy = nearx + er * 1.5, ny_ - er * 0.4
        g.append(f'<path d="M{sx:.2f},{sy:.2f} q3.2,4.0 0,6.4 q-3.2,-2.4 0,-6.4 Z" '
                 f'fill="{FOAM}" stroke="{OUTLINE}" stroke-width="1.6"/>')
    if kind == "guardian" and level != 5:  # alis tebal turun ke tengah
        for cx_, s in ((farx, 1), (nearx, 1)):
            g.append(f'<path d="M{cx_ - er * 0.95:.2f},{ny_ - er * 1.62:.2f} '
                     f'L{cx_ + er * 0.95:.2f},{ny_ - er * 1.95:.2f}" stroke="{OUTLINE}" '
                     f'stroke-width="2.8" stroke-linecap="round"/>')
    if kind == "grid":  # visor mendatar melintasi kedua mata
        g.append(f'<rect x="{farx - er * 1.25:.2f}" y="{ny_ - er * 0.85:.2f}" '
                 f'width="{(nearx - farx) + er * 2.5:.2f}" height="{er * 0.55:.2f}" '
                 f'rx="{er * 0.2:.2f}" fill="{OUTLINE}"/>')
    return "".join(g)


def mouth(rx, ry, level):
    mx, my = CX + 0.30 * rx, CY + 0.12 * ry
    w = 0.14 * rx
    if level <= 2:
        return (f'<path d="M{mx - w:.2f},{my:.2f} q{w * 0.5:.2f},{w * 0.8:.2f} {w:.2f},0 '
                f'q{w * 0.5:.2f},{w * 0.8:.2f} {w:.2f},0" fill="none" stroke="{OUTLINE}" '
                f'stroke-width="2.4" stroke-linecap="round"/>')
    if level == 3:
        return (f'<ellipse cx="{mx:.2f}" cy="{my:.2f}" rx="{w * 0.55:.2f}" '
                f'ry="{w * 0.45:.2f}" fill="{OUTLINE}"/>')
    if level == 4:
        return (f'<ellipse cx="{mx:.2f}" cy="{my:.2f}" rx="{w * 0.7:.2f}" '
                f'ry="{w * 0.8:.2f}" fill="{OUTLINE}"/>')
    return (f'<ellipse cx="{mx:.2f}" cy="{my:.2f}" rx="{w * 1.0:.2f}" '
            f'ry="{w * 1.25:.2f}" fill="{OUTLINE}"/>')


def rim(level):
    if level == 1:
        r = 45.0
        a0, a1 = math.radians(198), math.radians(342)
        x0, y0 = 50 + r * math.cos(a0), 50 + r * math.sin(a0)
        x1, y1 = 50 + r * math.cos(a1), 50 + r * math.sin(a1)
        return (f'<path d="M{x0:.2f},{y0:.2f} A{r},{r} 0 0,1 {x1:.2f},{y1:.2f}" '
                f'fill="none" stroke="{RISK[1]}" stroke-width="2" stroke-linecap="round"/>')
    if level == 2:
        return (f'<circle cx="50" cy="50" r="45" fill="none" stroke="{RISK[2]}" '
                f'stroke-width="3"/>'
                f'<rect x="46" y="2" width="8" height="7" fill="{BG}"/>')
    if level == 3:
        return (f'<circle cx="50" cy="50" r="45" fill="none" stroke="{RISK[3]}" '
                f'stroke-width="3" stroke-dasharray="6 4"/>')
    if level == 4:
        return (f'<circle cx="50" cy="50" r="46" fill="none" stroke="{RISK[4]}" stroke-width="2"/>'
                f'<circle cx="50" cy="50" r="42" fill="none" stroke="{RISK[4]}" stroke-width="2"/>')
    return ('<circle cx="50" cy="50" r="45" fill="none" stroke="url(#hazard)" stroke-width="8"/>'
            '<circle cx="50" cy="50" r="49" fill="none" stroke="' + OUTLINE + '" stroke-width="1"/>'
            '<circle cx="50" cy="50" r="41" fill="none" stroke="' + OUTLINE + '" stroke-width="1"/>')


def character(kind, level, with_rim=True, with_bg=True, bgcolor=BG):
    c = CHARS[kind]
    w, h = LEVEL_WH[level]
    rx, ry = w * c["ws"] / 2, h * c["hs"] / 2
    ext = LEVEL_EXT[level]
    body = ell(CX, CY, rx, ry)
    uid = f"{kind}{level}"
    s = []
    if with_bg:
        s.append(f'<rect width="100" height="100" fill="{bgcolor}"/>')
    s.append('<defs>')
    s.append(f'<clipPath id="c{uid}"><path d="{body}"/></clipPath>')
    s.append('<pattern id="hazard" width="8" height="8" patternUnits="userSpaceOnUse" '
             'patternTransform="rotate(45)">'
             f'<rect width="8" height="8" fill="{FOAM}"/>'
             f'<rect width="4" height="8" fill="{OUTLINE}"/></pattern>')
    s.append('</defs>')

    g = [f'<g stroke="{OUTLINE}" stroke-width="3" stroke-linejoin="round">']

    # --- bagian di belakang badan -------------------------------------------
    bx, by = CX - rx * 0.92, CY + ry * 0.08
    g.append(f'<path fill="{c["body"]}" d="M{bx:.2f},{by - 7:.2f} L{bx - 17:.2f},{by - 15:.2f} '
             f'L{bx - 12:.2f},{by - 4:.2f} L{bx - 19:.2f},{by:.2f} L{bx - 12:.2f},{by + 4:.2f} '
             f'L{bx - 17:.2f},{by + 15:.2f} L{bx:.2f},{by + 7:.2f} Z"/>')

    if kind == "guardian":   # perisai punggung — tepi atas siluet jadi lurus
        sw, sh = rx * 1.58, ry * 0.62
        sx, sy = CX - sw / 2, CY - ry - 5.5
        g.append(f'<path fill="{FOAM2}" d="M{sx:.2f},{sy + 6:.2f} q0,-6 6,-6 '
                 f'L{sx + sw - 6:.2f},{sy:.2f} q6,0 6,6 L{sx + sw:.2f},{sy + sh:.2f} '
                 f'L{sx:.2f},{sy + sh:.2f} Z"/>')
    if kind == "grid":       # sirip punggung segitiga tegak
        g.append(f'<path fill="{c["body"]}" d="M{CX - 9:.2f},{CY - ry + 2:.2f} '
                 f'L{CX + 1:.2f},{CY - ry - 15:.2f} L{CX + 9:.2f},{CY - ry + 2:.2f} Z"/>')
    if kind == "yield":      # sirip punggung daun, miring ke kanan-atas
        g.append(f'<path fill="{c["body"]}" d="M{CX - 2:.2f},{CY - ry + 3:.2f} '
                 f'Q{CX + 14:.2f},{CY - ry - 20:.2f} {CX + 22:.2f},{CY - ry - 6:.2f} '
                 f'Q{CX + 16:.2f},{CY - ry + 3:.2f} {CX + 10:.2f},{CY - ry + 4:.2f} Z"/>')
    if kind == "rebalancer":  # lengan timbangan mendatar, tinggi sama persis
        ay = CY - ry * 0.15
        for sgn in (-1, 1):
            x0 = CX + sgn * rx * 0.55
            x1 = CX + sgn * (rx + 15)
            g.append(f'<path fill="{FOAM}" d="M{x0:.2f},{ay - 5:.2f} L{x1:.2f},{ay - 3.5:.2f} '
                     f'L{x1:.2f},{ay + 3.5:.2f} L{x0:.2f},{ay + 5:.2f} Z"/>')
        g.append(f'<circle cx="{CX - (rx + 15) - 4:.2f}" cy="{ay:.2f}" r="4.6" fill="{FOAM}"/>')
        g.append(f'<circle cx="{CX + (rx + 15) + 3:.2f}" cy="{ay:.2f}" r="3.0" fill="{FOAM}"/>')

    g.append(f'<g fill="{c["body"]}">{spikes(rx, ry, ext, secondary=(level == 5))}</g>')

    # --- badan ---------------------------------------------------------------
    g.append(f'<path d="{body}" fill="{c["body"]}"/>')
    g.append(f'<g clip-path="url(#c{uid})" stroke="none">')
    g.append(f'<ellipse cx="{CX:.2f}" cy="{CY + 0.40 * ry:.2f}" rx="{0.84 * rx:.2f}" '
             f'ry="{0.62 * ry:.2f}" fill="{c["belly"]}"/>')
    if kind == "grid":   # kisi 3x3 samar, satu sel terisi
        step = rx * 0.42
        for i in (-1, 0, 1):
            g.append(f'<path d="M{CX + i * step:.2f},{CY - ry:.2f} V{CY + ry:.2f}" '
                     f'stroke="{OUTLINE}" stroke-width="1.4" opacity="0.20"/>')
            g.append(f'<path d="M{CX - rx:.2f},{CY + i * step * 0.8:.2f} H{CX + rx:.2f}" '
                     f'stroke="{OUTLINE}" stroke-width="1.4" opacity="0.20"/>')
        g.append(f'<rect x="{CX - step * 1.5:.2f}" y="{CY - step * 1.6:.2f}" '
                 f'width="{step:.2f}" height="{step * 0.8:.2f}" fill="{OUTLINE}" opacity="0.30"/>')
    # bayangan blok datar di kiri-bawah
    g.append(f'<path fill-rule="evenodd" fill="{OUTLINE}" opacity="0.14" '
             f'd="M0,0 H100 V100 H0 Z {ell(CX + 5, CY - 4, rx, ry)}"/>')
    g.append('</g>')
    g.append(f'<path d="{body}" fill="none"/>')

    # sirip dada
    fx, fy = CX - 0.52 * rx, CY + 0.42 * ry
    g.append(f'<ellipse cx="{fx:.2f}" cy="{fy:.2f}" rx="{0.17 * rx:.2f}" '
             f'ry="{0.085 * ry:.2f}" fill="{c["belly"]}" stroke-width="2.4" '
             f'transform="rotate(-28 {fx:.2f} {fy:.2f})"/>')

    if kind == "guardian":   # bilah meteran health factor di tepi kanan perisai
        fill = {1: 1.0, 2: 0.75, 3: 0.5, 4: 0.3, 5: 0.08}[level]
        gx, gy, gw, gh = CX + rx * 0.60, CY - ry - 3.5, 4.6, ry * 0.52
        g.append(f'<rect x="{gx:.2f}" y="{gy:.2f}" width="{gw}" height="{gh:.2f}" rx="1.6" '
                 f'fill="{FOAM}" stroke-width="2"/>')
        g.append(f'<rect x="{gx + 1.1:.2f}" y="{gy + gh * (1 - fill) + 1.1:.2f}" '
                 f'width="{gw - 2.2}" height="{max(gh * fill - 2.2, 0.8):.2f}" rx="0.8" '
                 f'fill="{RISK[level]}" stroke="none"/>')
    if kind == "yield":      # tiga gelembung arus di belakang ekor
        for (dx, dy, r_) in ((-2, -14, 3.2), (-7, -20, 2.3), (-11, -25, 1.6)):
            g.append(f'<circle cx="{bx + dx:.2f}" cy="{by + dy:.2f}" r="{r_}" '
                     f'fill="none" stroke-width="2"/>')

    g.append(eyes(rx, ry, level, kind))
    g.append(mouth(rx, ry, level))
    g.append('</g>')
    s.append("".join(g))
    if with_rim:
        s.append(rim(level))
    return "".join(s)


def svg100(inner, size=100):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            f'width="{size}" height="{size}">' + inner + '</svg>')


def write(name, content):
    p = os.path.join(OUT, name)
    with open(p, "w") as f:
        f.write(content)
    print("tulis", p)


os.makedirs(OUT, exist_ok=True)

for k in ("guardian", "rebalancer", "grid", "yield"):
    write(f"{k}.svg", svg100(character(k, 1), 512))

for lv in (1, 2, 3, 4, 5):
    write(f"guardian-kembung-{lv}.svg", svg100(character("guardian", lv), 512))

write("maskot.svg", svg100(character("maskot", 2, with_rim=False), 512))
write("fallback.svg", svg100(character("fallback", 1, with_rim=False), 512))

# favicon: kepala + duri saja, disederhanakan habis
fav = character("maskot", 2, with_rim=False, bgcolor="#05121A")
write("favicon-src.svg", svg100(fav, 256))

# --- OG image 1200x630 ---------------------------------------------------
row = []
xs = [(680, 1), (830, 2), (980, 4), (1130, 5)]
kinds = ["guardian", "rebalancer", "grid", "yield"]
for (x, lv), k in zip(xs, kinds):
    sc = 1.42
    row.append(f'<g transform="translate({x - 50 * sc:.0f},{300 - 50 * sc:.0f}) scale({sc})">'
               + character(k, lv, with_rim=True, with_bg=False) + '</g>')
og = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">'
      f'<rect width="1200" height="630" fill="#05121A"/>'
      + "".join(f'<path d="M60,{y} H1140" stroke="#14303F" stroke-width="1.5"/>'
                for y in (150, 470))
      + "".join(row)
      + '<text x="72" y="286" font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif" '
        'font-size="76" font-weight="700" fill="#F4F8F9">Fugugent</text>'
      + '<text x="74" y="336" font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif" '
        'font-size="27" font-weight="500" fill="#5FD4DC">Agent DeFi di BNB Chain</text>'
      + '<text x="74" y="378" font-family="system-ui,-apple-system,Helvetica,Arial,sans-serif" '
        'font-size="23" font-weight="400" fill="#9FB9C4">Fugu mengembang seiring beban risiko</text>'
      + '</svg>')
write("og.svg", og)

# --- lembar kontak untuk pemeriksaan visual ------------------------------
# Hanya ditulis bila SHEET_DIR di-set; lembar ini alat kerja, bukan aset produk.
sheet_dir = os.environ.get("SHEET_DIR")
if sheet_dir:
    rows = [
        [("guardian", 1), ("rebalancer", 1), ("grid", 1), ("yield", 1)],
        [("guardian", 1), ("guardian", 2), ("guardian", 3), ("guardian", 4)],
        [("guardian", 5), ("maskot", 2), ("fallback", 1), ("yield", 5)],
    ]
    cells = []
    for r, rowv in enumerate(rows):
        for i, (k, lv) in enumerate(rowv):
            rimq = not (r == 2 and k in ("maskot", "fallback"))
            cells.append(f'<g transform="translate({i * 110},{r * 110})">'
                         + character(k, lv, with_rim=rimq) + '</g>')
    sheet = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 450 340" '
             'width="900" height="680">'
             '<rect x="-5" y="-5" width="450" height="340" fill="#05121A"/>'
             + "".join(cells) + '</svg>')
    with open(os.path.join(sheet_dir, "_sheet.svg"), "w") as f:
        f.write(sheet)
    print("tulis lembar kontak")
