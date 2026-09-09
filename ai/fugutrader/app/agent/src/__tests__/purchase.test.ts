/**
 * The layer between untrusted JSON and the engine.
 *
 * Two properties are defended here. A malformed request must come back as a refusal
 * carrying the reason, never as a decision built from guessed values, because a guess
 * looks like an answer. And every payload must repeat, in its own fields, that nothing
 * has been signed, because a caller reads the payload and not this comment.
 */
import { describe, expect, it } from "vitest";
import {
  PURCHASE_ADVISORY_SKILL,
  PURCHASE_NOTICE,
  PURCHASE_POLICY_SKILL,
  advisePurchase,
  parsePurchaseInput,
  purchaseAdvisorySkill,
  purchasePolicySkill,
} from "../purchase.js";
import { WAD } from "../strategy/types.js";
import {
  ONE_CENT,
  SELLER,
  USDT_TESTNET,
  demandBody,
  option,
} from "../strategy/__tests__/fixtures.js";

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { demand: demandBody(), ...over };
}

describe("parsePurchaseInput", () => {
  it("accepts a running total written as a string, so no digit is lost on the wire", () => {
    const { ledger } = parsePurchaseInput(body({ spentUnits: WAD.toString() }));
    expect(ledger.spentUnits).toBe(WAD);
  });

  it("refuses a JSON number too large to carry exactly", () => {
    // A token amount in 18 decimals is past that boundary almost always, which is why
    // the error says to quote it.
    expect(() => parsePurchaseInput(body({ spentUnits: 9_007_199_254_740_993 }))).toThrow(
      /carries exactly/,
    );
  });

  it("names a mistyped key rather than dropping it", () => {
    expect(() => parsePurchaseInput(body({ spentUnit: "1" }))).toThrow(/spentUnit/);
  });

  it("refuses an address that is not an address", () => {
    expect(() => parsePurchaseInput(body({ expectedPayee: "0x1" }))).toThrow(/expectedPayee/);
  });

  it("keeps this agent's own limits when none are sent", () => {
    const { policy } = parsePurchaseInput(body());
    expect(policy.chainId).toBe(97);
    expect(policy.maxTimeoutSeconds).toBe(480);
  });
});

describe("advisePurchase", () => {
  it("returns the decision with every number already written out", () => {
    const { payload } = advisePurchase(body());
    expect(payload.decision).toBe("PAY");
    const chosen = payload.chosen as Record<string, unknown>;
    expect(chosen.amount).toBe("0.010000");
    expect(chosen.paysTo).toBe(SELLER);
    expect(chosen.authorisationValidFor).toBe("300 seconds");
  });

  it("says in its own fields that nothing was signed", () => {
    const { payload } = advisePurchase(body());
    expect(payload.paymentPerformed).toBe(false);
    expect(payload.notice).toBe(PURCHASE_NOTICE);
  });

  it("carries the puff level, which the marketplace draws the fish from", () => {
    const { payload } = advisePurchase(body());
    expect(payload.puffLevel).toBe(1);
  });

  it("hands back every option it put aside, with the rule that did it", () => {
    const { payload } = advisePurchase(
      body({ demand: demandBody([option({ asset: USDT_TESTNET })]) }),
    );
    const putAside = payload.putAside as { rule: string }[];
    expect(putAside[0]?.rule).toBe("TOKEN");
  });

  it("counts a running total the caller sends against the window", () => {
    const { payload } = advisePurchase(
      body({ spentUnits: (5n * WAD).toString() }),
    );
    expect(payload.decision).toBe("WINDOW_EXHAUSTED");
  });

  it("refuses a recipient the caller did not expect", () => {
    const { payload } = advisePurchase(
      body({ expectedPayee: "0x000000000000000000000000000000000000bEEF" }),
    );
    expect(payload.decision).toBe("REFUSED");
  });
});

describe("the A2A dispatch", () => {
  it("answers a malformed request with a refusal the caller can read, and never throws", () => {
    const result = purchaseAdvisorySkill({ skill: PURCHASE_ADVISORY_SKILL, spentUnits: "abc" });
    expect(result.status).toBe("rejected");
    expect(result.errorKind).toBe("PurchaseInputError");
    expect(result.paymentPerformed).toBe(false);
  });

  it("tells a malformed shape apart from a policy that could never pay", () => {
    const badShape = purchaseAdvisorySkill({ skill: PURCHASE_ADVISORY_SKILL, nope: 1 });
    const badPolicy = purchaseAdvisorySkill({
      skill: PURCHASE_ADVISORY_SKILL,
      ...body({ policy: { tokens: [] } }),
    });
    expect(badShape.errorKind).toBe("PurchaseInputError");
    expect(badPolicy.errorKind).toBe("PurchaseError");
  });

  it("ignores the envelope's own skill key, which the strict schema would otherwise refuse", () => {
    const result = purchaseAdvisorySkill({ skill: PURCHASE_ADVISORY_SKILL, ...body() });
    expect(result.decision).toBe("PAY");
  });

  it("refuses a token configured with six decimals, and says why in the message", () => {
    const result = purchaseAdvisorySkill({
      skill: PURCHASE_ADVISORY_SKILL,
      ...body({
        policy: { tokens: [{ address: SELLER, symbol: "USDT", decimals: 6 }] },
      }),
    });
    expect(result.status).toBe("rejected");
    expect(String(result.error)).toContain("18");
  });

  it("reads back every limit with the reason it is the value it is", () => {
    const result = purchasePolicySkill({ skill: PURCHASE_POLICY_SKILL });
    const limits = result.limits as Record<string, { value: string; why: string }>;
    expect(limits.mostPerCall?.value).toBe("0.500000");
    expect(limits.mostPerWindow?.value).toBe("5.000000");
    expect(limits.longestAuthorisation?.value).toBe("480 seconds");
    for (const entry of Object.values(limits)) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("never writes an em dash into text a person reads", () => {
    const decision = purchaseAdvisorySkill({ skill: PURCHASE_ADVISORY_SKILL, ...body() });
    const limits = purchasePolicySkill({ skill: PURCHASE_POLICY_SKILL });
    expect(JSON.stringify(decision)).not.toContain("—");
    expect(JSON.stringify(limits)).not.toContain("—");
  });

  it("reports the one cent this project's own seller charges as one cent", () => {
    const { payload } = advisePurchase(body());
    expect((payload.chosen as Record<string, unknown>).amount).toBe("0.010000");
    expect(ONE_CENT).toBe(WAD / 100n);
  });
});
