/**
 * The RUNTIME layer between the outside world and the pure Grid decision engine.
 *
 * `src/strategy/` is pure — no network, no clock, no `process.env`. This module is the
 * only place where an untrusted JSON payload (an A2A DataPart, an MCP tool argument, an
 * LLM tool call) is turned into the engine's domain types, and where the engine's bigint
 * result is turned back into text a human or an LLM may read.
 *
 * ## This agent gives ADVICE. It does not act.
 *
 * The Grid has NO execution path: no DEX adapter, no session-key signer, no order router.
 * Its on-chain metadata says so (`onchainExecution: false`) and so does `docs/STATUS.md`.
 * Every payload built here repeats it, because an agent that takes money and lets a caller
 * believe it is placing orders is the exact lie that cost Giza and ARMA their credibility.
 *
 * ## The grid's memory belongs to the caller
 *
 * `decide` is a reducer: `(config, state, observation) -> decision`, with the next state
 * returned alongside. The state is NOT stored here, and it is not guessed either — a
 * request without it is rejected. Inventing a `lotsHeld` would produce advice about a grid
 * nobody is running. And because this agent does not execute, the state it returns is
 * `nextStateIfActedOn`: it is only true for a caller who actually carries the trade out.
 *
 * ## The LLM never decides
 *
 * Every number below comes from `decide()` — deterministic, replayable, backtested code.
 * An LLM may call these tools and read the result out loud. It may not choose an action,
 * shift a threshold, or recompute an amount. Rule number one of the project.
 */
import { z } from "zod";
import { decide } from "./strategy/decide.js";
import { formatBps, formatPriceUsd8, formatUsd8 } from "./strategy/format.js";
import {
  intervalsOf,
  levelPriceBase,
  lotValueBase,
  minProfitableStepBps,
  minStepBps,
  roundTripCostBps,
  stepBase,
} from "./strategy/grid.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  type CostModel,
  type GridConfig,
  type GridDecision,
  type GridObservation,
  type GridState,
  type GridThresholds,
} from "./strategy/types.js";

/** The A2A skill ids / MCP tool names. */
export const GRID_ADVISORY_SKILL = "grid_advisory";
export const GRID_FEASIBILITY_SKILL = "grid_feasibility";
export const ADVISORY_SKILL_IDS = [GRID_ADVISORY_SKILL, GRID_FEASIBILITY_SKILL] as const;

/**
 * Carried by EVERY advisory payload. Stated once, here, so no call site can ship a result
 * that quietly forgets it.
 */
export const ADVISORY_NOTICE =
  "Advice only. This agent reads the grid and the price you give it, decides with " +
  "deterministic code, and explains itself. It has no execution path: it signs nothing, " +
  "sends no transaction, places no order, and holds no inventory of its own. Nothing in " +
  "this result has happened on-chain, and nothing will happen unless you act on it yourself.";

/** A malformed request. Never turned into advice — the caller has to see it. */
export class AdvisoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvisoryInputError";
  }
}

// ── input parsing ─────────────────────────────────────────────────────────────

/**
 * The WIRE schema is deliberately transform-free.
 *
 * It is published as the tool's input schema over MCP and to the LLM, so it has to
 * describe JSON exactly as JSON — a zod transform there would leak bigints into a
 * generated JSON Schema and into the value the tool handler receives. Shape validation
 * lives here; the string -> bigint conversion happens one step later, in `toBigint`, where
 * a failure can name the exact field.
 */
const amountWire = z
  .union([z.string(), z.number()])
  .describe(
    "A whole number: prices and money on the 8-decimal basis (100000000 = $1.00), " +
      "percentages in bps (10000 = 100%). Quote large values as a string so no digit is lost.",
  );

const DECIMAL_INTEGER = /^-?\d+$/;

/**
 * One wire value -> bigint, or a rejection naming the field.
 *
 * A JSON number is accepted only while it is a safe integer. A price on the 8-decimal
 * basis passes 2^53 at around $90 million, and a price that silently loses its last digit
 * decides which band the grid thinks it is in.
 */
function toBigint(raw: string | number, field: string): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new AdvisoryInputError(
        `${field}: ${raw} is not an integer. Prices and money are on the 8-decimal basis and percentages are in bps, so both are whole numbers.`,
      );
    }
    if (!Number.isSafeInteger(raw)) {
      throw new AdvisoryInputError(
        `${field}: ${raw} is beyond the range a JSON number carries exactly. Send it as a decimal string so no digit is lost.`,
      );
    }
    return BigInt(raw);
  }
  const text = raw.trim();
  if (!DECIMAL_INTEGER.test(text)) {
    throw new AdvisoryInputError(
      `${field}: "${raw}" is not a decimal integer. Prices and money are on the 8-decimal basis (100000000 = $1.00) and percentages are in bps (10000 = 100%).`,
    );
  }
  return BigInt(text);
}

const configWire = z
  .object({
    lowerBase: amountWire.describe("the grid's lower bound price, USD on the 8-decimal basis"),
    upperBase: amountWire.describe("the grid's upper bound price, USD on the 8-decimal basis"),
    levels: z
      .number()
      .int()
      .describe("the number of grid LINES; the number of intervals (and of lots) is levels - 1"),
    capitalBase: amountWire.describe("capital allocated to this grid, USD on the 8-decimal basis"),
  })
  .strict();

const stateWire = z
  .object({
    bandIndex: z.number().int().describe("the band the price was in at the PREVIOUS observation, 0..intervals-1"),
    lotsHeld: z.number().int().describe("base-asset lots currently held, 0..intervals"),
    consecutiveOutside: z
      .number()
      .int()
      .describe("how many CONSECUTIVE observations the price has been outside the breakout buffer"),
    outsideSide: z
      .union([z.literal("ABOVE"), z.literal("BELOW"), z.null()])
      .describe("the direction of the breach being counted; null while the price is inside the buffer"),
  })
  .strict();

const observationWire = z
  .object({
    priceBase: amountWire.describe("the base asset's price in the quote asset, USD on the 8-decimal basis"),
    blockNumber: amountWire.optional().describe("the block the price was read at; a provenance label"),
  })
  .strict();

const costWire = z
  .object({
    swapFeeBps: amountWire.describe("DEX pool fee in bps (PancakeSwap v3 0.05% tier = 5)"),
    slippageBps: amountWire.describe("price impact plus slippage tolerance, in bps"),
    gasCostBase: amountWire.describe("gas for ONE swap, USD on the 8-decimal basis"),
  })
  .strict();

const thresholdsWire = z
  .object({
    breakoutBufferBps: amountWire,
    breakoutConfirmObservations: z.number().int(),
    hardBreakoutBps: amountWire,
    minProfitMultipleBps: amountWire,
    maxRangeRatioBps: amountWire,
  })
  .strict();

/**
 * `.strict()` everywhere on purpose: a mistyped key (`lotsHeId`) has to be named in the
 * error, not silently dropped and then reported as a missing field somewhere else.
 *
 * `state` is REQUIRED. The grid's memory lives with whoever runs it, and a default
 * `lotsHeld: 0` would answer a question about a grid that does not exist.
 */
export const gridAdvisoryInputSchema = z
  .object({
    config: configWire,
    state: stateWire.describe("the grid's memory, as this agent returned it last time"),
    observation: observationWire,
    cost: costWire.optional().describe("omit to use this agent's default cost model"),
    thresholds: thresholdsWire.optional().describe("omit to use this agent's default thresholds"),
  })
  .strict();

/** MCP `registerTool` wants the raw shape, not the object schema. */
export const gridAdvisoryToolShape = gridAdvisoryInputSchema.shape;

export const gridFeasibilityInputSchema = z
  .object({
    config: configWire.optional().describe("omit to read only the thresholds and the cost model"),
    cost: costWire.optional(),
    thresholds: thresholdsWire.optional(),
  })
  .strict();

export const gridFeasibilityToolShape = gridFeasibilityInputSchema.shape;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

function parseConfig(config: z.infer<typeof configWire>): GridConfig {
  return {
    lowerBase: toBigint(config.lowerBase, "config.lowerBase"),
    upperBase: toBigint(config.upperBase, "config.upperBase"),
    levels: config.levels,
    capitalBase: toBigint(config.capitalBase, "config.capitalBase"),
  };
}

function parseCost(cost: z.infer<typeof costWire> | undefined): CostModel {
  if (cost === undefined) return DEFAULT_COST_MODEL;
  return {
    swapFeeBps: toBigint(cost.swapFeeBps, "cost.swapFeeBps"),
    slippageBps: toBigint(cost.slippageBps, "cost.slippageBps"),
    gasCostBase: toBigint(cost.gasCostBase, "cost.gasCostBase"),
  };
}

function parseThresholds(t: z.infer<typeof thresholdsWire> | undefined): GridThresholds {
  if (t === undefined) return DEFAULT_GRID_THRESHOLDS;
  return {
    breakoutBufferBps: toBigint(t.breakoutBufferBps, "thresholds.breakoutBufferBps"),
    breakoutConfirmObservations: t.breakoutConfirmObservations,
    hardBreakoutBps: toBigint(t.hardBreakoutBps, "thresholds.hardBreakoutBps"),
    minProfitMultipleBps: toBigint(t.minProfitMultipleBps, "thresholds.minProfitMultipleBps"),
    maxRangeRatioBps: toBigint(t.maxRangeRatioBps, "thresholds.maxRangeRatioBps"),
  };
}

/**
 * Parse an untrusted payload into the engine's arguments.
 *
 * A rejected input NEVER degrades into a default. The engine then applies its own, much
 * stricter checks (a grid that cannot turn a profit, an impossible state, a price of zero)
 * and those failures are not swallowed either.
 */
export function parseGridInput(input: unknown): {
  config: GridConfig;
  state: GridState;
  observation: GridObservation;
  cost: CostModel;
  thresholds: GridThresholds;
} {
  const parsed = gridAdvisoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdvisoryInputError(`Malformed grid request — ${formatIssues(parsed.error)}`);
  }
  const value = parsed.data;
  return {
    config: parseConfig(value.config),
    state: {
      bandIndex: value.state.bandIndex,
      lotsHeld: value.state.lotsHeld,
      consecutiveOutside: value.state.consecutiveOutside,
      outsideSide: value.state.outsideSide,
    },
    observation: {
      priceBase: toBigint(value.observation.priceBase, "observation.priceBase"),
      blockNumber:
        value.observation.blockNumber === undefined
          ? 0n
          : toBigint(value.observation.blockNumber, "observation.blockNumber"),
    },
    cost: parseCost(value.cost),
    thresholds: parseThresholds(value.thresholds),
  };
}

// ── output ────────────────────────────────────────────────────────────────────

export interface GridAdvisory {
  /** The engine's verbatim result. In-process only — bigints never go on the wire raw. */
  decision: GridDecision;
  config: GridConfig;
  cost: CostModel;
  thresholds: GridThresholds;
  /** The wire form: every number already through `strategy/format.ts`. */
  payload: Record<string, unknown>;
}

/**
 * Every threshold, formatted, with the sentence that says what it is for.
 *
 * Exposed so an LLM asked "why 2.00x?" has somewhere to read the answer instead of
 * inventing one. The full rationale lives beside the numbers in `strategy/types.ts`; these
 * are its one-line summaries.
 */
export function thresholdsPayload(
  t: GridThresholds = DEFAULT_GRID_THRESHOLDS,
  cost: CostModel = DEFAULT_COST_MODEL,
): Record<string, unknown> {
  return {
    breakoutBuffer: {
      value: formatBps(t.breakoutBufferBps),
      why:
        "How far outside the range the price must sit before a breakout is even considered. A price " +
        "that pierces the bound by a unit or two is a candle wick in thin liquidity or one bad oracle " +
        "read, and tearing the grid down for that pays gas out and back in to end up where you started.",
    },
    breakoutConfirmObservations: {
      value: `${t.breakoutConfirmObservations} consecutive observations`,
      why:
        "A single observation outside the bound is indistinguishable from stale RPC data. This demands " +
        "the price STAY outside. Its meaning depends entirely on the keeper's cadence, which this " +
        "strategy does not know: three observations is three minutes at a one-minute cadence and three " +
        "hours at an hourly one, so whoever sets the schedule must set this number with it.",
    },
    hardBreakout: {
      value: formatBps(t.hardBreakoutBps),
      why:
        "Far enough out that the price can no longer be called a wick, so the confirmation wait is " +
        "skipped entirely. A last-resort catch, not a normal rule.",
    },
    minProfitMultiple: {
      value: `${t.minProfitMultipleBps / BPS_ONE}.${(t.minProfitMultipleBps % BPS_ONE) / 100n}x`,
      why:
        "The line-to-line spacing must exceed the cost of one buy-then-sell round trip by this " +
        "multiple, or every 'successful' round trip loses money. 1.00x is a break-even grid: a busy " +
        "machine paying costs while carrying inventory risk. This multiple leaves half the gross " +
        "spread as profit. A grid that fails this check is REJECTED, not run and then quietly " +
        "loss-making — that failure does not look like a failure until the capital is gone.",
    },
    maxRangeRatio: {
      value: `${t.maxRangeRatioBps / BPS_ONE}x`,
      why:
        "This grid is ARITHMETIC: its lines are evenly spaced in dollars, so the percentage spacing is " +
        "widest at the lower bound and narrowest at the upper, and the ratio between those extremes IS " +
        "the range ratio. A geometric grid avoids this, but it needs an nth root that bigint cannot " +
        "compute exactly, and float error would sit directly on the price path that decides trades.",
    },
    costModel: {
      swapFee: formatBps(cost.swapFeeBps),
      slippage: formatBps(cost.slippageBps),
      gasPerSwap: formatUsd8(cost.gasCostBase),
      why:
        "Estimates, not measurements. The chain layer must replace all three with real numbers before " +
        "they decide about money; they exist so tests and backtests have a sane starting point.",
    },
  };
}

/**
 * Can this grid make money at all — and if not, exactly which number stops it.
 *
 * This is the most valuable "do not do it" answer the Grid can give, so it does NOT come
 * back as a thrown error: `profitable: false` with the two numbers that disagree is
 * readable, and a caller can widen the range or add capital from it. `decide` refuses such
 * a config outright, which is correct there — this tool is where you find out first.
 *
 * Adding levels without adding capital is the trap it catches: every lot shrinks, gas per
 * lot stays the same, and the round-trip cost swells past the spacing.
 */
export function feasibilityPayload(
  config: GridConfig,
  cost: CostModel,
  t: GridThresholds,
): Record<string, unknown> {
  const intervals = intervalsOf(config);
  if (intervals < 1 || config.upperBase <= config.lowerBase || config.lowerBase <= 0n) {
    throw new GridError(
      `A grid from ${config.lowerBase} to ${config.upperBase} with ${config.levels} lines is not a grid: ` +
        `it needs a positive lower bound, an upper bound above it, and at least 3 lines.`,
    );
  }
  const lot = lotValueBase(config);
  const spacing = minStepBps(config);
  const rangeRatioBps = (config.upperBase * BPS_ONE) / config.lowerBase;
  const rangeWithinLimit = config.upperBase * BPS_ONE <= config.lowerBase * t.maxRangeRatioBps;

  if (lot <= 0n) {
    return {
      profitable: false,
      blockingReason:
        `The lot value rounds to zero: ${formatUsd8(config.capitalBase)} of capital split across ` +
        `${intervals} intervals leaves nothing per lot. Add capital or use fewer levels.`,
      grid: { intervals, lotValue: formatUsd8(0n) },
    };
  }

  const roundTrip = roundTripCostBps(lot, cost);
  const required = minProfitableStepBps(lot, cost, t.minProfitMultipleBps);
  const profitable = spacing >= required && rangeWithinLimit;

  return {
    profitable,
    blockingReason: profitable
      ? null
      : !rangeWithinLimit
        ? `The range ratio is ${rangeRatioBps / BPS_ONE}.${(rangeRatioBps % BPS_ONE) / 100n}x, beyond the ` +
          `${t.maxRangeRatioBps / BPS_ONE}x limit. On an arithmetic grid that ratio is exactly how much ` +
          `wider the percentage spacing is at the bottom than at the top, and the profitability check ` +
          `uses the narrowest spacing.`
        : `The narrowest line-to-line spacing is ${formatBps(spacing)}, while one buy-then-sell round trip ` +
          `costs ${formatBps(roundTrip)} and this agent requires ${formatBps(required)} to leave a margin. ` +
          `Every round trip on this grid would lose money. Reduce the level count, widen the range, or add capital.`,
    grid: {
      lowerBound: formatPriceUsd8(config.lowerBase),
      upperBound: formatPriceUsd8(config.upperBase),
      lines: config.levels,
      intervals,
      dollarSpacing: formatPriceUsd8(stepBase(config)),
      // The NARROWEST spacing, at the upper bound — the thinnest-margin round trip there is.
      narrowestSpacing: formatBps(spacing),
      lotValue: formatUsd8(lot),
      capital: formatUsd8(config.capitalBase),
      linePrices: Array.from({ length: config.levels }, (_, i) =>
        formatPriceUsd8(levelPriceBase(config, i)),
      ),
    },
    economics: {
      roundTripCost: formatBps(roundTrip),
      requiredSpacing: formatBps(required),
      spacingCoversRoundTrip: spacing >= required,
      why:
        "Gas goes INTO the round-trip cost, divided by the lot value. That is why adding levels without " +
        "adding capital is dangerous: every lot shrinks, gas per lot does not, and the cost swells past " +
        "the spacing.",
    },
    /**
     * Where a caller starts if they decide to run this grid. Offered, not stored: this agent
     * keeps no memory and runs nothing.
     */
    suggestedInitialState: { bandIndex: 0, lotsHeld: 0, consecutiveOutside: 0, outsideSide: null },
  };
}

/**
 * The wire payload. Raw bigints stay behind: `formatUsd8` / `formatPriceUsd8` / `formatBps`
 * from `strategy/format.ts` are the single source of truth for how a number reads, so the
 * sentence in `decision.reason` and the fields beside it can never disagree.
 */
export function gridAdvisoryPayload(
  decision: GridDecision,
  config: GridConfig,
  observation: GridObservation,
  cost: CostModel,
  t: GridThresholds,
): Record<string, unknown> {
  const lot = lotValueBase(config);
  const intervals = intervalsOf(config);
  const isExit = decision.action === "EXIT_ABOVE" || decision.action === "EXIT_BELOW";
  return {
    kind: "advisory",
    agent: "fugugrid",
    advisoryOnly: true,
    /** Mirrors this agent's on-chain listing metadata. It is false there and false here. */
    onchainExecution: false,
    executionPerformed: false,
    notice: ADVISORY_NOTICE,
    recommendedAction: decision.action,
    reasoning: decision.reason,
    price: formatPriceUsd8(observation.priceBase),
    band: {
      index: decision.bandIndex,
      of: intervals,
      lowerBound: formatPriceUsd8(config.lowerBase),
      upperBound: formatPriceUsd8(config.upperBase),
    },
    economics: {
      lotValue: formatUsd8(lot),
      narrowestSpacing: formatBps(decision.minStepBps),
      roundTripCost: formatBps(decision.roundTripCostBps),
      requiredSpacing: formatBps(minProfitableStepBps(lot, cost, t.minProfitMultipleBps)),
      // Always true by the time a decision exists: `decide` refuses a grid that fails it.
      // Reported anyway so the margin is visible rather than assumed.
      spacingCoversRoundTrip: decision.minStepBps >= minProfitableStepBps(lot, cost, t.minProfitMultipleBps),
    },
    /**
     * SUGGESTED. `lotsCapped` is its own field because "we wanted 3 lots and only 1 was
     * possible" is a different answer from "1 lot was the right size", and a caller acting
     * on the second when the first is true will keep expecting fills that cannot come.
     */
    suggestedTrade: {
      lots: decision.lots,
      notional: formatUsd8(decision.notionalBase),
      lotsCapped: decision.lotsCapped,
      unwindsEntireInventory: isExit,
    },
    breakoutWatch: {
      status: decision.breakout,
      observationsOutside: decision.nextState.consecutiveOutside,
      observationsToConfirm: t.breakoutConfirmObservations,
      side: decision.nextState.outsideSide,
    },
    /**
     * The state that WOULD follow if the recommended action were carried out. This agent
     * does not carry it out, so only a caller who actually acts should persist it —
     * persisting it without trading would leave the grid believing it holds lots it does not.
     */
    nextStateIfActedOn: decision.nextState,
    thresholds: thresholdsPayload(t, cost),
  };
}

/**
 * Read a grid, a state and a price; decide; explain. Throws `AdvisoryInputError` on a
 * malformed request and `GridError` (from the engine) on one that parses but makes no
 * sense — a grid that cannot turn a profit, a `lotsHeld` outside 0..intervals, a breach
 * counted with no direction, a price of zero. Neither is swallowed: bad input has to come
 * back as an error, never as advice.
 */
export function adviseGrid(input: unknown): GridAdvisory {
  const { config, state, observation, cost, thresholds } = parseGridInput(input);
  const decision = decide(config, state, observation, cost, thresholds);
  return {
    decision,
    config,
    cost,
    thresholds,
    payload: gridAdvisoryPayload(decision, config, observation, cost, thresholds),
  };
}

/**
 * The A2A dispatch form: never throws, because an A2A caller with a bad payload needs to
 * READ what was wrong with it. A malformed request is a business outcome (the caller's
 * mistake), not an internal fault, so it comes back as a result carrying the engine's own
 * error message verbatim — the message is the value.
 */
export function gridAdvisorySkill(data: unknown): Record<string, unknown> {
  try {
    return adviseGrid(stripSkillKey(data)).payload;
  } catch (e) {
    return rejection(e);
  }
}

export function gridFeasibilitySkill(data: unknown): Record<string, unknown> {
  try {
    const parsed = gridFeasibilityInputSchema.safeParse(stripSkillKey(data));
    if (!parsed.success) {
      throw new AdvisoryInputError(`Malformed feasibility request — ${formatIssues(parsed.error)}`);
    }
    const cost = parseCost(parsed.data.cost);
    const thresholds = parseThresholds(parsed.data.thresholds);
    return {
      kind: "reference",
      agent: "fugugrid",
      advisoryOnly: true,
      onchainExecution: false,
      executionPerformed: false,
      notice: ADVISORY_NOTICE,
      ...(parsed.data.config === undefined
        ? {}
        : feasibilityPayload(parseConfig(parsed.data.config), cost, thresholds)),
      thresholds: thresholdsPayload(thresholds, cost),
    };
  } catch (e) {
    return rejection(e);
  }
}

/** The A2A envelope carries `skill`; the schemas are `.strict()` and would reject it. */
function stripSkillKey(data: unknown): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
  const { skill: _skill, ...rest } = data as Record<string, unknown>;
  return rest;
}

/**
 * A rejection keeps the message and says which layer refused. `AdvisoryInputError` means
 * the shape was wrong; `GridError` means the shape was fine and the grid was not. Those are
 * different problems for the caller to fix, so they are labelled apart.
 */
function rejection(e: unknown): Record<string, unknown> {
  const known = e instanceof AdvisoryInputError || e instanceof GridError;
  return {
    status: "rejected",
    kind: "error",
    advisoryOnly: true,
    onchainExecution: false,
    executionPerformed: false,
    errorKind: known ? (e as Error).name : "UnexpectedError",
    error: known
      ? (e as Error).message
      : "The request could not be evaluated. No advice was produced.",
  };
}
