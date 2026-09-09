/**
 * Two scales live in this file, and they are deliberately kept apart.
 *
 * ## 1. The puff level — "how risky is the position right now?"
 *
 * Five levels, named in `docs/brand/puff-levels.md`: Calm · Watchful · Strained ·
 * Critical · Emergency. This is the core mechanic of the product: the fugu swells with
 * the risk it carries. The names are fixed — they are used in the brand doc, the README
 * and the generated avatar assets — and the field stays `bloatLevel` for the same reason.
 *
 * The most important rule here, and the reason there is not a single numeric threshold in
 * this file: **the frontend does not compute thresholds.** The backend sends
 * `level: 1|2|3|4|5`, already derived from the raw metrics by the same decision engine
 * that runs the agent. If the UI says "Strained" while the agent is executing
 * DELEVERAGE, we repeat exactly the mistake that killed Giza/ARMA: the dashboard telling
 * a different story than the chain.
 *
 * `level: null` is not "level 0". It means **there is no fresh reading**, and it is drawn
 * as a hollow silhouette — guessing a level from stale data is the most expensive lie
 * this product could tell.
 *
 * ## 2. The action band — "what does the agent do about it?"
 *
 * A different question with a different answer, so it gets a different **register** on
 * screen rather than a second set of English words. The label of an action is always the
 * verbatim identifier from the decision engine —
 * `NONE / WARN / PARTIAL_REPAY / DELEVERAGE / EMERGENCY`, the `Action` union in
 * `ai/fuguguardian/app/agent/src/strategy/types.ts` — rendered in uppercase monospace.
 *
 * Why that, and not prose: an earlier round gave the action band its own prose names
 * ("Watching", "Repaying", …) and "Watching" sat one letter away from the puff level
 * "Watchful" while meaning something else entirely. Two prose scales that answer
 * different questions cannot be told apart by wording alone, however carefully the words
 * are chosen. A code token cannot be mistaken for a puff-level name, and it cannot drift
 * away from the action the agent actually takes, because it *is* that action's name.
 *
 * The two scales therefore never share a visual treatment:
 *
 * | | puff level | action band |
 * |---|---|---|
 * | question | how risky is the position | what the agent does |
 * | wording | title-case prose (`Strained`) | code identifier (`PARTIAL_REPAY`) |
 * | typeface | sans | monospace, uppercase, underscored |
 * | chip | fully rounded (pill) | square-cornered |
 * | carrier | the fugu's shape and ring pattern | text only, no avatar |
 *
 * The one word they share is level 5 / `EMERGENCY`, and that is correct rather than
 * ambiguous: at the last threshold the state of the position and the action taken are the
 * same event. Everywhere else the registers keep them apart.
 *
 * Scope, stated plainly: the action band below is **Guardian's** (`HEALTH_FACTOR`). The
 * other three categories map their own metric onto the same five puff levels
 * (`puff-levels.md` §4) but have no action ladder in the code yet, so the UI must not
 * show one for them.
 */

export type BloatLevel = 1 | 2 | 3 | 4 | 5;

export const BLOAT_LEVELS: readonly BloatLevel[] = [1, 2, 3, 4, 5];

/** One puff level. Answers only "how risky is the position" — no agent verbs in here. */
export interface BloatLevelSpec {
  level: BloatLevel;
  /** The brand name. Title-case prose, never a code token. */
  name: string;
  /**
   * The state of the **position** at this level. Deliberately contains no agent verb:
   * what the agent does about it belongs to `GUARDIAN_ACTIONS`, not here. This field used
   * to mix the two, which is how the on-screen ambiguity got in.
   */
  state: string;
  /** The ring pattern — the channel that survives in grayscale. Colour is the second channel. */
  ring: string;
  color: string;
  /** The motion class; levels 3 and 5 deliberately have no repeating animation. */
  motionClass: string | null;
}

export const BLOAT: Record<BloatLevel, BloatLevelSpec> = {
  1: {
    level: 1,
    name: "Calm",
    state: "Far from every threshold. Nothing about the position is close to going wrong.",
    ring: "thin solid arc",
    color: "var(--risk-1)",
    motionClass: "fugu-motion-1",
  },
  2: {
    level: 2,
    name: "Watchful",
    state: "The first threshold has been touched. Nothing has broken yet.",
    ring: "solid ring with a notch",
    color: "var(--risk-2)",
    motionClass: "fugu-motion-2",
  },
  3: {
    level: 3,
    name: "Strained",
    state: "Inside the band where a position stops being able to look after itself.",
    ring: "dashed ring",
    color: "var(--risk-3)",
    motionClass: null,
  },
  4: {
    level: 4,
    name: "Critical",
    state: "Close to the limit. Still recoverable, but not on its own.",
    ring: "double ring",
    color: "var(--risk-4)",
    motionClass: "fugu-motion-4",
  },
  5: {
    level: 5,
    name: "Emergency",
    state: "Past the last threshold — the state this whole scale exists to warn about.",
    ring: "45° hazard stripes",
    color: "var(--risk-5)",
    // Deliberately still. The change from moving to stopping is a signal in its own right.
    motionClass: null,
  },
};

/**
 * The Guardian action band. The union is copied verbatim from `Action` in
 * `ai/fuguguardian/app/agent/src/strategy/types.ts`; if that changes, this changes with
 * it and never the other way round.
 */
export type GuardianAction = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY";

export interface GuardianActionSpec {
  /** The identifier from the decision engine. This is also the on-screen label. */
  action: GuardianAction;
  /** The puff level this action pairs with — `docs/brand/puff-levels.md` §3. */
  level: BloatLevel;
  /** What the agent does. Prose here explains the token; it never replaces it. */
  does: string;
  /** Whether running this action spends the user's money. */
  spendsMoney: boolean;
}

/**
 * Every sentence below is checked against `decide.ts` and `execute.ts`. In particular
 * `DELEVERAGE` does **not** sell collateral in the shipped agent — the only transaction
 * Guardian can send is a bounded repay, and the session key allows exactly `repay` and
 * `approve`. Describing it as selling would be naming an action that does not exist.
 */
export const GUARDIAN_ACTIONS: readonly GuardianActionSpec[] = [
  {
    action: "NONE",
    level: 1,
    does: "Reads the position and sends nothing.",
    spendsMoney: false,
  },
  {
    action: "WARN",
    level: 2,
    does: "Publishes the reason and the numbers behind it. No transaction.",
    spendsMoney: false,
  },
  {
    action: "PARTIAL_REPAY",
    level: 3,
    does: "Repays debt up to the safe target — no further, and inside a per-action and per-day cap.",
    spendsMoney: true,
  },
  {
    action: "DELEVERAGE",
    level: 4,
    does: "A larger, more urgent repay toward the same target. It reduces debt; it does not sell collateral.",
    spendsMoney: true,
  },
  {
    action: "EMERGENCY",
    level: 5,
    does: "Repays at the cap immediately. Anyone may liquidate the position from here, so there is nothing gentler left to try.",
    spendsMoney: true,
  },
];

const ACTION_BY_LEVEL = new Map<BloatLevel, GuardianActionSpec>(
  GUARDIAN_ACTIONS.map((spec) => [spec.level, spec]),
);

/**
 * The Guardian action that pairs with a puff level.
 *
 * Only meaningful for the `HEALTH_FACTOR` category. Callers must gate on the category
 * rather than calling this for every agent: showing `PARTIAL_REPAY` next to a Grid agent
 * would be inventing an action that agent cannot take.
 */
export function guardianActionFor(level: BloatLevel): GuardianActionSpec {
  const spec = ACTION_BY_LEVEL.get(level);
  if (!spec) throw new Error(`No Guardian action mapped to puff level ${level}.`);
  return spec;
}

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
 *
 * This sentence describes the **risk state** only. A screen reader hears the action band
 * from its own labelled block, so the two scales stay separated in audio as well as on
 * screen.
 */
export function riskAriaLabel(agentName: string, reading: RiskReading | null): string {
  if (!reading) {
    return `${agentName}. No fresh risk reading — the fish is drawn hollow rather than guessed.`;
  }
  const spec = BLOAT[reading.level];
  const tail = reading.companion ? ` ${reading.companion}.` : "";
  return `${agentName}, risk level ${reading.level} of 5, ${spec.name.toLowerCase()}. ${reading.metricLabel} ${reading.metricValue}.${tail}`;
}
