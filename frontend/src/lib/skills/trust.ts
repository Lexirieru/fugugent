/**
 * How each of the seven statuses is *said* and *drawn*.
 *
 * This file holds no logic that decides a status — only the vocabulary for one that has
 * already been decided by the backend. Nothing here reads an audit, a finding, or a
 * digest in order to reach a conclusion.
 *
 * ## Why every status carries four channels
 *
 * Somebody who misreads this installs a skill that empties their wallet. So the
 * distinction is never left to colour:
 *
 * 1. **`label`** — a unique phrase per status. All seven differ, and only one of them
 *    contains the word "passed". This channel alone separates all seven, in grayscale,
 *    in a screen reader, and in a black-and-white printout.
 * 2. **`glyph`** — a unique silhouette per status (tick, cross, ≠, ?, half-disc,
 *    hourglass, slashed circle). Shape, not hue.
 * 3. **`pattern`** — the border and the card's top rail: solid, hazard stripes, double,
 *    dotted, dashed, hairline. A texture survives `grayscale(1)`.
 * 4. **`verdictLine`** — a full sentence about installing. The five "we do not know"
 *    statuses all say so in words; `FAILED` says the opposite of "unknown", not a
 *    louder version of it.
 *
 * Colour is the fifth channel and never the first, exactly as `theme/tokens.css`
 * requires of the risk ramp it borrows from.
 */

import type { TrustStatus } from "@/lib/skills/types";

export type TrustGlyph =
  | "tick"
  | "cross"
  | "not-equal"
  | "question"
  | "half"
  | "hourglass"
  | "empty";

export type TrustPattern =
  | "solid"
  | "hazard"
  | "double"
  | "dotted"
  | "dashed"
  | "ticks"
  | "hairline";

/**
 * The three bands. `verified` holds exactly one status; `dangerous` holds exactly one;
 * `unknown` holds the other five. Grouping them is what keeps "nobody has looked at
 * this" from sitting next to "audited and clean" as though they were neighbours.
 */
export type TrustBand = "verified" | "dangerous" | "unknown";

export interface TrustPresentation {
  label: string;
  band: TrustBand;
  bandLabel: string;
  glyph: TrustGlyph;
  pattern: TrustPattern;
  /** A `theme/tokens.css` semantic colour. Never a new hex. */
  color: string;
  /** `true` = the badge is a filled block with white text, not an outline. */
  filled: boolean;
  /** The sentence that answers "can I install this?". Plain language, no hedging. */
  verdictLine: string;
  /** What the status means, for the legend. */
  meaning: string;
}

export const TRUST_PRESENTATION: Record<TrustStatus, TrustPresentation> = {
  PASSED: {
    label: "Passed audit",
    band: "verified",
    bandLabel: "Verified",
    glyph: "tick",
    pattern: "solid",
    color: "var(--risk-1)",
    filled: false,
    verdictLine: "An auditor examined this exact build, found it clean, and we hold the report.",
    meaning:
      "The only status that means safe. The audited digest equals the digest being served, and the evidence is held.",
  },
  FAILED: {
    label: "Failed audit",
    band: "dangerous",
    bandLabel: "Known dangerous",
    glyph: "cross",
    pattern: "hazard",
    color: "var(--risk-5)",
    filled: true,
    verdictLine: "An auditor examined this exact build and found it dangerous. Do not install it.",
    meaning:
      "Knowledge, not ignorance. This build was examined and found harmful — a different thing from never having been looked at.",
  },
  STALE_AUDIT: {
    label: "Audit is for an older build",
    band: "unknown",
    bandLabel: "Not known",
    glyph: "not-equal",
    pattern: "double",
    color: "var(--risk-4)",
    filled: false,
    verdictLine:
      "The verdict on record examined different bytes from the ones being served. It says nothing about this build.",
    meaning:
      "The rug-pull shape: a clean v1 followed by a v2 nobody checked. A verdict is bound to the digest it examined and does not travel.",
  },
  INCONCLUSIVE: {
    label: "Audit inconclusive",
    band: "unknown",
    bandLabel: "Not known",
    glyph: "question",
    pattern: "dotted",
    color: "var(--risk-3)",
    filled: false,
    verdictLine:
      "An audit ran and could not decide, or its evidence is not held. Nothing was cleared and nothing was ruled out.",
    meaning:
      "An audit that reached no verdict has still told us something real, and it is not rounded to either clean or dangerous.",
  },
  AUDITING: {
    label: "Audit running",
    band: "unknown",
    bandLabel: "Not known",
    glyph: "half",
    pattern: "dashed",
    color: "var(--fg-muted)",
    filled: false,
    verdictLine: "The pipeline is running against this build. There is no verdict yet.",
    meaning: "Work in progress is not a result. A partial pipeline clears nothing.",
  },
  AUDIT_REQUESTED: {
    label: "Audit requested",
    band: "unknown",
    bandLabel: "Not known",
    glyph: "hourglass",
    pattern: "ticks",
    color: "var(--fg-muted)",
    filled: false,
    verdictLine: "An audit has been funded, and no auditor has produced a verdict yet.",
    meaning:
      "Money in escrow is a promise about the future, not a statement about the code.",
  },
  UNAUDITED: {
    label: "Never audited",
    band: "unknown",
    bandLabel: "Not known",
    glyph: "empty",
    pattern: "hairline",
    color: "var(--fg-faint)",
    filled: false,
    verdictLine: "Nobody has ever audited this skill. We know nothing about what it does.",
    meaning:
      "The default state of everything on an open registry, and the state most installs happen in today.",
  },
};

/** The order the statuses are shown in: what we know, then what we do not. */
export const TRUST_DISPLAY_ORDER: TrustStatus[] = [
  "PASSED",
  "FAILED",
  "STALE_AUDIT",
  "INCONCLUSIVE",
  "AUDITING",
  "AUDIT_REQUESTED",
  "UNAUDITED",
];

export const BAND_HEADING: Record<TrustBand, string> = {
  verified: "We checked, and it is clean",
  dangerous: "We checked, and it is dangerous",
  unknown: "We do not know",
};

/**
 * The CSS `border-style` for a pattern. `hazard` has no border at all — it is a filled
 * block — and `hairline` is the thinnest honest line we can draw.
 */
/**
 * Border style and width per pattern. Together with the colour these give every one of
 * the seven badges a triple nothing else shares — so two of them never differ by hue
 * alone, which is what a colour-blind reader would be left with.
 */
export const PATTERN_BORDER: Record<TrustPattern, string> = {
  solid: "solid",
  hazard: "solid",
  double: "double",
  dotted: "dotted",
  dashed: "dashed",
  ticks: "dashed",
  hairline: "solid",
};

export const PATTERN_WIDTH: Record<TrustPattern, string> = {
  solid: "2px",
  hazard: "0",
  double: "4px",
  dotted: "2px",
  dashed: "2px",
  ticks: "1px",
  hairline: "1px",
};

/**
 * The rail across the top of a card, as a `background` value.
 *
 * Every one of these is a texture rather than a tint, so the seven remain seven under
 * `filter: grayscale(1)` — the check a colour-blind reader performs for us.
 */
export function railBackground(pattern: TrustPattern, color: string): string {
  switch (pattern) {
    case "hazard":
      // Diagonal hazard tape. The only diagonal on the page, and the only rail that
      // reads as a warning without being read at all.
      return `repeating-linear-gradient(45deg, ${color} 0 6px, transparent 6px 12px)`;
    case "double":
      // Two thin rules with a gap between them: a "double rule", not another dash length.
      return `linear-gradient(to bottom, ${color} 0 2px, transparent 2px 4px, ${color} 4px 6px)`;
    case "dotted":
      return `repeating-linear-gradient(to right, ${color} 0 2px, transparent 2px 6px)`;
    case "dashed":
      return `repeating-linear-gradient(to right, ${color} 0 12px, transparent 12px 20px)`;
    case "ticks":
      return `repeating-linear-gradient(to right, ${color} 0 5px, transparent 5px 10px)`;
    case "hairline":
      return `repeating-linear-gradient(to right, ${color} 0 2px, transparent 2px 12px)`;
    case "solid":
    default:
      return color;
  }
}
