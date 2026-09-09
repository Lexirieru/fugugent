/**
 * Tests for the four-category classifier (Task 4).
 *
 * ## Where the examples come from
 *
 * Nearly every `name`/`description` in this file is **copied verbatim from
 * production 8004scan** (live calls 8 Sep 2026, `GET /api/v1/agents`,
 * `GET /api/v1/agents/search/semantic`, `?search=…&search_type=text`, with a
 * browser `User-Agent` header). That is deliberate: a classifier that passes
 * against sentences we wrote ourselves proves nothing. What decides the quality
 * of this classifier is whether it is right on the sentences agent registrants
 * actually wrote — including the messy ones.
 *
 * The negatives per category are also taken from real agents, and deliberately
 * chosen to be **the most treacherous** ones — not random text:
 *
 * | Category | Its negative | Why it is treacherous |
 * |---|---|---|
 * | GRID | `Grid-hub` | its name is "Grid", but it is an x402 payment service |
 * | YIELD | an agricultural harvest agent | "yield" = a harvest, not a return |
 * | REBALANCING | `smart-money-yield-agent` | it says "Rebalances daily", but it is a YIELD agent |
 * | HEALTH_FACTOR | `yieldflow` | it mentions "liquidity", not "liquidation" |
 */

import { describe, expect, it } from "vitest";

import { CLASSIFIER_THRESHOLDS, classify } from "../classify.js";
import type { AgentRecord } from "../types.js";

/** Build a minimal `AgentRecord`; only the classifier's input fields matter. */
function agent(patch: Partial<AgentRecord>): AgentRecord {
  return {
    id: "56:1",
    chainId: 56,
    tokenId: "1",
    registryAddress: null,
    agentId: null,
    name: "",
    description: "",
    imageUrl: null,
    agentType: null,
    tags: [],
    categories: [],
    skills: [],
    domains: [],
    supportedProtocols: [],
    ownerAddress: null,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: null,
    isActive: true,
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },
    classification: null,
    fuguListing: null,
    source: "scan8004",
    fetchedAt: "2026-09-08T00:00:00.000Z",
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// GRID
// ---------------------------------------------------------------------------

describe("classify — GRID", () => {
  it("recognizes an explicit grid trading agent (LingoAI Grid Trading Agent, live)", () => {
    const result = classify(
      agent({
        name: "LingoAI Grid Trading Agent",
        description:
          "Automated grid trading strategy runner: plans grid levels and orders within a configured price range on PancakeSwap v3 pools (BSC). Hireable via ERC-8183 escrow, 1 U per job.",
      }),
    );
    expect(result.category).toBe("GRID");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.reason).toMatch(/grid trading/i);
  });

  it("recognizes grid market making without the phrase 'grid trading' (Grid Agent 1 by 4LPHA, live)", () => {
    const result = classify(
      agent({
        name: "Grid Agent 1 by 4LPHA",
        description:
          "Automated grid market making that buys low and sells high as market prices move using PancakeSwap V3 on BNB Chain.",
      }),
    );
    expect(result.category).toBe("GRID");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("recognizes grid from an explicit category marker (smart-money-grid-trading-agent, live)", () => {
    const result = classify(
      agent({
        name: "smart-money-grid-trading-agent",
        description:
          "[category:grid-trading] Places and manages automated grid orders on PancakeSwap. Buys low, sells high within a configurable price band, capturing spread from sideways markets 24/7.",
      }),
    );
    expect(result.category).toBe("GRID");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("recognizes grid from price geometry even when the word 'trading' never appears (PancakeSwap Grid Trader, live)", () => {
    const result = classify(
      agent({
        name: "PancakeSwap Grid Trader",
        description:
          "Runs a geometric grid over a PancakeSwap v3 pair: a band, a level count, a size per level, and a slot at each level that fills on the way down and unwinds on the way up.",
      }),
    );
    expect(result.category).toBe("GRID");
  });

  it("NEGATIVE: 'Grid-hub' is merely the name of an x402 payment service, not grid trading (live)", () => {
    const result = classify(
      agent({
        name: "Grid-hub",
        description:
          "Grid-hub is an x402-native service at https://api.grid-hub.app, indexed from the x402 Bazaar (Coinbase's public discovery directory). It charges callers itself in USDC on Base and is paid directly at call time.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("NEGATIVE: a 'grid' meaning a UI layout must not become GRID", () => {
    const result = classify(
      agent({
        name: "Layout Assistant",
        description:
          "Generates responsive CSS grid layouts and design tokens for React components.",
      }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REBALANCING
// ---------------------------------------------------------------------------

describe("classify — REBALANCING", () => {
  it("recognizes a target-driven portfolio rebalancer (DriftHarbor_271, live)", () => {
    const result = classify(
      agent({
        name: "DriftHarbor_271",
        description:
          "A disciplined portfolio rebalancer that watches target allocations, measures drift, and suggests precise trim/add orders to bring holdings back in line. It emphasizes clear rebalance rationale and threshold-aware adjustments.",
      }),
    );
    expect(result.category).toBe("REBALANCING");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("recognizes the very short description 'Automated portfolio rebalancing' (babycaisubagent, live)", () => {
    const result = classify(
      agent({
        name: "babycaisubagent66_quickassistant6584",
        description: "Automated portfolio rebalancing",
      }),
    );
    expect(result.category).toBe("REBALANCING");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("recognizes a target-allocation rebalancer (Portfolio Rebalancer, live)", () => {
    const result = classify(
      agent({
        name: "Portfolio Rebalancer",
        description:
          "Autonomous portfolio rebalancer that maintains target allocation and executes low-turnover rebalance actions on Base Sepolia",
      }),
    );
    expect(result.category).toBe("REBALANCING");
  });

  it("recognizes concentrated LP range rebalancing as REBALANCING, not YIELD", () => {
    const result = classify(
      agent({
        name: "CL Range Manager",
        description:
          "Concentrated liquidity manager for PancakeSwap v3: detects when an LP position drifts out of range and repositions the range automatically.",
      }),
    );
    expect(result.category).toBe("REBALANCING");
  });

  it("recognizes equal-weight rebalancing without the words 'portfolio rebalancing'", () => {
    const result = classify(
      agent({
        name: "Equal Weight Allocator",
        description:
          "Holds an equal-weight allocation across stablecoin markets and tops up the under-weight side as soon as one falls 100 bps of the portfolio behind its target.",
      }),
    );
    expect(result.category).toBe("REBALANCING");
  });

  it("NEGATIVE: a YIELD agent that happens to write 'Rebalances daily' stays YIELD (smart-money-yield-agent, live)", () => {
    const result = classify(
      agent({
        name: "smart-money-yield-agent",
        description:
          "[category:yield] Routes deposited liquidity to the highest available APR across Aave V3, Venus, Lista Liquid Staking, and PancakeSwap pools on BSC. Rebalances daily. Returns a ranked APR comparison table with recommended action.",
      }),
    );
    expect(result.category).toBe("YIELD");
  });
});

// ---------------------------------------------------------------------------
// YIELD
// ---------------------------------------------------------------------------

describe("classify — YIELD", () => {
  it("recognizes a yield farming agent (YieldPilot, live)", () => {
    const result = classify(
      agent({
        name: "YieldPilot",
        description:
          "Automated yield farming agent that allocates capital across lending protocols and vaults for optimal APY.",
      }),
    );
    expect(result.category).toBe("YIELD");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("recognizes an APY-driven yield optimiser (LingoAI Yield Optimiser, live)", () => {
    const result = classify(
      agent({
        name: "LingoAI Yield Optimiser",
        description:
          "Yield optimisation: reads Venus market rates, ranks vaults and staking pools by APY and proposes a reallocation toward the highest-earning opportunities. Hireable via ERC-8183 escrow, 1 U per job.",
      }),
    );
    expect(result.category).toBe("YIELD");
  });

  it("recognizes a cross-protocol APY aggregator (yieldflow, live)", () => {
    const result = classify(
      agent({
        name: "yieldflow",
        description:
          "Advanced DeFi yield aggregation and liquidity optimization agent. Scans for the highest APY opportunities, calculates impermanent loss risks, and provides auto-compounding strategies on the Base network",
      }),
    );
    expect(result.category).toBe("YIELD");
  });

  it("recognizes auto-compounding staking (Staking Optimizer, live)", () => {
    const result = classify(
      agent({
        name: "Staking Optimizer",
        description:
          "Recommends staking pools, auto-compounds rewards, and monitors slashing risks.",
      }),
    );
    expect(result.category).toBe("YIELD");
  });

  it("A DELIBERATE RECALL COST: a yield description that is too thin stays null (Yieldlane, live)", () => {
    // "Yield agent that compares idle capital vs PancakeSwap-style LP yield."
    // This genuinely is a real YIELD agent, and the classifier MISSES IT (0.53 vs
    // the 0.55 threshold). That is recorded here as deliberate behaviour, not an
    // undiscovered bug: lowering the threshold so a sentence this thin passes
    // would also let through any analytics agent that says "yield" twice. If this
    // decision is ever reversed, this is the test that has to change —
    // consciously, not quietly.
    const result = classify(
      agent({
        name: "Yieldlane",
        description:
          "Yield agent that compares idle capital vs PancakeSwap-style LP yield. Listed on Fourlane marketplace. Testnet only. Not financial advice.",
      }),
    );
    expect(result.category).toBeNull();
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(result.confidence).toBeLessThan(0.55);
  });

  it("NEGATIVE: an agricultural crop 'yield' must not become YIELD", () => {
    const result = classify(
      agent({
        name: "Crop Yield Forecaster",
        description:
          "Forecasts seasonal crop yield for smallholder farms from rainfall, soil moisture, and satellite imagery.",
        domains: ["agriculture/crop_management", "agriculture/agriculture"],
      }),
    );
    expect(result.category).toBeNull();
  });

  it("NEGATIVE: a traditional-markets 'bond yield' must not become YIELD", () => {
    const result = classify(
      agent({
        name: "Macro Desk",
        description:
          "Tracks the US Treasury bond yield curve and publishes a daily macro commentary for global markets.",
      }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HEALTH_FACTOR
// ---------------------------------------------------------------------------

describe("classify — HEALTH_FACTOR", () => {
  it("recognizes a Venus health factor monitor (Venus Health Factor Monitor, live)", () => {
    const result = classify(
      agent({
        name: "Venus Health Factor Monitor",
        description:
          "Reads any wallet's Venus Protocol lending position and returns its health factor, collateral, borrowings, per-market liquidation thresholds, and a plain-language risk recommendation.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("recognizes liquidation protection (bnb-lending-guardian.agent, live)", () => {
    const result = classify(
      agent({
        name: "bnb-lending-guardian.agent",
        description:
          "Liquidation protection for Venus on BNB Chain. Reads a full lending position across Venus Core and all 8 isolated pools, computes the true health factor from liquidation thresholds, and stress-tests it against -5% to -20% collateral drops.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("recognizes a debt-repaying agent without the full phrase 'health factor' in its name (Lending Agent 4 by 4LPHA, live)", () => {
    const result = classify(
      agent({
        name: "Lending Agent 4 by 4LPHA",
        description:
          "Watches a Venus Core borrow position and repays its debt from a reserve when the health factor falls, on BNB Chain.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("recognizes proximity to liquidation with no 'health factor' phrase at all (Assay Health, live)", () => {
    const result = classify(
      agent({
        name: "Assay Health",
        description:
          "Reports how close a Venus borrower is to liquidation, reading the account's live liquidity and shortfall from the Comptroller.",
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("NEGATIVE: 'liquidity' is not 'liquidation' — an LP agent must not become HEALTH_FACTOR", () => {
    const result = classify(
      agent({
        name: "Liquidity Scout",
        description:
          "Scans liquidity pools and reports total value locked, liquidity depth, and slippage for any BSC pair.",
      }),
    );
    expect(result.category).not.toBe("HEALTH_FACTOR");
  });

  it("NEGATIVE: a medical health agent must not become HEALTH_FACTOR", () => {
    const result = classify(
      agent({
        name: "Health Companion",
        description:
          "A personal health assistant that tracks sleep, activity, and nutrition, and flags risk factors worth discussing with a doctor.",
        domains: ["healthcare/medical_technology"],
      }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The threshold: an unclear agent yields null
// ---------------------------------------------------------------------------

describe("classify — the confidence threshold", () => {
  it("an empty agent yields null with confidence 0", () => {
    const result = classify(agent({}));
    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("a generic agent with no DeFi connection yields null (SummaryBot, live)", () => {
    const result = classify(
      agent({
        name: "SummaryBot",
        description:
          "Distill long documents, papers, meeting notes, reports into concise summaries. Perfect for research papers, legal documents, earnings calls, and technical specs.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("a generic trading agent with no specific strategy yields null (Autonomous Trader Bot, live)", () => {
    const result = classify(
      agent({
        name: "Autonomous Trader Bot",
        description:
          "Performs continuous trading based on predefined parameters and market conditions.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("a single MODERATE-tier keyword alone is not enough to pass the threshold", () => {
    // "liquidation" alone is worth 0.6 → confidence 0.375, below 0.55.
    // That is no coincidence: the threshold is deliberately set above the ceiling
    // of a single moderate cue.
    const result = classify(
      agent({ name: "Watcher", description: "Sends an alert on any liquidation event it sees." }),
    );
    expect(result.category).toBeNull();
  });

  it("a single WEAK-tier keyword alone is clearly not enough", () => {
    const result = classify(agent({ name: "Vault Watcher", description: "Watches a vault." }));
    expect(result.category).toBeNull();
  });

  it("REFUSES TO GUESS on the hardest real case: Narrow Band Allocator (live)", () => {
    // This agent really is REBALANCING (equal-weight allocation, correcting the
    // under-weight side). But its description mentions "health factor" — in an
    // explanatory clause about why it does NOT withdraw funds. A keyword
    // classifier cannot tell that mention apart from its main function.
    //
    // The right answer here is neither guessing REBALANCING (accidentally
    // correct) nor answering HEALTH_FACTOR (wrong, and an early version of this
    // classifier answered exactly that with confidence 0.94 — found only because
    // its output was checked over 167 real 8004scan agents, not over tests we
    // wrote ourselves). The right answer is `null`: two categories both have real
    // evidence in the same text.
    const result = classify(
      agent({
        name: "Narrow Band Allocator",
        description:
          "Holds an equal-weight allocation across the Venus Core-pool stablecoin markets and corrects it as soon as a market falls 100 bps of the portfolio behind its target. Tops up the under-weight side through vToken.mint(uint256), which takes an amount and no recipient; it never withdraws, because redeemUnderlying(uint256) can push a borrowing account's health factor below one and needs a guard this authority does not carry.",
      }),
    );
    expect(result.category).toBeNull();
  });

  it("strong evidence balanced across two categories yields null, not a guess", () => {
    const result = classify(
      agent({
        name: "Omni DeFi Suite",
        description:
          "Runs grid trading strategies and yield farming vaults side by side, with portfolio rebalancing and health factor monitoring, all in one agent.",
      }),
    );
    expect(result.category).toBeNull();
    expect(result.reason).toMatch(/rival|competing|balanced/i);
  });
});

// ---------------------------------------------------------------------------
// The ceilings that pin down the threshold
// ---------------------------------------------------------------------------

/**
 * The 0.55 threshold is claimed valid because it is bracketed by two ceilings. A
 * claim like that is only useful if the numbers genuinely come out of the code —
 * the first version of the `MIN_CONFIDENCE` comment stated the tie ceiling as
 * 0.375 when its value is 0.35, and no test could catch it. All three ceilings
 * are locked down here so the comment and the behaviour cannot drift apart again
 * without someone shouting.
 */
describe("classify — the ceilings that pin down the threshold", () => {
  const { MIN_CONFIDENCE, SEPARATION_FLOOR } = CLASSIFIER_THRESHOLDS;

  it("LOWER CEILING 0.375: one MODERATE cue with no rival, and the threshold sits above it", () => {
    const result = classify(
      agent({ name: "Watcher", description: "Sends an alert on any liquidation event it sees." }),
    );
    expect(result.confidence).toBe(0.375);
    expect(result.category).toBeNull();
    expect(MIN_CONFIDENCE).toBeGreaterThan(0.375);
  });

  it("UPPER CEILING 0.625: one DECISIVE cue with no rival, and the threshold sits below it", () => {
    const result = classify(agent({ name: "Sentinel", description: "Monitors the health factor." }));
    expect(result.confidence).toBe(0.625);
    expect(result.category).toBe("HEALTH_FACTOR");
    expect(MIN_CONFIDENCE).toBeLessThan(0.625);
  });

  it("TIE CEILING 0.35: two exactly tied categories with saturated evidence stop precisely at SEPARATION_FLOOR", () => {
    // GRID 2.1 vs HEALTH_FACTOR 2.1 — both above the evidence cap, so
    // strength = 1 and separation = 0. This is the HIGHEST value a perfect tie
    // can reach, however much evidence there is.
    const result = classify(
      agent({
        name: "Tie",
        description:
          "grid trading with range orders in a price range. health factor: liquidation on venus lending.",
      }),
    );
    expect(result.confidence).toBe(SEPARATION_FLOOR);
    expect(result.confidence).toBe(0.35);
    expect(result.category).toBeNull();
  });

  it("the tie ceiling sits BELOW the lower ceiling, so it is not the binding bound", () => {
    // This is the correction to the first version of the comment: there is only
    // ONE lower bound (0.375), not two that happen to coincide.
    expect(SEPARATION_FLOOR).toBeLessThan(0.375);
  });
});

// ---------------------------------------------------------------------------
// The second layer: OASF
// ---------------------------------------------------------------------------

describe("classify — the second OASF layer", () => {
  it("empty OASF changes nothing (the most common path on 8004scan)", () => {
    const base = {
      name: "Hevo Grid",
      description:
        "Grid trading strategy agent on BNB Smart Chain that analyzes market conditions and designs systematic buy-and-sell price grids",
    };
    const withoutOasf = classify(agent(base));
    const withEmptyOasf = classify(agent({ ...base, skills: [], domains: [] }));
    expect(withoutOasf.confidence).toBe(withEmptyOasf.confidence);
    expect(withoutOasf.category).toBe("GRID");
  });

  it("a DeFi OASF domain raises confidence on a threshold case", () => {
    const base = {
      name: "Range Trader",
      description:
        "Places buy orders at support and sell orders at resistance within a defined price range.",
    };
    const plain = classify(agent(base));
    const withDefi = classify(
      agent({ ...base, domains: ["technology/blockchain/defi", "finance/markets/crypto"] }),
    );
    expect(withDefi.confidence).toBeGreaterThan(plain.confidence);
    expect(withDefi.category).toBe("GRID");
    expect(withDefi.reason).toMatch(/OASF/i);
  });

  it("a non-finance OASF domain pushes the classification down even when the keywords match", () => {
    const base = {
      name: "Harvest Planner",
      description: "Yield farming schedule optimiser for rotating crops across seasons.",
    };
    const plain = classify(agent(base));
    const withAgriculture = classify(
      agent({ ...base, domains: ["agriculture/crop_management"], skills: ["agriculture/planning"] }),
    );
    expect(withAgriculture.confidence).toBeLessThan(plain.confidence);
    expect(withAgriculture.category).toBeNull();
  });

  it("A CONSCIOUS DECISION: an unrelated OASF domain PUSHES DOWN but never vetoes", () => {
    // A correct HEALTH_FACTOR agent that passes on a single decisive phrase alone
    // (0.625) must not be cancelled merely because the upstream taxonomy contains
    // one token like "logistics" or "education". Those domains create no homonym
    // with our vocabulary, and OASF — by our own findings — cannot pick a
    // category; it does not deserve a veto.
    const base = { name: "Sentinel", description: "Monitors the health factor." };
    const plain = classify(agent(base));
    expect(plain.confidence).toBe(0.625);

    for (const domain of ["transportation/logistics", "education/online_learning", "media_and_entertainment/gaming"]) {
      const result = classify(agent({ ...base, domains: [domain] }));
      expect(result.confidence).toBeLessThan(plain.confidence);
      expect(result.category).toBe("HEALTH_FACTOR");
      expect(result.confidence).toBeGreaterThanOrEqual(CLASSIFIER_THRESHOLDS.MIN_CONFIDENCE);
    }
  });

  it("A CONSCIOUS DECISION: an OASF domain that collides in meaning MAY veto a decisive cue", () => {
    // The opposite, and deliberately so: these three domains produce exactly the
    // homonyms this classifier was built to withstand — "crop yield", a medical
    // "health factor", "power grid". Here a veto is exactly what is wanted.
    const base = { name: "Sentinel", description: "Monitors the health factor." };
    for (const domain of ["agriculture/crop_management", "healthcare/medical_technology", "energy/utilities"]) {
      const result = classify(agent({ ...base, domains: [domain] }));
      expect(result.category).toBeNull();
    }
  });

  it("a single DeFi signal frees a cross-domain agent from both penalties (GameFi)", () => {
    const result = classify(
      agent({
        name: "Sentinel",
        description: "Monitors the health factor.",
        domains: ["media_and_entertainment/gaming", "technology/blockchain/defi"],
      }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
    expect(result.confidence).toBeGreaterThan(0.625);
  });

  it("OASF can never classify on its own without any keyword", () => {
    const result = classify(
      agent({
        name: "Nameless",
        description: "",
        domains: ["technology/blockchain/defi", "finance/markets/crypto"],
        skills: ["analytical_skills/data_analysis/crypto_analysis"],
      }),
    );
    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tags / categories upstream
// ---------------------------------------------------------------------------

describe("classify — upstream tags and categories", () => {
  it("a matching upstream category label is the strongest evidence", () => {
    const result = classify(
      agent({ name: "Agent 42", description: "An agent.", categories: ["yield"] }),
    );
    expect(result.category).toBe("YIELD");
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it("the 'health-factor' tag maps to HEALTH_FACTOR", () => {
    const result = classify(
      agent({ name: "Agent 43", description: "An agent.", tags: ["health-factor", "bsc"] }),
    );
    expect(result.category).toBe("HEALTH_FACTOR");
  });

  it("generic tags like 'defi' or 'trading' classify nothing", () => {
    const result = classify(
      agent({ name: "Agent 44", description: "An agent.", tags: ["defi", "trading", "bnb"] }),
    );
    expect(result.category).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Purity and the output shape
// ---------------------------------------------------------------------------

describe("classify — purity and the output contract", () => {
  it("deterministic: the same input yields an identical output", () => {
    const a = agent({
      name: "GridPilot",
      description: "Low-cost automated grid execution on BSC Testnet using controlled parameters.",
    });
    expect(classify(a)).toEqual(classify(a));
  });

  it("does not mutate the input record", () => {
    const a = agent({ name: "YieldPilot", description: "Automated yield farming agent." });
    const copy = structuredClone(a);
    classify(a);
    expect(a).toEqual(copy);
  });

  it("confidence always lies in the range 0..1", () => {
    const samples = [
      agent({ name: "", description: "" }),
      agent({
        name: "smart-money-grid-trading-agent",
        description:
          "[category:grid-trading] grid trading grid bot grid strategy grid orders grid levels buy low sell high",
      }),
      agent({ name: "Grid-hub", description: "x402 service." }),
    ];
    for (const c of samples) {
      const r = classify(c);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("reason is always populated, both when categorizing and when refusing", () => {
    expect(classify(agent({ name: "YieldPilot", description: "yield farming" })).reason).not.toBe("");
    expect(classify(agent({ name: "x", description: "y" })).reason).not.toBe("");
  });

  it("tolerates missing fields without throwing", () => {
    const broken = { name: undefined, description: undefined, tags: undefined } as unknown as AgentRecord;
    expect(() => classify(broken)).not.toThrow();
    expect(classify(broken).category).toBeNull();
  });
});
