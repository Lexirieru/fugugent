/**
 * The layer between untrusted JSON and the engine.
 *
 * Two properties are being defended. A malformed request must come back as a rejection
 * carrying the reason, never as a decision built from guessed values, because a guess
 * looks like an answer. And every payload must repeat, in its own fields, that nothing
 * has been paid, because a caller reads the payload and not this comment.
 */
import { describe, expect, it } from "vitest";
import {
  HIRE_ADVISORY_SKILL,
  HIRE_POLICY_SKILL,
  HIRING_NOTICE,
  adviseHire,
  hireAdvisorySkill,
  hirePolicySkill,
  parseHireInput,
  paymentIntentPayload,
} from "../hiring.js";
import { DEFAULT_POLICY, WAD } from "../strategy/types.js";
import { decide } from "../strategy/decide.js";

const OWNER = "0x2222222222222222222222222222222222222222";
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: "YIELD",
    workSeconds: "3600",
    budgetUsd8: "200000000",
    catalog: [
      {
        listingId: "4",
        owner: OWNER,
        category: "YIELD",
        priceUsd8PerPeriod: "5000000",
        periodSeconds: "120",
        active: true,
        name: "Fugu Yield",
      },
    ],
    ...over,
  };
}

describe("parseHireInput", () => {
  it("accepts whole numbers written as strings, so no digit is lost on the wire", () => {
    const { request, catalog } = parseHireInput(body());
    expect(request.workSeconds).toBe(3_600n);
    expect(catalog[0]?.priceUsd8PerPeriod).toBe(5_000_000n);
  });

  it("accepts a JSON number while it is still exact", () => {
    const { request } = parseHireInput(body({ workSeconds: 3600 }));
    expect(request.workSeconds).toBe(3_600n);
  });

  it("refuses a JSON number too large to carry exactly, instead of losing its last digit", () => {
    expect(() => parseHireInput(body({ budgetUsd8: 9_007_199_254_740_993 }))).toThrow(
      /carries exactly/,
    );
  });

  it("refuses a value that is not a whole number", () => {
    expect(() => parseHireInput(body({ workSeconds: 1.5 }))).toThrow(/whole number/);
    expect(() => parseHireInput(body({ workSeconds: "1.5" }))).toThrow(/decimal/);
  });

  it("names a mistyped key rather than dropping it", () => {
    expect(() => parseHireInput(body({ budgetUsd: "1" }))).toThrow(/budgetUsd/);
  });

  it("refuses a capability nobody declared", () => {
    expect(() => parseHireInput(body({ category: "SOMETHING_ELSE" }))).toThrow(/category/);
  });

  it("refuses an address that is not an address", () => {
    expect(() =>
      parseHireInput(body({ catalog: [{ ...(body().catalog as never[])[0] as object, owner: "0x1" }] })),
    ).toThrow(/owner/);
  });
});

describe("adviseHire", () => {
  it("returns the decision with every number already written out", () => {
    const { payload } = adviseHire(body());
    expect(payload.decision).toBe("HIRE");
    expect((payload.chosen as Record<string, unknown>).total).toBe("$1.50000000");
    expect((payload.money as Record<string, unknown>).limitForThisHire).toBe("$2.00000000");
  });

  it("says in its own fields that nothing was paid", () => {
    const { payload } = adviseHire(body());
    expect(payload.paymentPerformed).toBe(false);
    expect(payload.notice).toBe(HIRING_NOTICE);
  });

  it("carries the puff level, which the marketplace draws the fish from", () => {
    const { payload } = adviseHire(body());
    expect(payload.puffLevel).toBe(4);
  });

  it("hands back every listing it put aside, with the rule that did it", () => {
    const { payload } = adviseHire(
      body({ catalog: [{ ...(body().catalog as never[])[0] as object, active: false }] }),
    );
    const putAside = (payload.catalog as { putAside: { rule: string }[] }).putAside;
    expect(putAside[0]?.rule).toBe("INACTIVE");
  });
});

describe("the A2A dispatch", () => {
  it("answers a malformed request with a rejection the caller can read, and never throws", () => {
    const result = hireAdvisorySkill({ skill: HIRE_ADVISORY_SKILL, category: "NONSENSE" });
    expect(result.status).toBe("rejected");
    expect(result.errorKind).toBe("HiringInputError");
    expect(String(result.error)).toContain("category");
    expect(result.paymentPerformed).toBe(false);
  });

  it("tells a malformed shape apart from a request that parses and makes no sense", () => {
    const badShape = hireAdvisorySkill({ skill: HIRE_ADVISORY_SKILL, category: "NONSENSE" });
    const badContent = hireAdvisorySkill({
      skill: HIRE_ADVISORY_SKILL,
      ...body({ workSeconds: "-1" }),
    });
    expect(badShape.errorKind).toBe("HiringInputError");
    expect(badContent.errorKind).toBe("HiringError");
  });

  it("ignores the envelope's own skill key, which the strict schema would otherwise refuse", () => {
    const result = hireAdvisorySkill({ skill: HIRE_ADVISORY_SKILL, ...body() });
    expect(result.decision).toBe("HIRE");
  });

  it("reads back every limit with the reason it is the value it is", () => {
    const result = hirePolicySkill({ skill: HIRE_POLICY_SKILL });
    const limits = result.limits as Record<string, { value: string; why: string }>;
    expect(limits.perHireLimit?.value).toBe("$5.00000000");
    expect(limits.windowLimit?.value).toBe("$20.00000000");
    for (const entry of Object.values(limits)) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("never writes an em dash into text a person reads", () => {
    const decision = hireAdvisorySkill({ skill: HIRE_ADVISORY_SKILL, ...body() });
    const limits = hirePolicySkill({ skill: HIRE_POLICY_SKILL });
    expect(JSON.stringify(decision)).not.toContain("—");
    expect(JSON.stringify(limits)).not.toContain("—");
  });
});

describe("paymentIntentPayload", () => {
  it("keeps the ceiling and the deadline in the payload, so a caller can check them", () => {
    const decision = decide(
      [
        {
          listingId: 4n,
          erc8004AgentId: 8004n,
          owner: OWNER as `0x${string}`,
          agentWallet: OWNER as `0x${string}`,
          category: "YIELD",
          priceUsd8PerPeriod: 5_000_000n,
          periodSeconds: 120n,
          active: true,
          curated: false,
          name: "Fugu Yield",
          onchainExecution: false,
        },
      ],
      { category: "YIELD", workSeconds: 3_600n, budgetUsd8: 200_000_000n },
    );
    const payload = paymentIntentPayload(
      decision,
      {
        payToken: USDT,
        quotedAmountWad: 150n * WAD / 100n,
        nowUnix: 1_800_000_000n,
        allowedPayTokens: [USDT],
      },
      DEFAULT_POLICY,
    );
    expect(payload.paymentPerformed).toBe(false);
    expect(payload.willNotPayMoreThan).toBe("1.515000");
    expect(payload.mustLandBeforeUnixSecond).toBe("1800000300");
  });
});
