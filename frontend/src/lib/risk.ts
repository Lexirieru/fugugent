/**
 * The puff level — the core mechanic of the product.
 * Source: `docs/brand/puff-levels.md`.
 *
 * The most important rule in this file, and the reason there is not a single numeric
 * threshold in it: **the frontend does not compute thresholds.** The backend sends
 * `level: 1|2|3|4|5`, already derived from the raw metrics by the same decision engine
 * that runs the agent. If the UI says "Strained" while the agent is executing
 * DELEVERAGE, we repeat exactly the mistake that killed Giza/ARMA: the dashboard
 * telling a different story than the chain.
 *
 * `level: null` is not "level 0". It means **there is no fresh reading**, and it is
 * drawn as a hollow silhouette — guessing a level from stale data is the most expensive
 * lie this product could tell.
 */

export type BloatLevel = 1 | 2 | 3 | 4 | 5;

export const BLOAT_LEVELS: readonly BloatLevel[] = [1, 2, 3, 4, 5];

export interface BloatLevelSpec {
  level: BloatLevel;
  name: string;
  /** What the agent is doing at this level. */
  meaning: string;
  /** The ring pattern — the channel that survives in grayscale. Colour is the second channel. */
  ring: string;
  color: string;
  /** The motion class; levels 3 and 5 deliberately have no repeating animation. */
  motionClass: string | null;
  /** Whether this level has a financial consequence. */
  spendsMoney: boolean;
}

export const BLOAT: Record<BloatLevel, BloatLevelSpec> = {
  1: {
    level: 1,
    name: "Calm",
    meaning: "Nothing to do. The agent watches and spends nothing.",
    ring: "thin solid arc",
    color: "var(--risk-1)",
    motionClass: "fugu-motion-1",
    spendsMoney: false,
  },
  2: {
    level: 2,
    name: "Watchful",
    meaning: "First threshold touched. The agent explains itself, it does not spend.",
    ring: "solid ring with a notch",
    color: "var(--risk-2)",
    motionClass: "fugu-motion-2",
    spendsMoney: false,
  },
  3: {
    level: 3,
    name: "Strained",
    meaning: "The agent is about to act, and acting costs money.",
    ring: "dashed ring",
    color: "var(--risk-3)",
    motionClass: null,
    spendsMoney: true,
  },
  4: {
    level: 4,
    name: "Critical",
    meaning: "Aggressive action underway. The position can still be saved.",
    ring: "double ring",
    color: "var(--risk-4)",
    motionClass: "fugu-motion-4",
    spendsMoney: true,
  },
  5: {
    level: 5,
    name: "Emergency",
    meaning: "The last threshold is behind us. Readable with no colour at all.",
    ring: "45° hazard stripes",
    color: "var(--risk-5)",
    // Deliberately still. The change from moving to stopping is a signal in its own right.
    motionClass: null,
    spendsMoney: true,
  },
};

/**
 * One risk reading. This is **not** part of `AgentRecord` — that shape is locked in
 * `backend/src/types.ts` and does not carry risk yet. The data layer serves it as a
 * separate piece, so that when the backend adds the risk endpoint that fills it in, not
 * one component needs to change.
 */
export interface RiskReading {
  level: BloatLevel;
  /** E.g. "Health factor" — the primary risk metric for this category. */
  metricLabel: string;
  /** Already formatted by the data layer. The UI does not re-round it. */
  metricValue: string;
  /** An actionable companion sentence, or `null`. */
  companion: string | null;
  /** ISO 8601 — when this number was read from the chain. */
  observedAt: string;
  /** The block the number was read at. `null` when the source is not a block read. */
  blockNumber: number | null;
  /** Proof anyone can open. `null` means there is no block to open yet. */
  proofTxHash: string | null;
}

/**
 * A full `aria-label` sentence — not a bare number.
 * `puff-levels.md` §5.6 requires this form.
 */
export function riskAriaLabel(agentName: string, reading: RiskReading | null): string {
  if (!reading) {
    return `${agentName}. No fresh risk reading — the fish is drawn hollow rather than guessed.`;
  }
  const spec = BLOAT[reading.level];
  const tail = reading.companion ? ` ${reading.companion}.` : "";
  return `${agentName}, level ${reading.level} of 5, ${spec.name.toLowerCase()}. ${reading.metricLabel} ${reading.metricValue}.${tail}`;
}
