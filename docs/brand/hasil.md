# Fugugent — Asset Production Results

**Date:** 2026-09-08

---

## 1. Image generation tool: NOT AVAILABLE

The two image-generation MCP servers available in this environment were **not connected** when
this work was done. Tried, and failed, four times:

| Call | Result |
|---|---|
| `mcp__claude_ai_pika__generate_image` (nano-banana-pro, full Guardian prompt) | `MCP server "claude.ai pika" is not connected` |
| `mcp__claude_ai_pika__generate_image` (nano-banana-2-lite, minimal prompt) | `MCP server "claude.ai pika" is not connected` |
| `mcp__claude_ai_Higgsfield__generate_image` (nano_banana_pro, full Guardian prompt) | `MCP server "claude.ai Higgsfield" is not connected` |
| `mcp__claude_ai_Higgsfield__balance` (connection test) | `MCP server "claude.ai Higgsfield" is not connected` |

**Zero images were produced by a generative model.** Not one file in
`landingpage/public/brand/` comes from an image model. The prompts in
`prompt-gambar.md` have **never been run** and are therefore not yet verified against real
output — treat them as a mature specification, not as a proven recipe.

## 2. What was done instead

The assets were drawn by hand as **parametric SVGs**, produced by
`docs/brand/generate-svg.py` (Python, no dependencies). That script translates the geometry in
`karakter.md` and `tingkat-kembung.md` into shapes — the 100×100 box, the body width per level,
the spike angles, the ring patterns, all exactly the same numbers as in the documents.

This is not merely a stopgap. `prompt-gambar.md` §7 already stated up front that the
**48 px avatar must be a hand-drawn SVG, not a generated PNG**, because at that size geometric
precision decides everything and because the puff level has to change via props rather than by
swapping files. So what is in the repo now is precisely the asset the product actually needs;
what is missing is the richer illustrative version for marketing material.

To regenerate:

```bash
python3 docs/brand/generate-svg.py landingpage/public/brand
```

## 3. The files that actually exist

All in `landingpage/public/brand/`. **13 files, all SVG.**

| File | Contents | Spec reference |
|---|---|---|
| `guardian.svg` | Guardian, puff level 1 | `karakter.md` §2 |
| `rebalancer.svg` | Rebalancer, puff level 1 | `karakter.md` §3 |
| `grid.svg` | Grid, puff level 1 | `karakter.md` §4 |
| `yield.svg` | Yield, puff level 1 | `karakter.md` §5 |
| `guardian-kembung-1.svg` | Calm — `HF > 1.5`, `NONE` | `tingkat-kembung.md` §3 |
| `guardian-kembung-2.svg` | Watchful — `1.2 < HF ≤ 1.5`, `WARN` | same |
| `guardian-kembung-3.svg` | Strained — `1.1 < HF ≤ 1.2`, `PARTIAL_REPAY` | same |
| `guardian-kembung-4.svg` | Critical — `1.0 < HF ≤ 1.1`, `DELEVERAGE` | same |
| `guardian-kembung-5.svg` | Emergency — `HF ≤ 1.0`, `EMERGENCY` | same |
| `maskot.svg` | Primary mascot / logo | `prompt-gambar.md` §5.1 |
| `favicon-src.svg` | Favicon source (background `#05121A`) | `prompt-gambar.md` §5.2 |
| `og.svg` | OG image 1200×630 | `prompt-gambar.md` §5.3 |
| `fallback.svg` | Neutral fugu for third-party agents | `karakter.md` §7 |

`guardian.svg` and `guardian-kembung-1.svg` have identical contents — deliberately, so that a
consumer can reference either one without having to know the other convention.

## 4. Checks that were actually run

Rendered with `qlmanage -t` (WebKit) and inspected visually.

| Test | Result |
|---|---|
| Render the 4 characters side by side, level 1 | pass — all four silhouettes differ |
| Render the 5 Guardian levels side by side | pass — the width progression reads in order |
| **Full grayscale** (`feColorMatrix saturate 0`) at 48 px | **pass** — all four characters can still be matched to their names; all five levels stay in order because the ring patterns (arc / solid+notch / dashed / double / hazard stripes) do not depend on colour at all |
| OG image 1200×630 | pass — text in the left third, four fugu rising from slim to emergency on the right |

Three defects were found and fixed in the process, recorded here so they are not repeated:

1. **The level 1 eyelids were drawn as half-circles**, not as a segment above a chord, so the
   eyes were half-shut and the whole family looked like it was wearing sunglasses. Fixed by
   computing the chord width `√(r² − k²)`.
2. **The pectoral fins were placed in the middle of the belly**, so they read as a second
   mouth. Moved to the lower-left edge of the body.
3. **The spikes were too short** to be visible below 64 px. Their length was raised from
   9 to 10.5 units and level 5 was shrunk slightly (88→86 units) so that the spikes break out
   through the hazard-stripe ring rather than hiding behind it.

## 5. What has not been done

- **No PNG files.** This environment has no SVG rasterizer (`rsvg-convert`, `inkscape`,
  ImageMagick, `cairosvg` — none of them present); all that exists is `qlmanage`, which always
  emits a square canvas with white padding and is therefore not fit to use as an asset. SVG can
  be used directly in `next/image` and `<img>`, so this is not a blocker. If PNG/ICO is needed
  for legacy favicons, produce it through a build pipeline (`sharp`) in `landingpage/`, rather
  than checking rasterized files into the repo.
- **The five-level series for Rebalancer, Grid, and Yield.** The script already supports it
  (`character("grid", 4)` and so on); it simply has not been written out to files, because this
  task only asked for the Guardian series. Adding it is a one-liner.
- **The illustrative version from a generative model.** Waiting for an image MCP to come up.
  The prompts are ready and complete in `prompt-gambar.md`.
- **A real colour-blindness simulation** (deuteranopia/protanopia). Only full grayscale has been
  run — a harsher test for luminance ordering, but not a substitute for a dichromatic
  simulation. Run it before launch.
