/**
 * Tests for the RUNTIME layer that exposes the Yield agent's decision engine.
 *
 * Three things are asserted here, and they are the three ways this wiring could be a lie:
 *   1. the tool returns EXACTLY what the decision engine returned — no rounding, no
 *      re-derivation, no second opinion between `decide()` and the wire;
 *   2. a malformed request is REJECTED with the reason, never answered with a guess;
 *   3. nothing in any payload implies this agent executed anything, because it cannot.
 *
 * No network and no clock: `apyAgeSeconds` is data, so every case here is replayable.
 */
import { describe, expect, it } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ADVISORY_NOTICE,
  ADVISORY_SKILL_IDS,
  AdvisoryInputError,
  YIELD_ADVISORY_SKILL,
  YIELD_BREAKEVEN_SKILL,
  adviseYield,
  parseYieldInput,
  yieldAdvisorySkill,
  yieldBreakevenSkill,
} from "../advisory.js";
import { buildAgentCard } from "../agentCard.js";
import { buildMcpServer } from "../mcpMain.js";
import { decide } from "../strategy/decide.js";
import { DEFAULT_SWITCH_COST, DEFAULT_YIELD_THRESHOLDS, YieldError } from "../strategy/types.js";

interface WirePool {
  poolId: string;
  protocol: string;
  apyBps: string;
  tvlBase: string;
  riskScore: number;
  isActive: boolean;
  apyAgeSeconds: number;
}

const pool = (poolId: string, apyBps: string, tvlBase: string, extra: Partial<WirePool> = {}): WirePool => ({
  poolId,
  protocol: poolId.split("-")[0]!,
  apyBps,
  tvlBase,
  riskScore: 20,
  isActive: true,
  apyAgeSeconds: 60,
  ...extra,
});

/** $10,000 sitting in a $500,000 pool at 5.00% APY. */
const PRINCIPAL = "1000000000000";
const BIG_POOL = "50000000000000";
const position = { principalBase: PRINCIPAL, current: pool("venus-usdt", "500", BIG_POOL) };

const ask = (candidates: WirePool[], consecutiveFavorable = 0, current = position) => ({
  position: current,
  candidates,
  consecutiveFavorable,
});

describe("the tool decides with the engine, not beside it", () => {
  it("returns the engine's own decision, field for field", () => {
    const input = ask([pool("aave-usdt", "1200", BIG_POOL)], 3);
    const parsed = parseYieldInput(input);
    expect(adviseYield(input).decision).toEqual(
      decide(parsed.observation, parsed.cost, parsed.thresholds),
    );
  });

  it.each([
    ["STAY", "NO_CANDIDATE", ask([])],
    ["STAY", "NO_BETTER_POOL", ask([pool("aave-usdt", "300", BIG_POOL)])],
    ["STAY", "SPREAD_BELOW_BREAKEVEN", ask([pool("aave-usdt", "700", BIG_POOL)])],
    ["STAY", "SPREAD_NOT_CONFIRMED", ask([pool("aave-usdt", "1200", BIG_POOL)], 1)],
    ["MIGRATE", "MIGRATION_ECONOMIC", ask([pool("aave-usdt", "1200", BIG_POOL)], 3)],
    [
      "MIGRATE",
      "CURRENT_POOL_UNSAFE",
      ask([pool("aave-usdt", "300", BIG_POOL)], 0, {
        principalBase: PRINCIPAL,
        current: pool("venus-usdt", "500", BIG_POOL, { isActive: false }),
      }),
    ],
    [
      "EXIT",
      "NO_ELIGIBLE_POOL",
      ask([], 0, {
        principalBase: PRINCIPAL,
        current: pool("venus-usdt", "500", BIG_POOL, { isActive: false }),
      }),
    ],
    [
      "STAY",
      "CURRENT_DATA_STALE",
      ask([pool("aave-usdt", "1200", BIG_POOL)], 3, {
        principalBase: PRINCIPAL,
        current: pool("venus-usdt", "500", BIG_POOL, { apyAgeSeconds: 99_999 }),
      }),
    ],
  ] as const)("%s / %s comes straight from the engine and is not renamed on the way out", (action, code, input) => {
    const advisory = adviseYield(input);
    expect(advisory.decision.action).toBe(action);
    expect(advisory.decision.reasonCode).toBe(code);
    expect(advisory.payload.recommendedAction).toBe(action);
    expect(advisory.payload.reasonCode).toBe(code);
    // The reasoning is the engine's sentence verbatim — the runtime layer never writes a
    // second version of why the decision was made.
    expect(advisory.payload.reasoning).toBe(advisory.decision.reason);
  });

  it("defaults to this agent's own cost model and thresholds when none are given", () => {
    const advisory = adviseYield(ask([]));
    expect(advisory.cost).toEqual(DEFAULT_SWITCH_COST);
    expect(advisory.thresholds).toEqual(DEFAULT_YIELD_THRESHOLDS);
  });

  it("passes overrides through to the engine rather than quietly using its own defaults", () => {
    const input = {
      ...ask([pool("aave-usdt", "700", BIG_POOL)], 3),
      thresholds: {
        expectedHoldingDays: "365",
        spreadSafetyMultipleBps: "20000",
        maxPoolShareBps: "1000",
        maxPlausibleApyBps: "100000",
        maxRiskScore: 50,
        maxApyAgeSeconds: 3_600,
        minConsecutiveFavorable: 3,
      },
    };
    // A 200 bps spread does not clear a 30-day threshold; over a year it does, because the
    // migration cost is paid once and the spread is earned every day.
    expect(adviseYield(ask([pool("aave-usdt", "700", BIG_POOL)], 3)).decision.action).toBe("STAY");
    expect(adviseYield(input).decision.action).toBe("MIGRATE");
  });

  it("accepts a quoted decimal beyond the safe-integer range without losing a digit", () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a double
    const { observation } = parseYieldInput({
      ...ask([]),
      position: { principalBase: PRINCIPAL, current: pool("venus-usdt", "500", huge.toString()) },
    });
    expect(observation.position.current.tvlBase).toBe(huge);
  });
});

describe("no number reaches a reader raw", () => {
  it("money and APY go out through the formatters, not as base units or bps digits", () => {
    const payload = adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 3)).payload as Record<string, any>;
    expect(payload.position.principal).toBe("$10,000.00");
    expect(payload.position.apy).toBe("5.00%");
    expect(payload.suggestedTarget.apy).toBe("12.00%");
    expect(payload.economics.spread).toBe("700 bps");
    expect(payload.economics.migrationCost).toBe("$16.00");
    expect(payload.economics.requiredSpread).toBe("390 bps");
    expect(payload.economics.estimatedNetGainOverHorizon).toBe("$41.53");
  });

  it("carries no 8-decimal base value anywhere in the serialized payload", () => {
    const text = JSON.stringify(adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 3)).payload);
    // 1000000000000 = $10,000.00 on the 8-decimal basis; verbatim it reads as a trillion.
    expect(text).not.toContain(PRINCIPAL);
    expect(text).not.toContain(BIG_POOL);
  });
});

describe('"a higher APY is not worth moving to" is an answer, not a failure', () => {
  it("says so with the threshold it was measured against", () => {
    const payload = adviseYield(ask([pool("aave-usdt", "700", BIG_POOL)])).payload as Record<string, any>;
    expect(payload.recommendedAction).toBe("STAY");
    expect(payload.reasonCode).toBe("SPREAD_BELOW_BREAKEVEN");
    expect(payload.economics.spreadCoversItsOwnCost).toBe(false);
    expect(payload.economics.spread).toBe("200 bps");
    expect(payload.economics.breakEvenSpread).toBe("195 bps");
    expect(payload.economics.requiredSpread).toBe("390 bps");
    expect(payload.reasoning).toContain("that higher APY is not the better choice");
  });

  it("is not dressed up as a rejection — it is a successful advisory", () => {
    const result = yieldAdvisorySkill({ skill: YIELD_ADVISORY_SKILL, ...ask([pool("aave-usdt", "700", BIG_POOL)]) });
    expect(result.status).toBeUndefined();
    expect(result.kind).toBe("advisory");
    expect(result.errorKind).toBeUndefined();
  });

  it("the threshold is inversely proportional to the principal, and says so", () => {
    const big = yieldBreakevenSkill({ principalBase: PRINCIPAL }) as Record<string, any>;
    const small = yieldBreakevenSkill({ principalBase: "20000000000" }) as Record<string, any>; // $200
    expect(big.requiredSpread).toBe("390 bps");
    expect(small.requiredSpread).toBe("1582 bps");
    // Same pools, same day: $10,000 should move for a spread that $200 must not move for.
    expect(String(big.why)).toContain("INVERSELY");
    expect(String(big.why)).toContain("The highest APY is not the answer");
  });

  it("reads the thresholds alone when no principal is given, because the spread has no meaning without one", () => {
    const payload = yieldBreakevenSkill({}) as Record<string, any>;
    expect(payload.requiredSpread).toBeUndefined();
    expect(payload.thresholds.spreadSafetyMultiple.value).toBe("2.0x");
    expect(payload.thresholds.expectedHoldingDays.value).toBe("30 days");
    for (const entry of Object.values(payload.thresholds) as Record<string, unknown>[]) {
      expect(typeof entry.why).toBe("string");
      expect((entry.why as string).length).toBeGreaterThan(40);
    }
  });

  it("the confirmation gate holds a qualifying spread and explains who counts", () => {
    const payload = adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 1)).payload as Record<string, any>;
    expect(payload.recommendedAction).toBe("STAY");
    expect(payload.economics.spreadCoversItsOwnCost).toBe(true);
    expect(payload.confirmation).toMatchObject({ favorableObservations: 1, required: 3, confirmed: false });
    // This agent keeps no memory, so the caller has to be told the counting rule.
    expect(String(payload.confirmation.howToCount)).toContain("reset to zero");
  });
});

describe("risk is judged before any APY is compared", () => {
  it("refuses the highest APY on the board and says why, one code per pool", () => {
    const advisory = adviseYield(
      ask([
        pool("scam-usdt", "9000", "100000000000", { riskScore: 90 }),
        pool("tiny-usdt", "5000", "500000000000"),
        pool("dead-usdt", "3000", BIG_POOL, { isActive: false }),
        pool("stale-usdt", "2000", BIG_POOL, { apyAgeSeconds: 99_999 }),
        pool("bait-usdt", "200000", BIG_POOL),
      ]),
    );
    expect(advisory.decision.action).toBe("STAY");
    expect(advisory.decision.reasonCode).toBe("NO_CANDIDATE");
    const rejected = advisory.payload.rejectedCandidates as { poolId: string; why: string; meaning: string }[];
    expect(rejected.map((r) => [r.poolId, r.why])).toEqual([
      ["scam-usdt", "RISK_SCORE"],
      ["tiny-usdt", "POOL_SHARE"],
      ["dead-usdt", "INACTIVE"],
      ["stale-usdt", "STALE_DATA"],
      ["bait-usdt", "IMPLAUSIBLE_APY"],
    ]);
    // Each code carries a sentence, so a caller reading "POOL_SHARE" does not have to guess.
    for (const r of rejected) expect(r.meaning.length).toBeGreaterThan(40);
  });

  it("leaves an unsafe pool even when the only destination pays less", () => {
    const advisory = adviseYield(
      ask([pool("aave-usdt", "300", BIG_POOL)], 0, {
        principalBase: PRINCIPAL,
        current: pool("venus-usdt", "500", BIG_POOL, { isActive: false }),
      }),
    );
    expect(advisory.decision.action).toBe("MIGRATE");
    expect(advisory.payload.reasoning).toContain("safety beats economics");
    // A negative spread, and it migrates anyway. Safety is not traded against yield.
    expect((advisory.payload as Record<string, any>).economics.spread).toBe("-200 bps");
  });
});

describe("a malformed request is rejected, never answered with a guess", () => {
  it.each([
    ["a mistyped key", { ...ask([]), position: { principalBase: PRINCIPAL, current: { ...pool("a", "1", "1"), apyBp: 5 } } }],
    ["a fractional amount", { ...ask([]), position: { principalBase: 1.5, current: pool("a", "1", "1") } }],
    ["a non-numeric amount", { ...ask([]), position: { principalBase: "plenty", current: pool("a", "1", "1") } }],
    ["an amount beyond the exact JSON range", { ...ask([]), position: { principalBase: 9007199254740993, current: pool("a", "1", "1") } }],
    ["a fractional risk score", ask([pool("aave-usdt", "700", BIG_POOL, { riskScore: 20.5 })])],
    ["no confirmation count", { position, candidates: [] }],
    ["an unknown top-level key", { ...ask([]), leverage: "10x" }],
  ])("%s throws AdvisoryInputError", (_label, input) => {
    expect(() => adviseYield(input)).toThrow(AdvisoryInputError);
  });

  it("does not swallow the engine's own hard failures", () => {
    // riskScore 200 is not a very risky pool, it is a broken reading — and treating it as
    // "very risky" would mean quietly accepting data we do not understand.
    expect(() =>
      adviseYield(
        ask([], 0, { principalBase: PRINCIPAL, current: pool("venus-usdt", "500", BIG_POOL, { riskScore: 200 }) }),
      ),
    ).toThrow(YieldError);

    // Two candidates with the same id make the best choice ambiguous.
    expect(() =>
      adviseYield(ask([pool("aave-usdt", "700", BIG_POOL), pool("aave-usdt", "900", BIG_POOL)])),
    ).toThrow(YieldError);

    // A TVL of zero is not a pool, it is a failed reading.
    expect(() => adviseYield(ask([pool("aave-usdt", "700", "0")]))).toThrow(YieldError);

    // No principal means there is no position to manage.
    expect(() =>
      adviseYield(ask([], 0, { principalBase: "0", current: pool("venus-usdt", "500", BIG_POOL) })),
    ).toThrow(YieldError);
  });

  it("labels the two failure kinds apart, because they are different mistakes to fix", () => {
    const shape = yieldAdvisorySkill({
      ...ask([]),
      position: { principalBase: 1.5, current: pool("a", "1", "1") },
    });
    expect(shape).toMatchObject({ status: "rejected", errorKind: "AdvisoryInputError" });
    expect(String(shape.error)).toContain("8-decimal basis");

    const sense = yieldAdvisorySkill(ask([pool("aave-usdt", "700", "0")]));
    expect(sense).toMatchObject({ status: "rejected", errorKind: "YieldError" });
    // The engine's message reaches the caller intact: without it they retry the same payload.
    expect(String(sense.error)).toContain("not positive");
  });

  it("a rejection is never mistaken for advice", () => {
    const rejected = yieldAdvisorySkill(ask([pool("aave-usdt", "700", "0")]));
    expect(rejected.kind).toBe("error");
    expect(rejected.recommendedAction).toBeUndefined();
    expect(rejected.suggestedTarget).toBeUndefined();
  });

  it("tolerates the A2A envelope's own `skill` key on an otherwise strict schema", () => {
    const result = yieldAdvisorySkill({
      skill: YIELD_ADVISORY_SKILL,
      ...ask([pool("aave-usdt", "1200", BIG_POOL)], 3),
    });
    expect(result.recommendedAction).toBe("MIGRATE");
  });
});

describe("nothing in the output implies this agent acted on-chain", () => {
  const everyPayload = () => [
    adviseYield(ask([])).payload,
    adviseYield(ask([pool("aave-usdt", "700", BIG_POOL)])).payload,
    adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 1)).payload,
    adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 3)).payload,
    adviseYield(
      ask([], 0, { principalBase: PRINCIPAL, current: pool("venus-usdt", "500", BIG_POOL, { isActive: false }) }),
    ).payload,
    yieldAdvisorySkill({ skill: YIELD_ADVISORY_SKILL, ...ask([pool("aave-usdt", "1200", BIG_POOL)], 3) }),
    yieldBreakevenSkill({ skill: YIELD_BREAKEVEN_SKILL, principalBase: PRINCIPAL }),
    yieldAdvisorySkill(ask([pool("aave-usdt", "700", "0")])),
  ];

  it("every payload states plainly that it did not execute", () => {
    for (const payload of everyPayload()) {
      expect(payload.onchainExecution).toBe(false);
      expect(payload.executionPerformed).toBe(false);
      expect(payload.advisoryOnly).toBe(true);
    }
  });

  it("every advisory carries the notice, including the one that recommends migrating", () => {
    for (const payload of everyPayload()) {
      if (payload.kind === "error") continue;
      expect(payload.notice).toBe(ADVISORY_NOTICE);
      expect(String(payload.notice)).toContain("withdraws nothing, deposits nothing");
    }
  });

  it.each([
    [/\btx[_ ]?hash\b/i],
    [/broadcast/i],
    [/\bsubmitted\b/i],
    [/\bexecuted\b/i],
    [/\bwithdrew\b/i],
    [/\bdeposited\b/i],
    [/we (migrated|moved|withdrew|deposited|exited)/i],
    [/\bhas been (migrated|moved|withdrawn|deposited)\b/i],
  ])("no payload claims %s", (pattern) => {
    for (const payload of everyPayload()) {
      expect(JSON.stringify(payload)).not.toMatch(pattern);
    }
  });

  it("names its suggestions as suggestions", () => {
    const payload = adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 3)).payload as Record<string, any>;
    expect(payload).toHaveProperty("suggestedTarget");
    expect(payload).toHaveProperty("recommendedAction");
    // No key that would read as a record of something done.
    expect(payload).not.toHaveProperty("migration");
    expect(payload).not.toHaveProperty("newPosition");
    expect(payload.economics).toHaveProperty("estimatedNetGainOverHorizon");
  });

  it("even MIGRATE — the most action-like answer — is offered, not reported", () => {
    const payload = adviseYield(ask([pool("aave-usdt", "1200", BIG_POOL)], 3)).payload as Record<string, any>;
    expect(payload.recommendedAction).toBe("MIGRATE");
    expect(payload.executionPerformed).toBe(false);
    expect(String(payload.notice)).toContain("signs nothing");
    // The position reported is still the one the caller sent: nothing moved.
    expect(payload.position.poolId).toBe("venus-usdt");
  });
});

describe("both faces actually advertise the advisory", () => {
  it("the A2A agent card lists it, with or without a payment rail", () => {
    for (const commerceSkills of [true, false]) {
      const ids = buildAgentCard({ commerceSkills }).skills.map((s) => s.id);
      expect(ids).toContain(YIELD_ADVISORY_SKILL);
      expect(ids).toContain(YIELD_BREAKEVEN_SKILL);
    }
  });

  it("the card says out loud that the agent does not execute", () => {
    const card = buildAgentCard();
    expect(card.description).toContain("no execution path");
    const advisory = card.skills.find((s) => s.id === YIELD_ADVISORY_SKILL)!;
    expect(advisory.description).toContain("DOES NOT MOVE FUNDS");
    expect(advisory.tags).toContain("no-execution");
  });

  it("the MCP server registers both tools and answers a real call", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer({ commerceSkills: false });
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain(YIELD_ADVISORY_SKILL);
    expect(names).toContain(YIELD_BREAKEVEN_SKILL);

    const args = ask([pool("aave-usdt", "1200", BIG_POOL)], 3);
    const called = await client.callTool({ name: YIELD_ADVISORY_SKILL, arguments: args });
    const payload = JSON.parse((called.content as { text: string }[])[0]!.text);
    // The MCP face returns what the engine returned — the same object as the direct call.
    expect(payload).toEqual(adviseYield(args).payload);
    expect(payload.onchainExecution).toBe(false);

    const rejected = await client.callTool({
      name: YIELD_ADVISORY_SKILL,
      arguments: ask([pool("aave-usdt", "700", "0")]),
    });
    const rejectedPayload = JSON.parse((rejected.content as { text: string }[])[0]!.text);
    expect(rejectedPayload.status).toBe("rejected");
    expect(String(rejectedPayload.error)).toContain("not positive");

    await client.close();
  });

  it("keeps the two skill ids in one place so the card and the tools cannot drift", () => {
    expect([...ADVISORY_SKILL_IDS]).toEqual([YIELD_ADVISORY_SKILL, YIELD_BREAKEVEN_SKILL]);
  });
});
