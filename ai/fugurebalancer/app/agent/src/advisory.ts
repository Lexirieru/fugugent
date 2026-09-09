/**
 * The RUNTIME layer between the outside world and the pure Rebalancer decision engine.
 *
 * `src/strategy/` is pure — no network, no clock, no `process.env`. This module is the
 * only place where an untrusted JSON payload (an A2A DataPart, an MCP tool argument, an
 * LLM tool call) is turned into the engine's domain types, and where the engine's
 * bigint result is turned back into text a human or an LLM may read. The engine itself
 * is never handed a string and never asked to format one.
 *
 * ## This agent gives ADVICE. It does not act.
 *
 * The Rebalancer has NO execution path: no DEX adapter, no session-key signer, no
 * transaction builder. Its on-chain metadata says so (`onchainExecution: false`) and so
 * does `docs/STATUS.md`. Every payload built here repeats it, because an agent that
 * takes money and lets a caller believe it is trading is the exact lie that cost Giza
 * and ARMA their credibility. The words in this file are load-bearing: `recommendedAction`,
 * `suggestedTrades`, `nextStateIfActedOn`. Nothing here reports a transaction, because
 * there is none.
 *
 * ## The LLM never decides
 *
 * The numbers below come from `decide()` — deterministic, replayable, backtestable code.
 * An LLM may call these tools and read the sentences out loud. It may not choose an
 * action, move a threshold, or recompute an amount. Rule number one of the project.
 */
import { z } from "zod";
import { decide } from "./strategy/decide.js";
import { formatBps, formatUsd8, formatWeight } from "./strategy/format.js";
import { minEconomicTurnoverBase } from "./strategy/weights.js";
import {
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  type CostModel,
  type Portfolio,
  type RebalanceDecision,
  type RebalanceThresholds,
} from "./strategy/types.js";

/** The A2A skill id / MCP tool name for the advisory, and for the threshold reference. */
export const REBALANCE_ADVISORY_SKILL = "rebalance_advisory";
export const REBALANCE_THRESHOLDS_SKILL = "rebalance_thresholds";
export const ADVISORY_SKILL_IDS = [
  REBALANCE_ADVISORY_SKILL,
  REBALANCE_THRESHOLDS_SKILL,
] as const;

/**
 * Carried by EVERY advisory payload. Stated once, here, so no call site can ship a
 * result that quietly forgets it.
 */
export const ADVISORY_NOTICE =
  "Advice only. This agent reads the portfolio you give it, decides with deterministic " +
  "code, and explains itself. It has no execution path: it signs nothing, sends no " +
  "transaction, places no order, and moves no funds. Nothing in this result has happened " +
  "on-chain, and nothing will happen unless you act on it yourself.";

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
 * lives here; the string -> bigint conversion happens one step later, in `toBigint`,
 * where a failure can name the exact field.
 */
const amountWire = z
  .union([z.string(), z.number()])
  .describe(
    "A whole number: money on the 8-decimal basis (100000000 = $1.00), percentages in bps " +
      "(10000 = 100%). Quote large values as a string so no digit is lost.",
  );

const DECIMAL_INTEGER = /^-?\d+$/;

/**
 * One wire value -> bigint, or a rejection naming the field.
 *
 * A JSON number is accepted only while it is a safe integer. `9007199254740993` parses to
 * `...992` as a double, and one wrong unit on the 8-decimal basis is how a rounding gate
 * opens for the wrong reason. Past that boundary the caller is told to quote the value
 * instead of being served a silently corrupted answer.
 */
function toBigint(raw: string | number, field: string): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new AdvisoryInputError(
        `${field}: ${raw} is not an integer. Money is on the 8-decimal basis and percentages are in bps, so both are whole numbers.`,
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
      `${field}: "${raw}" is not a decimal integer. Money is on the 8-decimal basis (100000000 = $1.00) and percentages are in bps (10000 = 100%).`,
    );
  }
  return BigInt(text);
}

const assetWire = z
  .object({
    symbol: z.string().min(1).describe("token symbol, e.g. BNB"),
    valueBase: amountWire.describe("current position value in USD, 8-decimal basis"),
    targetWeightBps: amountWire.describe("target weight in bps; the sum across assets must be exactly 10000"),
  })
  .strict();

const costWire = z
  .object({
    swapFeeBps: amountWire.describe("DEX pool fee in bps (PancakeSwap v3 0.05% tier = 5)"),
    slippageBps: amountWire.describe("price impact plus slippage tolerance, in bps"),
    gasCostBase: amountWire.describe("gas for the whole rebalance sequence, USD on the 8-decimal basis"),
  })
  .strict();

const thresholdsWire = z
  .object({
    watchBandBps: amountWire,
    rebalanceBandBps: amountWire,
    maxRebalanceCostBps: amountWire,
  })
  .strict();

/**
 * `.strict()` everywhere on purpose: a mistyped key (`targetWeightBp`) has to be named in
 * the error, not silently dropped and then reported as a missing field somewhere else.
 */
export const rebalanceAdvisoryInputSchema = z
  .object({
    account: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/, "account must be a 0x-prefixed 20-byte address")
      .optional()
      .describe("the account the portfolio belongs to; a provenance label, not used in the maths"),
    blockNumber: amountWire.optional().describe("the block the values were read at; a provenance label"),
    assets: z
      .array(assetWire)
      .min(1)
      .describe("every position in the portfolio; rebalancing needs at least 2"),
    cost: costWire.optional().describe("omit to use this agent's default cost model"),
    thresholds: thresholdsWire.optional().describe("omit to use this agent's default thresholds"),
  })
  .strict();

/** MCP `registerTool` wants the raw shape, not the object schema. */
export const rebalanceAdvisoryToolShape = rebalanceAdvisoryInputSchema.shape;

export const thresholdsRequestSchema = z
  .object({ cost: costWire.optional(), thresholds: thresholdsWire.optional() })
  .strict();

const ZERO_ACCOUNT = "0x0000000000000000000000000000000000000000" as const;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Parse an untrusted payload into a `Portfolio` + the cost model + thresholds.
 *
 * A rejected input NEVER degrades into a default. Guessing an omitted asset value, or
 * dropping an asset whose weight failed to parse, would produce advice about a portfolio
 * nobody owns — worse than an error, because it looks like an answer.
 */
export function parseRebalanceInput(input: unknown): {
  portfolio: Portfolio;
  cost: CostModel;
  thresholds: RebalanceThresholds;
} {
  const parsed = rebalanceAdvisoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdvisoryInputError(`Malformed rebalance request — ${formatIssues(parsed.error)}`);
  }
  const value = parsed.data;
  return {
    portfolio: {
      // The account and block number are provenance labels: `decide` does not read them,
      // and the advisory does not need a real address to compute weights. They default so
      // a caller can ask "what would you do with these weights" without inventing one.
      account: (value.account ?? ZERO_ACCOUNT) as `0x${string}`,
      assets: value.assets.map((a, i) => ({
        symbol: a.symbol,
        valueBase: toBigint(a.valueBase, `assets[${i}].valueBase`),
        targetWeightBps: toBigint(a.targetWeightBps, `assets[${i}].targetWeightBps`),
      })),
      blockNumber: value.blockNumber === undefined ? 0n : toBigint(value.blockNumber, "blockNumber"),
    },
    cost: parseCost(value.cost),
    thresholds: parseThresholds(value.thresholds),
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

function parseThresholds(
  t: z.infer<typeof thresholdsWire> | undefined,
): RebalanceThresholds {
  if (t === undefined) return DEFAULT_THRESHOLDS;
  return {
    watchBandBps: toBigint(t.watchBandBps, "thresholds.watchBandBps"),
    rebalanceBandBps: toBigint(t.rebalanceBandBps, "thresholds.rebalanceBandBps"),
    maxRebalanceCostBps: toBigint(t.maxRebalanceCostBps, "thresholds.maxRebalanceCostBps"),
  };
}

// ── output ────────────────────────────────────────────────────────────────────

export interface RebalanceAdvisory {
  /** The engine's verbatim result. In-process only — bigints never go on the wire raw. */
  decision: RebalanceDecision;
  cost: CostModel;
  thresholds: RebalanceThresholds;
  /** The wire form: every number already through `strategy/format.ts`. */
  payload: Record<string, unknown>;
}

/**
 * Every threshold, formatted, with the sentence that says what it is for.
 *
 * Exposed as its own tool so an LLM asked "why 50 bps?" has somewhere to read the answer
 * instead of inventing one. The rationale text lives beside the numbers in
 * `strategy/types.ts`; these are its one-line summaries.
 */
export function thresholdsPayload(
  thresholds: RebalanceThresholds = DEFAULT_THRESHOLDS,
  cost: CostModel = DEFAULT_COST_MODEL,
): Record<string, unknown> {
  const minTurnover = minEconomicTurnoverBase(cost, thresholds.maxRebalanceCostBps);
  return {
    watchBand: {
      value: formatBps(thresholds.watchBandBps),
      why: "One warning level before anything is spent. No money moves because of this number.",
    },
    rebalanceBand: {
      value: formatBps(thresholds.rebalanceBandBps),
      why:
        "A rebalance is only considered once the largest absolute weight deviation reaches this band. " +
        "The 5% tolerance band is where most of the risk-control benefit is already captured while trade " +
        "frequency drops sharply. Calibrated for stock/bond portfolios, so it is touched far more often on " +
        "crypto pairs and must be re-tested with the backtest before it decides about money.",
    },
    costBudget: {
      value: formatBps(thresholds.maxRebalanceCostBps),
      why:
        "The cost of one rebalance, measured against the value being moved. The rebalancing benefit in the " +
        "literature is tens of bps per YEAR, so paying more than this in one rebalance spends several years " +
        "of that benefit at once.",
    },
    costModel: {
      swapFee: formatBps(cost.swapFeeBps),
      slippage: formatBps(cost.slippageBps),
      gas: formatUsd8(cost.gasCostBase),
      why:
        "Estimates, not measurements. The chain layer must replace all three with real numbers before they " +
        "decide about money; they exist so tests and backtests have a sane starting point.",
    },
    smallestEconomicTrade: {
      value: minTurnover === null ? null : formatUsd8(minTurnover),
      why:
        "Derived, not chosen: with proportional cost r and gas g, turnover T costs r + g x 10000/T bps, so the " +
        "budget M is only reachable from T >= g x 10000/(M - r). Below this size no rebalance can clear the cost gate.",
    },
  };
}

/**
 * The wire payload. Raw bigints stay behind: `formatUsd8` / `formatBps` / `formatWeight`
 * from `strategy/format.ts` are the single source of truth for how a number reads, so the
 * sentence in `decision.reason` and the fields beside it can never disagree.
 */
export function rebalanceAdvisoryPayload(
  decision: RebalanceDecision,
  cost: CostModel,
  thresholds: RebalanceThresholds,
): Record<string, unknown> {
  return {
    kind: "advisory",
    agent: "fugurebalancer",
    advisoryOnly: true,
    /** Mirrors this agent's on-chain listing metadata. It is false there and false here. */
    onchainExecution: false,
    executionPerformed: false,
    notice: ADVISORY_NOTICE,
    recommendedAction: decision.action,
    reasoning: decision.reason,
    portfolio: {
      totalValue: formatUsd8(decision.totalValueBase),
      largestWeightDeviation: formatWeight(decision.maxDeviationBps),
      rebalanceBand: formatBps(thresholds.rebalanceBandBps),
    },
    economics: {
      valueThatWouldMove: formatUsd8(decision.turnoverBase),
      estimatedCost: formatUsd8(decision.estimatedCostBase),
      estimatedCostOfValueMoved:
        decision.turnoverBase > 0n ? formatBps(decision.estimatedCostBps) : null,
      costBudget: formatBps(thresholds.maxRebalanceCostBps),
      // The valuable answer this strategy can give is "no": a deviation past the band that
      // still is not worth fixing. It gets its own boolean so a caller cannot miss it.
      costGateBlocks: decision.action === "BLOCKED_BY_COST",
    },
    /**
     * SUGGESTED. Empty unless the deviation gate AND the cost gate both open — and empty
     * even then in the eyes of the chain, because this agent has no way to place them.
     */
    suggestedTrades: decision.trades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      value: formatUsd8(t.valueBase),
    })),
    thresholds: thresholdsPayload(thresholds, cost),
  };
}

/**
 * Read a portfolio, decide, explain. Throws `AdvisoryInputError` on a malformed request
 * and `PortfolioError` (from the engine) on one that parses but makes no sense — target
 * weights that do not sum to 10,000 bps, a duplicated symbol, a portfolio worth zero.
 * Neither is swallowed: bad input has to come back as an error, never as advice.
 */
export function adviseRebalance(input: unknown): RebalanceAdvisory {
  const { portfolio, cost, thresholds } = parseRebalanceInput(input);
  const decision = decide(portfolio, cost, thresholds);
  return {
    decision,
    cost,
    thresholds,
    payload: rebalanceAdvisoryPayload(decision, cost, thresholds),
  };
}

/**
 * The A2A dispatch form: never throws, because an A2A caller with a bad payload needs to
 * READ what was wrong with it. A malformed request is a business outcome (the caller's
 * mistake), not an internal fault, so it comes back as a result carrying the engine's own
 * error message verbatim — the message is the value.
 */
export function rebalanceAdvisorySkill(data: unknown): Record<string, unknown> {
  try {
    return adviseRebalance(stripSkillKey(data)).payload;
  } catch (e) {
    return rejection(e);
  }
}

export function rebalanceThresholdsSkill(data: unknown): Record<string, unknown> {
  try {
    const raw = stripSkillKey(data);
    const parsed = thresholdsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AdvisoryInputError(`Malformed thresholds request — ${formatIssues(parsed.error)}`);
    }
    return {
      kind: "reference",
      agent: "fugurebalancer",
      advisoryOnly: true,
      onchainExecution: false,
      executionPerformed: false,
      notice: ADVISORY_NOTICE,
      thresholds: thresholdsPayload(
        parseThresholds(parsed.data.thresholds),
        parseCost(parsed.data.cost),
      ),
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
 * the shape was wrong; `PortfolioError` means the shape was fine and the portfolio was
 * not. Those are different problems for the caller to fix, so they are labelled apart.
 */
function rejection(e: unknown): Record<string, unknown> {
  const known = e instanceof AdvisoryInputError || e instanceof PortfolioError;
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
