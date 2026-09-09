/**
 * The RUNTIME layer between the outside world and the pure purchase engine.
 *
 * `src/strategy/` is pure: no network, no clock, no `process.env`. This module is the one
 * place where untrusted JSON, an A2A data part, an MCP tool argument, a model's tool
 * call, becomes the engine's types, and where the engine's bigint answer becomes text a
 * person or a model may read.
 *
 * ## What this agent does, stated where a buyer reads it before paying
 *
 * It is handed a seller's demand for payment and decides whether to pay it: the right
 * chain, a token it knows, a recipient it expected, a price under its cap, and enough
 * left in its window. It can then sign one authorisation for that exact amount and no
 * more, and ask again. Deciding and paying are separate steps, and a payment is only ever
 * proven by a transaction. `paymentPerformed` is false in every payload built here.
 *
 * ## The model never decides
 *
 * Every number below comes from `decidePurchase`, which is deterministic and replayable.
 * A model may call these tools and read the sentences out loud. It may not choose an
 * option, move a cap, or recompute an amount.
 */
import { z } from "zod";
import { parsePriceDemand } from "./strategy/challenge.js";
import { decidePurchase, windowRemainingUnits } from "./strategy/decide.js";
import { formatShare, formatToken18 } from "./strategy/format.js";
import {
  DEFAULT_POLICY,
  PurchaseError,
  type PurchaseDecision,
  type PurchasePolicy,
  type Rail,
  type SpendLedger,
} from "./strategy/types.js";

/** The A2A skill ids, which are also the MCP tool names. */
export const PURCHASE_ADVISORY_SKILL = "purchase_advisory";
export const PURCHASE_POLICY_SKILL = "purchase_policy";
export const PURCHASE_SKILL_IDS = [PURCHASE_ADVISORY_SKILL, PURCHASE_POLICY_SKILL] as const;

/**
 * Carried by EVERY payload. Written once, here, so that no call site can ship a result
 * that quietly forgets it.
 */
export const PURCHASE_NOTICE =
  "This is a decision, not a receipt. This agent reads the demand for payment you give " +
  "it, decides with code that always answers the same way for the same input, and " +
  "explains itself. Nothing here has been signed and nothing has been paid. When this " +
  "agent does pay, it signs one authorisation for one amount, valid for a few minutes, " +
  "using a delegated key with a spending cap and an expiry date that the wallet contract " +
  "enforces, and the proof of that is a transaction you can look up.";

/** A malformed request. Never turned into a decision; the caller has to see it. */
export class PurchaseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseInputError";
  }
}

// ── input parsing ─────────────────────────────────────────────────────────────

const amountWire = z
  .union([z.string(), z.number()])
  .describe(
    "A whole number in the token's smallest unit. One token is 1000000000000000000, because " +
      "every token on this network has 18 decimals. Quote it as a string so no digit is lost.",
  );

const DECIMAL_INTEGER = /^\d+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function toBigint(raw: string | number, field: string): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new PurchaseInputError(
        `${field}: ${raw} is not a whole number. Token amounts are whole numbers of the ` +
          `smallest unit.`,
      );
    }
    if (!Number.isSafeInteger(raw)) {
      throw new PurchaseInputError(
        `${field}: ${raw} is beyond the range a JSON number carries exactly. Send it as a ` +
          `string so no digit is lost. A token amount in 18 decimals is almost always past ` +
          `that boundary.`,
      );
    }
    return BigInt(raw);
  }
  const text = raw.trim();
  if (!DECIMAL_INTEGER.test(text)) {
    throw new PurchaseInputError(
      `${field}: "${raw}" is not a whole number written in decimal.`,
    );
  }
  return BigInt(text);
}

const addressWire = z.string().regex(ADDRESS, "must be a 0x address of 20 bytes");

const railWire = z.enum(["permit2-exact", "eip3009"]);

const tokenWire = z
  .object({
    address: addressWire,
    symbol: z.string().min(1),
    decimals: z.number().int().describe("must be 18; every token on this network has 18"),
  })
  .strict();

const policyWire = z
  .object({
    chainId: z.number().int().optional(),
    tokens: z.array(tokenWire).optional(),
    rails: z.array(railWire).optional(),
    maxPricePerCallUnits: amountWire.optional(),
    windowBudgetUnits: amountWire.optional(),
    maxTimeoutSeconds: z.number().int().optional(),
  })
  .strict();

export const purchaseAdvisoryInputSchema = z
  .object({
    demand: z
      .unknown()
      .describe("the seller's reply body, exactly as it arrived, with its `accepts` list"),
    spentUnits: amountWire
      .optional()
      .describe("what this agent has already spent in the current window"),
    expectedPayee: addressWire
      .optional()
      .describe("the address the caller expects to be paid, when they know it"),
    policy: policyWire.optional().describe("omit to use this agent's own limits"),
  })
  .strict();

export const purchaseAdvisoryToolShape = purchaseAdvisoryInputSchema.shape;

export const purchasePolicyRequestSchema = z.object({ policy: policyWire.optional() }).strict();

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

function parsePolicy(raw: z.infer<typeof policyWire> | undefined): PurchasePolicy {
  if (raw === undefined) return DEFAULT_POLICY;
  return {
    chainId: raw.chainId ?? DEFAULT_POLICY.chainId,
    tokens:
      raw.tokens === undefined
        ? DEFAULT_POLICY.tokens
        : raw.tokens.map((t) => ({
            address: t.address as `0x${string}`,
            symbol: t.symbol,
            decimals: t.decimals,
          })),
    rails: (raw.rails ?? DEFAULT_POLICY.rails) as readonly Rail[],
    maxPricePerCallUnits:
      raw.maxPricePerCallUnits === undefined
        ? DEFAULT_POLICY.maxPricePerCallUnits
        : toBigint(raw.maxPricePerCallUnits, "policy.maxPricePerCallUnits"),
    windowBudgetUnits:
      raw.windowBudgetUnits === undefined
        ? DEFAULT_POLICY.windowBudgetUnits
        : toBigint(raw.windowBudgetUnits, "policy.windowBudgetUnits"),
    maxTimeoutSeconds: raw.maxTimeoutSeconds ?? DEFAULT_POLICY.maxTimeoutSeconds,
  };
}

export function parsePurchaseInput(input: unknown): {
  demandBody: unknown;
  ledger: SpendLedger;
  policy: PurchasePolicy;
  expectedPayee?: `0x${string}`;
} {
  const parsed = purchaseAdvisoryInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PurchaseInputError(`Malformed purchase request. ${formatIssues(parsed.error)}`);
  }
  const value = parsed.data;
  return {
    demandBody: value.demand,
    ledger: {
      spentUnits:
        value.spentUnits === undefined ? 0n : toBigint(value.spentUnits, "spentUnits"),
      windowStartedAt: 0n,
    },
    policy: parsePolicy(value.policy),
    ...(value.expectedPayee === undefined
      ? {}
      : { expectedPayee: value.expectedPayee as `0x${string}` }),
  };
}

// ── output ────────────────────────────────────────────────────────────────────

/** Every limit, written out, with the sentence that says what it is for. */
export function policyPayload(policy: PurchasePolicy = DEFAULT_POLICY): Record<string, unknown> {
  return {
    chain: {
      value: String(policy.chainId),
      why:
        "The only chain this agent pays on. The same token address exists on more than one " +
        "chain, and on one of them the money is real.",
    },
    tokensItPaysWith: {
      value: policy.tokens.map((t) => `${t.symbol} (${t.address})`).join(", "),
      why:
        "The seller names the token in its demand, so without a list this agent would sign " +
        "away whichever token the seller preferred it to spend.",
    },
    waysItSigns: {
      value: policy.rails.join(", then "),
      why:
        "What gets signed differs completely between the two, and they are listed in the " +
        "order this agent prefers them. The first works for any token it has approved once " +
        "and its signature is checked by the settling contract, which is what makes a " +
        "delegated key usable at all. The second only works for tokens whose transfer " +
        "authorisation understands a contract's signature.",
    },
    mostPerCall: {
      value: formatToken18(policy.maxPricePerCallUnits),
      why:
        "The seller sets the price and the format has no upper bound, so this is the only " +
        "thing between this agent and whatever it is asked for.",
    },
    mostPerWindow: {
      value: formatToken18(policy.windowBudgetUnits),
      why:
        "The per-call cap cannot stop a loop: a thousand correct one-cent payments are a " +
        "thousand correct decisions. The window itself is whatever period the caller resets " +
        "its running total over.",
    },
    longestAuthorisation: {
      value: `${policy.maxTimeoutSeconds} seconds`,
      why:
        "A signed authorisation is money the seller can take at any moment inside its " +
        "window, so the window is the exposure. This is also the largest value BNB Agent " +
        "Studio sellers accept in practice, so staying under it keeps this agent payable by " +
        "them as well as safe.",
    },
  };
}

export function purchaseAdvisoryPayload(
  decision: PurchaseDecision,
  policy: PurchasePolicy,
): Record<string, unknown> {
  return {
    kind: "purchase-decision",
    agent: "fugutrader",
    /** Building this payload is not signing a payment, and never becomes one. */
    paymentPerformed: false,
    notice: PURCHASE_NOTICE,
    decision: decision.action,
    reasoning: decision.reason,
    chosen:
      decision.chosen === null
        ? null
        : {
            paysTo: decision.chosen.payTo,
            token: decision.chosen.asset,
            symbol: decision.chosen.symbol,
            amount: formatToken18(decision.chosen.amountUnits),
            signedThe: decision.chosen.rail,
            authorisationValidFor: `${decision.chosen.timeoutSeconds} seconds`,
          },
    money: {
      leftInThisWindow: formatToken18(decision.windowRemainingUnits),
      shareOfWindowUsed: formatShare(decision.windowUsedBps),
    },
    /** 0 to 4. The fugu puffs up as the money committed against the limit rises. */
    puffLevel: decision.puffLevel,
    putAside: decision.refused.map((r) => ({
      option: r.index,
      rule: r.rule,
      detail: r.detail,
    })),
    limits: policyPayload(policy),
  };
}

export interface PurchaseAdvisory {
  decision: PurchaseDecision;
  policy: PurchasePolicy;
  payload: Record<string, unknown>;
}

/**
 * Reads a seller's demand, decides, explains. Throws `PurchaseInputError` on a malformed
 * request and `PurchaseError` on a policy that could never pay. Neither is swallowed: bad
 * input has to come back as an error, never as a payment.
 */
export function advisePurchase(input: unknown): PurchaseAdvisory {
  const { demandBody, ledger, policy, expectedPayee } = parsePurchaseInput(input);
  const decision = decidePurchase(
    parsePriceDemand(demandBody),
    policy,
    ledger,
    expectedPayee === undefined ? {} : { expectedPayee },
  );
  return { decision, policy, payload: purchaseAdvisoryPayload(decision, policy) };
}

// ── A2A dispatch ──────────────────────────────────────────────────────────────

function stripSkillKey(data: unknown): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
  const { skill: _skill, ...rest } = data as Record<string, unknown>;
  return rest;
}

function rejection(e: unknown): Record<string, unknown> {
  const known = e instanceof PurchaseInputError || e instanceof PurchaseError;
  return {
    status: "rejected",
    kind: "error",
    paymentPerformed: false,
    errorKind: known ? (e as Error).name : "UnexpectedError",
    error: known
      ? (e as Error).message
      : "The request could not be evaluated. No decision was produced and nothing was signed.",
  };
}

/**
 * Never throws, because an A2A caller with a bad payload needs to READ what was wrong
 * with it. A malformed request is the caller's mistake, not an internal fault.
 */
export function purchaseAdvisorySkill(data: unknown): Record<string, unknown> {
  try {
    return advisePurchase(stripSkillKey(data)).payload;
  } catch (e) {
    return rejection(e);
  }
}

export function purchasePolicySkill(data: unknown): Record<string, unknown> {
  try {
    const parsed = purchasePolicyRequestSchema.safeParse(stripSkillKey(data));
    if (!parsed.success) {
      throw new PurchaseInputError(`Malformed limits request. ${formatIssues(parsed.error)}`);
    }
    const policy = parsePolicy(parsed.data.policy);
    return {
      kind: "reference",
      agent: "fugutrader",
      paymentPerformed: false,
      notice: PURCHASE_NOTICE,
      limits: policyPayload(policy),
      leftInThisWindow: formatToken18(
        windowRemainingUnits({ spentUnits: 0n, windowStartedAt: 0n }, policy),
      ),
    };
  } catch (e) {
    return rejection(e);
  }
}
