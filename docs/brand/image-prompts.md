# Fugugent — Image Prompts

**Date:** 2026-09-08
**Purpose:** produce assets that are **consistent across runs**. Two people running the same
prompt on different days must get the same character — not merely "a similar-looking
pufferfish".

**The prompts are written in English.** This is a technical decision, not a lapse of style:
the image models we use follow geometric instructions (ratios, angles, line weight) far more
faithfully in English. Everything outside the prompt blocks is explanation and rules.

---

## 0. How to assemble a prompt

Each character prompt = **three blocks, joined with full stops, in this order:**

```
[STYLE BLOCK] + [CHARACTER BLOCK] + [LEVEL BLOCK]
```

The rules that keep it consistent:

1. **Copy the style block exactly, character for character.** Do not paraphrase, do not
   shorten, do not reorder its sentences. Most run-to-run inconsistency comes from here.
2. **Reference chain.** Generate the **anchor** first (Guardian level 1). Every later image is
   run with that anchor as `reference_images`, and each next level image uses the previous
   level's image of the same character. Text alone is not enough to hold the identity.
3. **One model for the whole set.** Do not mix models mid-set; the difference between models is
   far larger than the difference between runs of the same model.
4. **1:1 ratio, 2K resolution** for all avatars. The OG image is the only exception.
5. **Always append the negative block** at the end if the tool supports it; if not, the
   prohibitions are already embedded inside the style block.

**Settings used** (record any change in `results.md`):

| Parameter | Value |
|---|---|
| Tool | `mcp__claude_ai_pika__generate_image` |
| `provider` | `nano-banana-pro` |
| `aspect_ratio` | `1:1` (OG image: `16:9`) |
| `resolution` | `2K` |
| `num_images` | `1` |

---

## 1. STYLE BLOCK (copy exactly)

```
Flat vector mascot illustration in a clean modern app-icon style. Thick uniform dark
outline in colour #05121A, completely flat fills, no gradients, no texture, no glow,
and exactly one flat darker block shadow on the lower-left of the body. The character
is a cartoon pufferfish (fugu): one single egg-shaped body with no neck, two large
round white eyes with round black pupils and a single small white glint at ten
o'clock in each eye, a small omega-shaped mouth set below the eyes, two small pectoral
fins, and a three-lobed fan tail. Three-quarter front view seen slightly from above,
facing right. The character is centred in a square frame with 8 percent padding on all
sides. Solid flat background colour #0B1E2B, empty, with no scenery, no water, no
ground, no sparkles, no text, no letters, no logo and no watermark. Crisp vector edges,
high contrast, sticker-like, designed to stay readable when scaled down to a
48-pixel avatar.
```

## 2. NEGATIVE BLOCK (copy exactly)

```
photorealistic, 3d render, realistic fish anatomy, detailed scales, gradient mesh,
soft shading, drop shadow, outer glow, blur, noise, busy background, underwater scene,
bubbles unless specified, text, letters, numbers, watermark, signature, more than one
character, human hands, extra fins, extra eyes, spikes on a calm character
```

---

## 3. CHARACTER BLOCKS

### 3.1 Guardian — `HEALTH_FACTOR`

```
The character is Fugu Guardian, a calm night-watchman pufferfish. Its body is wider
than it is tall, roughly a 1.15 to 1 ratio, giving it a low sturdy stance. A smooth
half-circle shell plate is fused onto its back so that the top edge of its silhouette
is a straight horizontal line, unlike any other character in the set. Body colour
#0072B2, belly colour #58A9E0 with a single curved dividing line, shell plate colour
#E3ECEF outlined in #05121A. Thick eyebrows angled gently down toward the centre,
reading as focused rather than angry. On the right edge of the shell plate there is a
narrow vertical gauge bar filled from the bottom.
```

### 3.2 Rebalancer — `REBALANCING`

```
The character is Fugu Rebalancer, a tidy perfectionist pufferfish. Its body is slightly
taller than wide, roughly a 1 to 1.1 ratio, like a standing egg. Its two pectoral fins
are unusually large and held straight out horizontally on both sides at exactly the same
height, like the arms of a balance scale, so the silhouette extends left and right past
the body. Its tail is short and small so the outstretched fins stay the dominant shape.
Body colour #CC79A7, belly colour #E9A8CC, fin tips #F4F8F9. One small round bubble
floats at the tip of each fin and the left bubble is clearly larger than the right one.
```

### 3.3 Grid — `GRID`

```
The character is Fugu Grid, a cold methodical pufferfish. Its body is a square-ish
1 to 1 egg, and a single sharp triangular dorsal fin points straight up from the top of
its head, the only sharp angle in the set. Its fan tail is cut off flat rather than
rounded. A thin rectangular dark visor runs horizontally across both eyes as one
continuous straight bar. A faint 3 by 3 square grid pattern is printed on the body in
#05121A at 20 percent opacity, and exactly one cell of that grid is filled solid.
Body colour #56B4E9, belly colour #8FD3F4.
```

### 3.4 Yield — `YIELD`

```
The character is Fugu Yield, a friendly slightly greedy forager pufferfish. Its body is
the roundest and fullest of the set, about 8 percent larger than the others even when
calm, with a 1.05 to 1 ratio. A single leaf-shaped dorsal fin curves diagonally
backwards from the upper right of its head, giving the silhouette a slanted bump.
Body colour #E69F00, belly colour #FFC24D. Three small round bubbles rise in a
diagonal line behind its tail, each one smaller than the one below it.
```

---

## 4. LEVEL BLOCKS (five)

These apply to all four characters. Sizes are expressed relative to the 100 unit box.

### Level 1 — Calm
```
The fish is at bloat level 1 of 5, calm. Its body is at its slimmest, about 56 units
wide and 52 units tall inside a 100 unit square. No spikes at all; the back is
completely smooth. The eyes are relaxed with slightly lowered lids and the omega mouth
is small and neutral. A thin solid arc, 2 units thick, in colour #009E73, curves around
the upper 40 percent of the character like a partial ring.
```

### Level 2 — Watchful
```
The fish is at bloat level 2 of 5, watchful. Its body has puffed to about 64 units wide
and 58 units tall inside a 100 unit square. Short blunt-tipped spikes have emerged about
a quarter of their length along five rows following the back and sides. One eyebrow is
raised and the eyes are a little wider. A solid ring 3 units thick in colour #F0E442
fully surrounds the character, with a single small notch cut out of it at the twelve
o'clock position.
```

### Level 3 — Strained
```
The fish is at bloat level 3 of 5, strained. Its body has puffed to about 72 units wide
and 66 units tall inside a 100 unit square. The spikes are extended about 60 percent and
their tips are becoming sharp. The eyes are narrowed, the cheeks are visibly puffed and
the mouth is pursed as if holding a breath. A dashed ring 3 units thick in colour
#E69F00 fully surrounds the character, with dashes 6 units long separated by 4 unit gaps.
```

### Level 4 — Critical
```
The fish is at bloat level 4 of 5, critical. Its body has puffed to about 80 units wide
and 74 units tall inside a 100 unit square. The spikes are fully extended and sharply
pointed. The eyes are wide open with small pupils, one bead of sweat sits at the
temple, and the mouth is open in a small circle. Two concentric solid rings, each 2
units thick and 2 units apart, in colour #D55E00, surround the character.
```

### Level 5 — Emergency
```
The fish is at bloat level 5 of 5, an emergency. Its body is enormous, about 84 units
wide and 82 units tall inside a 100 unit square, so that it touches and is very slightly
cropped by the edges of the square frame; it no longer fits. The spikes are fully
extended and a second row of shorter spikes has appeared between the main rows. Both
eyes are drawn as simple crosses instead of circles and the mouth hangs wide open. The
character is surrounded by a thick warning ring made of 45 degree diagonal hazard
stripes, each stripe 4 units wide, alternating between #F4F8F9 and #05121A in strong
black and white contrast.
```

---

## 5. Brand asset prompts

### 5.1 Primary mascot / logo

```
[STYLE BLOCK] The character is the Fugugent mascot, a friendly cartoon pufferfish shown at
a calm, slightly puffed state, about 62 units wide inside a 100 unit square. It has no
shell, no visor, no leaf fin and no outstretched scale arms; it is the neutral parent
form of the family. Body colour #0E7C86, belly colour #9CE9EE. Its spikes are short,
rounded and friendly, extended about 20 percent, evenly spaced in five rows. The eyes
are large, round and confident, looking slightly toward the viewer. A single thin ring
in colour #5FD4DC, 2 units thick, orbits the character at a shallow angle, suggesting a
boundary or permission perimeter rather than a halo. Perfectly symmetrical enough to
work as an app icon, with the silhouette readable as one clean shape.
```

Derivatives must be made from the same file, not generated again:
`logo-mark.svg` (vector trace), `logo-lockup.svg` (mascot + the word "Fugugent"),
`logo-mono.svg` (single colour, for the sponsor sheet).

### 5.2 Favicon

The favicon is **not generated from scratch** — it is cropped from the primary mascot. If it
really must be generated, this is the prompt:

```
[STYLE BLOCK] Extreme simplification for a 16 by 16 pixel favicon: only the head and upper
body of the Fugugent pufferfish mascot, cropped square, filling 92 percent of the frame.
Body colour #0E7C86 on a solid #05121A background. Only four shapes are allowed: the
body silhouette, two eyes, and four short rounded spikes on the top edge. No belly line,
no mouth, no ring, no fins, no tail, no detail of any kind. Maximum contrast between the
body and the background so the shape survives at 16 pixels.
```

Test before accepting: shrink it to 16 px and look at it in a browser tab next to other tabs.
If it cannot be told apart from a plain circle, add spikes, do not add detail.

### 5.3 OG image (`1200×630`)

Ratio 16:9, then cropped to 1200×630. The text must **not** be made by the image model —
render the text in a Next.js layer (`opengraph-image.tsx`) on top of this image.

```
Flat vector illustration banner, wide 16 by 9 composition, in a clean modern app style
with thick uniform #05121A outlines, completely flat fills and no gradients. Four cartoon
pufferfish characters float in a horizontal row on a solid deep navy #05121A background,
lit from above, evenly spaced, each one facing right in three-quarter view. From left to
right: a wide low blue pufferfish with a flat half-circle shell on its back in #0072B2;
a pink pufferfish with two large fins held straight out horizontally in #CC79A7; a light
blue pufferfish with a sharp triangular dorsal fin and a dark horizontal visor across its
eyes in #56B4E9; and a round amber pufferfish with a leaf-shaped dorsal fin in #E69F00.
Each character is progressively more puffed than the one before it, so the row reads as a
sequence from slim to enormous. Faint thin #14303F horizontal guide lines run behind them.
The entire left third of the image is empty flat background reserved for text. No text,
no letters, no numbers, no logo, no watermark.
```

### 5.4 Empty card / third-party fallback

```
[STYLE BLOCK] The character is a neutral fallback pufferfish with no distinguishing
accessories at all: no shell, no visor, no leaf fin, no outstretched arms, no bubbles.
Plain egg-shaped body, about 60 units wide inside a 100 unit square, spikes retracted.
Body colour #6E8C6E, belly 18 percent lighter. Eyes are open but neutral, mouth is a
small flat line rather than an omega shape, giving it a deliberately generic and
unremarkable presence next to the four named characters.
```

---

## 6. Minimum asset list

| File | Prompt |
|---|---|
| `guardian.svg` | STYLE + 3.1 + Level 1 |
| `rebalancer.svg` | STYLE + 3.2 + Level 1 |
| `grid.svg` | STYLE + 3.3 + Level 1 |
| `yield.svg` | STYLE + 3.4 + Level 1 |
| `guardian-kembung-1.svg` … `-5.svg` | STYLE + 3.1 + Levels 1…5 |
| `maskot.svg` | §5.1 |
| `favicon-src.svg` | §5.2 |
| `og.svg` | §5.3 |
| `fallback.svg` | §5.4 |

> The assets that actually exist in the repo right now are **hand-drawn SVGs**
> (`docs/brand/generate-svg.py`), not model output. The reasons are in
> `results.md`. The prompts above still stand if we later want to make a richer
> illustrative version for marketing material.

Everything is stored in `landingpage/public/brand/` and recorded in `docs/brand/results.md`.

---

## 7. Acceptance criteria

An image is **rejected** if any of these is true — no matter how good it looks:

1. Spikes appear at level 1. Level 1 has to be smooth; otherwise the whole scale loses its
   zero point.
2. Level 5 is not cropped by the frame, or its eyes are still circles.
3. There is text, a number, or a watermark inside the image.
4. There is a gradient, a glow, or a soft shadow.
5. The body colour is off the specified hex by more than a glance can accept — check with a
   colour picker, not by feel.
6. After converting to grayscale and shrinking to 48 px, the character is confused with
   another character in the set.

Generative model images **will not** be precise on hex and ratio. That is accounted for: these
assets are used for the landing page, the OG image, and presentation material.
**The 48 px avatar in the marketplace must be a hand-drawn SVG** following the spec in
`characters.md`, not a generated PNG — because at that size geometric precision is everything,
and because the avatar must be able to change its puff level directly through CSS/props.
