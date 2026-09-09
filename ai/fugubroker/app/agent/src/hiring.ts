/**
 * The RUNTIME layer between the outside world and the pure hiring engine.
 *
 * `src/strategy/` is pure: no network, no clock, no `process.env`. This module is the one
 * place where untrusted JSON, an A2A data part, an MCP tool argument, an LLM tool call,
 * becomes the engine's types, and where the engine's bigint answer becomes text a person
 * or a model may read. The engine is never handed a string and never asked to format one.
 *
 * ## What this agent does, stated where a buyer reads it before paying
 *
 * It reads the catalog of agents, picks one by rules that are written down and tested,
 * works out what the rental costs, and can pay for it. The payment goes through a
 * delegated key whose list of permitted methods holds exactly one entry. Whether a
 * payment has actually happened is a fact about a transaction, and this module never
 * claims one: `paymentPerformed` is false in every payload built here, because building a
 * payload is not sending a payment.
 *
 * ## The model never decides
 *
 * Every number below comes from `decide()`, which is deterministic and replayable. A
 * model may call these tools and read the sentences out loud. It may not choose a
 * listing, move a limit, or recompute an amount.
 */
import { z } from "zod";
import { decide } from "./strategy/decide.js";
import { buildPaymentIntent, describeIntent, type PaymentContext } from "./strategy/plan.js";
import {
  formatBps,
  formatDuration,
  formatShare,
  formatToken18,
  formatUsd8Exact,
} from "./strategy/format.js";
import {
  CATEGORY_LABELS,
  CATEGORY_NAMES,
  CatalogError,
  DEFAULT_POLICY,
  HiringError,
  type CatalogListing,
  type Category,
  type HireDecision,
  type HiringPolicy,
  type HiringRequest,
} from "./strategy/types.js";

/** The A2A skill ids, which are also the MCP tool names. */
export const HIRE_ADVISORY_SKILL = "hire_advisory";
export const HIRE_POLICY_SKILL = "hire_policy";
export const HIRING_SKILL_IDS = [HIRE_ADVISORY_SKILL, HIRE_POLICY_SKILL] as const;

/**
 * Carried by EVERY payload. Written once, here, so that no call site can ship a result
 * that quietly forgets it.
 */
export const HIRING_NOTICE =
  "This is a decision, not a receipt. This agent reads the catalog you give it, chooses " +
  "with code that always chooses the same way for the same input, and explains itself. " +
  "Nothing here has been paid. When this agent does pay, it pays through a delegated key " +
  "whose permitted-method list holds one entry, with a spending cap and an expiry date " +
  "that the wallet contract enforces, and the proof of that is a transaction you can look " +
  "up, not a sentence in this reply.";

/** A malformed request. Never turned into a decision; the caller has to see it. */
export class HiringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiringInputError";
  }
}

// ── input parsing ─────────────────────────────────────────────────────────────

/**
 * The WIRE schema is deliberately transform-free.
 *
 * It is published as the tool's input schema over MCP and to the model, so it has to
 * describe JSON exactly as JSON. A transform here would leak bigints into a generated
 * JSON Schema. Shape checking lives in the schema; the string to bigint step happens one
 * layer later, in `toBigint`, where a failure can name the exact field.
 */
const amountWire = z
  .union([z.string(), z.number()])
  .describe(
    "A whole number: money on the 8-decimal basis (100000000 = $1.00), shares in basis " +
      "points (10000 = 100%), time in whole seconds. Quote a large value as a string so no " +
      "digit is lost.",
  );

const DECIMAL_INTEGER = /^-?\d+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function toBigint(raw: string | number, field: string): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new HiringInputError(
        `${field}: ${raw} is not a whole number. Money is on the 8-decimal basis and time is in ` +
          `whole seconds, so both are whole numbers.`,
      );
    }
    if (!Number.isSafeInteger(raw)) {
      throw new HiringInputError(
        `${field}: ${raw} is beyond the range a JSON number carries exactly. Send it as a ` +
          `string so no digit is lost.`,
      );
    }
    return BigInt(raw);
  }
  const text = raw.trim();
  if (!DECIMAL_INTEGER.test(text)) {
    throw new HiringInputError(
      `${field}: "${raw}" is not a whole number written in decimal. Money is on the 8-decimal ` +
        `basis (100000000 = $1.00).`,
    );
  }
  return BigInt(text);
}

const addressWire = z.string().regex(ADDRESS, "must be a 0x address of 20 bytes");

const categoryWire = z.enum(CATEGORY_NAMES);

const listingWire = z
  .object({
    listingId: amountWire.describe("the id the catalog contract gave this listing; ids start at 1"),
    erc8004AgentId: amountWire.optional().describe("the identity id this listing claims"),
    owner: addressWire.describe("the address that gets paid"),
    agentWallet: addressWire.optional().describe("the address the agent works from; never a payee"),
    category: categoryWire.describe("the capability on offer"),
    priceUsd8PerPeriod: amountWire.describe("price of one block of time, 8-decimal basis"),
    periodSeconds: amountWire.describe("how long one block of time is, in whole seconds"),
    active: z.boolean().describe("false means the listing is switched off and cannot be paid"),
    curated: z.boolean().optional().describe("true when a reviewer who is not the seller vetted it"),
    name: z.string().optional(),
    onchainExecution: z
      .boolean()
      .optional()
      .describe("the listing's own claim that it carries out work, rather than only advising"),
  })
  .strict();

const policyWire = z
  .object({
    maxTotalUsd8: amountWire.optional(),
    windowBudgetUsd8: amountWire.optional(),
    maxPricePerPeriodUsd8: amountWire.optional(),
    maxPeriods: amountWire.optional(),
    minPeriodSeconds: amountWire.optional(),
    maxPeriodSeconds: amountWire.optional(),
    slippageBps: amountWire.optional(),
    intentTtlSeconds: amountWire.optional(),
  })
  .strict();

/**
 * `.strict()` everywhere on purpose: a mistyped key has to be named in the error, not
 * dropped in silence and then reported as a missing field somewhere else.
 */
export const hireAdvisoryInputSchema = z
  .object({
    category: categoryWire.describe("the capability to hire"),
    workSeconds: amountWire.describe("how long the work needs the hired agent for, in seconds"),
    budgetUsd8: amountWire.describe("the most this caller will spend on this one hire"),
    alreadySpentUsd8: amountWire
      .optional()
      .describe("what this agent has already spent on hiring in the current window"),
    requireCurated: z.boolean().optional(),
    requireOnchainExecution: z.boolean().optional(),
    excludeOwners: z.array(addressWire).optional(),
    catalog: z.array(listingWire).describe("the catalog to choose from"),
    policy: policyWire.optional().describe("omit to use this agent's own limits"),
  })
  .strict();

export const hireAdvisoryToolShape = hireAdvisoryInputSchema.shape;

export const hirePolicyRequestSchema = z.object({ policy: policyWire.optional() }).strict();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function parsePolicy(raw: z.infer<typeof policyWire> | undefined): HiringPolicy {
  if (raw === undefined) return DEFAULT_POLICY;
  const pick = (key: keyof HiringPolicy, wire: string | number | undefined): bigint =>
    wire === undefined ? DEFAULT_POLICY[key] : toBigint(wire, `policy.${key}`);
  return {
    maxTotalUsd8: pick("maxTotalUsd8", raw.maxTotalUsd8),
    windowBudgetUsd8: pick("windowBudgetUsd8", raw.windowBudgetUsd8),
    maxPricePerPeriodUsd8: pick("maxPricePerPeriodUsd8", raw.maxPricePerPeriodUsd8),
    maxPeriods: pick("maxPeriods", raw.maxPeriods),
    minPeriodSeconds: pick("minPeriodSeconds", raw.minPeriodSeconds),
    maxPeriodSeconds: pick("maxPeriodSeconds", raw.maxPeriodSeconds),
    slippageBps: pick("slippageBps", raw.slippageBps),
    intentTtlSeconds: pick("intentTtlSeconds", raw.intentTtlSeconds),
  };
}

/**
 * Parses an untrusted payload into a catalog, a request and a policy.
 *
 * A rejected input NEVER degrades into a default. Guessing a missing price, or dropping a
 * listing whose period failed to parse, would produce a hire from a catalog nobody owns,
 * which is worse than an error because it looks like an answer.
 */
export function parseHireInput(input: unknown): {
  catalog: CatalogListing[];
  request: HiringRequest;
  policy: HiringPolicy;
} {
  const parsed = hireAdvisoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new HiringInputError(`Malformed hiring request. ${formatIssues(parsed.error)}`);
  }
  const value = parsed.data;

  const catalog: CatalogListing[] = value.catalog.map((l, i) => ({
    listingId: toBigint(l.listingId, `catalog[${i}].listingId`),
    erc8004AgentId:
      l.erc8004AgentId === undefined ? 0n : toBigint(l.erc8004AgentId, `catalog[${i}].erc8004AgentId`),
    owner: l.owner as `0x${string}`,
    agentWallet: (l.agentWallet ?? ZERO_ADDRESS) as `0x${string}`,
    category: l.category as Category,
    priceUsd8PerPeriod: toBigint(l.priceUsd8PerPeriod, `catalog[${i}].priceUsd8PerPeriod`),
    periodSeconds: toBigint(l.periodSeconds, `catalog[${i}].periodSeconds`),
    active: l.active,
    curated: l.curated ?? false,
    name: l.name ?? "",
    onchainExecution: l.onchainExecution ?? false,
  }));

  const request: HiringRequest = {
    category: value.category as Category,
    workSeconds: toBigint(value.workSeconds, "workSeconds"),
    budgetUsd8: toBigint(value.budgetUsd8, "budgetUsd8"),
    ...(value.alreadySpentUsd8 === undefined
      ? {}
      : { alreadySpentUsd8: toBigint(value.alreadySpentUsd8, "alreadySpentUsd8") }),
    ...(value.requireCurated === undefined ? {} : { requireCurated: value.requireCurated }),
    ...(value.requireOnchainExecution === undefined
      ? {}
      : { requireOnchainExecution: value.requireOnchainExecution }),
    ...(value.excludeOwners === undefined
      ? {}
      : { excludeOwners: value.excludeOwners as `0x${string}`[] }),
  };

  return { catalog, request, policy: parsePolicy(value.policy) };
}

// ── output ────────────────────────────────────────────────────────────────────

/** Every limit, formatted, with the sentence that says what it is for. */
export function policyPayload(policy: HiringPolicy = DEFAULT_POLICY): Record<string, unknown> {
  return {
    perHireLimit: {
      value: formatUsd8Exact(policy.maxTotalUsd8),
      why:
        "The most this agent spends on one rental, whatever a caller asks for. A caller's own " +
        "limit and this one are both ceilings and the smaller wins.",
    },
    windowLimit: {
      value: formatUsd8Exact(policy.windowBudgetUsd8),
      why:
        "The most this agent spends on rentals across one window, counted against the running " +
        "total the caller sends. The per-rental limit cannot stop a loop: two hundred correct " +
        "rentals are two hundred correct decisions and a wallet that is empty.",
    },
    perBlockPriceLimit: {
      value: formatUsd8Exact(policy.maxPricePerPeriodUsd8),
      why:
        "The most this agent pays for one block of time. A seller can change a price with one " +
        "transaction, and the total limit alone would answer a tenfold rise by buying fewer " +
        "blocks instead of stopping.",
    },
    maxBlocksPerHire: {
      value: policy.maxPeriods.toString(),
      why:
        "Money for blocks of time is paid up front and is released to the seller as the time " +
        "passes, so a long prepayment is a long stretch of trust in a seller who might stop " +
        "working.",
    },
    blockLengthBand: {
      value: `${formatDuration(policy.minPeriodSeconds)} to ${formatDuration(policy.maxPeriodSeconds)}`,
      why:
        "Outside this band the arithmetic stops describing anything sensible: a one-second " +
        "block needs millions of blocks for a day of work, and a one-year block means one " +
        "payment covers a year that has not happened yet.",
    },
    priceMoveAllowance: {
      value: formatBps(policy.slippageBps),
      why:
        "The catalog stores dollars and the payment is made in tokens, so the token amount is " +
        "only known when a price is read inside the transaction. This is how far it may move " +
        "before the payment refuses itself. Removing it would mean agreeing to whatever the " +
        "price turns out to be.",
    },
    decisionValidFor: {
      value: formatDuration(policy.intentTtlSeconds),
      why:
        "How long a decision may wait before it has to be made again, so a decision cannot sit " +
        "in a queue and then act on a catalog that has changed underneath it.",
    },
  };
}

function quotePayload(quote: NonNullable<HireDecision["chosen"]>): Record<string, unknown> {
  return {
    listingId: quote.listingId.toString(),
    name: quote.name.length > 0 ? quote.name : null,
    capability: CATEGORY_LABELS[quote.category],
    paidTo: quote.owner,
    worksFrom: quote.agentWallet,
    vettedByAReviewer: quote.curated,
    claimsItCarriesOutWork: quote.onchainExecution,
    pricePerBlock: formatUsd8Exact(quote.pricePerPeriodUsd8),
    blockLength: formatDuration(quote.periodSeconds),
    blocks: quote.periods.toString(),
    timeCovered: formatDuration(quote.coveredSeconds),
    total: formatUsd8Exact(quote.totalUsd8),
  };
}

/**
 * The wire payload. Raw bigints stay behind: the formatters in `strategy/format.ts` are
 * the single source of truth for how a number reads, so the sentence in `reasoning` and
 * the fields beside it can never disagree.
 */
export function hireAdvisoryPayload(
  decision: HireDecision,
  policy: HiringPolicy,
): Record<string, unknown> {
  return {
    kind: "hiring-decision",
    agent: "fugubroker",
    /** Building this payload is not sending a payment, and never becomes one. */
    paymentPerformed: false,
    notice: HIRING_NOTICE,
    decision: decision.action,
    reasoning: decision.reason,
    chosen: decision.chosen === null ? null : quotePayload(decision.chosen),
    runnerUp: decision.runnerUp === null ? null : quotePayload(decision.runnerUp),
    money: {
      limitForThisHire: formatUsd8Exact(decision.budgetUsd8),
      shareOfLimitUsed: formatShare(decision.budgetUsedBps),
    },
    /** 0 to 4. The fugu puffs up as the money committed against the limit rises. */
    puffLevel: decision.puffLevel,
    catalog: {
      listingsSeen: decision.considered,
      putAside: decision.rejected.map((r) => ({
        listingId: r.listingId.toString(),
        rule: r.rule,
        detail: r.detail,
      })),
    },
    limits: policyPayload(policy),
  };
}

export interface HireAdvisory {
  decision: HireDecision;
  policy: HiringPolicy;
  payload: Record<string, unknown>;
}

/**
 * Reads a catalog, decides, explains. Throws `HiringInputError` on a malformed request
 * and `HiringError` or `CatalogError` on one that parses but makes no sense. Neither is
 * swallowed: bad input has to come back as an error, never as a hire.
 */
export function adviseHire(input: unknown): HireAdvisory {
  const { catalog, request, policy } = parseHireInput(input);
  const decision = decide(catalog, request, policy);
  return { decision, policy, payload: hireAdvisoryPayload(decision, policy) };
}

/**
 * The payment arguments for a decision, as text and numbers a person can check.
 *
 * Kept separate from `adviseHire` on purpose. Deciding needs nothing but the catalog;
 * building a payment needs a token price and a clock, and mixing the two would make the
 * decision itself depend on when it was asked for.
 */
export function paymentIntentPayload(
  decision: HireDecision,
  context: PaymentContext,
  policy: HiringPolicy = DEFAULT_POLICY,
): Record<string, unknown> {
  const intent = buildPaymentIntent(decision, context, policy);
  return {
    kind: "payment-intent",
    agent: "fugubroker",
    paymentPerformed: false,
    notice: HIRING_NOTICE,
    listingId: intent.listingId.toString(),
    blocks: intent.periods.toString(),
    payWith: intent.payToken,
    priceNow: formatToken18(intent.quotedAmountWad),
    willNotPayMoreThan: formatToken18(intent.maxAmountWad),
    priceMoveAllowance: formatBps(intent.slippageBps),
    mustLandBeforeUnixSecond: intent.deadlineUnix.toString(),
    inWords: describeIntent(intent),
  };
}

// ── A2A dispatch ──────────────────────────────────────────────────────────────

/** The A2A envelope carries `skill`; the schemas are strict and would reject it. */
function stripSkillKey(data: unknown): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
  const { skill: _skill, ...rest } = data as Record<string, unknown>;
  return rest;
}

/**
 * A rejection keeps the message and says which layer refused. `HiringInputError` means
 * the shape was wrong; `HiringError` and `CatalogError` mean the shape was fine and the
 * content was not. Those are different problems for a caller to fix, so they are labelled
 * apart.
 */
function rejection(e: unknown): Record<string, unknown> {
  const known =
    e instanceof HiringInputError || e instanceof HiringError || e instanceof CatalogError;
  return {
    status: "rejected",
    kind: "error",
    paymentPerformed: false,
    errorKind: known ? (e as Error).name : "UnexpectedError",
    error: known
      ? (e as Error).message
      : "The request could not be evaluated. No decision was produced and nothing was paid.",
  };
}

/**
 * Never throws, because an A2A caller with a bad payload needs to READ what was wrong
 * with it. A malformed request is the caller's mistake, not an internal fault, so it
 * comes back as a result carrying the engine's own message. The message is the value.
 */
export function hireAdvisorySkill(data: unknown): Record<string, unknown> {
  try {
    return adviseHire(stripSkillKey(data)).payload;
  } catch (e) {
    return rejection(e);
  }
}

export function hirePolicySkill(data: unknown): Record<string, unknown> {
  try {
    const parsed = hirePolicyRequestSchema.safeParse(stripSkillKey(data));
    if (!parsed.success) {
      throw new HiringInputError(`Malformed limits request. ${formatIssues(parsed.error)}`);
    }
    return {
      kind: "reference",
      agent: "fugubroker",
      paymentPerformed: false,
      notice: HIRING_NOTICE,
      limits: policyPayload(parsePolicy(parsed.data.policy)),
    };
  } catch (e) {
    return rejection(e);
  }
}
