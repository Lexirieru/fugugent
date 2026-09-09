import { describe, expect, it, vi } from "vitest";
import {
  asPaymentFailure,
  budgetFor,
  initialExecuteState,
  NeverSentError,
  payCharge,
  PaymentFailedError,
  wasNeverSent,
  type ExecuteDeps,
  type ExecuteState,
  type PaymentTiming,
} from "../execute.js";
import { createScopeRegistry, type Scope } from "../scope.js";
import { clearInFlight, entryFor, markPaid, markInFlight } from "../ledger.js";
import type { DueCharge } from "../types.js";
import type { SessionPermissions } from "../session.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const RENT_PAYEE = "0xAAAA000000000000000000000000000000000001" as const;
const COMPUTE_PAYEE = "0xBBBB000000000000000000000000000000000002" as const;
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const TRANSFER = "transfer(address,uint256)";

const RENT: Scope = {
  agentId: "rent-agent",
  allowedPayees: [RENT_PAYEE],
  allowedCalls: [{ to: USDT, signature: TRANSFER }],
  maxPerPaymentUsd8: 50n * USD,
  maxPerDayUsd8: 50n * USD,
};

const COMPUTE: Scope = {
  agentId: "compute-agent",
  allowedPayees: [COMPUTE_PAYEE],
  allowedCalls: [{ to: USDT, signature: TRANSFER }],
  maxPerPaymentUsd8: 5n * USD,
  maxPerDayUsd8: 20n * USD,
};

const REGISTRY = createScopeRegistry([RENT, COMPUTE]);

const TIMING: PaymentTiming = { minIntervalSeconds: 60 };

const SESSION: SessionPermissions = {
  calls: [{ to: USDT, signature: TRANSFER }],
  spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
  expiresAt: NOW + 30 * 86_400,
};

function charge(overrides: Partial<DueCharge> = {}): DueCharge {
  return {
    subscriptionId: "office-rent",
    agentId: "rent-agent",
    periodIndex: 0,
    payee: RENT_PAYEE,
    amountUsd8: 10n * USD,
    call: { to: USDT, signature: TRANSFER },
    periodStartSeconds: NOW - 100,
    ...overrides,
  };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    ...initialExecuteState(),
    agents: {
      // The day started an hour ago, not a day ago: a helper whose default already rolls the
      // budget over would make every limit test pass for the wrong reason.
      "rent-agent": { spentTodayUsd8: 0n, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
      "compute-agent": { spentTodayUsd8: 0n, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
    },
    ...overrides,
  };
}

function deps(overrides: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    pay: async () => HASH,
    now: () => NOW,
    sessionPermissions: SESSION,
    ...overrides,
  };
}

describe("the ordinary case", () => {
  it("pays and records it", async () => {
    const result = await payCharge(charge(), REGISTRY, TIMING, state(), deps());
    expect(result.paid).toBe(true);
    expect(result.amountPaidUsd8).toBe(10n * USD);
    expect(result.txHash).toBe(HASH);
    const entry = entryFor(result.state.ledger, "office-rent", 0)!;
    expect(entry.status).toBe("PAID");
    expect(entry.txHash).toBe(HASH);
    expect(result.state.agents["rent-agent"]!.spentTodayUsd8).toBe(10n * USD);
  });

  it("never changes the state it was given", async () => {
    const before = state();
    await payCharge(charge(), REGISTRY, TIMING, before, deps());
    expect(before.ledger).toEqual({});
    expect(before.agents["rent-agent"]!.spentTodayUsd8).toBe(0n);
  });

  it("starts an agent nobody has a budget for yet at zero, not at unlimited", async () => {
    const empty = { killed: false, agents: {}, ledger: {} };
    expect(budgetFor(empty, "new-agent", NOW).spentTodayUsd8).toBe(0n);
    expect(budgetFor(empty, "new-agent", NOW).lastPaymentAt).toBe(0);
  });
});

describe("one agent trying to use another agent's powers", () => {
  it("refuses to pay somebody only the other agent may pay", async () => {
    // REQUIRED BY THE BRIEF, and MONEY SAFETY RULE S5, this time all the way through the
    // paying path rather than only in the scope check.
    const pay = vi.fn(async () => HASH);
    const result = await payCharge(
      charge({ payee: COMPUTE_PAYEE }),
      REGISTRY,
      TIMING,
      state(),
      deps({ pay }),
    );
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("may not pay");
    // Nothing at all is written down for a refused payment.
    expect(result.state.ledger).toEqual({});
  });

  it("refuses an amount only the other agent's larger limit would allow", async () => {
    const result = await payCharge(
      charge({ agentId: "compute-agent", payee: COMPUTE_PAYEE, amountUsd8: 50n * USD }),
      REGISTRY,
      TIMING,
      state(),
      deps(),
    );
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("at most");
  });

  it("refuses an agent that has no scope on this wallet", async () => {
    const result = await payCharge(charge({ agentId: "ghost" }), REGISTRY, TIMING, state(), deps());
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("no scope called");
  });

  it("gives each agent its own daily budget, not a share of one", async () => {
    // MONEY SAFETY RULE S8. A single shared budget would let the agent buying computing time
    // eat the whole allowance and leave the one paying the rent with nothing, and neither
    // would have done anything wrong. Deleting the per agent budgets makes this fail.
    const spent = state({
      agents: {
        "rent-agent": { spentTodayUsd8: 50n * USD, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
        "compute-agent": { spentTodayUsd8: 0n, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
      },
    });
    // The rent agent is out of room.
    const blocked = await payCharge(charge({ periodIndex: 1 }), REGISTRY, TIMING, spent, deps());
    expect(blocked.paid).toBe(false);
    expect(blocked.reason).toContain("of its own");
    // The compute agent is untouched by that.
    const fine = await payCharge(
      charge({
        subscriptionId: "compute",
        agentId: "compute-agent",
        payee: COMPUTE_PAYEE,
        amountUsd8: 5n * USD,
      }),
      REGISTRY,
      TIMING,
      spent,
      deps(),
    );
    expect(fine.paid).toBe(true);
  });

  it("spends only the paying agent's budget, leaving the other's alone", async () => {
    const result = await payCharge(charge(), REGISTRY, TIMING, state(), deps());
    expect(result.state.agents["rent-agent"]!.spentTodayUsd8).toBe(10n * USD);
    expect(result.state.agents["compute-agent"]!.spentTodayUsd8).toBe(0n);
  });

  it("gives each agent its own waiting time as well", async () => {
    const justPaid = state({
      agents: {
        "rent-agent": { spentTodayUsd8: 0n, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 10 },
        "compute-agent": { spentTodayUsd8: 0n, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
      },
    });
    expect((await payCharge(charge(), REGISTRY, TIMING, justPaid, deps())).paid).toBe(false);
    expect(
      (
        await payCharge(
          charge({ subscriptionId: "compute", agentId: "compute-agent", payee: COMPUTE_PAYEE, amountUsd8: 5n * USD }),
          REGISTRY,
          TIMING,
          justPaid,
          deps(),
        )
      ).paid,
    ).toBe(true);
  });
});

describe("a period that has already been dealt with", () => {
  it("pays nothing for one already paid", async () => {
    const paid = state({
      ledger: markPaid(
        markInFlight({}, {
          subscriptionId: "office-rent",
          periodIndex: 0,
          amountUsd8: 10n * USD,
          agentId: "rent-agent",
          startedAt: NOW - 100,
        }),
        "office-rent",
        0,
        HASH,
      ),
    });
    const pay = vi.fn(async () => HASH);
    const result = await payCharge(charge(), REGISTRY, TIMING, paid, deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("Nothing is paid twice");
  });

  it("pays nothing for one still in the air", async () => {
    // MONEY SAFETY RULE S2. This is what makes a crash in the middle of a payment survivable.
    const inFlight = state({
      ledger: markInFlight({}, {
        subscriptionId: "office-rent",
        periodIndex: 0,
        amountUsd8: 10n * USD,
        agentId: "rent-agent",
        startedAt: NOW - 100,
      }),
    });
    const pay = vi.fn(async () => HASH);
    const result = await payCharge(charge(), REGISTRY, TIMING, inFlight, deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("risks paying twice");
  });

  it("lets a person clear one that never went out, and then pays it", async () => {
    const inFlight = state({
      ledger: markInFlight({}, {
        subscriptionId: "office-rent",
        periodIndex: 0,
        amountUsd8: 10n * USD,
        agentId: "rent-agent",
        startedAt: NOW - 100,
      }),
    });
    const cleared = { ...inFlight, ledger: clearInFlight(inFlight.ledger, "office-rent", 0) };
    expect((await payCharge(charge(), REGISTRY, TIMING, cleared, deps())).paid).toBe(true);
  });
});

describe("the stop switch", () => {
  it("pays nothing while it is on", async () => {
    const pay = vi.fn(async () => HASH);
    const result = await payCharge(charge(), REGISTRY, TIMING, state({ killed: true }), deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
  });

  it("beats every other rule", async () => {
    const result = await payCharge(charge(), REGISTRY, TIMING, state({ killed: true }), deps());
    expect(result.reason).toContain("stop switch");
  });
});

describe("the key running out", () => {
  it("pays nothing once it has stopped working", async () => {
    const pay = vi.fn(async () => HASH);
    const result = await payCharge(
      charge(),
      REGISTRY,
      TIMING,
      state(),
      deps({ pay, sessionPermissions: { ...SESSION, expiresAt: NOW - 1 } }),
    );
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("stopped working");
  });

  it("pays nothing when it stops working inside the safety margin", async () => {
    const result = await payCharge(
      charge(),
      REGISTRY,
      TIMING,
      state(),
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW + 30 } }),
    );
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("margin");
  });

  it("writes nothing down when it refuses on the key", async () => {
    const result = await payCharge(
      charge(),
      REGISTRY,
      TIMING,
      state(),
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW - 1 } }),
    );
    expect(result.state.ledger).toEqual({});
  });
});

describe("the day rolling over", () => {
  it("starts the agent's budget again after a whole day", async () => {
    const result = await payCharge(
      charge(),
      REGISTRY,
      TIMING,
      state({
        agents: {
          "rent-agent": { spentTodayUsd8: 50n * USD, dayStartedAt: NOW - 86_400, lastPaymentAt: NOW - 86_400 },
        },
      }),
      deps(),
    );
    expect(result.paid).toBe(true);
    expect(result.state.agents["rent-agent"]!.spentTodayUsd8).toBe(10n * USD);
  });

  it("does not start it again one second early", async () => {
    const result = await payCharge(
      charge(),
      REGISTRY,
      TIMING,
      state({
        agents: {
          "rent-agent": { spentTodayUsd8: 50n * USD, dayStartedAt: NOW - 86_399, lastPaymentAt: NOW - 86_399 },
        },
      }),
      deps(),
    );
    expect(result.paid).toBe(false);
  });

  it("allows a payment that lands exactly on the day's limit", async () => {
    const result = await payCharge(
      charge({ amountUsd8: 10n * USD }),
      REGISTRY,
      TIMING,
      state({
        agents: {
          "rent-agent": { spentTodayUsd8: 40n * USD, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
        },
      }),
      deps(),
    );
    expect(result.paid).toBe(true);
  });

  it("refuses one hundred-millionth of a dollar over the day's limit", async () => {
    const result = await payCharge(
      charge({ amountUsd8: 10n * USD }),
      REGISTRY,
      TIMING,
      state({
        agents: {
          "rent-agent": { spentTodayUsd8: 40n * USD + 1n, dayStartedAt: NOW - 3_600, lastPaymentAt: NOW - 3_600 },
        },
      }),
      deps(),
    );
    expect(result.paid).toBe(false);
  });
});

describe("writing it down before sending", () => {
  it("saves first, then pays", async () => {
    const order: string[] = [];
    let saved: ExecuteState | null = null;
    await payCharge(charge(), REGISTRY, TIMING, state(), deps({
      persistBeforeSend: (s) => {
        order.push("save");
        saved = s;
      },
      pay: async () => {
        order.push("pay");
        return HASH;
      },
    }));
    expect(order).toEqual(["save", "pay"]);
    expect(entryFor(saved!.ledger, "office-rent", 0)!.status).toBe("IN_FLIGHT");
    expect(saved!.agents["rent-agent"]!.spentTodayUsd8).toBe(10n * USD);
  });

  it("refuses to pay at all when the record cannot be saved", async () => {
    // Fails closed. A payment with no record that could hold it back is somebody's money
    // gone; a payment not made is one late bill.
    const pay = vi.fn(async () => HASH);
    const err = await payCharge(charge(), REGISTRY, TIMING, state(), deps({
      pay,
      persistBeforeSend: () => {
        throw new Error("the disk is full");
      },
    })).catch((e) => e);
    expect(err).toBeInstanceOf(NeverSentError);
    expect(pay).not.toHaveBeenCalled();
    expect(wasNeverSent(err)).toBe(true);
    expect(asPaymentFailure(err)).toBeNull();
  });
});

describe("a payment that failed after touching the network", () => {
  it("throws an error carrying the state where the period is already recorded", async () => {
    const err = await payCharge(charge(), REGISTRY, TIMING, state(), deps({
      pay: async () => {
        throw new Error("waiting for the result timed out");
      },
    })).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentFailedError);
    const carried = asPaymentFailure(err)!;
    expect(entryFor(carried.stateAfterSend.ledger, "office-rent", 0)!.status).toBe("IN_FLIGHT");
    expect(carried.stateAfterSend.agents["rent-agent"]!.spentTodayUsd8).toBe(10n * USD);
  });

  it("makes that carried state refuse the same period on the next attempt", async () => {
    // The point of carrying it. Using the old state here is the double payment bug.
    const err = await payCharge(charge(), REGISTRY, TIMING, state(), deps({
      pay: async () => {
        throw new Error("the connection dropped");
      },
    })).catch((e) => e);
    const next = asPaymentFailure(err)!.stateAfterSend;
    const again = await payCharge(charge(), REGISTRY, TIMING, next, deps());
    expect(again.paid).toBe(false);
    expect(again.reason).toContain("risks paying twice");
  });

  it("passes an error marked as never sent straight through", async () => {
    const original = new NeverSentError("nothing was sent");
    const err = await payCharge(charge(), REGISTRY, TIMING, state(), deps({
      pay: async () => {
        throw original;
      },
    })).catch((e) => e);
    expect(err).toBe(original);
    expect(asPaymentFailure(err)).toBeNull();
  });

  it("is still found when something upstream wraps it", async () => {
    const inner = await payCharge(charge(), REGISTRY, TIMING, state(), deps({
      pay: async () => {
        throw new Error("the connection dropped");
      },
    })).catch((e) => e);
    const carried = asPaymentFailure(new Error("while running the cycle", { cause: inner }));
    expect(carried).not.toBeNull();
  });

  it("gives up on a chain of causes that loops", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(asPaymentFailure(a)).toBeNull();
  });

  it("refuses to believe a marker with no real state attached", () => {
    expect(asPaymentFailure({ paymentFailure: true, stateAfterSend: { nonsense: 1 } })).toBeNull();
  });
});
