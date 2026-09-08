/**
 * The presentation mapping for the four Fugugent categories.
 *
 * The categories are locked in `contracts/src/types/FuguTypes.sol` and
 * `backend/src/types.ts`. All that lives here is how to show them — a name for humans,
 * the fugu character, and the category's **primary risk metric**.
 *
 * A different metric per category is a deliberate choice, not an oversight: a health
 * factor must not be forced to be judged by APR. That is what makes the four categories
 * genuinely equal in depth, rather than merely four tabs (spec §7.5, point 8).
 */

import type { AgentRecord, Category } from "@/lib/agent-types";
import type { FuguKind } from "@/lib/fugu";

export interface CategoryMeta {
  category: Category;
  label: string;
  kind: FuguKind;
  /** What an agent in this category does. */
  blurb: string;
  /** The metric that maps to the puff level. Source: docs/brand/puff-levels.md §3–4. */
  riskMetric: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  HEALTH_FACTOR: {
    category: "HEALTH_FACTOR",
    label: "Health factor",
    kind: "guardian",
    blurb: "Keeps a lending position away from liquidation.",
    riskMetric: "distance to liquidation",
  },
  REBALANCING: {
    category: "REBALANCING",
    label: "Rebalancing",
    kind: "rebalancer",
    blurb: "Keeps portfolio weights and LP ranges where you put them.",
    riskMetric: "time spent out of range, rolling 24h",
  },
  GRID: {
    category: "GRID",
    label: "Grid",
    kind: "grid",
    blurb: "Buys and sells at fixed levels. Loses in a trending market, and says so.",
    riskMetric: "drawdown from peak equity",
  },
  YIELD: {
    category: "YIELD",
    label: "Yield",
    kind: "yield",
    blurb: "Moves into the highest risk-adjusted APR pool it can verify.",
    riskMetric: "utilisation of the pool holding your funds",
  },
};

/** The tab order. The same as the on-chain enum order. */
export const CATEGORY_ORDER: Category[] = ["REBALANCING", "GRID", "YIELD", "HEALTH_FACTOR"];

/**
 * The ids of our first-party agents. Only these four may carry a distinguishing prop
 * (shield, visor, leaf, scale arms) — `docs/brand/characters.md` §7. A third-party agent
 * always gets a neutral silhouette in a deterministic colour, so that our four read as a
 * quality floor rather than as four out of 309 thousand.
 */
export const FIRST_PARTY: Record<string, FuguKind> = {
  "97:1": "guardian",
  "97:2": "rebalancer",
  "97:3": "grid",
  "97:4": "yield",
};

export function fuguKindFor(record: AgentRecord): FuguKind {
  return FIRST_PARTY[record.id] ?? "fallback";
}

/** The category that applies: the on-chain listing first, then the classifier's result. */
export function categoryOf(record: AgentRecord): Category | null {
  return record.fuguListing?.category ?? record.classification?.category ?? null;
}

export function isCategory(value: string | null | undefined): value is Category {
  return value === "REBALANCING" || value === "GRID" || value === "YIELD" || value === "HEALTH_FACTOR";
}
