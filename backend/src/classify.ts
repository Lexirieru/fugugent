/**
 * The four-category classifier for the Fugugent marketplace (Task 4).
 *
 * Places an `AgentRecord` into `REBALANCING` · `GRID` · `YIELD` ·
 * `HEALTH_FACTOR`, or **refuses to categorize** (`category: null`).
 *
 * ## What this module is
 *
 * **Pure.** No network, no `Date.now()`, no `process.env`, no randomness, no
 * mutation of its input. Its output is a function of the record's contents
 * alone. That is not cosmetic tidiness: the classification decides which
 * category an agent appears under in the marketplace, so it must be
 * backtestable against old snapshots and inspectable by eye — not explained
 * away with "that's just how it came out".
 *
 * **There is no LLM here.** Per the project rules, a decision that changes what
 * the user sees is deterministic code.
 *
 * ## Two layers
 *
 * 1. **Keywords** on `name`, `description`, `tags`/`categories`/`agentType`.
 *    This is what actually picks the category.
 * 2. **OASF** (`skills`/`domains`) — only a **multiplier**, never a chooser.
 *
 * Why is the second layer limited to being a multiplier? Because the OASF
 * vocabulary was checked live (8 Sep 2026,
 * `GET /api/v1/stats/oasf/{skills,domains}`) and it **contains not a single
 * term that distinguishes our four categories**. All that exists is a broad
 * taxonomy like `finance/markets/crypto`, `technology/blockchain/defi`,
 * `trust_and_safety/risk_management`, `analytical_skills/market_insights` —
 * and, on the other side, `agriculture/crop_management` and
 * `healthcare/medical_technology`. There is no `grid_trading`, no
 * `yield_farming`, no `rebalancing`. So OASF can only answer "is this really a
 * DeFi agent?", not "which kind of DeFi?". Forcing it to pick a category would
 * be false precision.
 *
 * Further: `oasf_skills`/`oasf_domains` are **absent** from `GET /agents` and
 * from `GET /agents/{chain_id}/{token_id}`; in the 8004scan OpenAPI spec they
 * appear only in the `MCPAgentDetail` schema, typed `string[] | null`. So on our
 * main data path those arrays are empty. Therefore **empty OASF must be
 * neutral** (multiplier 1.0) — not a penalty. Tested explicitly in
 * `classify.test.ts` ("empty OASF changes nothing").
 *
 * ## Why not just "keyword → category"
 *
 * Because the keywords themselves lie. Real traps found in 8004scan production
 * data, which shaped all of the weighting below:
 *
 * - **`grid`** — the `Grid-hub` agent on 8004scan is an x402 payment service;
 *   only its name is "Grid". Add to that "CSS grid", "energy grid", "data grid".
 *   So a bare `grid` is **weak**; what is decisive is a `grid` standing next to
 *   a trading verb (`grid trading`, `grid orders`, `grid levels`,
 *   `grid market making`).
 * - **`yield`** — "crop yield" (agriculture) and "bond yield curve" (macro) use
 *   exactly the same word. So a bare `yield` is **weak**;
 *   `yield farming` / `yield optimizer` / `auto-compound` / `APY` are the strong
 *   ones.
 * - **`rebalance`** — a genuine YIELD agent (`smart-money-yield-agent`) writes
 *   "Rebalances daily" in its description. If a bare `rebalance` scored high,
 *   that yield agent would land in the REBALANCING category. So a bare
 *   `rebalanc` is **weak**; `portfolio rebalancing`, `target allocation`,
 *   `concentrated liquidity` are the strong ones.
 * - **`liquidation` vs `liquidity`** — similar words, opposite meaning for us.
 *   Every pattern uses the stem `liquidat`, which **never** matches
 *   "liquidity". This is why not a single pattern uses the stem `liquid`.
 * - **`compound`** — "auto-compounding" is YIELD, "Compound protocol" is
 *   lending. So a bare `compound` is **not used at all**; only
 *   `auto-compound` / `compounding rewards`.
 * - **`health`** — medical health agents exist. There is no bare `health`
 *   pattern; only the full phrase `health factor`.
 *
 * ## The confidence arithmetic
 *
 * Each matching pattern contributes `weight × field_multiplier`, counted
 * **once** per pattern (a pattern matching in several fields takes the largest
 * multiplier rather than summing them — otherwise repeating a word in the title
 * and the description would inflate the score artificially). From each
 * category's raw score:
 *
 * ```
 * strength   = min(top, EVIDENCE_CAP) / EVIDENCE_CAP   // how much evidence
 * separation = (top - runner_up) / top                 // how unambiguous
 * confidence = strength × (FLOOR + (1-FLOOR) × separation) × OASF_multiplier
 * ```
 *
 * Those two factors are **multiplied**, not summed, so both are mandatory:
 * plenty of evidence split evenly across categories is still rejected, and a
 * single weak cue that happens to have no rival is still rejected. That is
 * exactly what was asked for: **better not to categorize than to categorize
 * wrongly.**
 *
 * Every constant below carries its reasoning and its consequence where it is
 * defined. A magic number with no explanation counts as a defect in this module.
 */

import { CATEGORIES, type AgentClassification, type AgentRecord, type Category } from "./types.js";

// ---------------------------------------------------------------------------
// Constants — each with its reasoning and the consequence of getting it wrong
// ---------------------------------------------------------------------------

/**
 * The weight per confidence tier of a pattern.
 *
 * - `DECISIVE` (1.0) — a phrase that in an agent description has practically no
 *   other meaning. `health factor`, `grid trading`, `portfolio rebalancing`,
 *   `yield farming`. One alone is enough to categorize (see `MIN_CONFIDENCE`).
 * - `STRONG` (0.6) — points strongly but can be borrowed by another category.
 *   `liquidation`, `APY`, `collateral`, `rebalancer`. **Deliberately set so a
 *   single moderate cue is NOT enough**: 0.6/1.6 × 1.0 = 0.375 < 0.55.
 * - `WEAK` (0.25) — supporting only. `venus`, `vault`, a bare `grid`.
 *   Even three weak cues at once (0.75 → 0.469) are still below the threshold;
 *   it takes four, and four weak cues all pointing the same way have earned it.
 *
 * If `STRONG` were raised to 0.9, the single word "liquidation" would send any
 * LP analytics agent to HEALTH_FACTOR. If `WEAK` were raised to 0.4, `Grid-hub`
 * (a payment service) would land in the GRID category.
 */
const WEIGHT = { decisive: 1.0, strong: 0.6, weak: 0.25 } as const;

type Tier = keyof typeof WEIGHT;

/**
 * The per-field multiplier. An agent's name is denser in signal than its
 * description — authors name an agent after what it does, and a name has no room
 * for filler. Upstream labels (`tags`/`categories`/`agentType`) are curated data,
 * more precise than free prose, but rank below the name because their contents
 * are often generic (`defi`, `trading`) and we do not control their vocabulary.
 *
 * If `name` were raised to 2.0, one word in the title could outweigh the entire
 * description — and `Grid-hub` becomes a problem again.
 */
const FIELD_WEIGHT = { name: 1.3, description: 1.0, label: 1.2 } as const;

type Field = keyof typeof FIELD_WEIGHT;

/**
 * The raw score treated as "full evidence". Above it, extra evidence no longer
 * raises `strength` — a long description must not automatically be more
 * convincing than a short, accurate one.
 *
 * Its value 1.6 = one decisive cue (1.0) + one moderate cue (0.6). The direct
 * consequence used to pin down `MIN_CONFIDENCE`: one decisive cue on its own
 * gives a strength of 1.0/1.6 = 0.625.
 */
const EVIDENCE_CAP = 1.6;

/**
 * The floor of the separation factor. A category that wins outright
 * (`separation` = 1) uses the full factor of 1.0; one that wins narrowly still
 * gets `FLOOR` so that strong evidence is not wiped out entirely by a small
 * rival.
 *
 * 0.35 was chosen from one desired behaviour: an agent claiming to do all four
 * things at once ("grid trading + yield farming + portfolio rebalancing +
 * health factor" — a real case in any marketplace) must fall to `null`. With
 * 0.35 that case ends at 0.43 (< 0.55, rejected); with a floor of 0.6 it ends at
 * 0.63 and would be **guessed** as YIELD purely because the word "vault"
 * happened to appear too. Guessing there is exactly what destroys trust.
 */
const SEPARATION_FLOOR = 0.35;

/**
 * The acceptance threshold. **This is the most important constant in this file.**
 *
 * It was not picked by taste; it is bracketed by two ceilings computed from the
 * formula above — and the three numbers below are **locked by tests**
 * (`describe("classify — the ceilings that pin down the threshold")`), so this
 * comment can no longer drift away from the code's behaviour:
 *
 * | Scenario | Value | Its role |
 * |---|---|---|
 * | one MODERATE cue, no rival | `0.6/1.6 × 1.0` = **0.375** | the lower bound — the threshold must be ABOVE it |
 * | one DECISIVE cue, no rival | `1.0/1.6 × 1.0` = **0.625** | the upper bound — the threshold must be BELOW it |
 * | two categories EXACTLY tied (`separation` = 0) | `strength × SEPARATION_FLOOR` ≤ **0.35** | not binding (see below) |
 *
 * So the valid range is **(0.375, 0.625)**; 0.55 is taken on its conservative
 * side. Translated: **the minimum ticket of entry is exactly one phrase that
 * cannot mean anything else.**
 *
 * A correction note (a review finding): the first version of this comment
 * claimed the tie ceiling was also 0.375 and presented it as a second lower
 * bound. That was wrong — and the mistake was not merely arithmetic but a way of
 * arguing: the number was copied from the first ceiling rather than derived from
 * the formula. The real value is `SEPARATION_FLOOR` = 0.35 (reached exactly when
 * the evidence saturates; on the real "Omni DeFi Suite" case it comes out at
 * 0.3281 because `strength` < 1). Since 0.35 < 0.375, the tie ceiling is **never
 * the binding bound** — it is already satisfied automatically by the real lower
 * bound. There is only ONE lower bound, not two that happen to coincide.
 *
 * The consequence of getting it wrong: at 0.40 the single word "liquidation"
 * would send any LP analytics agent to Health Factor — the user sees an agent in
 * the wrong place. At 0.70 an agent like `Assay Health` (0.69) — plainly
 * HEALTH_FACTOR — disappears from the marketplace. Both are tested.
 */
const MIN_CONFIDENCE = 0.55;

/**
 * The multiplier when OASF confirms a DeFi/finance context.
 *
 * 1.15 is deliberately small and has two hard, checkable bounds:
 * - it **cannot** create a classification out of nothing (0 × 1.15 = 0);
 * - it **cannot** let an evenly contested case through (0.43 × 1.15 = 0.49 < 0.55).
 * All it can do is help a case that was already almost through
 * (0.50 → 0.575). That is the honest role for a signal which, per the live
 * findings above, cannot distinguish the categories.
 */
const OASF_DEFI_BONUS = 1.15;

/**
 * The multiplier when OASF points at a domain that **collides in meaning** with
 * our category vocabulary — not merely another domain, but a domain that
 * produces exactly the homonyms this classifier was built to withstand:
 *
 * | OASF domain | The homonym it creates |
 * |---|---|
 * | `agriculture` / `crop` | "crop **yield**" — a harvest, not a return |
 * | `healthcare` / `medical` | "**health** factor" in the medical sense |
 * | `energy` / `utilities` | "power **grid**" — an electrical grid, not grid trading |
 *
 * 0.5 was chosen so it is enough to **cancel a single decisive cue**
 * (0.625 × 0.5 = 0.31 < 0.55). That is exactly what is wanted: an agent that
 * registers itself under `agriculture/crop_management` and writes "yield" is
 * talking about a harvest — however convincing its keywords. Loosened to 0.8,
 * that harvest agent slips into the Yield category.
 */
const OASF_CONTRADICTING_PENALTY = 0.5;

/**
 * The multiplier when OASF points only at **unrelated** domains (logistics,
 * legal, education, gaming, entertainment) with not a single finance/blockchain
 * signal.
 *
 * Split off from the case above after a review finding: because
 * {@link MIN_CONFIDENCE} sits deliberately just above "one decisive cue on its
 * own" (0.625), a multiplier of 0.5 would **cancel a correct agent** merely
 * because the upstream taxonomy happened to contain one token like `education`
 * or `logistics`. That is wrong twice over: (a) these domains create no homonym
 * with our vocabulary, and (b) it contradicts our own finding that OASF "cannot
 * pick a category" — a signal that weak does not deserve a veto. A GameFi agent
 * that genuinely does yield farming is a real case, not a hypothetical.
 *
 * 0.9 is not an arbitrary round number: it is the largest round value that
 * **cannot cancel a single decisive cue on its own**. The requirement is a
 * multiplier > 0.55/0.625 = 0.88; 0.9 meets it with a thin margin
 * (0.625 × 0.9 = 0.5625 ≥ 0.55, still through). All it can do is push down a
 * case that was already at the threshold — exactly the honest role for a weak
 * cue. Lowered to 0.85, that veto silently returns.
 */
const OASF_UNRELATED_PENALTY = 0.9;

// ---------------------------------------------------------------------------
// The pattern tables
// ---------------------------------------------------------------------------

interface Rule {
  /** The label that appears verbatim in `reason`, so the decision can be read. */
  readonly label: string;
  readonly tier: Tier;
  readonly pattern: RegExp;
}

/** Every pattern is case-insensitive; the text is lowercased before being tested. */
const RULES: Readonly<Record<Category, readonly Rule[]>> = {
  /**
   * REBALANCING covers two things that Fugugent treats as one category:
   * rebalancing a portfolio's allocation, and rebalancing the range of a
   * concentrated LP position (PancakeSwap v3). Both "return a position to its
   * target".
   */
  REBALANCING: [
    { label: "portfolio rebalancing", tier: "decisive", pattern: /\bportfolio\s+rebalanc|\brebalanc\w*\s+(?:the\s+)?portfolio\b/ },
    { label: "target allocation", tier: "decisive", pattern: /\btarget\s+(?:asset\s+)?allocations?\b|\basset\s+allocations?\b/ },
    { label: "concentrated liquidity", tier: "decisive", pattern: /\bconcentrated\s+liquidity\b/ },
    { label: "rebalance LP range/position", tier: "decisive", pattern: /\brebalanc\w*\s+(?:the\s+)?(?:lp|range|position)\b|\blp\s+range\s+rebalanc/ },
    { label: "[category:rebalancing] marker", tier: "decisive", pattern: /\[\s*category:\s*rebalanc[a-z-]*\s*\]/ },
    { label: "rebalancer", tier: "strong", pattern: /\brebalancers?\b/ },
    // "drift" in a DeFi agent description almost always means allocation
    // drift. The word boundary keeps it from matching names like "DriftHarbor".
    { label: "allocation drift", tier: "strong", pattern: /\bdrifts?\b|\bdrifting\b/ },
    { label: "out of range / reposition", tier: "strong", pattern: /\bout\s+of\s+range\b|\brepositions?\b|\brepositioning\b/ },
    // Allocation-weight vocabulary. Added after inspecting 167 real 8004scan
    // agents: `Narrow Band Allocator` ("equal-weight allocation … tops up the
    // under-weight side") had NOT ONE REBALANCING cue without this rule, so it
    // lost to HEALTH_FACTOR — which only won because its description mentions
    // "health factor" in an explanatory clause ("… can push a borrowing
    // account's health factor below one"). HEALTH_FACTOR was not weakened;
    // REBALANCING was completed: weakening a correct phrase for the sake of one
    // case is how a classifier becomes brittle.
    { label: "allocation weight (equal/under/over-weight)", tier: "strong", pattern: /\bequal[\s-]?weight\w*\b|\bunder[\s-]?weight\w*\b|\bover[\s-]?weight\w*\b|\bportfolio\s+weights?\b/ },
    // Bare and weak — even a real YIELD agent writes "Rebalances daily".
    { label: "rebalance (bare)", tier: "weak", pattern: /\brebalanc/ },
    { label: "reallocation", tier: "weak", pattern: /\breallocat/ },
    { label: "LP position", tier: "weak", pattern: /\blp\s+positions?\b|\bliquidity\s+positions?\b/ },
    { label: "portfolio (bare)", tier: "weak", pattern: /\bportfolios?\b/ },
    { label: "allocation (bare)", tier: "weak", pattern: /\ballocat\w*\b/ },
  ],

  /**
   * GRID is the category most prone to false positives: the word "grid" far more
   * often means a layout, an electrical network, or simply part of a brand name
   * than a grid trading strategy.
   */
  GRID: [
    // The core of this category: a `grid` standing next to a trading verb.
    { label: "grid trading/bot/order/level", tier: "decisive", pattern: /\bgrid[\s-]?(?:trad(?:e|er|es|ing)|bot|strateg|order|level|execution|plan|market[\s-]?making)/ },
    { label: "[category:grid] marker", tier: "decisive", pattern: /\[\s*category:\s*grid[a-z-]*\s*\]/ },
    { label: "range trading/order", tier: "strong", pattern: /\brange[\s-]?(?:trad(?:e|er|es|ing)|orders?)\b/ },
    { label: "price grid (geometric/price grid)", tier: "strong", pattern: /\b(?:geometric|price|trading|systematic)\s+grids?\b/ },
    { label: "buy low / sell high", tier: "strong", pattern: /\bbuys?\s+low\b[^.]{0,20}\bsells?\s+high\b/ },
    // Deliberately weak. This is what holds back `Grid-hub` (an x402 service)
    // and "CSS grid".
    { label: "grid (bare)", tier: "weak", pattern: /\bgrid\b/ },
    { label: "price range / price band", tier: "weak", pattern: /\bprice\s+(?:range|band)\b/ },
    // Matches only when both order sides are present — one side alone is not a grid.
    { label: "buy order + sell order", tier: "weak", pattern: /\bbuy\s+and\s+sell\s+orders?\b|\bbuy\s+orders?\b(?=[\s\S]*\bsell\s+orders?\b)|\bsell\s+orders?\b(?=[\s\S]*\bbuy\s+orders?\b)/ },
  ],

  /**
   * YIELD: hunting the highest return and compounding it. The word "yield" alone
   * means nothing (harvests, bonds), so all of this category's strength rests on
   * compound phrases and on APY/APR.
   */
  YIELD: [
    { label: "yield farming", tier: "decisive", pattern: /\byield\s+farm/ },
    { label: "yield optimizer/aggregator/routing", tier: "decisive", pattern: /\byield\s+(?:optimi|aggregat|rout|strateg|generat|harvest|pulse)/ },
    // Compound forms only. A bare `compound` is never used: it points equally
    // at the Compound lending protocol.
    { label: "auto-compound", tier: "decisive", pattern: /\bauto[\s-]?compound\w*\b|\bcompounding\s+(?:rewards?|yields?|returns?)\b/ },
    { label: "[category:yield] marker", tier: "decisive", pattern: /\[\s*category:\s*yield[a-z-]*\s*\]/ },
    { label: "APY/APR", tier: "strong", pattern: /\bap[yr]s?\b/ },
    { label: "highest return", tier: "strong", pattern: /\bhighest[\s-]?(?:earning|yielding)\b|\bbest\s+(?:apy|apr|yield)\b/ },
    // A `yield` attached to the source of the return is far more specific than a
    // loose `yield` — "crop yield" and "bond yield" do not take this form.
    { label: "LP/pool/lending yield", tier: "strong", pattern: /\b(?:lp|pool|lending|staking|farming)\s+yields?\b/ },
    { label: "yield (bare)", tier: "weak", pattern: /\byields?\b/ },
    { label: "vault", tier: "weak", pattern: /\bvaults?\b/ },
    { label: "staking", tier: "weak", pattern: /\bstaking\b|\bstakes?\b/ },
    { label: "liquidity pool / TVL", tier: "weak", pattern: /\bliquidity\s+pools?\b|\btotal\s+value\s+locked\b|\btvl\b/ },
    { label: "impermanent loss", tier: "weak", pattern: /\bimpermanent\s+loss\b/ },
  ],

  /**
   * HEALTH_FACTOR: keeping a borrowing position from being liquidated. The
   * cleanest vocabulary of the four — as long as `liquidat` is never confused
   * with `liquidity`, and `health` is never used bare (medical health agents
   * exist).
   */
  HEALTH_FACTOR: [
    { label: "health factor", tier: "decisive", pattern: /\bhealth[\s-]?factors?\b/ },
    { label: "liquidation threshold/risk/protection", tier: "decisive", pattern: /\bliquidation\s+(?:threshold|risk|price|protection|prevention)s?\b|\bavoid(?:ing)?\s+liquidation\b|\bliquidation\s+protection\b/ },
    { label: "collateral ratio / LTV", tier: "decisive", pattern: /\bcollateral(?:isation|ization)?\s+ratios?\b|\bloan[\s-]to[\s-]value\b|\bltv\b/ },
    { label: "borrowing position", tier: "decisive", pattern: /\bborrow(?:ing)?\s+positions?\b|\bdebt\s+positions?\b/ },
    { label: "[category:health-factor] marker", tier: "decisive", pattern: /\[\s*category:\s*(?:health[a-z-]*|lending|liquidation)\s*\]/ },
    // The stem `liquidat`, NOT `liquid` — "liquidity" must not match.
    { label: "liquidation", tier: "strong", pattern: /\bliquidat/ },
    { label: "collateral", tier: "strong", pattern: /\bcollateral/ },
    { label: "lending/loan position", tier: "strong", pattern: /\blending\s+positions?\b|\bloan\s+positions?\b/ },
    { label: "repay debt", tier: "strong", pattern: /\brepay\w*\s+(?:its\s+)?(?:the\s+)?(?:debt|loan|borrow)/ },
    { label: "lending protocol (venus/aave/…)", tier: "weak", pattern: /\bvenus\b|\baave\b|\bmorpho\b|\bcomptroller\b/ },
    { label: "borrow / debt", tier: "weak", pattern: /\bborrow\w*\b|\bdebts?\b/ },
    { label: "lending / loan", tier: "weak", pattern: /\blending\b|\bloans?\b/ },
  ],
  /**
   * HIRING is an agent that hires and pays OTHER AGENTS. The homonym is obvious
   * and common: "hiring" in the recruiting sense, an agent that screens human
   * candidates. Every decisive cue here therefore names an agent as the thing
   * being hired or paid, never the act of hiring alone.
   */
  HIRING: [
    { label: "hires/pays another agent", tier: "decisive", pattern: /\b(?:hir\w*|employ\w*|commission\w*|subcontract\w*|delegat\w*)\s+(?:other\s+|another\s+|third[\s-]party\s+)?(?:ai\s+)?agents?\b/ },
    { label: "agent-to-agent hiring/marketplace", tier: "decisive", pattern: /\bagent[\s-]hiring\b|\bhiring\s+marketplace\s+for\s+agents?\b|\bmarketplace\s+(?:of|for)\s+(?:ai\s+)?agents?\b/ },
    { label: "ERC-8183 buyer side", tier: "decisive", pattern: /\berc[\s-]?8183\b|\bhireerc8183agent\b/ },
    { label: "[category:hiring] marker", tier: "decisive", pattern: /\[\s*category:\s*(?:hiring|broker)\s*\]/ },
    { label: "escrowed payment to an agent", tier: "strong", pattern: /\bescrow\w*\s+(?:payment|funds?|the\s+fee)\b.{0,40}\bagents?\b|\bagents?\b.{0,40}\bescrow\w*\s+(?:payment|funds?)\b/ },
    { label: "orchestrates a fleet of agents", tier: "strong", pattern: /\borchestrat\w*\s+(?:a\s+)?(?:fleet|team|swarm|network)\s+of\s+agents?\b/ },
    { label: "buyer side of an agent deal", tier: "weak", pattern: /\bbuyer[\s-]side\b|\bbuys?\s+(?:the\s+)?services?\s+of\b/ },
  ],

  /**
   * COMMERCE is one agent buying inference or data from another, one call at a
   * time, with neither side holding the other's keys. The homonym is
   * e-commerce: a shopping assistant that buys goods for a person. The decisive
   * cues are therefore the per-call payment protocols, not the word "commerce".
   */
  COMMERCE: [
    { label: "x402 / b402 payment", tier: "decisive", pattern: /\b[xb]402\b|\bhttp\s*402\b|\b402\s+payment\s+required\b/ },
    { label: "pay per API/inference call", tier: "decisive", pattern: /\bpay(?:s|ment)?[\s-]per[\s-](?:call|request|query|token|inference)\b|\bper[\s-]call\s+(?:payment|billing|pricing)\b/ },
    { label: "buys inference or data", tier: "decisive", pattern: /\bbuys?\s+(?:ai\s+)?(?:inference|compute|model\s+outputs?|data\s+feeds?)\b/ },
    { label: "machine-to-machine payment", tier: "decisive", pattern: /\bmachine[\s-]to[\s-]machine\s+payments?\b|\bagent[\s-]to[\s-]agent\s+(?:commerce|payments?)\b/ },
    { label: "[category:commerce] marker", tier: "decisive", pattern: /\[\s*category:\s*(?:commerce|a2a[\s-]?commerce)\s*\]/ },
    { label: "monetised API for agents", tier: "strong", pattern: /\bmonetis\w*\s+(?:an?\s+)?api\b|\bsells?\s+(?:api\s+)?(?:access|inference|data)\s+to\s+agents?\b/ },
    { label: "no shared custody of keys", tier: "weak", pattern: /\bneither\s+side\s+holds\b|\bwithout\s+(?:sharing|holding)\s+(?:private\s+)?keys\b/ },
  ],

  /**
   * AUTONOMOUS is the category with the weakest natural boundary in this table,
   * because "rebalances, lends, stakes, copy-trades" overlaps REBALANCING and
   * YIELD word for word. What actually separates it is the CAP: an agent that
   * acts on its own inside a limit it cannot exceed. So every decisive cue names
   * the limit or the absence of a human, never the DeFi action, and the DeFi
   * verbs sit at `weak` where they cannot carry a classification alone.
   *
   * Do not promote the `weak` rules here. A yield optimiser mentioning "stake"
   * would then land in two categories at once, and the tie-break would decide
   * the marketplace's shelf by coin flip.
   */
  AUTONOMOUS: [
    { label: "spending cap it cannot exceed", tier: "decisive", pattern: /\bspend(?:ing)?\s+(?:cap|limit)s?\b|\bcannot\s+exceed\b.{0,30}\b(?:cap|limit|budget)\b|\bbudget\s+it\s+cannot\s+exceed\b/ },
    { label: "acts without human approval", tier: "decisive", pattern: /\bwithout\s+(?:a\s+)?human\s+(?:approval|in\s+the\s+loop|intervention|sign[\s-]?off)\b|\bno\s+human\s+approves?\b/ },
    { label: "copy trading", tier: "decisive", pattern: /\bcopy[\s-]trad\w*\b|\bmirror\s+trad\w*\b/ },
    { label: "[category:autonomous] marker", tier: "decisive", pattern: /\[\s*category:\s*autonom\w*\s*\]/ },
    { label: "autonomous DeFi agent", tier: "strong", pattern: /\bautonomous\w*\s+(?:defi|trading|treasury|portfolio)\b|\bfully\s+autonomous\s+agent\b/ },
    { label: "session permissions bounded on chain", tier: "strong", pattern: /\bbounded\s+(?:session|permissions?|authority)\b|\ballowlist\w*\s+(?:of\s+)?(?:calls?|contracts?|functions?)\b/ },
    { label: "lends / stakes / swaps", tier: "weak", pattern: /\blends?\b|\bstak(?:e|es|ing)\b|\bswaps?\b/ },
  ],

  /**
   * STREAMING is payment by the second, the call or the unit, continuously. The
   * homonym is the loud one: video and music streaming. Every decisive cue names
   * money, and the bare word "stream" is not a rule at all.
   */
  STREAMING: [
    { label: "streaming/continuous payment", tier: "decisive", pattern: /\b(?:payment|money|salary|token)\s+streams?\b|\bstream(?:s|ing|ed)?\s+(?:payments?|funds?|money|tokens?|value)\b/ },
    { label: "per-second / per-unit billing", tier: "decisive", pattern: /\bper[\s-]second\s+(?:billing|payment|pricing)\b|\bmeter(?:ed|ing)\s+billing\b|\bpay[\s-]as[\s-]you[\s-]go\s+(?:billing|payments?)\b/ },
    { label: "micropayment", tier: "decisive", pattern: /\bmicro[\s-]?payments?\b|\bmicro[\s-]?transactions?\b/ },
    { label: "[category:streaming] marker", tier: "decisive", pattern: /\[\s*category:\s*(?:streaming|micropayments?)\s*\]/ },
    { label: "streaming-payment protocol", tier: "strong", pattern: /\bsablier\b|\bsuperfluid\b|\bllamapay\b/ },
    { label: "session key with an expiry", tier: "weak", pattern: /\bexpir\w*\s+session\b|\bsession\s+keys?\s+with\s+(?:an?\s+)?expiry\b/ },
  ],

  /**
   * TREASURY is recurring outgoing payments on a schedule: payroll,
   * subscriptions, vesting. The near-miss to guard against is a DAO treasury
   * ANALYTICS agent, which reports on a treasury and never pays anyone. Reporting
   * verbs are deliberately absent from this table.
   */
  TREASURY: [
    { label: "payroll", tier: "decisive", pattern: /\bpayroll\b|\bpays?\s+salaries\b|\bcontributor\s+payments?\b/ },
    { label: "recurring / scheduled payments", tier: "decisive", pattern: /\brecurring\s+payments?\b|\bscheduled\s+(?:payments?|transfers?|disbursements?)\b|\bstanding\s+orders?\b/ },
    { label: "runs subscriptions on a schedule", tier: "decisive", pattern: /\bsubscriptions?\s+(?:on\s+a\s+schedule|billing\s+cycle)\b|\brenews?\s+subscriptions?\b/ },
    { label: "[category:treasury] marker", tier: "decisive", pattern: /\[\s*category:\s*(?:treasury|payroll)\s*\]/ },
    { label: "vesting / disbursement schedule", tier: "strong", pattern: /\bvesting\s+schedules?\b|\bdisburse\w*\s+on\s+a\s+schedule\b/ },
    { label: "treasury operations", tier: "strong", pattern: /\btreasury\s+(?:operations?|management|execution)\b/ },
    { label: "multiple scopes on one wallet", tier: "weak", pattern: /\bmultiple\s+agents?\s+(?:on|share)\s+(?:one|a\s+single)\s+wallet\b|\bdifferent\s+scopes?\b/ },
  ],
};

/**
 * Upstream label aliases → our categories. Matched **per whole token** on
 * `tags`/`categories`/`agentType`, not as a substring: `tags: ["trading"]` must
 * not drag an agent into GRID, and `["defi"]` must not mean anything. A curated
 * label is the strongest structured evidence available, hence its decisive
 * weight.
 */
const LABEL_ALIASES: Readonly<Record<string, Category>> = {
  rebalancing: "REBALANCING",
  rebalance: "REBALANCING",
  "portfolio-rebalancing": "REBALANCING",
  grid: "GRID",
  "grid-trading": "GRID",
  gridtrading: "GRID",
  yield: "YIELD",
  "yield-farming": "YIELD",
  yieldfarming: "YIELD",
  "health-factor": "HEALTH_FACTOR",
  healthfactor: "HEALTH_FACTOR",
  "health_factor": "HEALTH_FACTOR",
  "liquidation-protection": "HEALTH_FACTOR",
};

/**
 * OASF confirming a finance/blockchain context. Taken from the vocabulary
 * actually in use on 8004scan: `finance/markets/crypto`,
 * `technology/blockchain/defi`, `trust_and_safety/risk_management`,
 * `analytical_skills/market_insights`, `finance_and_business/investment_services`.
 */
const OASF_DEFI = /blockchain|crypto|defi|decentralized[_\s-]?finance|finance|investment|trading|market|risk[_\s-]?management|smart[_\s-]?contract/;

/**
 * OASF domains that collide in meaning with our category vocabulary. Applies
 * only when there is not a single DeFi signal — a cross-domain agent is not
 * penalized.
 */
const OASF_CONTRADICTING = /agricultur|crop|farming_practice|horticultur|healthcare|medical|clinical|patient|energy|utilit|electric|power_grid/;

/**
 * OASF domains that are merely unrelated: they create no homonym with our
 * vocabulary, so they only push down slightly and never veto.
 */
const OASF_UNRELATED = /gaming|entertainment|media|legal|logistics|transportation|manufactur|robotics|education|hospitality|agriculture_business|sports|travel/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function listText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").join(" ").toLowerCase()
    : "";
}

function tokens(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v !== "")
    : [];
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

interface Hit {
  readonly label: string;
  readonly tier: Tier;
  readonly weight: number;
}

interface Score {
  readonly category: Category;
  readonly raw: number;
  readonly hits: readonly Hit[];
}

/** Condenses a category's evidence into one readable phrase. */
function describeHits(hits: readonly Hit[]): string {
  const TIER_ID: Record<Tier, string> = { decisive: "decisive", strong: "moderate", weak: "weak" };
  return hits
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((h) => `"${h.label}" (${TIER_ID[h.tier]} ${round(h.weight)})`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// The public API
// ---------------------------------------------------------------------------

/**
 * Places an agent in one of the four categories, or refuses.
 *
 * Never throws and never mutates `agent`: a malformed record (missing fields,
 * wrong types from upstream) is treated as having empty fields, because one odd
 * record must not take the whole indexing run down.
 *
 * @returns `category: null` when confidence is below {@link MIN_CONFIDENCE}.
 *          `reason` is always populated — including on a refusal, because "why
 *          does this agent appear nowhere?" deserves an answer just as much as
 *          "why did this agent land in Grid?".
 */
export function classify(agent: AgentRecord): AgentClassification {
  const fields: Record<Field, string> = {
    name: text(agent?.name),
    description: text(agent?.description),
    label: [listText(agent?.tags), listText(agent?.categories), text(agent?.agentType)]
      .filter((s) => s !== "")
      .join(" "),
  };

  // --- Layer 1a: curated upstream label aliases -----------------------------
  const labelTokens = [...tokens(agent?.tags), ...tokens(agent?.categories)];
  const aliasHits = new Map<Category, Hit>();
  for (const token of labelTokens) {
    const category = LABEL_ALIASES[token];
    if (category !== undefined && !aliasHits.has(category)) {
      aliasHits.set(category, {
        label: `upstream label "${token}"`,
        tier: "decisive",
        weight: WEIGHT.decisive * FIELD_WEIGHT.label,
      });
    }
  }

  // --- Layer 1b: keywords on name/description/label -------------------------
  const scores: Score[] = CATEGORIES.map((category) => {
    const hits: Hit[] = [];
    const alias = aliasHits.get(category);
    if (alias !== undefined) hits.push(alias);

    for (const rule of RULES[category]) {
      // One pattern counts ONCE, with the largest field multiplier where it
      // matched. Summing every occurrence would turn word repetition into a
      // scoring tactic.
      let best = 0;
      for (const field of ["name", "description", "label"] as const) {
        if (fields[field] !== "" && rule.pattern.test(fields[field])) {
          best = Math.max(best, FIELD_WEIGHT[field]);
        }
      }
      if (best > 0) hits.push({ label: rule.label, tier: rule.tier, weight: WEIGHT[rule.tier] * best });
    }

    return { category, raw: hits.reduce((sum, h) => sum + h.weight, 0), hits };
  });

  const ranked = scores.slice().sort((a, b) => b.raw - a.raw);
  const top = ranked[0]!;
  const runnerUp = ranked[1]!;

  if (top.raw === 0) {
    return {
      category: null,
      confidence: 0,
      reason:
        "not categorized: not a single category keyword matched the name, description, tags, or upstream categories",
    };
  }

  // `strength` uses the capped score (enough evidence is enough);
  // `separation` uses the raw score, so real dominance is still visible even
  // when both categories have passed the cap.
  const strength = Math.min(top.raw, EVIDENCE_CAP) / EVIDENCE_CAP;
  const separation = (top.raw - runnerUp.raw) / top.raw;

  // --- Layer 2: OASF as a multiplier, never as a chooser --------------------
  const oasf = `${listText(agent?.skills)} ${listText(agent?.domains)}`.trim();
  let oasfMultiplier = 1;
  let oasfNote = "";
  if (oasf !== "") {
    if (OASF_DEFI.test(oasf)) {
      // Checked first: a single finance/blockchain signal is enough to free a
      // cross-domain agent (e.g. GameFi) from both penalties.
      oasfMultiplier = OASF_DEFI_BONUS;
      oasfNote = `; OASF confirms a DeFi/finance context (x${OASF_DEFI_BONUS})`;
    } else if (OASF_CONTRADICTING.test(oasf)) {
      oasfMultiplier = OASF_CONTRADICTING_PENALTY;
      oasfNote = `; OASF points at a domain that collides in meaning with the category vocabulary (x${OASF_CONTRADICTING_PENALTY})`;
    } else if (OASF_UNRELATED.test(oasf)) {
      oasfMultiplier = OASF_UNRELATED_PENALTY;
      oasfNote = `; OASF points at unrelated domains (x${OASF_UNRELATED_PENALTY}, never a veto)`;
    }
  }

  const confidence = round(
    Math.min(
      1,
      Math.max(
        0,
        strength * (SEPARATION_FLOOR + (1 - SEPARATION_FLOOR) * separation) * oasfMultiplier,
      ),
    ),
  );

  const rivalNote =
    runnerUp.raw > 0
      ? `closest rival ${runnerUp.category} ${round(runnerUp.raw)}`
      : "no rival category";

  if (confidence < MIN_CONFIDENCE) {
    return {
      category: null,
      confidence,
      reason:
        `not categorized: strongest evidence ${top.category} ${round(top.raw)} — ${describeHits(top.hits)}; ` +
        `${rivalNote}${oasfNote}; confidence ${confidence} below the threshold ${MIN_CONFIDENCE}`,
    };
  }

  return {
    category: top.category,
    confidence,
    reason:
      `${top.category}: matched ${describeHits(top.hits)}; evidence ${round(top.raw)}/${EVIDENCE_CAP}, ` +
      `${rivalNote}${oasfNote}; confidence ${confidence} (threshold ${MIN_CONFIDENCE})`,
  };
}

/**
 * The threshold constants, exported so callers (and tests) reference the same
 * numbers instead of copying them. Copying a threshold elsewhere is the most
 * common way it becomes inconsistent.
 */
export const CLASSIFIER_THRESHOLDS = {
  MIN_CONFIDENCE,
  EVIDENCE_CAP,
  SEPARATION_FLOOR,
  OASF_DEFI_BONUS,
  OASF_CONTRADICTING_PENALTY,
  OASF_UNRELATED_PENALTY,
} as const;
