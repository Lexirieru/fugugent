# Fugugent — Puff Levels

**Date:** 2026-09-08
**Source of the Guardian thresholds:** `ai/fuguguardian/app/agent/src/strategy/types.ts`
(`DEFAULT_THRESHOLDS`) and `decide.ts`. **If the code changes, this document changes with it**
— not the other way round. The numbers in the UI must always be the same as the numbers the
decision engine uses; otherwise we repeat exactly the mistake that killed Giza/ARMA (the
dashboard telling a different story than the chain).

---

## 0. The visual contract

Five levels. Not four, not seven. Five because that is the exact number needed to cover the
four Guardian decision thresholds (`WARN`, `PARTIAL_REPAY`, `DELEVERAGE`, `EMERGENCY`) plus
one "nothing needs doing" state.

Every level differs on **six channels at once**. This is not redundancy — each channel
survives a different condition (small size, grayscale, colour blindness, animation off,
compressed screenshot).

| # | Channel | Why it exists |
|---|---|---|
| 1 | Body width | survives down to 16 px and after blurring |
| 2 | Spikes | survives in the silhouette |
| 3 | Eyes & mouth | survives at ≥64 px, carries the emotional payload |
| 4 | Ring (rim) around the avatar | pattern, not colour — survives in grayscale |
| 5 | Ring colour | read quickly by the majority, **never on its own** |
| 6 | Numeric text chip | the only unambiguous channel; required on both the card and the detail page |

**Absolute rule:** the agent's body colour **never** changes because of the puff level. Only
the body shape and the ring change. A Guardian in an emergency is still cobalt; it just
becomes round, spiky, and surrounded by hazard stripes.

---

## 1. The five levels

Geometry unit: a 100×100 unit box, 8 units of padding (see `characters.md` §1).

### Level 1 — **Calm**

- **Body width** 56 u · height 52 u (the slimmest)
- **Spikes** fully retracted; the back is smooth
- **Face** relaxed round eyes, lids slightly lowered, small neutral `ω` mouth
- **Ring** thin 2 u line, **solid**, covering only 40% of the circumference (upper arc)
- **Ring colour** Reef Green `#009E73`
- **Chip** text on a transparent background, normal text colour
- **Motion** floating up and down 3 u, 4-second cycle
- **Meaning** nothing needs doing. The agent is alive, monitoring, not acting.

### Level 2 — **Watchful**

- **Body width** 64 u · height 58 u
- **Spikes** out 25%, tips still **blunt**
- **Face** one eyebrow raised, eyes slightly wider, mouth still neutral
- **Ring** 3 u line, **solid**, full circumference, with **one notch** at twelve o'clock
- **Ring colour** Shoal Yellow `#F0E442`
- **Chip** normal text, plus a word label
- **Motion** floating 2 u, 3-second cycle
- **Meaning** the first threshold has been touched. The agent has given notice; it has not
  spent anything yet. This is the level users see most often and it **must not feel like an
  alarm** — if level 2 already causes panic, level 5 loses its force.

### Level 3 — **Strained**

- **Body width** 72 u · height 66 u
- **Spikes** out 60%, tips starting to sharpen
- **Face** eyes narrowed, cheeks puffed, mouth pursed as if holding back
- **Ring** 3 u line, **dashed** (6 u dash / 4 u gap), full circumference
- **Ring colour** Tide Amber `#E69F00`
- **Chip** normal text + a trend direction arrow (up/down) — direction starts to matter here
- **Motion** fine 1 u tremor, 8 Hz, only when new data arrives
- **Meaning** the agent is about to act and **spend money**. For Guardian: repaying part of
  the debt. This is the first level with a financial consequence, and the ring pattern
  changing from solid to dashed marks it without needing colour.

### Level 4 — **Critical**

- **Body width** 80 u · height 74 u
- **Spikes** out 100%, fully pointed
- **Face** eyes wide, pupils small, one bead of sweat at the temple, mouth slightly open
- **Ring** **double** — two 2 u lines 2 u apart, both solid
- **Ring colour** Deep Vermillion `#D55E00`
- **Chip** bold text + warning triangle icon
- **Motion** pulse scaling 1.00 → 1.04, 1.2-second cycle
- **Meaning** an aggressive action is under way (deleverage). The position can still be
  saved. The double ring = "two things are moving at once".

### Level 5 — **Emergency**

This is the level that has to be readable with no colour at all.

- **Body width** 84 u · height 82 u — **touching and slightly cropped by the square frame**.
  The only level that leaves its box. The fugu no longer fits.
- **Spikes** 100% + a secondary row of spikes between the main rows
- **Face** the eyes become **crosses (×)** — the only level whose eyes are not circles; the
  mouth hangs wide open
- **Ring** **45° diagonal hazard stripes**, 4 u stripe width, alternating
  `#F4F8F9` and `#05121A` — luminance contrast 17.7:1, readable in pure monochrome, on a
  broken screen, and in black-and-white print
- **Colour** Alarm Red `#A4210E` is used only as a **solid chip fill**, with white text on it
  (contrast 7.49:1). The red is a bonus, not the carrier of the message.
- **Chip** solid block, white text, all caps, containing the number + a word:
  `HF 0.98 · EMERGENCY`
- **Motion** none. **Deliberately still.** Every other level moves; level 5 freezes. The change
  from moving to stopped is a very strong signal in peripheral vision, and it still works for
  users who turn animation off (see §5).
- **Meaning** the last threshold has been crossed. For Guardian: the position is at the
  liquidation point.

**The four level-5 channels that do not depend on colour at all:** the silhouette cropped by
the frame · cross eyes · black-and-white hazard stripes · all-caps text on the chip. Remove
colour entirely and level 5 is still the only one that cannot be mistaken for another level.

---

## 2. Summary table

| # | Name | Width | Spikes | Ring (pattern) | Ring (colour) | Motion |
|---|---|---|---|---|---|---|
| 1 | Calm | 56 u | 0% | thin solid arc | `#009E73` | slow float |
| 2 | Watchful | 64 u | 25% blunt | solid + notch | `#F0E442` | float |
| 3 | Strained | 72 u | 60% | dashed | `#E69F00` | tremor on update |
| 4 | Critical | 80 u | 100% | double | `#D55E00` | pulse |
| 5 | Emergency | 84 u, cropped | 100% + secondary | **45° black-and-white hazard stripes** | `#A4210E` (chip fill only) | **still** |

---

## 3. Guardian mapping — `HEALTH_FACTOR`

This is the binding mapping, copied straight from the comparisons in `decide.ts`. Note that
**every boundary is inclusive toward the more severe side** — the code checks from the most
severe condition to the mildest so that a case sitting exactly on a threshold always falls to
the safer action. The visuals must mirror that exactly; if the UI shows "Strained" while the
agent is already running `DELEVERAGE`, we are lying.

| Level | HF condition | `Action` in code | What the agent does |
|---|---|---|---|
| 1 Calm | `HF > 1.5` **or `HF = null`** | `NONE` | monitor only |
| 2 Watchful | `1.2 < HF ≤ 1.5` | `WARN` | notify, spend nothing |
| 3 Strained | `1.1 < HF ≤ 1.2` | `PARTIAL_REPAY` | repay part of the debt |
| 4 Critical | `1.0 < HF ≤ 1.1` | `DELEVERAGE` | reduce leverage |
| 5 Emergency | `HF ≤ 1.0` | `EMERGENCY` | emergency action; already at the liquidation point |

**The `HF = null` case (no debt).** This is the **safest** state, not an unknown one, and the
code already says so (`"There is no debt, so there is no liquidation risk."`). Visually:
level 1 at full, with an `∞` chip replacing the number. Never show `—` or `N/A`; that makes
the safest state look like data that failed to load.

**The companion number is mandatory.** Besides HF, the Guardian chip shows
`dropToLiquidationBps` as a percentage: *"collateral can fall 6.4% before liquidation"*. For
many people that sentence is more actionable than "HF 1.18", and the code already computes it.
On a 48 px card only the HF number fits; the percentage appears on hover and on the detail page.

**Two scales, two registers — a rendering rule, not a preference.** The puff level and the
`Action` are different answers to different questions: *how dangerous is this position right
now* versus *what will the agent do about it*. Both matter before someone pays, and neither
can stand in for the other.

They must never be rendered as two prose labels side by side. When we tried that, the scales
read as "Watchful" and "Watching" — two words nobody can tell apart, meaning two different
things. No amount of careful word choice fixes that; the failure is structural.

The rule: **the puff level is prose, the action is a code token.** The level appears as a
title-case name in a rounded pill next to the fugu. The action appears as the identifier
copied verbatim from `decide.ts` — `NONE`, `WARN`, `PARTIAL_REPAY`, `DELEVERAGE`,
`EMERGENCY` — in uppercase monospace, in a square-cornered box, with no fugu beside it.
Verbatim identifiers carry a second benefit: the UI cannot name an action the code does not
have.

Label each scale with the question it answers rather than trusting the reader to infer it.

**Stale data state.** If the on-chain read fails or is older than 2× the poll interval, do not
show any level at all. Show a **hollow fugu silhouette (outline only, no fill)** with the chip
`stale data · last read 4m ago`. Guessing a level from old data is the most expensive lie in
this product.

---

## 4. Mapping for the other three agents

The principle is the same: each agent maps **one primary risk metric** that can be verified
on-chain onto the same five levels. The metric differs per category — that is exactly what
"equivalent-within-category metric" means in spec §7.5.

### Rebalancer — `REBALANCING`
Metric: **percentage of time the LP position is out of range** (rolling 24 hours), from
comparing the position tick against the pool tick.

| Level | Time out of range, 24h |
|---|---|
| 1 Calm | < 5% |
| 2 Watchful | 5–15% |
| 3 Strained | 15–30% |
| 4 Critical | 30–50% |
| 5 Emergency | > 50%, **or** out of range for > 24 hours with no profitable rebalance |

The second condition at level 5 matters: a position can be "only" 40% out of range but stuck
because `ΔFee − Gas − Slippage − ΔIL` is always negative. That is the real emergency — the
agent cannot help, and the user needs to know.

### Grid — `GRID`
Metric: **drawdown from peak equity** since the subscription started.

| Level | Drawdown |
|---|---|
| 1 Calm | < 2% |
| 2 Watchful | 2–5% |
| 3 Strained | 5–10% |
| 4 Critical | 10–18% |
| 5 Emergency | > 18%, **or** price leaves the upper/lower grid bound |

Price leaving the grid bounds = the strategy stops working entirely (all capital sits on one
side). Grid must puff up fully there even if the drawdown has not reached 18%, because this is
the structural failure mode we promised to state openly.

### Yield — `YIELD`
Metric: **utilisation of the pool the funds sit in** (`borrow / supply`) — a direct proxy for
the "cannot withdraw" risk.

| Level | Utilisation |
|---|---|
| 1 Calm | < 70% |
| 2 Watchful | 70–85% |
| 3 Strained | 85–92% |
| 4 Critical | 92–97% |
| 5 Emergency | > 97%, **or** a withdrawal fails because liquidity ran out |

A high APR **never** shrinks the fugu. Puffing only talks about risk. If APR rises because
utilisation rises, the fugu puffs up — that is in fact the correct message, and it is what
separates us from dashboards that display a headline APR with no context.

---

## 5. Implementation rules

1. **Thresholds come from one source.** The backend sends `bloatLevel: 1|2|3|4|5` already
   computed from the raw metrics; the frontend **must not** recompute the thresholds. The
   frontend also receives the raw metrics, for display, but not for deciding.
2. **Fast up, slow down.** Puffing up takes 400 ms `ease-out`; deflating takes 900 ms
   `ease-in-out`. Risk arrives suddenly, recovery does not. This also stops the avatar from
   flickering when a metric jitters around a threshold.
3. **3% hysteresis.** To drop one level, the metric must pass the threshold by 3% in the safe
   direction. Without this, HF 1.199 → 1.201 → 1.199 makes the fugu flicker and users stop
   trusting it.
4. **`prefers-reduced-motion`.** All motion is turned off; shape, ring, and chip still carry
   the entire message. No information exists **only** in the animation — including the
   stillness at level 5, which is still marked by the hazard stripes and the cross eyes.
5. **Minimum display size.** The ring and spikes may be simplified below 32 px, but the
   numeric chip must not be dropped at any size that displays level 4 or 5. If it does not
   fit, do not show the avatar at all — show the row as text.
6. **Aria.** `role="img"` with an `aria-label` containing a full sentence, not a bare number:
   *"Fugu Guardian, level 4 of 5, critical. Health factor 1.06. Collateral can fall 5.7 percent
   before liquidation."*
7. **Never use the puff level for anything other than risk.** Not for popularity, not for AUM,
   not for the number of hirers. One mechanic, one meaning — the moment it is used for two
   things, it stops meaning anything.
