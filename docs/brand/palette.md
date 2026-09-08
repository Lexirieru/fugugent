# Fugugent — Colour Palette

**Date:** 2026-09-08
Every contrast ratio in this document is **computed** (WCAG 2.1 relative luminance), not
estimated. Thresholds: **AA normal text 4.5:1** · **AA large text (≥18.66 px bold /
≥24 px) 3.0:1** · **AAA normal text 7.0:1** · **non-text components 3.0:1**.

---

## 1. The BNB yellow `#F0B90B` decision

**We deliberately stay away from it.** `#F0B90B` is not a Fugugent brand colour; it is used
**only** as an ecosystem colour — the "BNB Chain Testnet" badge, the network icon, the footer
— and never as a primary button colour, a link colour, or a brand background.

Three reasons, ordered from most binding down:

1. **Yellow already has another job in this product.** Puff level 2 ("Watchful") uses
   `#F0E442`. If yellow also becomes the brand colour, every button and every header starts to
   look like a warning, and the real warnings lose their voice. In a product whose entire value
   is reading risk at a glance, this is not a matter of taste — it breaks the function.
2. **Yellow fails as text.** `#F0B90B` on white `#F4F8F9` is only **1.69:1** — far below AA for
   text and below the 3.0:1 for components. A brand whose colour cannot be used for writing
   will be violated over and over by its own implementation.
3. **Every BNB hackathon entrant uses that colour.** Being the fiftieth yellow in the room is
   not a differentiation strategy. Fugugent already has a far stronger identity to work with:
   the deep sea, and a fish that puffs up inside it.

What we **do take** from BNB Chain is the principle, not the hex: one decisive warm accent
colour on a dark background. We use it for Fugu Yield (`#E69F00`) — close enough to feel part
of the same ecosystem, far enough not to be mistaken for it.

**Rules for using `#F0B90B`:** only on dark backgrounds (`#05121A` → 10.51:1), only as badge
or icon fill, minimum size 16 px, never as text colour on a light background, never inside a
risk component.

---

## 2. Base colours

| Token | Hex | Use for |
|---|---|---|
| `abyss-900` | `#05121A` | app background (dark), outlines on all illustrations |
| `abyss-800` | `#0B1E2B` | card surfaces in dark mode |
| `abyss-700` | `#14303F` | raised surfaces, table headers |
| `line` | `#23485C` | divider lines in dark mode |
| `foam-100` | `#F4F8F9` | app background (light), text on dark backgrounds |
| `foam-200` | `#E3ECEF` | card surfaces in light mode, fill of the Guardian shield |
| `ink` | `#06131A` | primary text on light backgrounds |
| `muted-dark` | `#9FB9C4` | secondary text **on dark backgrounds** |
| `muted-light` | `#4A6472` | secondary text **on light backgrounds** |

## 3. Brand colours

| Token | Hex | Notes |
|---|---|---|
| `teal-700` | `#0A6470` | brand colour for text/links **on light backgrounds** |
| `teal-600` | `#0E7C86` | primary button fill; white text on top |
| `teal-300` | `#5FD4DC` | brand colour for text/links/icons **on dark backgrounds** |
| `teal-200` | `#9CE9EE` | highlights, the glow around a fugu, focus rings in dark mode |
| `bnb-yellow` | `#F0B90B` | **only** the ecosystem badge, only on dark backgrounds |

## 4. Agent category colours

Taken from the **Okabe–Ito** palette, a set designed to stay distinguishable under
deuteranopia, protanopia, and tritanopia. This is not an aesthetic choice that happens to be
safe — it is the starting point.

| Agent | Token | Hex | Belly |
|---|---|---|---|
| Guardian (`HEALTH_FACTOR`) | `agent-guardian` | `#0072B2` | `#58A9E0` |
| Rebalancer (`REBALANCING`) | `agent-rebalancer` | `#CC79A7` | `#E9A8CC` |
| Grid (`GRID`) | `agent-grid` | `#56B4E9` | `#8FD3F4` |
| Yield (`YIELD`) | `agent-yield` | `#E69F00` | `#FFC24D` |

Guardian, Grid, and Rebalancer will converge under dichromatic vision. That is **accepted and
intentional**, because the main differentiator is the silhouette (see `characters.md` §6), and
because every card always carries the category name as text. Colour here is the third channel,
not the first.

## 5. Puff level colours

These may appear only inside risk components (avatar ring, chip, bar). They **must not** be
used for anything else — not for buttons, not for charts, not for badges.

| Level | Token | Hex | Companion pattern (mandatory) |
|---|---|---|---|
| 1 Calm | `risk-1` | `#009E73` | thin solid arc |
| 2 Watchful | `risk-2` | `#F0E442` | solid ring + notch |
| 3 Strained | `risk-3` | `#E69F00` | dashed ring |
| 4 Critical | `risk-4` | `#D55E00` | double ring |
| 5 Emergency | `risk-5` | `#A4210E` | **45° diagonal hazard stripes** `#F4F8F9`/`#05121A` |

`risk-3` is deliberately the same as `agent-yield`. The two never appear in the same role
within one component (one on the body, one on the ring), and adding yet another orange would
only shrink the distance between colours across the whole system.

---

## 6. Contrast table (computed)

### Text pairs that **pass AA** — use these

| Foreground | Background | Ratio | Status |
|---|---|---|---|
| `ink #06131A` | `foam-100 #F4F8F9` | **17.60** | AAA |
| `foam-100 #F4F8F9` | `abyss-900 #05121A` | **17.73** | AAA |
| `foam-100 #F4F8F9` | `abyss-800 #0B1E2B` | **15.91** | AAA |
| `foam-100 #F4F8F9` | `abyss-700 #14303F` | **12.89** | AAA |
| `muted-light #4A6472` | `foam-100 #F4F8F9` | **5.85** | AA |
| `muted-dark #9FB9C4` | `abyss-900 #05121A` | **9.22** | AAA |
| `teal-700 #0A6470` | `foam-100 #F4F8F9` | **6.40** | AA (nearly AAA) |
| `teal-600 #0E7C86` | `foam-100 #F4F8F9` | **4.63** | AA normal text |
| `white #FFFFFF` | `teal-600 #0E7C86` | **4.95** | AA — primary button |
| `white #FFFFFF` | `teal-700 #0A6470` | **6.84** | AA — primary button (hover) |
| `teal-300 #5FD4DC` | `abyss-900 #05121A` | **10.77** | AAA |
| `teal-300 #5FD4DC` | `abyss-800 #0B1E2B` | **9.67** | AAA |
| `ink #06131A` | `bnb-yellow #F0B90B` | **10.44** | AAA — text on the BNB badge |
| `white #FFFFFF` | `risk-5 #A4210E` | **7.49** | AAA — Emergency chip |
| `ink #06131A` | `risk-2 #F0E442` | **14.23** | AAA — Watchful chip |
| `agent-guardian #0072B2` | `foam-100 #F4F8F9` | **4.85** | AA |
| `white #FFFFFF` | `agent-guardian #0072B2` | **5.19** | AA |
| `agent-grid #56B4E9` | `abyss-900 #05121A` | **8.21** | AAA |
| `agent-yield #E69F00` | `abyss-900 #05121A` | **8.42** | AAA |
| `agent-rebalancer #CC79A7` | `abyss-900 #05121A` | **6.19** | AA |
| `risk-5 #A4210E` | `foam-100 #F4F8F9` | **7.01** | AAA |

### Pairs that **FAIL** — do not use for text

| Foreground | Background | Ratio | Notes |
|---|---|---|---|
| `bnb-yellow #F0B90B` | `foam-100 #F4F8F9` | 1.69 | the main reason for §1 |
| `risk-2 #F0E442` | `foam-100 #F4F8F9` | 1.24 | yellow only as fill, with `ink` text on top |
| `teal-300 #5FD4DC` | `foam-100 #F4F8F9` | 1.65 | light teal is for dark mode only |
| `agent-grid #56B4E9` | `foam-100 #F4F8F9` | 2.16 | use `#0072B2` if you need blue text on a light background |
| `agent-yield #E69F00` | `foam-100 #F4F8F9` | 2.11 | use as fill + `ink` text |
| `agent-rebalancer #CC79A7` | `foam-100 #F4F8F9` | 2.86 | same |
| `risk-5 #A4210E` | `abyss-900 #05121A` | 2.53 | **important:** in dark mode, level 5 must be a solid `#A4210E` fill with white text, not red text |
| `risk-1 #009E73` | `foam-100 #F4F8F9` | 3.20 | enough for non-text components, not for text |

The `risk-5` row on a dark background is the trap that is easiest to fall into and the most
expensive to get wrong: the most severe state becomes the hardest one to read. That is why
level 5 is **always** a solid fill + white text + hazard stripes, in both light and dark mode.

---

## 7. CSS tokens

```css
:root {
  --abyss-900:#05121A; --abyss-800:#0B1E2B; --abyss-700:#14303F; --line:#23485C;
  --foam-100:#F4F8F9; --foam-200:#E3ECEF; --ink:#06131A;
  --muted-dark:#9FB9C4; --muted-light:#4A6472;

  --teal-700:#0A6470; --teal-600:#0E7C86; --teal-300:#5FD4DC; --teal-200:#9CE9EE;
  --bnb-yellow:#F0B90B;

  --agent-guardian:#0072B2;   --agent-guardian-belly:#58A9E0;
  --agent-rebalancer:#CC79A7; --agent-rebalancer-belly:#E9A8CC;
  --agent-grid:#56B4E9;       --agent-grid-belly:#8FD3F4;
  --agent-yield:#E69F00;      --agent-yield-belly:#FFC24D;

  --risk-1:#009E73; --risk-2:#F0E442; --risk-3:#E69F00;
  --risk-4:#D55E00; --risk-5:#A4210E;
}
```

## 8. Typography (short version)

- **Headings & numbers:** a single grotesk with *tabular* figures — the numbers on agent cards
  change every second over WebSocket, and varying widths make the line wobble. Turn on
  `font-variant-numeric: tabular-nums` everywhere a metric is displayed. This is a binding
  rule, not a preference.
- **Financial numbers** use Indonesian formatting: `1,18` (decimal comma), `6,4%`. This is
  already consistent with `formatHf()` and `formatPercentFromBps()` in the Guardian code.
- **Minimum size** for metric text on a card: 13 px, weight 500. Below that, drop the metric —
  do not shrink it.
