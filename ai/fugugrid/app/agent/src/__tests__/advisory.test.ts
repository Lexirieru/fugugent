/**
 * Tests for the RUNTIME layer that exposes the Grid's decision engine.
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
  GRID_ADVISORY_SKILL,
  GRID_FEASIBILITY_SKILL,
  adviseGrid,
  gridAdvisorySkill,
  gridFeasibilitySkill,
  parseGridInput,
} from "../advisory.js";
import { buildAgentCard } from "../agentCard.js";
import { buildMcpServer } from "../mcpMain.js";
import { decide } from "../strategy/decide.js";
import { DEFAULT_COST_MODEL, DEFAULT_GRID_THRESHOLDS, GridError } from "../strategy/types.js";

/**
 * A viable grid: $500..$700, 11 lines (10 intervals of $20), $1,000 of capital.
 * Narrowest spacing 285 bps against a 40 bps round trip — comfortably past the 2.00x gate.
 */
const config = {
  lowerBase: "50000000000",
  upperBase: "70000000000",
  levels: 11,
  capitalBase: "100000000000",
};

/** The same range chopped into 100 intervals: $10 lots, and gas eats the spacing. */
const tooManyLevels = { ...config, levels: 101 };

/** The wire shape of the grid's memory — `outsideSide` is a union, not just null. */
interface WireState {
  bandIndex: number;
  lotsHeld: number;
  consecutiveOutside: number;
  outsideSide: "ABOVE" | "BELOW" | null;
}

const midState: WireState = { bandIndex: 5, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null };

const at = (priceBase: string, state: WireState = midState) => ({
  config,
  state,
  observation: { priceBase },
});

describe("the tool decides with the engine, not beside it", () => {
  it("returns the engine's own decision, field for field", () => {
    const input = at("54500000000");
    const parsed = parseGridInput(input);
    expect(adviseGrid(input).decision).toEqual(
      decide(parsed.config, parsed.state, parsed.observation, parsed.cost, parsed.thresholds),
    );
  });

  it.each([
    ["IDLE", at("60500000000")],
    ["BUY", at("54500000000")],
    ["SELL", at("66500000000")],
    [
      "WATCH_BREAKOUT",
      at("71500000000", { bandIndex: 9, lotsHeld: 5, consecutiveOutside: 1, outsideSide: "ABOVE" }),
    ],
    ["EXIT_ABOVE", at("78000000000", { bandIndex: 9, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null })],
    ["EXIT_BELOW", at("44000000000", { bandIndex: 0, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null })],
  ] as const)("%s comes straight from the engine and is not renamed on the way out", (action, input) => {
    const advisory = adviseGrid(input);
    expect(advisory.decision.action).toBe(action);
    expect(advisory.payload.recommendedAction).toBe(action);
    // The reasoning is the engine's sentence verbatim — the runtime layer never writes a
    // second version of why the decision was made.
    expect(advisory.payload.reasoning).toBe(advisory.decision.reason);
  });

  it("defaults to this agent's own cost model and thresholds when none are given", () => {
    const advisory = adviseGrid(at("60500000000"));
    expect(advisory.cost).toEqual(DEFAULT_COST_MODEL);
    expect(advisory.thresholds).toEqual(DEFAULT_GRID_THRESHOLDS);
  });

  it("passes overrides through to the engine rather than quietly using its own defaults", () => {
    // One observation outside is enough when the caller says one is enough.
    const advisory = adviseGrid({
      ...at("71500000000", { bandIndex: 9, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null }),
      thresholds: {
        breakoutBufferBps: "200",
        breakoutConfirmObservations: 1,
        hardBreakoutBps: "1000",
        minProfitMultipleBps: "20000",
        maxRangeRatioBps: "30000",
      },
    });
    expect(advisory.decision.action).toBe("EXIT_ABOVE");
    expect(adviseGrid(at("71500000000", { bandIndex: 9, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null })).decision.action).toBe(
      "WATCH_BREAKOUT",
    );
  });

  it("accepts a quoted decimal beyond the safe-integer range without losing a digit", () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a double
    const { observation } = parseGridInput({
      ...at("60500000000"),
      observation: { priceBase: "60500000000", blockNumber: huge.toString() },
    });
    expect(observation.blockNumber).toBe(huge);
  });
});

describe("the grid's memory belongs to the caller", () => {
  it("refuses to guess a state that was not sent", () => {
    expect(() => adviseGrid({ config, observation: { priceBase: "60500000000" } })).toThrow(
      AdvisoryInputError,
    );
  });

  it("returns the next state as a conditional, not as a fact", () => {
    const advisory = adviseGrid(at("54500000000"));
    expect(advisory.payload.nextStateIfActedOn).toEqual(advisory.decision.nextState);
    // The key name is the whole point: this agent does not act, so the state only becomes
    // true for a caller who carries the trade out themselves.
    expect(advisory.payload).not.toHaveProperty("nextState");
    expect(advisory.payload).not.toHaveProperty("newState");
  });

  it("a BUY that is capped by inventory capacity says so instead of pretending it filled", () => {
    // 10 lots already held out of 10 intervals: there is no room to buy another.
    const advisory = adviseGrid(
      at("50500000000", { bandIndex: 5, lotsHeld: 10, consecutiveOutside: 0, outsideSide: null }),
    );
    const trade = advisory.payload.suggestedTrade as Record<string, unknown>;
    expect(trade.lotsCapped).toBe(true);
    expect(trade.lots).toBe(0);
    expect(advisory.payload.recommendedAction).toBe("IDLE");
  });
});

describe("no number reaches a reader raw", () => {
  it("prices, money and spacings go out through the formatters, not as base units", () => {
    const payload = adviseGrid(at("54500000000")).payload as Record<string, any>;
    expect(payload.price).toBe("$545.00");
    expect(payload.band.lowerBound).toBe("$500.00");
    expect(payload.band.upperBound).toBe("$700.00");
    expect(payload.economics.lotValue).toBe("$100.00");
    expect(payload.economics.narrowestSpacing).toBe("285 bps");
    expect(payload.economics.roundTripCost).toBe("40 bps");
    expect(payload.economics.requiredSpacing).toBe("80 bps");
    expect(payload.suggestedTrade.notional).toBe("$300.00");
  });

  it("carries no 8-decimal base value anywhere in the serialized payload", () => {
    const text = JSON.stringify(adviseGrid(at("54500000000")).payload);
    // 54500000000 = $545.00 on the 8-decimal basis. Verbatim, it reads as fifty-four billion.
    expect(text).not.toContain("54500000000");
    expect(text).not.toContain("70000000000");
  });
});

describe('"this grid cannot make money" is an answer, not a failure', () => {
  it("names the two numbers that disagree instead of throwing", () => {
    const payload = gridFeasibilitySkill({ config: tooManyLevels }) as Record<string, any>;
    expect(payload.profitable).toBe(false);
    expect(payload.blockingReason).toContain("28 bps");
    expect(payload.blockingReason).toContain("130 bps");
    expect(payload.blockingReason).toContain("260 bps");
    expect(payload.blockingReason).toContain("Every round trip on this grid would lose money");
    // And it says what to change, so the answer is actionable rather than only discouraging.
    expect(payload.blockingReason).toContain("Reduce the level count, widen the range, or add capital");
  });

  it("passes a viable grid with the margin visible rather than merely asserted", () => {
    const payload = gridFeasibilitySkill({ config }) as Record<string, any>;
    expect(payload.profitable).toBe(true);
    expect(payload.blockingReason).toBeNull();
    expect(payload.economics.spacingCoversRoundTrip).toBe(true);
    expect(payload.grid.narrowestSpacing).toBe("285 bps");
    expect(payload.economics.requiredSpacing).toBe("80 bps");
    expect(payload.grid.linePrices[0]).toBe("$500.00");
    expect(payload.grid.linePrices.at(-1)).toBe("$700.00");
  });

  it("the advisory itself still refuses that grid outright, with the same numbers", () => {
    const rejected = gridAdvisorySkill({
      config: tooManyLevels,
      state: { bandIndex: 5, lotsHeld: 0, consecutiveOutside: 0, outsideSide: null },
      observation: { priceBase: "60000000000" },
    });
    expect(rejected).toMatchObject({ status: "rejected", errorKind: "GridError" });
    expect(String(rejected.error)).toContain("cannot turn a profit");
    // Running it would look busy and successful while eating the capital, which is why the
    // engine will not evaluate it at all.
    expect(rejected.recommendedAction).toBeUndefined();
  });

  it("reads the thresholds alone when no config is given", () => {
    const payload = gridFeasibilitySkill({}) as Record<string, any>;
    expect(payload.profitable).toBeUndefined();
    expect(payload.thresholds.minProfitMultiple.value).toBe("2.0x");
    expect(payload.thresholds.breakoutConfirmObservations.value).toBe("3 consecutive observations");
    for (const entry of Object.values(payload.thresholds) as Record<string, unknown>[]) {
      expect(typeof entry.why).toBe("string");
      expect((entry.why as string).length).toBeGreaterThan(40);
    }
  });
});

describe("a malformed request is rejected, never answered with a guess", () => {
  it.each([
    ["a mistyped key", { config, state: { ...midState, lotsHeId: 5 }, observation: { priceBase: "1" } }],
    ["a fractional price", { ...at("1"), observation: { priceBase: 1.5 } }],
    ["a non-numeric price", { ...at("1"), observation: { priceBase: "cheap" } }],
    ["a price beyond the exact JSON range", { ...at("1"), observation: { priceBase: 9007199254740993 } }],
    ["a fractional level count", { ...at("60500000000"), config: { ...config, levels: 10.5 } }],
    ["no observation", { config, state: midState }],
    ["an unknown top-level key", { ...at("60500000000"), leverage: "10x" }],
  ])("%s throws AdvisoryInputError", (_label, input) => {
    expect(() => adviseGrid(input)).toThrow(AdvisoryInputError);
  });

  it("does not swallow the engine's own hard failures", () => {
    // A breach counted with no direction: observations above and below could otherwise stack
    // into a "confirmation" that never happened in either single direction.
    expect(() =>
      adviseGrid(at("60000000000", { bandIndex: 5, lotsHeld: 5, consecutiveOutside: 2, outsideSide: null })),
    ).toThrow(GridError);

    // A price of zero is a broken reading, not an asset that became free.
    expect(() => adviseGrid(at("0"))).toThrow(GridError);

    // lotsHeld outside 0..intervals.
    expect(() =>
      adviseGrid(at("60000000000", { bandIndex: 5, lotsHeld: 99, consecutiveOutside: 0, outsideSide: null })),
    ).toThrow(GridError);

    // Two lines are a pair of limit orders, not a grid.
    expect(() =>
      adviseGrid({ ...at("60000000000"), config: { ...config, levels: 2 } }),
    ).toThrow(GridError);
  });

  it("labels the two failure kinds apart, because they are different mistakes to fix", () => {
    const shape = gridAdvisorySkill({ ...at("1"), observation: { priceBase: 1.5 } });
    expect(shape).toMatchObject({ status: "rejected", errorKind: "AdvisoryInputError" });
    expect(String(shape.error)).toContain("8-decimal basis");

    const sense = gridAdvisorySkill(at("0"));
    expect(sense).toMatchObject({ status: "rejected", errorKind: "GridError" });
    // The engine's message reaches the caller intact: without it they retry the same payload.
    expect(String(sense.error)).toContain("not positive");
  });

  it("a rejection is never mistaken for advice", () => {
    const rejected = gridAdvisorySkill(at("0"));
    expect(rejected.kind).toBe("error");
    expect(rejected.recommendedAction).toBeUndefined();
    expect(rejected.suggestedTrade).toBeUndefined();
    expect(rejected.nextStateIfActedOn).toBeUndefined();
  });

  it("tolerates the A2A envelope's own `skill` key on an otherwise strict schema", () => {
    expect(gridAdvisorySkill({ skill: GRID_ADVISORY_SKILL, ...at("54500000000") }).recommendedAction).toBe(
      "BUY",
    );
  });
});

describe("nothing in the output implies this agent acted on-chain", () => {
  const everyPayload = () => [
    adviseGrid(at("60500000000")).payload,
    adviseGrid(at("54500000000")).payload,
    adviseGrid(at("66500000000")).payload,
    adviseGrid(at("78000000000", { bandIndex: 9, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null })).payload,
    adviseGrid(at("44000000000", { bandIndex: 0, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null })).payload,
    gridAdvisorySkill({ skill: GRID_ADVISORY_SKILL, ...at("54500000000") }),
    gridFeasibilitySkill({ skill: GRID_FEASIBILITY_SKILL, config }),
    gridFeasibilitySkill({ config: tooManyLevels }),
    gridAdvisorySkill(at("0")),
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
      expect(String(payload.notice)).toContain("places no order");
    }
  });

  it.each([
    [/\btx[_ ]?hash\b/i],
    [/broadcast/i],
    [/\bsubmitted\b/i],
    [/\bfilled\b/i],
    [/\bexecuted\b/i],
    [/we (bought|sold|swapped|unwound|exited)/i],
    [/\bhas been (bought|sold|swapped|unwound|placed)\b/i],
  ])("no payload claims %s", (pattern) => {
    for (const payload of everyPayload()) {
      expect(JSON.stringify(payload)).not.toMatch(pattern);
    }
  });

  it("names its suggestions as suggestions", () => {
    const payload = adviseGrid(at("54500000000")).payload as Record<string, any>;
    expect(payload).toHaveProperty("suggestedTrade");
    expect(payload).toHaveProperty("recommendedAction");
    // No key that would read as a record of something done.
    expect(payload).not.toHaveProperty("trade");
    expect(payload).not.toHaveProperty("executedTrade");
    expect(payload).not.toHaveProperty("fills");
  });

  it("even an EXIT — the most action-like answer — is offered, not reported", () => {
    const payload = adviseGrid(
      at("78000000000", { bandIndex: 9, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null }),
    ).payload as Record<string, any>;
    expect(payload.recommendedAction).toBe("EXIT_ABOVE");
    expect(payload.suggestedTrade.unwindsEntireInventory).toBe(true);
    expect(payload.executionPerformed).toBe(false);
    expect(String(payload.notice)).toContain("signs nothing");
  });
});

describe("both faces actually advertise the advisory", () => {
  it("the A2A agent card lists it, with or without a payment rail", () => {
    for (const commerceSkills of [true, false]) {
      const ids = buildAgentCard({ commerceSkills }).skills.map((s) => s.id);
      expect(ids).toContain(GRID_ADVISORY_SKILL);
      expect(ids).toContain(GRID_FEASIBILITY_SKILL);
    }
  });

  it("the card says out loud that the agent does not execute", () => {
    const card = buildAgentCard();
    expect(card.description).toContain("no execution path");
    const advisory = card.skills.find((s) => s.id === GRID_ADVISORY_SKILL)!;
    expect(advisory.description).toContain("DOES NOT TRADE");
    expect(advisory.tags).toContain("no-execution");
  });

  it("the MCP server registers both tools and answers a real call", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer({ commerceSkills: false });
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain(GRID_ADVISORY_SKILL);
    expect(names).toContain(GRID_FEASIBILITY_SKILL);

    const called = await client.callTool({ name: GRID_ADVISORY_SKILL, arguments: at("54500000000") });
    const payload = JSON.parse((called.content as { text: string }[])[0]!.text);
    // The MCP face returns what the engine returned — the same object as the direct call.
    expect(payload).toEqual(adviseGrid(at("54500000000")).payload);
    expect(payload.onchainExecution).toBe(false);

    const rejected = await client.callTool({
      name: GRID_ADVISORY_SKILL,
      arguments: { config: tooManyLevels, state: midState, observation: { priceBase: "60000000000" } },
    });
    const rejectedPayload = JSON.parse((rejected.content as { text: string }[])[0]!.text);
    expect(rejectedPayload.status).toBe("rejected");
    expect(String(rejectedPayload.error)).toContain("cannot turn a profit");

    await client.close();
  });

  it("keeps the two skill ids in one place so the card and the tools cannot drift", () => {
    expect([...ADVISORY_SKILL_IDS]).toEqual([GRID_ADVISORY_SKILL, GRID_FEASIBILITY_SKILL]);
  });
});
