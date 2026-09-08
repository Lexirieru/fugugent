# Fugugent — Characters

**Date:** 2026-09-08
**Scope:** the visual identity of the four Fugu agents. The categories are locked in
`contracts/src/types/FuguTypes.sol` (`REBALANCING | GRID | YIELD | HEALTH_FACTOR`)
and must not be changed from the brand side.

Companion documents: `puff-levels.md` (risk states), `palette.md` (colours),
`image-prompts.md` (image production).

---

## 0. The core idea

A fugu puffs up as risk load grows. This is not decoration: the puff level is a
**metric reading**, exactly as serious as the number next to it. That is why there is one
rule that must not be broken anywhere in the system:

> **Body colour says who the agent is. Body shape says how heavy the risk is.**
> Body colour never changes because of risk; puffing never changes because of category.

The consequence: a colour-blind user can still read risk (shape), and a user looking at a
card at 48 pixels can still tell the agents apart (silhouette). Two channels that complement
each other rather than stack on each other.

This is also why we do not use happy/sad faces as the primary marker: expressions disappear
below ~64 pixels, whereas silhouette and body width survive.

---

## 1. Family rules

What makes all four look like one species rather than four pieces of stock art:

| Aspect | Rule |
|---|---|
| Viewpoint | 3/4 front, slightly from above, facing **right**. Never pure profile, never from behind. |
| Frame | 1:1 square. The body lives in a 100×100 unit box with 8 units of padding on every side. |
| Construction | Body = egg/oval. Head and body are a single shape — a fugu has no neck. |
| Outline | Uniform **3 units** thick (at 48 px ≈ 1.5–2 px), colour `#05121A` (Abyss 900), **not pure black**. |
| Eyes | Two large circles, gap between eyes = 1 eye diameter, round pupil + **one** white glint at ten o'clock. |
| Mouth | Small, below the midpoint of the eyes, a flattened `ω` shape. |
| Fins | Two small pectoral fins, one three-lobed fan tail. |
| Belly | Always 18% lighter than the body colour, bounded by a single curved line. |
| Spikes | The spike exit points are **exactly the same** on all four characters: 5 rows following the contour of the back and sides. The only difference is how far they come out. |
| Shadow | One flat block (not a gradient) on the lower-left of the body, 12% darker. |
| Rendering | Flat vector, no mesh gradients, no texture, no double outlines. |
| Prop | Each agent has **one** signature prop, and that prop is **attached to the body** — not held. Hands do not read at 48 px. |

**The family test:** if the four black silhouettes are placed side by side, a person must be
able to say "these are four fish of the same species" *and* point out which is which. If
either fails, the design is wrong, not the reader.

---

## 2. Fugu Guardian — `HEALTH_FACTOR`

**Job:** protect lending positions from liquidation (Venus, Aave v3).

**Temperament.** A night watchman. Calm to the point of being boring, and that is precisely
its achievement. It never raises its voice; if Guardian moves, it means the numbers really
did hit a threshold. It speaks in numbers, not adjectives: not "your position is a bit
risky", but "HF 1.18 — another 6.4% price drop to liquidation".

**Silhouette.** The **widest and lowest** of the four (width:height ratio ≈ 1.15:1).
Unique trait: a **straight back line**, because a half-circle shield shell is fused onto its
back. Only Guardian has a flat top edge — the other three are curved. Thick eyebrows, angled
slightly down toward the centre (focused, not angry).

**Colours.** Body Guardian Cobalt `#0072B2` · belly `#58A9E0` · shield Foam `#E3ECEF`
outlined in Abyss. Eyes white `#F4F8F9`, pupils Abyss 900.

**Signature prop.** The back shield, with **one vertical gauge bar** on the right edge of the
shield that fills from the bottom — that is the Health Factor bar. At the calm level it is
full; at the emergency level only a sliver is left.

**What makes it readable at 48 px.** The flat back. That alone is enough: in a monochrome
48 px silhouette, Guardian is the only shape with a horizontal top edge, and the only one
wider than it is tall. The dark cobalt colour is the second differentiator, not the first.

---

## 3. Fugu Rebalancer — `REBALANCING`

**Job:** keep portfolio weights / PancakeSwap v3 LP positions inside their range.

**Temperament.** A quietly anxious perfectionist. It cannot stand seeing something crooked.
But it also knows tidying has a cost — it only moves when `ΔFee − Gas − Slippage − ΔIL > 0`.
So its temperament is: fussy, but calculating. Not the type to touch a position every hour.

**Silhouette.** The body is slightly **taller than wide** (≈ 1:1.1) — a standing egg.
Unique trait: **two large pectoral fins held straight out horizontally**, symmetrical, at
exactly the same height, like the arms of a balance scale. Only Rebalancer extends past the
body to the left and right. The tail is short and small so those arms stay the dominant shape.

**Colours.** Body Rebalancer Orchid `#CC79A7` · belly `#E9A8CC` · fin tips Foam.

**Signature prop.** One bubble at the tip of each fin, **of unequal size** — the left bubble
is larger than the right when the portfolio is skewed, and they become equal when it is
balanced. This is a prop that stays alive: the difference in bubble size = weight deviation.

**What makes it readable at 48 px.** The horizontal "T" shape: two dots on the left and right
at the same height. Even when the fin detail disappears, those two dots survive as two
symmetrical dark pixels — a pattern none of the other three have.

---

## 4. Fugu Grid — `GRID`

**Job:** grid trading on PancakeSwap v3 (direct swaps; PancakeSwap has no on-chain order
book, so Grid watches `slot0()` itself).

**Temperament.** Methodical and cold. It has no opinion about market direction — only about
levels. And it is honest about its weakness: a grid strategy is structurally mean-reverting,
so it **loses in trending markets**, and that is stated openly on the agent page. A character
that admits its limits is more trusted than one that smiles the whole time.

**Silhouette.** The most **angular**. The body stays an egg (family rule), but the dorsal fin
is a **single sharp triangle** pointing straight up — the only sharp angle in this family at
the calm level. The fan tail is cut off flat rather than curved.

**Colours.** Body Grid Sky `#56B4E9` · belly `#8FD3F4` · grid lines Abyss 900 at 20% opacity.

**Signature prop.** A **thin rectangular visor** running across both eyes (one dark horizontal
bar), plus a **3×3 grid** printed faintly on the body. A grid level that has been filled is
marked by one grid cell in full colour.

**What makes it readable at 48 px.** Two marks survive: the upright triangle above the body,
and one dark horizontal line across the face. The 3×3 grid will merge into a grey texture at
small sizes — that is fine, it acts as "a slightly darker body", not as information.

---

## 5. Fugu Yield — `YIELD`

**Job:** move positions into the pool with the highest risk-adjusted APR
(Venus, Aave v3, Lista).

**Temperament.** A friendly, slightly greedy forager. Always sniffing around. Optimistic, but
with calculated optimism: it only moves if the APR difference exceeds the migration cost. Of
the four, it is the easiest to like — and precisely for that reason its detail page has to be
the harshest about disclaimers.

**Silhouette.** The **roundest and fullest**, even at the calm level — its baseline really is
8% bigger than the other three (it was already chubby before risk arrived; that is part of the
joke). Unique trait: a **leaf-shaped dorsal fin**, curving diagonally backwards — a diagonal
bump on the upper right of the silhouette.

**Colours.** Body Yield Amber `#E69F00` · belly `#FFC24D`. The only warm-coloured fugu, and
that is deliberate.

**Signature prop.** **Three rising bubbles** behind the tail, getting smaller toward the top —
a flowing stream of yield. These bubbles are also an indicator: the faster the animation, the
more often the agent is moving positions.

**What makes it readable at 48 px.** The diagonal leaf bump on the upper right + colour
temperature. In a row of four avatars, Yield is the only warm patch; in a monochrome
silhouette, the only one with a slanted bump (not upright like Grid, not flat like Guardian).

---

## 6. The 48-pixel differentiation matrix

Ordered from the channel that survives shrinking best to the one that disappears first.

| Channel | Guardian | Rebalancer | Grid | Yield |
|---|---|---|---|---|
| **Top edge of silhouette** | flat (shield) | curved | upright triangle | slanted bump |
| **Width:height ratio** | 1.15 : 1 | 1 : 1.1 | 1 : 1 | 1.05 : 1 (baseline +8%) |
| **Extends past the body** | no | yes, left+right | no | no |
| **Mark on the face** | thick eyebrows | — | horizontal visor line | — |
| **Colour temperature** | cold dark | cold light (magenta) | cold bright | **warm** |
| **Body texture** | plain | plain | faint grid | plain |

**Mandatory tests before an asset is considered done:**

1. Render at 48×48 px, then convert to **grayscale**. All four must still be matched to the
   right name by someone who has seen them only once.
2. Render at 48×48 px, then **blur by 2 px**. The silhouettes must still differ.
3. Place all four on `#0B1E2B` and on `#F4F8F9` backgrounds. None may disappear on either.
4. Simulate deuteranopia and protanopia. Guardian/Grid/Rebalancer will look similar to each
   other in hue — that is accepted, because the differentiator is the silhouette. What is
   **not** accepted is two silhouettes looking similar as well.

---

## 7. Third-party agents (fallback)

Spec `§8` specifies a fallback fugu coloured deterministically from the agent ID. Brand rules:

- The fallback uses a **neutral silhouette**: a plain egg body, no signature prop, no
  shield/visor/leaf/arms. The signature props belong to the four first-party agents and must
  not leak to third parties — that is what makes our four agents read as a quality floor
  rather than as four out of 309 thousand.
- The hue is taken from `hash(agentId) mod 360`, but **saturation and lightness are locked**
  (S 42%, L 52%) so that no card ever glows brighter than a curated agent, and so text
  contrast stays predictable.
- Hues in the 95°–150° (green) and 0°–20° (red) ranges are **skipped** — those two ranges
  belong to risk semantics, not to identity.
- The fallback still follows the puff system: it puffs up too, because the metric is the same.

## Terminology — one name, three spellings resolved

Prose, UI copy, and the README all use **puff level** (the fugu *puffs up*). The five levels
are **Calm · Watchful · Strained · Critical · Emergency**.

The code field is still named `bloatLevel`, and the frozen image prompts in
`image-prompts.md` say "bloat level". Those are deliberately left alone: renaming an
identifier that generated assets are keyed to would break references for no reader benefit.
When you meet `bloatLevel` in code, read it as *puff level*.
