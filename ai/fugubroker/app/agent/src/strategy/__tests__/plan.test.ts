/**
 * The payment arguments.
 *
 * The three values in a payment that exist only to protect the buyer are the ceiling, the
 * deadline and the choice of token. Each of them has a way of being quietly wrong that
 * still produces a payment: an unbounded ceiling, a deadline in the past, a token nobody
 * priced. Those are the cases below.
 */
import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  MAX_UINT32,
  ZERO_ADDRESS,
  buildErc8183HirePlan,
  buildPaymentIntent,
  ceilingWithSlippage,
  describeIntent,
  usd8ToPeggedWad,
  type PaymentContext,
} from "../plan.js";
import { DEFAULT_POLICY, HiringError, WAD, type HiringPolicy } from "../types.js";
import { OWNER_B, listing } from "./fixtures.js";

const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const U = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as const;

/** An hour of work at five cents a block: thirty blocks, $1.50. */
function hireDecision() {
  return decide([listing({ listingId: 1n, owner: OWNER_B, name: "Fugu Yield" })], {
    category: "YIELD",
    workSeconds: 3_600n,
    budgetUsd8: 200_000_000n,
  });
}

function context(over: Partial<PaymentContext> = {}): PaymentContext {
  return {
    payToken: USDT,
    // $1.50 at one token to the dollar, in 18 decimals.
    quotedAmountWad: 150n * WAD / 100n,
    nowUnix: 1_800_000_000n,
    allowedPayTokens: [USDT, U],
    ...over,
  };
}

describe("ceilingWithSlippage", () => {
  it("rounds up, so the ceiling is never below the price it is meant to cover", () => {
    expect(ceilingWithSlippage(1n, 100n)).toBe(2n);
    expect(ceilingWithSlippage(10_000n, 100n)).toBe(10_100n);
    expect(ceilingWithSlippage(WAD, 0n)).toBe(WAD);
  });

  it("refuses a negative allowance, which would put the ceiling below the quote", () => {
    expect(() => ceilingWithSlippage(WAD, -1n)).toThrow(HiringError);
  });
});

describe("usd8ToPeggedWad", () => {
  it("converts a dollar to one token of 18 decimals", () => {
    expect(usd8ToPeggedWad(100_000_000n)).toBe(WAD);
    expect(usd8ToPeggedWad(5_000_000n)).toBe(WAD / 20n);
  });

  it("is not the six-decimal conversion, which would be ten thousand times too small", () => {
    expect(usd8ToPeggedWad(100_000_000n)).not.toBe(100_000_000n * 10n ** 12n);
  });
});

describe("buildPaymentIntent", () => {
  it("carries the listing, the block count and a ceiling above the quoted price", () => {
    const intent = buildPaymentIntent(hireDecision(), context());
    expect(intent.listingId).toBe(1n);
    expect(intent.periods).toBe(30n);
    expect(intent.payToken).toBe(USDT);
    expect(intent.maxAmountWad).toBeGreaterThan(intent.quotedAmountWad);
    // One percent of $1.50 is $0.015.
    expect(intent.maxAmountWad).toBe(1_515n * WAD / 1_000n);
  });

  it("puts the deadline one validity window ahead of the clock it was given", () => {
    const intent = buildPaymentIntent(hireDecision(), context({ nowUnix: 1_000n }));
    expect(intent.deadlineUnix).toBe(1_000n + DEFAULT_POLICY.intentTtlSeconds);
  });

  it("never builds a payment out of a refusal", () => {
    const refusal = decide([listing({ listingId: 1n })], {
      category: "TREASURY",
      workSeconds: 60n,
      budgetUsd8: 100_000_000n,
    });
    expect(() => buildPaymentIntent(refusal, context())).toThrow(/nothing to pay for/);
  });

  it("refuses the chain's own coin, because a ceiling cannot protect an exact amount", () => {
    expect(() => buildPaymentIntent(hireDecision(), context({ payToken: ZERO_ADDRESS }))).toThrow(
      /own coin/,
    );
  });

  it("refuses a token nobody configured a price source for", () => {
    expect(() =>
      buildPaymentIntent(hireDecision(), context({ allowedPayTokens: [U] })),
    ).toThrow(/not one of the tokens/);
  });

  it("refuses a quote of zero rather than treating it as free", () => {
    expect(() => buildPaymentIntent(hireDecision(), context({ quotedAmountWad: 0n }))).toThrow(
      /failed reading/,
    );
  });

  it("refuses a clock reading of zero, which would put the deadline in 1970", () => {
    expect(() => buildPaymentIntent(hireDecision(), context({ nowUnix: 0n }))).toThrow(/1970/);
  });

  it("refuses a block count that does not fit the field the payment carries it in", () => {
    const policy: HiringPolicy = {
      ...DEFAULT_POLICY,
      maxPeriods: MAX_UINT32 + 10n,
      maxTotalUsd8: 10n ** 20n,
      windowBudgetUsd8: 10n ** 20n,
    };
    const decision = decide(
      [listing({ listingId: 1n, periodSeconds: 60n, priceUsd8PerPeriod: 1n })],
      { category: "YIELD", workSeconds: 60n * (MAX_UINT32 + 5n), budgetUsd8: 10n ** 20n },
      policy,
    );
    expect(decision.action).toBe("HIRE");
    expect(() => buildPaymentIntent(decision, context(), policy)).toThrow(/32-bit field/);
  });

  it("describes itself in a sentence that names the ceiling and the deadline", () => {
    const text = describeIntent(buildPaymentIntent(hireDecision(), context()));
    expect(text).toContain("listing 1");
    expect(text).toContain("1.515000");
    expect(text).not.toContain("—");
  });
});

describe("buildErc8183HirePlan", () => {
  it("pays the listing owner, never the address the agent works from", () => {
    const plan = buildErc8183HirePlan(hireDecision(), { task: "Rebalance once." });
    expect(plan.provider).toBe(OWNER_B);
  });

  it("holds the same amount the catalog decision produced, converted at one token to the dollar", () => {
    const plan = buildErc8183HirePlan(hireDecision(), { task: "Rebalance once." });
    expect(plan.budgetWad).toBe(150n * WAD / 100n);
  });

  it("refuses a job with no description, because nobody can be held to one", () => {
    expect(() => buildErc8183HirePlan(hireDecision(), { task: "   " })).toThrow(/no description/);
  });

  it("refuses a description longer than the field can hold", () => {
    expect(() => buildErc8183HirePlan(hireDecision(), { task: "x".repeat(4097) })).toThrow(/4096/);
  });

  it("refuses a deadline that has already passed", () => {
    expect(() => buildErc8183HirePlan(hireDecision(), { task: "work", deadlineSeconds: 0 })).toThrow(
      /refunded/,
    );
  });

  it("never opens a job out of a refusal", () => {
    const refusal = decide([listing({ listingId: 1n })], {
      category: "TREASURY",
      workSeconds: 60n,
      budgetUsd8: 100_000_000n,
    });
    expect(() => buildErc8183HirePlan(refusal, { task: "work" })).toThrow(/no job to open/);
  });
});
