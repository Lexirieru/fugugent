/**
 * Tests for the RUNTIME layer that exposes the Rebalancer's decision engine.
 *
 * Three things are asserted here, and they are the three ways this wiring could be a lie:
 *   1. the tool returns EXACTLY what the decision engine returned — no rounding, no
 *      re-derivation, no second opinion between `decide()` and the wire;
 *   2. a malformed request is REJECTED with the reason, never answered with a guess;
 *   3. nothing in any payload implies this agent executed anything, because it cannot.
 *
 * No network: the advisory layer is a pure function of its argument, and the MCP surface is
 * driven over the SDK's in-memory transport.
 */
import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ADVISORY_NOTICE,
  ADVISORY_SKILL_IDS,
  AdvisoryInputError,
  REBALANCE_ADVISORY_SKILL,
  REBALANCE_THRESHOLDS_SKILL,
  adviseRebalance,
  parseRebalanceInput,
  rebalanceAdvisorySkill,
  rebalanceThresholdsSkill,
} from "../advisory.js";
import { buildAgentCard } from "../agentCard.js";
import { buildMcpServer } from "../mcpMain.js";
import { decide } from "../strategy/decide.js";
import { DEFAULT_COST_MODEL, DEFAULT_THRESHOLDS, PortfolioError } from "../strategy/types.js";

/** A $10,000 portfolio drifted to 60/40 against a 50/50 target: 10% deviation. */
const drifted = {
  assets: [
    { symbol: "BNB", valueBase: "600000000000", targetWeightBps: "5000" },
    { symbol: "USDT", valueBase: "400000000000", targetWeightBps: "5000" },
  ],
};

/** The same 10% drift on a $100 portfolio: the deviation gate opens, the cost gate does not. */
const driftedButTiny = {
  assets: [
    { symbol: "BNB", valueBase: "6000000000", targetWeightBps: "5000" },
    { symbol: "USDT", valueBase: "4000000000", targetWeightBps: "5000" },
  ],
};

const onTarget = {
  assets: [
    { symbol: "BNB", valueBase: "500000000000", targetWeightBps: "5000" },
    { symbol: "USDT", valueBase: "500000000000", targetWeightBps: "5000" },
  ],
};

/** 3% drift: past the watch band (2.5%), short of the rebalance band (5%). */
const watching = {
  assets: [
    { symbol: "BNB", valueBase: "530000000000", targetWeightBps: "5000" },
    { symbol: "USDT", valueBase: "470000000000", targetWeightBps: "5000" },
  ],
};

describe("the tool decides with the engine, not beside it", () => {
  it("returns the engine's own decision, field for field", () => {
    const { portfolio, cost, thresholds } = parseRebalanceInput(drifted);
    expect(adviseRebalance(drifted).decision).toEqual(decide(portfolio, cost, thresholds));
  });

  it.each([
    ["NONE", onTarget],
    ["WATCH", watching],
    ["REBALANCE", drifted],
    ["BLOCKED_BY_COST", driftedButTiny],
  ] as const)("%s comes straight from the engine and is not renamed on the way out", (action, input) => {
    const advisory = adviseRebalance(input);
    expect(advisory.decision.action).toBe(action);
    expect(advisory.payload.recommendedAction).toBe(action);
    // The reasoning is the engine's sentence verbatim — the runtime layer never writes a
    // second version of why the decision was made.
    expect(advisory.payload.reasoning).toBe(advisory.decision.reason);
  });

  it("passes overrides through to the engine rather than quietly using its own defaults", () => {
    const strict = {
      ...drifted,
      thresholds: { watchBandBps: "50", rebalanceBandBps: "100", maxRebalanceCostBps: "17" },
    };
    const advisory = adviseRebalance(strict);
    expect(advisory.thresholds.maxRebalanceCostBps).toBe(17n);
    // 18 bps of cost against a 17 bps budget: the tighter budget flips the answer.
    expect(advisory.decision.action).toBe("BLOCKED_BY_COST");
    expect(adviseRebalance(drifted).decision.action).toBe("REBALANCE");
  });

  it("lets the engine refuse a budget that no trade size could ever clear", () => {
    // 10 bps of budget against 15 bps of swap fee + slippage: the agent would look busy and
    // never rebalance anything, forever, without a single error. The engine says no.
    expect(() =>
      adviseRebalance({
        ...drifted,
        thresholds: { watchBandBps: "250", rebalanceBandBps: "500", maxRebalanceCostBps: "10" },
      }),
    ).toThrow(PortfolioError);
  });

  it("defaults to this agent's own cost model and thresholds when none are given", () => {
    const advisory = adviseRebalance(drifted);
    expect(advisory.cost).toEqual(DEFAULT_COST_MODEL);
    expect(advisory.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it("accepts a quoted decimal beyond the safe-integer range without losing a digit", () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a double
    const { portfolio } = parseRebalanceInput({
      assets: [
        { symbol: "A", valueBase: huge.toString(), targetWeightBps: "5000" },
        { symbol: "B", valueBase: huge.toString(), targetWeightBps: "5000" },
      ],
    });
    expect(portfolio.assets[0]!.valueBase).toBe(huge);
  });
});

describe("no number reaches a reader raw", () => {
  it("money and percentages go out through the formatters, not as base units", () => {
    const payload = adviseRebalance(drifted).payload as Record<string, any>;
    expect(payload.portfolio.totalValue).toBe("$10,000.00");
    expect(payload.portfolio.largestWeightDeviation).toBe("10.0%");
    expect(payload.economics.valueThatWouldMove).toBe("$1,000.00");
    expect(payload.economics.estimatedCost).toBe("$1.80");
    expect(payload.economics.estimatedCostOfValueMoved).toBe("18 bps");
    expect(payload.suggestedTrades).toEqual([
      { symbol: "BNB", side: "SELL", value: "$1,000.00" },
      { symbol: "USDT", side: "BUY", value: "$1,000.00" },
    ]);
  });

  it("carries no 8-decimal base value anywhere in the serialized payload", () => {
    const text = JSON.stringify(adviseRebalance(drifted).payload);
    // 600000000000 = $6,000.00 on the 8-decimal basis. If it appears verbatim, some field
    // is shipping a base unit and a reader will be off by a factor of 100 million.
    expect(text).not.toContain("600000000000");
    expect(text).not.toContain("1000000000000");
  });
});

describe('"do nothing, it costs more than it is worth" is an answer, not a failure', () => {
  it("says so in the payload as well as in the sentence", () => {
    const payload = adviseRebalance(driftedButTiny).payload as Record<string, any>;
    expect(payload.recommendedAction).toBe("BLOCKED_BY_COST");
    expect(payload.economics.costGateBlocks).toBe(true);
    expect(payload.reasoning).toContain("would lose money to costs");
    // The 50 bps budget it was measured against is in the result, so the answer can be
    // checked instead of taken on faith.
    expect(payload.economics.costBudget).toBe("50 bps");
    expect(payload.economics.estimatedCostOfValueMoved).toBe("315 bps");
  });

  it("is not dressed up as a rejection — it is a successful advisory", () => {
    const result = rebalanceAdvisorySkill({ skill: REBALANCE_ADVISORY_SKILL, ...driftedButTiny });
    expect(result.status).toBeUndefined();
    expect(result.kind).toBe("advisory");
    expect(result.errorKind).toBeUndefined();
  });

  it("offers no trades when the cost gate is shut, so a careless caller holds nothing", () => {
    expect((adviseRebalance(driftedButTiny).payload as Record<string, any>).suggestedTrades).toEqual([]);
  });
});

describe("a malformed request is rejected, never answered with a guess", () => {
  it.each([
    ["a mistyped key", { assets: [{ symbol: "A", valueBase: "1", targetWeightBp: "5000" }] }],
    ["a fractional amount", { assets: [{ symbol: "A", valueBase: 1.5, targetWeightBps: "5000" }] }],
    ["a non-numeric amount", { assets: [{ symbol: "A", valueBase: "lots", targetWeightBps: "5000" }] }],
    ["an amount beyond the exact JSON range", { assets: [{ symbol: "A", valueBase: 9007199254740993, targetWeightBps: "5000" }] }],
    ["no assets at all", { assets: [] }],
    ["a malformed account", { ...drifted, account: "0xnope" }],
    ["an unknown top-level key", { ...drifted, leverage: "10x" }],
  ])("%s throws AdvisoryInputError", (_label, input) => {
    expect(() => adviseRebalance(input)).toThrow(AdvisoryInputError);
  });

  it("does not swallow the engine's own hard failures", () => {
    // Weights summing to 8000 bps: every asset looks overweight, and an engine that shrugged
    // would sell part of everything to reach a state nobody asked for.
    expect(() =>
      adviseRebalance({
        assets: [
          { symbol: "A", valueBase: "100000000", targetWeightBps: "4000" },
          { symbol: "B", valueBase: "100000000", targetWeightBps: "4000" },
        ],
      }),
    ).toThrow(PortfolioError);

    expect(() =>
      adviseRebalance({ assets: [{ symbol: "A", valueBase: "100000000", targetWeightBps: "10000" }] }),
    ).toThrow(PortfolioError);

    expect(() =>
      adviseRebalance({
        assets: [
          { symbol: "A", valueBase: "0", targetWeightBps: "5000" },
          { symbol: "B", valueBase: "0", targetWeightBps: "5000" },
        ],
      }),
    ).toThrow(PortfolioError);
  });

  it("labels the two failure kinds apart, because they are different mistakes to fix", () => {
    const shape = rebalanceAdvisorySkill({ assets: [{ symbol: "A", valueBase: 1.5, targetWeightBps: "5000" }] });
    expect(shape).toMatchObject({ status: "rejected", errorKind: "AdvisoryInputError" });
    expect(String(shape.error)).toContain("8-decimal basis");

    const sense = rebalanceAdvisorySkill({
      assets: [
        { symbol: "A", valueBase: "100000000", targetWeightBps: "4000" },
        { symbol: "B", valueBase: "100000000", targetWeightBps: "4000" },
      ],
    });
    expect(sense).toMatchObject({ status: "rejected", errorKind: "PortfolioError" });
    // The engine's message reaches the caller intact: without it they retry the same payload.
    expect(String(sense.error)).toContain("8000 bps");
  });

  it("a rejection is never mistaken for advice", () => {
    const rejected = rebalanceAdvisorySkill({ assets: [] });
    expect(rejected.kind).toBe("error");
    expect(rejected.recommendedAction).toBeUndefined();
    expect(rejected.suggestedTrades).toBeUndefined();
  });

  it("tolerates the A2A envelope's own `skill` key on an otherwise strict schema", () => {
    const result = rebalanceAdvisorySkill({ skill: REBALANCE_ADVISORY_SKILL, ...drifted });
    expect(result.recommendedAction).toBe("REBALANCE");
  });
});

describe("nothing in the output implies this agent acted on-chain", () => {
  const everyPayload = () => [
    adviseRebalance(onTarget).payload,
    adviseRebalance(watching).payload,
    adviseRebalance(drifted).payload,
    adviseRebalance(driftedButTiny).payload,
    rebalanceAdvisorySkill({ skill: REBALANCE_ADVISORY_SKILL, ...drifted }),
    rebalanceThresholdsSkill({ skill: REBALANCE_THRESHOLDS_SKILL }),
    rebalanceAdvisorySkill({ assets: [] }),
  ];

  it("every payload states plainly that it did not execute", () => {
    for (const payload of everyPayload()) {
      expect(payload.onchainExecution).toBe(false);
      expect(payload.executionPerformed).toBe(false);
      expect(payload.advisoryOnly).toBe(true);
    }
  });

  it("every advisory carries the notice, including the one that recommends trading", () => {
    for (const payload of everyPayload()) {
      if (payload.kind === "error") continue;
      expect(payload.notice).toBe(ADVISORY_NOTICE);
      expect(String(payload.notice)).toContain("sends no transaction");
    }
  });

  it.each([
    [/\btx[_ ]?hash\b/i],
    [/broadcast/i],
    [/\bsubmitted\b/i],
    [/\bconfirmed\b/i],
    [/\bexecuted\b/i],
    [/we (bought|sold|swapped|moved|rebalanced)/i],
    [/\bhas been (bought|sold|swapped|moved|rebalanced)\b/i],
  ])("no payload claims %s", (pattern) => {
    for (const payload of everyPayload()) {
      expect(JSON.stringify(payload)).not.toMatch(pattern);
    }
  });

  it("names its suggestions as suggestions", () => {
    const payload = adviseRebalance(drifted).payload as Record<string, any>;
    expect(payload).toHaveProperty("suggestedTrades");
    expect(payload).toHaveProperty("recommendedAction");
    // No key that would read as a record of something done.
    expect(payload).not.toHaveProperty("trades");
    expect(payload).not.toHaveProperty("executedTrades");
    expect(payload.economics).toHaveProperty("valueThatWouldMove");
  });
});

describe("the thresholds are readable instead of guessable", () => {
  it("gives every threshold a value and the reason it is that value", () => {
    const payload = rebalanceThresholdsSkill({}) as Record<string, any>;
    expect(payload.thresholds.rebalanceBand.value).toBe("500 bps");
    expect(payload.thresholds.costBudget.value).toBe("50 bps");
    expect(payload.thresholds.watchBand.value).toBe("250 bps");
    for (const entry of Object.values(payload.thresholds) as Record<string, unknown>[]) {
      expect(typeof entry.why).toBe("string");
      expect((entry.why as string).length).toBeGreaterThan(40);
    }
  });

  it("derives the smallest trade that can clear the cost gate from gas and the budget", () => {
    // g = $0.30, M = 50 bps, r = 15 bps -> T >= 0.30 x 10000 / 35 = $85.71
    const payload = rebalanceThresholdsSkill({}) as Record<string, any>;
    expect(payload.thresholds.smallestEconomicTrade.value).toBe("$85.71");
  });

  it("rejects a malformed override instead of falling back to the defaults", () => {
    expect(rebalanceThresholdsSkill({ thresholds: { watchBandBps: "250" } })).toMatchObject({
      status: "rejected",
      errorKind: "AdvisoryInputError",
    });
  });
});

describe("both faces actually advertise the advisory", () => {
  it("the A2A agent card lists it, with or without a payment rail", () => {
    for (const commerceSkills of [true, false]) {
      const ids = buildAgentCard({ commerceSkills }).skills.map((s) => s.id);
      expect(ids).toContain(REBALANCE_ADVISORY_SKILL);
      expect(ids).toContain(REBALANCE_THRESHOLDS_SKILL);
    }
  });

  it("the card says out loud that the agent does not execute", () => {
    const card = buildAgentCard();
    expect(card.description).toContain("no execution path");
    const advisory = card.skills.find((s) => s.id === REBALANCE_ADVISORY_SKILL)!;
    expect(advisory.description).toContain("DOES NOT TRADE");
    expect(advisory.tags).toContain("no-execution");
  });

  it("the MCP server registers both tools and answers a real call", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer({ commerceSkills: false });
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain(REBALANCE_ADVISORY_SKILL);
    expect(names).toContain(REBALANCE_THRESHOLDS_SKILL);

    const called = await client.callTool({ name: REBALANCE_ADVISORY_SKILL, arguments: drifted });
    const payload = JSON.parse((called.content as { text: string }[])[0]!.text);
    // The MCP face returns what the engine returned — the same object as the direct call.
    expect(payload).toEqual(adviseRebalance(drifted).payload);
    expect(payload.onchainExecution).toBe(false);

    const rejected = await client.callTool({
      name: REBALANCE_ADVISORY_SKILL,
      arguments: { assets: [{ symbol: "A", valueBase: "1", targetWeightBps: "10000" }] },
    });
    const rejectedPayload = JSON.parse((rejected.content as { text: string }[])[0]!.text);
    expect(rejectedPayload.status).toBe("rejected");
    expect(String(rejectedPayload.error)).toContain("at least 2");

    await client.close();
  });

  it("keeps the two skill ids in one place so the card and the tools cannot drift", () => {
    expect([...ADVISORY_SKILL_IDS]).toEqual([REBALANCE_ADVISORY_SKILL, REBALANCE_THRESHOLDS_SKILL]);
  });
});
