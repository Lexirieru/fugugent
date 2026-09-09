/**
 * The presentation mapping for the nine Fugugent categories.
 *
 * The categories are locked in `contracts/src/types/FuguTypes.sol` and
 * `backend/src/types.ts`. All that lives here is how to show them: a name for humans,
 * the fugu character, and the category's **primary risk metric**.
 *
 * A different metric per category is a deliberate choice, not an oversight: a health
 * factor must not be forced to be judged by APR. That is what makes the categories
 * genuinely equal in depth, rather than merely nine tabs (spec §7.5, point 8).
 *
 * Every blurb below is one sentence a reader who has never touched crypto can follow.
 * If a sentence needs a term of art to stay true, the term is explained in the same
 * sentence rather than dropped.
 */

import type { AgentRecord, Category } from "@/lib/agent-types";
import { CATEGORIES } from "@/lib/agent-types";
import type { FuguKind } from "@/lib/fugu";

export interface CategoryMeta {
  category: Category;
  label: string;
  kind: FuguKind;
  /** What an agent in this category does. */
  blurb: string;
  /** The metric that maps to the puff level. Source: docs/brand/puff-levels.md §3 and §4. */
  riskMetric: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  HEALTH_FACTOR: {
    category: "HEALTH_FACTOR",
    label: "Health factor",
    kind: "guardian",
    blurb: "Pays down a loan before the collateral behind it can be sold off.",
    riskMetric: "how far the collateral can fall before the loan is closed by force",
  },
  REBALANCING: {
    category: "REBALANCING",
    label: "Rebalancing",
    kind: "rebalancer",
    blurb: "Keeps the split of what you hold where you set it, and moves it back when it drifts.",
    riskMetric: "share of the last 24 hours the holding spent outside its set range",
  },
  GRID: {
    category: "GRID",
    label: "Grid",
    kind: "grid",
    blurb:
      "Buys at fixed lower prices and sells at fixed higher ones. It loses in a one-way market, and says so.",
    riskMetric: "how far the balance has fallen from its own best day",
  },
  YIELD: {
    category: "YIELD",
    label: "Yield",
    kind: "yield",
    blurb: "Moves savings into the best paying place it can check for itself.",
    riskMetric:
      "how much of that place is already lent out, which is what makes taking money back slow",
  },
  HIRING: {
    category: "HIRING",
    label: "Hiring",
    kind: "broker",
    blurb: "Hires and pays other agents for you. The money is held until the work is done.",
    riskMetric: "share of hires that ended without the work being delivered",
  },
  COMMERCE: {
    category: "COMMERCE",
    label: "Commerce",
    kind: "trader",
    blurb:
      "Buys answers and data one call at a time, and neither side ever holds the other's keys.",
    riskMetric: "share of paid calls that were charged and then failed",
  },
  AUTONOMOUS: {
    category: "AUTONOMOUS",
    label: "Autonomous",
    kind: "pilot",
    blurb: "Moves, lends and stakes money for you inside a spending limit it cannot go past.",
    riskMetric: "how much of the spending limit has been used today",
  },
  STREAMING: {
    category: "STREAMING",
    label: "Streaming",
    kind: "meter",
    blurb: "Pays by the call, by the second or by the unit, without you approving each one.",
    riskMetric: "how close the running total is to the ceiling you set",
  },
  TREASURY: {
    category: "TREASURY",
    label: "Treasury",
    kind: "steward",
    blurb: "Runs the payments that repeat: salaries, subscriptions, anything on a schedule.",
    riskMetric: "how much is left to cover the payments already scheduled",
  },
};

/** The tab order. The same as the on-chain enum order, so a tab cannot outrank its number. */
export const CATEGORY_ORDER: Category[] = [...CATEGORIES];

/**
 * The ids of our own agents. Only these may carry a distinguishing prop (a shield, a
 * visor, a leaf, scale arms, a case, a price tag, twin fins, a dial, a clock) per
 * `docs/brand/characters.md` §7. Everything else gets a neutral silhouette in a
 * deterministic colour, so that ours read as a quality floor rather than as nine out
 * of three hundred thousand.
 *
 * **The key is the id, and that is the point.** Anybody may publish an agent called
 * "Fugu Guardian"; nobody else can take our token id. Matching on the name would hand
 * the shield to whoever asked for it.
 *
 * There are two sets of ids because there are two catalogues. The `97:1` to `97:4`
 * keys belong to the sample bundled with this build. The `97:8004` to `97:8012` keys
 * are the ERC-8004 token ids of the same agents as they are actually registered on
 * the test network, all owned by 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E. Both are
 * listed rather than one, because the app has to be right whichever catalogue answers.
 */
export const FIRST_PARTY: Record<string, FuguKind> = {
  // The bundled sample.
  "97:1": "guardian",
  "97:2": "rebalancer",
  "97:3": "grid",
  "97:4": "yield",
  // Registered on chain, ERC-8004 token ids.
  "97:8004": "guardian",
  "97:8005": "rebalancer",
  "97:8006": "grid",
  "97:8007": "yield",
  "97:8008": "broker",
  "97:8009": "trader",
  "97:8010": "pilot",
  "97:8011": "meter",
  "97:8012": "steward",
};

export function fuguKindFor(record: AgentRecord): FuguKind {
  return FIRST_PARTY[record.id] ?? "fallback";
}

/** The category that applies: the on-chain listing first, then the classifier's result. */
export function categoryOf(record: AgentRecord): Category | null {
  return record.fuguListing?.category ?? record.classification?.category ?? null;
}

export function isCategory(value: string | null | undefined): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
