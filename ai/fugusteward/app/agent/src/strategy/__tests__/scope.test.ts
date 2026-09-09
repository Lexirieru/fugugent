import { describe, expect, it } from "vitest";
import {
  assertScopeIsSane,
  assertWithinScope,
  createScopeRegistry,
  isWithinScope,
  ScopeViolationError,
  type Scope,
} from "../scope.js";

const USD = 100_000_000n;

const RENT_PAYEE = "0xAAAA000000000000000000000000000000000001" as const;
const COMPUTE_PAYEE = "0xBBBB000000000000000000000000000000000002" as const;
const STRANGER = "0xCCCC000000000000000000000000000000000003" as const;

const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const OTHER_TOKEN = "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee" as const;

const TRANSFER = "transfer(address,uint256)";
const APPROVE = "approve(address,uint256)";

/** Pays the office rent. May pay one landlord, in one token, up to fifty dollars. */
const RENT: Scope = {
  agentId: "rent-agent",
  allowedPayees: [RENT_PAYEE],
  allowedCalls: [{ to: USDT, signature: TRANSFER }],
  maxPerPaymentUsd8: 50n * USD,
  maxPerDayUsd8: 50n * USD,
};

/** Buys computing time. A different payee, a different token, a different limit. */
const COMPUTE: Scope = {
  agentId: "compute-agent",
  allowedPayees: [COMPUTE_PAYEE],
  allowedCalls: [{ to: OTHER_TOKEN, signature: APPROVE }],
  maxPerPaymentUsd8: 5n * USD,
  maxPerDayUsd8: 20n * USD,
};

const REGISTRY = createScopeRegistry([RENT, COMPUTE]);

describe("checking a scope before it allows anything", () => {
  it("accepts an ordinary one", () => {
    expect(() => assertScopeIsSane(RENT)).not.toThrow();
  });

  it("refuses one that names nobody it may pay", () => {
    expect(() => assertScopeIsSane({ ...RENT, allowedPayees: [] })).toThrow(/names nobody it may pay/);
  });

  it("refuses one that names no contract and method", () => {
    expect(() => assertScopeIsSane({ ...RENT, allowedCalls: [] })).toThrow(/no contract and method/);
  });

  it("refuses an entry naming only one half of a permission", () => {
    // Half a permission is not a permission. This is the same trap as an empty permission
    // list on the limited key, arriving one layer up.
    expect(() =>
      assertScopeIsSane({
        ...RENT,
        allowedCalls: [{ to: USDT, signature: "" } as never],
      }),
    ).toThrow(/only one half/);
  });

  it("refuses limits that are not positive", () => {
    expect(() => assertScopeIsSane({ ...RENT, maxPerPaymentUsd8: 0n })).toThrow(/not a positive/);
    expect(() => assertScopeIsSane({ ...RENT, maxPerDayUsd8: 0n })).toThrow(/not a positive/);
  });

  it("refuses a per payment limit larger than the whole day's", () => {
    // One of the two numbers is wrong, and guessing which would be guessing about money.
    expect(() =>
      assertScopeIsSane({ ...RENT, maxPerPaymentUsd8: 100n * USD, maxPerDayUsd8: 50n * USD }),
    ).toThrow(/One of the two numbers is wrong/);
  });

  it("refuses two scopes on one wallet sharing a name", () => {
    expect(() => createScopeRegistry([RENT, { ...COMPUTE, agentId: "rent-agent" }])).toThrow(
      /two scopes both called/,
    );
  });
});

describe("what an agent is allowed to do", () => {
  it("lets an agent do exactly what its own scope allows", () => {
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: RENT_PAYEE,
        amountUsd8: 10n * USD,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).not.toThrow();
  });

  it("does not care about capitals in an address", () => {
    expect(
      isWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: RENT_PAYEE.toLowerCase() as `0x${string}`,
        amountUsd8: 10n * USD,
        call: { to: USDT.toLowerCase() as `0x${string}`, signature: TRANSFER },
      }),
    ).toBe(true);
  });

  it("refuses an agent nobody set up at all", () => {
    // An agent with no scope is allowed nothing, which is the only safe reading of a name
    // nobody put there.
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "ghost-agent",
        payee: RENT_PAYEE,
        amountUsd8: 1n * USD,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).toThrow(/no scope called/);
  });

  it("refuses a payee outside its own list", () => {
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: STRANGER,
        amountUsd8: 1n * USD,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).toThrow(/may not pay/);
  });

  it("refuses a contract and method outside its own list", () => {
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: RENT_PAYEE,
        amountUsd8: 1n * USD,
        call: { to: USDT, signature: APPROVE },
      }),
    ).toThrow(/may not use/);
  });

  it("refuses more than its own per payment limit, rather than trimming it", () => {
    // A repeating payment paid short leaves the rest owed, and nobody decided that.
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "compute-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 5n * USD + 1n,
        call: { to: OTHER_TOKEN, signature: APPROVE },
      }),
    ).toThrow(/refused rather than trimmed/);
  });

  it("allows exactly the per payment limit", () => {
    expect(
      isWithinScope(REGISTRY, {
        agentId: "compute-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 5n * USD,
        call: { to: OTHER_TOKEN, signature: APPROVE },
      }),
    ).toBe(true);
  });

  it("refuses an amount that is not positive", () => {
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: RENT_PAYEE,
        amountUsd8: 0n,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).toThrow(/not a positive amount/);
  });
});

describe("one agent trying to use another agent's powers on the same wallet", () => {
  it("refuses a payee that belongs to the other agent's scope", () => {
    // REQUIRED BY THE BRIEF, and MONEY SAFETY RULE S5. This is the whole reason several
    // agents may share one wallet. The payee below is perfectly allowed, for somebody else,
    // and being allowed for somebody is not being allowed. Deleting the `allowedPayees`
    // check makes this fail, and with it the entire separation.
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 1n * USD,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).toThrow(ScopeViolationError);
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 1n * USD,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).toThrow(/makes no difference here/);
  });

  it("refuses a method that belongs to the other agent's scope", () => {
    // MONEY SAFETY RULE S5 again, on the other half of a permission. `approve` on the other
    // token is allowed for the compute agent and for nobody else.
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: RENT_PAYEE,
        amountUsd8: 1n * USD,
        call: { to: OTHER_TOKEN, signature: APPROVE },
      }),
    ).toThrow(/may not use/);
  });

  it("refuses an amount that only the other agent's larger limit would allow", () => {
    // The compute agent may send at most five dollars. Fifty is fine for the rent agent, and
    // that is not a reason for the compute agent to send it.
    expect(() =>
      assertWithinScope(REGISTRY, {
        agentId: "compute-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 50n * USD,
        call: { to: OTHER_TOKEN, signature: APPROVE },
      }),
    ).toThrow(/at most/);
  });

  it("still lets each agent do its own job, so the separation is not just a blanket refusal", () => {
    expect(
      isWithinScope(REGISTRY, {
        agentId: "compute-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 5n * USD,
        call: { to: OTHER_TOKEN, signature: APPROVE },
      }),
    ).toBe(true);
    expect(
      isWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: RENT_PAYEE,
        amountUsd8: 50n * USD,
        call: { to: USDT, signature: TRANSFER },
      }),
    ).toBe(true);
  });

  it("marks every refusal as never sent, so nothing is ever charged for one", () => {
    try {
      assertWithinScope(REGISTRY, {
        agentId: "rent-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 1n * USD,
        call: { to: USDT, signature: TRANSFER },
      });
      expect.unreachable("must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeViolationError);
      expect((err as ScopeViolationError).neverSent).toBe(true);
      expect((err as ScopeViolationError).agentId).toBe("rent-agent");
    }
  });
});
