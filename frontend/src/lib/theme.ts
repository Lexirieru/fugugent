/**
 * The palette, as literals, for the places that cannot read a CSS custom property.
 *
 * Two of them exist in this app:
 *
 *  1. **The OG images.** `app/opengraph-image.tsx` and `app/agent/[id]/opengraph-image.tsx`
 *     are rendered on the server by Satori. There is no document, no `:root`, and no
 *     cascade, a `var(--bg)` there resolves to nothing and the image comes out black.
 *  2. **The fugu SVG generator** (`lib/fugu.ts`), whose output is also fed to Satori as a
 *     data URI, so the same constraint applies to it.
 *
 * ## This file is a projection, not a second palette
 *
 * `theme/tokens.css` at the repository root is the source of truth, shared with the
 * landing page. These numbers are its server-side twin. They exist twice, here and
 * there, and nowhere else in this app: everything that CAN read a custom property does,
 * and every one of the twenty-odd hex literals that used to be scattered through the
 * components is gone.
 *
 * **Changing a colour means changing both files in the same commit.** There is no build
 * step keeping them honest, so that sentence is the whole mechanism. The contrast ratios
 * and the reasoning live in `theme/tokens.css`; do not re-derive them here.
 */

/** Page and surface colours. Mirrors the `--bg` / `--surface` block in theme/tokens.css. */
export const SURFACES = {
  bg: "#f1e6e1",
  surface: "#f8f0ec",
  bgElev: "#faf3ef",
} as const;

/** Text colours. Mirrors the `--fg*` block. */
export const TEXT = {
  fg: "#000000",
  muted: "#616161",
  faint: "#6f645e",
} as const;

/** Accent. Mirrors the `--accent*` block, orange, never BNB yellow (palette.md §1). */
export const ACCENT = {
  /** Fills, chips, rules. 2.91:1 on `bg`, not for text. */
  base: "#ea580c",
  /** The same orange as text and as a focus ring. 4.97:1 on `bg`. */
  strong: "#a8420a",
  /** What you write on top of an accent fill. 5.29:1 on `base`. */
  ink: "#06131a",
} as const;

/**
 * Puff-level colours, recomputed for a light ground. Okabe–Ito hues preserved to within
 * half a degree; lightness lowered until each clears AA as text on `--bg`. The full
 * argument, the before/after table and the hue-gap check are in `theme/tokens.css`.
 *
 * These are the RING colours. An agent's body colour is its identity and never changes
 * with risk, that is `AGENT`, below.
 */
export const RISK = {
  1: "#007656", // Calm      · 4.60:1 on bg
  2: "#6b6300", // Watchful  · 5.03:1 on bg
  3: "#7b5500", // Strained  · 5.46:1 on bg
  4: "#924000", // Critical  · 5.80:1 on bg
  5: "#a4210e", // Emergency · 6.12:1 on bg; always a solid fill with white text (7.49:1)
} as const;

/**
 * Agent identity. Okabe–Ito, and deliberately NOT darkened: these are never text and
 * never the boundary of a shape, only the fill inside a 3px `ILLUSTRATION.outline`
 * stroke, which is 15.48:1 against the page. `docs/brand/palette.md` §4.
 */
export const AGENT = {
  guardian: { body: "#0072b2", belly: "#58a9e0" },
  rebalancer: { body: "#cc79a7", belly: "#e9a8cc" },
  grid: { body: "#56b4e9", belly: "#8fd3f4" },
  yield: { body: "#e69f00", belly: "#ffc24d" },

  /*
   * The five capabilities added in the second round. These five ARE darkened,
   * because they were measured against this page rather than against the dark
   * ground Okabe-Ito was published for, and each one was lowered at constant hue
   * until it cleared the 3:1 a graphic needs. The numbers are computed, and the
   * argument for the two interpolated hues is in theme/tokens.css.
   */
  broker: { body: "#00976e", belly: "#26d7a7" }, // 3.03:1 on bg, belly 2.01:1 on the body
  trader: { body: "#91870b", belly: "#cec224" }, // 3.02:1 on bg, belly 2.00:1 on the body
  pilot: { body: "#d55e00", belly: "#e29559" }, // 3.16:1 on bg, belly 1.60:1 on the body
  meter: { body: "#7f79e0", belly: "#bab7ee" }, // 3.00:1 on bg, belly 1.94:1 on the body
  steward: { body: "#ba5ed9", belly: "#ddb1ec" }, // 3.01:1 on bg, belly 2.03:1 on the body
} as const;

/**
 * The fugu's own palette, shared with `docs/brand/generate-svg.py` so that the fish in
 * this app and the fish on the landing page are the same fish. Illustration only, never
 * reach for these to paint UI.
 */
export const ILLUSTRATION = {
  outline: "#05121a",
  foam: "#f4f8f9",
  foam2: "#e3ecef",
  /** The eye ring of a fugu with no fresh reading. */
  hollow: "#6f645e",
} as const;
