/**
 * The RUNTIME layer between the outside world and the pure Yield decision engine.
 *
 * `src/strategy/` is pure — no network, no clock, no `process.env`. This module is the only
 * place where an untrusted JSON payload (an A2A DataPart, an MCP tool argument, an LLM tool
 * call) is turned into the engine's domain types, and where the engine's bigint result is
 * turned back into text a human or an LLM may read.
 *
 * The clock stays outside on purpose. `apyAgeSeconds` arrives as data rather than being
 * computed here from `Date.now()`, so a decision can be replayed exactly and backtested.
 * This module does not read the clock either — it only carries the number through.
 *
 * ## This agent gives ADVICE. It does not act.
 *
 * The Yield agent has NO execution path: no protocol adapter, no session-key signer, no
 * withdraw/swap/deposit sequence. Its on-chain metadata says so (`onchainExecution: false`)
 * and so does `docs/STATUS.md`. Every payload built here repeats it, because an agent that
 * takes money and lets a caller believe it moved their principal is the exact lie that cost
 * Giza and ARMA their credibility.
 *
 * ## The LLM never decides
 *
 * Every number below comes from `decide()` — deterministic, replayable, backtested code. An
 * LLM may call these tools and read the result out loud. It may not choose an action, shift
 * a threshold, or recompute a spread. Rule number one of the project.
 */
import { z } from "zod";
import {
  breakEvenSpreadBps,
  poolShareBps,
  requiredSpreadBps,
  switchCostBase,
} from "./strategy/apy.js";
import { decide } from "./strategy/decide.js";
import { formatApyBps, formatBps, formatUsd8 } from "./strategy/format.js";
import {
  BPS_ONE,
  DEFAULT_SWITCH_COST,
  DEFAULT_YIELD_THRESHOLDS,
  YieldError,
  type Pool,
  type RejectReason,
  type SwitchCostModel,
  type YieldDecision,
  type YieldObservation,
  type YieldThresholds,
} from "./strategy/types.js";

/** The A2A skill ids / MCP tool names. */
export const YIELD_ADVISORY_SKILL = "yield_advisory";
export const YIELD_BREAKEVEN_SKILL = "yield_breakeven";
export const ADVISORY_SKILL_IDS = [YIELD_ADVISORY_SKILL, YIELD_BREAKEVEN_SKILL] as const;

/**
 * Carried by EVERY advisory payload. Stated once, here, so no call site can ship a result
 * that quietly forgets it.
 */
export const ADVISORY_NOTICE =
  "Advice only. This agent reads the position and the pools you give it, decides with " +
  "deterministic code, and explains itself. It has no execution path: it signs nothing, " +
  "sends no transaction, withdraws nothing, deposits nothing, and holds no funds. Nothing " +
  "in this result has happened on-chain, and nothing will happen unless you act on it yourself.";

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
 * It is published as the tool's input schema over MCP and to the LLM, so it has to describe
 * JSON exactly as JSON — a zod transform there would leak bigints into a generated JSON
 * Schema and into the value the tool handler receives. Shape validation lives here; the
 * string -> bigint conversion happens one step later, in `toBigint`, where a failure can
 * name the exact field.
 */
const amountWire = z
  .union([z.string(), z.number()])
  .describe(
    "A whole number: money on the 8-decimal basis (100000000 = $1.00), APY and percentages " +
      "in bps (500 = 5.00% per year). Quote large values as a string so no digit is lost.",
  );

const DECIMAL_INTEGER = /^-?\d+$/;

/**
 * One wire value -> bigint, or a rejection naming the field.
 *
 * A JSON number is accepted only while it is a safe integer. A TVL on the 8-decimal basis
 * passes 2^53 at around $90 million — well inside the range of real pools — and a TVL that
 * silently loses its last digit feeds straight into the pool-share gate.
 */
function toBigint(raw: string | number, field: string): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new AdvisoryInputError(
        `${field}: ${raw} is not an integer. Money is on the 8-decimal basis and APY is in bps, so both are whole numbers.`,
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
      `${field}: "${raw}" is not a decimal integer. Money is on the 8-decimal basis (100000000 = $1.00) and APY is in bps (500 = 5.00%).`,
    );
  }
  return BigInt(text);
}

const poolWire = z
  .object({
    poolId: z.string().min(1),
    protocol: z.string().min(1),
    apyBps: amountWire.describe("APY in bps: 500 = 5.00% per year"),
    tvlBase: amountWire.describe("the pool's total value locked, USD on the 8-decimal basis"),
    riskScore: z
      .number()
      .int()
      .describe(
        "0..100, from OUR OWN allowlist and research. This agent does not compute it and does " +
          "not pretend it could: protocol risk is a human judgement that arrives here as data.",
      ),
    isActive: z.boolean().describe("false when the pool is paused, shut down or deprecated"),
    apyAgeSeconds: z
      .number()
      .int()
      .describe("the age of the APY reading in seconds AT THE MOMENT the observation was taken"),
  })
  .strict();

const costWire = z
  .object({
    swapFeeBps: amountWire.describe("DEX pool fee in bps for the swap leg of a migration"),
    slippageBps: amountWire.describe("price impact plus slippage tolerance, in bps"),
    gasCostBase: amountWire.describe(
      "gas for the WHOLE migration sequence (withdraw, swap, deposit), USD on the 8-decimal basis",
    ),
  })
  .strict();

const thresholdsWire = z
  .object({
    expectedHoldingDays: amountWire,
    spreadSafetyMultipleBps: amountWire,
    maxPoolShareBps: amountWire,
    maxPlausibleApyBps: amountWire,
    maxRiskScore: z.number().int(),
    maxApyAgeSeconds: z.number().int(),
    minConsecutiveFavorable: z.number().int(),
  })
  .strict();

/**
 * `.strict()` everywhere on purpose: a mistyped key (`apyBp`) has to be named in the error,
 * not silently dropped and then reported as a missing field somewhere else.
 *
 * `consecutiveFavorable` is REQUIRED. The count is the scheduler's memory, not this agent's,
 * and defaulting it to zero would silently answer "the spread has not persisted" for a
 * caller who has been watching it persist for a week.
 */
export const yieldAdvisoryInputSchema = z
  .object({
    position: z
      .object({
        principalBase: amountWire.describe("the principal under management, USD on the 8-decimal basis"),
        current: poolWire.describe("the pool the principal sits in right now"),
      })
      .strict(),
    candidates: z
      .array(poolWire)
      .describe("alternative pools; one identical to the current position is ignored"),
    consecutiveFavorable: z
      .number()
      .int()
      .describe(
        "how many CONSECUTIVE observations the same best candidate has met the spread threshold. " +
          "Counted by YOU, the caller: increment when the previous reply had spreadQualifies true " +
          "AND the same targetPoolId, otherwise reset to zero.",
      ),
    blockNumber: amountWire.optional().describe("the block the readings came from; a provenance label"),
    cost: costWire.optional().describe("omit to use this agent's default cost model"),
    thresholds: thresholdsWire.optional().describe("omit to use this agent's default thresholds"),
  })
  .strict();

/** MCP `registerTool` wants the raw shape, not the object schema. */
export const yieldAdvisoryToolShape = yieldAdvisoryInputSchema.shape;

export const yieldBreakevenInputSchema = z
  .object({
    principalBase: amountWire
      .optional()
      .describe("omit to read only the thresholds — the break-even spread has no meaning without a principal"),
    cost: costWire.optional(),
    thresholds: thresholdsWire.optional(),
  })
  .strict();

export const yieldBreakevenToolShape = yieldBreakevenInputSchema.shape;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

function parsePool(pool: z.infer<typeof poolWire>, field: string): Pool {
  return {
    poolId: pool.poolId,
    protocol: pool.protocol,
    apyBps: toBigint(pool.apyBps, `${field}.apyBps`),
    tvlBase: toBigint(pool.tvlBase, `${field}.tvlBase`),
    riskScore: pool.riskScore,
    isActive: pool.isActive,
    apyAgeSeconds: pool.apyAgeSeconds,
  };
}

function parseCost(cost: z.infer<typeof costWire> | undefined): SwitchCostModel {
  if (cost === undefined) return DEFAULT_SWITCH_COST;
  return {
    swapFeeBps: toBigint(cost.swapFeeBps, "cost.swapFeeBps"),
    slippageBps: toBigint(cost.slippageBps, "cost.slippageBps"),
    gasCostBase: toBigint(cost.gasCostBase, "cost.gasCostBase"),
  };
}

function parseThresholds(t: z.infer<typeof thresholdsWire> | undefined): YieldThresholds {
  if (t === undefined) return DEFAULT_YIELD_THRESHOLDS;
  return {
    expectedHoldingDays: toBigint(t.expectedHoldingDays, "thresholds.expectedHoldingDays"),
    spreadSafetyMultipleBps: toBigint(t.spreadSafetyMultipleBps, "thresholds.spreadSafetyMultipleBps"),
    maxPoolShareBps: toBigint(t.maxPoolShareBps, "thresholds.maxPoolShareBps"),
    maxPlausibleApyBps: toBigint(t.maxPlausibleApyBps, "thresholds.maxPlausibleApyBps"),
    maxRiskScore: t.maxRiskScore,
    maxApyAgeSeconds: t.maxApyAgeSeconds,
    minConsecutiveFavorable: t.minConsecutiveFavorable,
  };
}

/**
 * Parse an untrusted payload into the engine's arguments.
 *
 * A rejected input NEVER degrades into a default. The engine then applies its own, much
 * stricter checks (a `riskScore` of 200 is a broken reading, not a very risky pool; a
 * duplicated candidate id makes the best choice ambiguous) and those failures are not
 * swallowed either.
 */
export function parseYieldInput(input: unknown): {
  observation: YieldObservation;
  cost: SwitchCostModel;
  thresholds: YieldThresholds;
} {
  const parsed = yieldAdvisoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdvisoryInputError(`Malformed yield request — ${formatIssues(parsed.error)}`);
  }
  const value = parsed.data;
  return {
    observation: {
      position: {
        principalBase: toBigint(value.position.principalBase, "position.principalBase"),
        current: parsePool(value.position.current, "position.current"),
      },
      candidates: value.candidates.map((c, i) => parsePool(c, `candidates[${i}]`)),
      consecutiveFavorable: value.consecutiveFavorable,
      blockNumber: value.blockNumber === undefined ? 0n : toBigint(value.blockNumber, "blockNumber"),
    },
    cost: parseCost(value.cost),
    thresholds: parseThresholds(value.thresholds),
  };
}

// ── output ────────────────────────────────────────────────────────────────────

export interface YieldAdvisory {
  /** The engine's verbatim result. In-process only — bigints never go on the wire raw. */
  decision: YieldDecision;
  observation: YieldObservation;
  cost: SwitchCostModel;
  thresholds: YieldThresholds;
  /** The wire form: every number already through `strategy/format.ts`. */
  payload: Record<string, unknown>;
}

/**
 * What each rejection code MEANS, so a caller reading "POOL_SHARE" does not have to guess.
 *
 * These sentences are the risk gates stated in plain words. They run BEFORE any APY is
 * compared, which is the point: a high APY can never buy leniency on risk.
 */
const REJECTION_MEANING: Record<RejectReason, string> = {
  SAME_POOL: "This is the pool the principal already sits in, so it is not an alternative.",
  INACTIVE: "The pool is paused, shut down, or marked deprecated by its protocol.",
  RISK_SCORE: "Its risk score from our own research is above the limit this agent will accept.",
  POOL_SHARE:
    "The principal would be too large a share of this pool. The highest APY is usually in the " +
    "smallest pool, and that is no coincidence: deposit into a pool you dominate and the APY you " +
    "were chasing becomes a reflection of your own capital, with no exit liquidity but yourself.",
  IMPLAUSIBLE_APY:
    "The APY is above what any sustainable pool pays. That is almost always unsustainable reward " +
    "emissions, a decimals bug in an indexer, or bait — rejecting it as broken data is more correct " +
    "than chasing it.",
  STALE_DATA:
    "The APY reading is too old to act on. A lending market's APY moves with utilization, which " +
    "changes every block.",
};

/**
 * The thresholds, formatted, with the sentence that says what each is for — and, when a
 * principal is given, the DERIVED spread that actually decides a migration.
 *
 * That derivation is the most useful thing this agent knows, and it is not a magic number:
 * the migration cost is paid once and the spread is earned per day, so
 * `spread = cost x 10000 x 365 / (principal x days)`. It is therefore INVERSELY proportional
 * to both the principal and the horizon — moving $200 needs a spread tens of times larger
 * than moving $200,000. "Chase the highest APY" is not a strategy; it is not even a
 * well-formed question until you say how much money and for how long.
 */
export function breakevenPayload(
  principalBase: bigint | null,
  cost: SwitchCostModel,
  t: YieldThresholds,
): Record<string, unknown> {
  const thresholds = {
    expectedHoldingDays: {
      value: `${t.expectedHoldingDays} days`,
      why:
        "The horizon. Without it, 'is this move worth it' has no answer: the cost is paid once and " +
        "the spread is earned per day. Too long a horizon makes the threshold small, so the agent " +
        "migrates for a thin spread that may not last — the dangerous direction, because the cost is " +
        "real and the gain is hypothetical. It must be re-tested against how long positions ACTUALLY last.",
    },
    spreadSafetyMultiple: {
      value: `${t.spreadSafetyMultipleBps / BPS_ONE}.${(t.spreadSafetyMultipleBps % BPS_ONE) / 100n}x`,
      why:
        "An APY is a snapshot, not a promise: it drops the moment capital arrives (our own deposit " +
        "pushes it down too), part of it is often reward emissions whose token price is falling, and " +
        "it is computed from a utilization that changes every block. This multiple keeps the migration " +
        "worth it even if the spread actually realized is only half of what was quoted.",
    },
    maxPoolShare: {
      value: formatBps(t.maxPoolShareBps),
      why: REJECTION_MEANING.POOL_SHARE,
    },
    maxPlausibleApy: {
      value: formatApyBps(t.maxPlausibleApyBps),
      why: REJECTION_MEANING.IMPLAUSIBLE_APY,
    },
    maxRiskScore: {
      value: `${t.maxRiskScore} of 100`,
      why:
        "The midpoint of a scale that comes from human research. This agent does not compute the " +
        "score; it only refuses anything above the threshold.",
    },
    maxApyAge: {
      value: `${t.maxApyAgeSeconds} seconds`,
      why: REJECTION_MEANING.STALE_DATA,
    },
    minConsecutiveFavorable: {
      value: `${t.minConsecutiveFavorable} consecutive observations`,
      why:
        "A single APY spike is usually one large loan that just landed and will be arbitraged away " +
        "within minutes. Demanding that the spread PERSIST stops the agent ping-ponging between two " +
        "pools, where each round trip pays the full migration cost twice. Its meaning depends entirely " +
        "on the scheduler's cadence, which this strategy does not know.",
    },
    costModel: {
      swapFee: formatBps(cost.swapFeeBps),
      slippage: formatBps(cost.slippageBps),
      gasForTheWholeMigration: formatUsd8(cost.gasCostBase),
      why:
        "Estimates, not measurements. The chain layer must replace all three with real numbers before " +
        "they decide about money; they exist so tests and backtests have a sane starting point.",
    },
  };

  if (principalBase === null) return { thresholds };

  const switchCost = switchCostBase(principalBase, cost);
  const breakEven = breakEvenSpreadBps(principalBase, switchCost, t.expectedHoldingDays);
  const required = requiredSpreadBps(breakEven, t.spreadSafetyMultipleBps);
  return {
    forPrincipal: formatUsd8(principalBase),
    migrationCost: formatUsd8(switchCost),
    horizon: `${t.expectedHoldingDays} days`,
    breakEvenSpread: formatBps(breakEven),
    requiredSpread: formatBps(required),
    why:
      `A migration of ${formatUsd8(principalBase)} costs ${formatUsd8(switchCost)} once, and the APY ` +
      `spread is earned per day, so over ${t.expectedHoldingDays} days it takes ${formatBps(breakEven)} ` +
      `just to break even and ${formatBps(required)} to be worth doing. This threshold is INVERSELY ` +
      "proportional to both the principal and the horizon: a smaller position, or a shorter stay, " +
      "needs a much larger spread. The highest APY is not the answer — the answer depends on how much " +
      "money it is and how long it will stay.",
    thresholds,
  };
}

/**
 * The wire payload. Raw bigints stay behind: `formatUsd8` / `formatApyBps` / `formatBps` from
 * `strategy/format.ts` are the single source of truth for how a number reads, so the sentence
 * in `decision.reason` and the fields beside it can never disagree.
 */
export function yieldAdvisoryPayload(
  decision: YieldDecision,
  observation: YieldObservation,
  cost: SwitchCostModel,
  t: YieldThresholds,
): Record<string, unknown> {
  const current = observation.position.current;
  const principal = observation.position.principalBase;
  const target =
    decision.targetPoolId === null
      ? null
      : (observation.candidates.find((c) => c.poolId === decision.targetPoolId) ?? null);
  return {
    kind: "advisory",
    agent: "fuguyield",
    advisoryOnly: true,
    /** Mirrors this agent's on-chain listing metadata. It is false there and false here. */
    onchainExecution: false,
    executionPerformed: false,
    notice: ADVISORY_NOTICE,
    recommendedAction: decision.action,
    reasonCode: decision.reasonCode,
    reasoning: decision.reason,
    position: {
      principal: formatUsd8(principal),
      poolId: current.poolId,
      protocol: current.protocol,
      apy: formatApyBps(decision.currentApyBps),
      shareOfPool: formatBps(poolShareBps(principal, current.tvlBase)),
      riskScore: `${current.riskScore} of 100`,
      isActive: current.isActive,
      apyAgeSeconds: current.apyAgeSeconds,
    },
    /** SUGGESTED destination. Nothing has moved and nothing will move because of this field. */
    suggestedTarget:
      target === null
        ? null
        : {
            poolId: target.poolId,
            protocol: target.protocol,
            apy: formatApyBps(target.apyBps),
            riskScore: `${target.riskScore} of 100`,
            shareOfPoolAfterMigration: formatBps(poolShareBps(principal, target.tvlBase)),
          },
    economics: {
      spread: decision.bestApyBps === null ? null : formatBps(decision.spreadBps),
      breakEvenSpread: formatBps(decision.breakEvenSpreadBps),
      requiredSpread: formatBps(decision.requiredSpreadBps),
      safetyMultiple: `${t.spreadSafetyMultipleBps / BPS_ONE}.${(t.spreadSafetyMultipleBps % BPS_ONE) / 100n}x`,
      migrationCost: formatUsd8(decision.switchCostBase),
      horizon: `${t.expectedHoldingDays} days`,
      estimatedNetGainOverHorizon: formatUsd8(decision.netGainBase),
      // The valuable answer this strategy can give is "no": a higher APY that still is not
      // worth the move. It gets its own boolean so a caller cannot miss it.
      spreadCoversItsOwnCost: decision.spreadQualifies,
    },
    confirmation: {
      favorableObservations: observation.consecutiveFavorable,
      required: t.minConsecutiveFavorable,
      confirmed: observation.consecutiveFavorable >= t.minConsecutiveFavorable,
      /**
       * The counting is the CALLER's job, because this module has no memory and no clock. If
       * the caller does not count, the confirmation gate can never open.
       */
      howToCount:
        "Increment when the previous reply had spreadCoversItsOwnCost true AND the same " +
        "suggestedTarget.poolId; otherwise reset to zero.",
    },
    /** Why each candidate was refused, before any APY was compared. */
    rejectedCandidates: decision.rejected.map((r) => ({
      poolId: r.poolId,
      why: r.why,
      meaning: REJECTION_MEANING[r.why],
    })),
    thresholds: (breakevenPayload(principal, cost, t) as Record<string, unknown>).thresholds,
  };
}

/**
 * Read a position and its alternatives; decide; explain. Throws `AdvisoryInputError` on a
 * malformed request and `YieldError` (from the engine) on one that parses but makes no sense
 * — a risk score outside 0..100, a duplicated candidate id, a non-positive TVL, a principal
 * of zero. Neither is swallowed: bad input has to come back as an error, never as advice.
 */
export function adviseYield(input: unknown): YieldAdvisory {
  const { observation, cost, thresholds } = parseYieldInput(input);
  const decision = decide(observation, cost, thresholds);
  return {
    decision,
    observation,
    cost,
    thresholds,
    payload: yieldAdvisoryPayload(decision, observation, cost, thresholds),
  };
}

/**
 * The A2A dispatch form: never throws, because an A2A caller with a bad payload needs to READ
 * what was wrong with it. A malformed request is a business outcome (the caller's mistake),
 * not an internal fault, so it comes back as a result carrying the engine's own error message
 * verbatim — the message is the value.
 */
export function yieldAdvisorySkill(data: unknown): Record<string, unknown> {
  try {
    return adviseYield(stripSkillKey(data)).payload;
  } catch (e) {
    return rejection(e);
  }
}

export function yieldBreakevenSkill(data: unknown): Record<string, unknown> {
  try {
    const parsed = yieldBreakevenInputSchema.safeParse(stripSkillKey(data));
    if (!parsed.success) {
      throw new AdvisoryInputError(`Malformed break-even request — ${formatIssues(parsed.error)}`);
    }
    return {
      kind: "reference",
      agent: "fuguyield",
      advisoryOnly: true,
      onchainExecution: false,
      executionPerformed: false,
      notice: ADVISORY_NOTICE,
      ...breakevenPayload(
        parsed.data.principalBase === undefined
          ? null
          : toBigint(parsed.data.principalBase, "principalBase"),
        parseCost(parsed.data.cost),
        parseThresholds(parsed.data.thresholds),
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
 * A rejection keeps the message and says which layer refused. `AdvisoryInputError` means the
 * shape was wrong; `YieldError` means the shape was fine and the position or a pool was not.
 * Those are different problems for the caller to fix, so they are labelled apart.
 */
function rejection(e: unknown): Record<string, unknown> {
  const known = e instanceof AdvisoryInputError || e instanceof YieldError;
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
