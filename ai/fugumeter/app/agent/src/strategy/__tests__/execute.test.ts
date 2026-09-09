import { describe, expect, it, vi } from "vitest";
import {
  asPaymentFailure,
  clearPendingPayment,
  initialExecuteState,
  NeverSentError,
  payInvoice,
  PaymentFailedError,
  wasNeverSent,
  type ExecuteDeps,
  type ExecuteState,
  type PaymentLimits,
} from "../execute.js";
import type { Invoice } from "../types.js";
import { EXPIRY_SAFETY_MARGIN_SECONDS, type SessionPermissions } from "../session.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const SESSION: SessionPermissions = {
  calls: [{ to: "0x1111111111111111111111111111111111111111", signature: "transfer(address,uint256)" }],
  spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
  expiresAt: NOW + 30 * 86_400,
};

const LIMITS: PaymentLimits = {
  maxPerPaymentUsd8: 10n * USD,
  maxPerDayUsd8: 50n * USD,
  minIntervalSeconds: 60,
};

function invoice(totalUsd8: bigint, from = NOW - 3_600, to = NOW): Invoice {
  return {
    window: { fromSeconds: from, toSeconds: to },
    lines:
      totalUsd8 === 0n
        ? []
        : [{ unit: "CALL", quantity: 1n, amountUsd8: totalUsd8, explanation: "one call" }],
    totalUsd8,
    empty: totalUsd8 === 0n,
  };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  // The day started an hour ago, not a day ago: a helper whose default state already rolls
  // the budget over would make every limit test pass for the wrong reason.
  return {
    ...initialExecuteState(NOW - 3_600),
    lastPaymentAt: NOW - 3_600,
    billedThroughSeconds: NOW - 3_600,
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
  it("pays the bill and moves every mark", async () => {
    const result = await payInvoice(invoice(5n * USD), LIMITS, state(), deps());
    expect(result.paid).toBe(true);
    expect(result.amountPaidUsd8).toBe(5n * USD);
    expect(result.txHash).toBe(HASH);
    expect(result.state.spentTodayUsd8).toBe(5n * USD);
    expect(result.state.lastPaymentAt).toBe(NOW);
    expect(result.state.billedThroughSeconds).toBe(NOW);
    expect(result.state.pendingPayment).toBeNull();
  });

  it("never changes the state it was given", async () => {
    const before = state();
    const snapshot = JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    await payInvoice(invoice(5n * USD), LIMITS, before, deps());
    expect(JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });
});

describe("nothing was used", () => {
  it("pays nothing at all for an empty bill", async () => {
    // REQUIRED BY THE BRIEF, and MONEY SAFETY RULE M5. Not a payment of zero, not a minimum
    // charge. An agent that pays without anybody approving each payment must never pay for
    // something that did not happen.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(invoice(0n), LIMITS, state(), deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("did not happen");
  });

  it("leaves every mark exactly where it was, including the billing mark", async () => {
    // If an empty bill moved the billing mark, seconds could be skipped over and use inside
    // them would never be paid for at all.
    const before = state();
    const result = await payInvoice(invoice(0n), LIMITS, before, deps());
    expect(result.state).toBe(before);
    expect(result.state.billedThroughSeconds).toBe(before.billedThroughSeconds);
  });

  it("pays nothing for a bill whose lines add up to nothing", async () => {
    const odd: Invoice = { ...invoice(0n), empty: false };
    const result = await payInvoice(odd, LIMITS, state(), deps());
    expect(result.paid).toBe(false);
  });
});

describe("the key running out part way through", () => {
  it("pays nothing when the key stopped working while the agent was working out the bill", async () => {
    // REQUIRED BY THE BRIEF, and MONEY SAFETY RULE M6. The key is checked HERE, at the last
    // possible moment, not only when the agent started. A cycle that began while the key was
    // fine can reach this line after it stopped working, and by then the alternative is a
    // send that the account contract refuses AFTER the budget has been charged.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({ pay, sessionPermissions: { ...SESSION, expiresAt: NOW - 1 } }),
    );
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("stopped working");
  });

  it("pays nothing when the key stops working inside the safety margin", async () => {
    // A payment is not instant. A key with thirty seconds left can be expired by the time
    // the account contract checks it.
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW + 30 } }),
    );
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("margin");
  });

  it("pays when the key is one second clear of the margin", async () => {
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW + EXPIRY_SAFETY_MARGIN_SECONDS + 1 } }),
    );
    expect(result.paid).toBe(true);
  });

  it("leaves the state untouched when it refuses on the key, because nothing was sent", async () => {
    const before = state();
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      before,
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW - 1 } }),
    );
    expect(result.state).toBe(before);
  });

  it("pays nothing when nobody said when the key stops working", async () => {
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({ sessionPermissions: { ...SESSION, expiresAt: undefined } }),
    );
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("does not say when it stops");
  });
});

describe("today's limit, at the exact boundary", () => {
  it("pays a bill that lands exactly on the limit", async () => {
    // REQUIRED BY THE BRIEF. Exactly at the limit is allowed: a limit of fifty dollars a day
    // means fifty dollars may be spent, not forty nine.
    const result = await payInvoice(
      invoice(10n * USD),
      LIMITS,
      state({ spentTodayUsd8: 40n * USD }),
      deps(),
    );
    expect(result.paid).toBe(true);
    expect(result.state.spentTodayUsd8).toBe(50n * USD);
  });

  it("pays nothing when the bill is one hundred-millionth of a dollar over what is left", async () => {
    // MONEY SAFETY RULE M7. One unit over is where an off by one lets a whole extra bill
    // through. The bill is kept at ten dollars, inside the one payment limit, so this test
    // can only fail on the daily rule and not on the one above it. Changing the comparison
    // in rule 6 from `>` to `>=` makes the previous test fail; deleting the rule makes this
    // one fail.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(
      invoice(10n * USD),
      LIMITS,
      state({ spentTodayUsd8: 40n * USD + 1n }),
      deps({ pay }),
    );
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("left of today");
  });

  it("pays nothing once the day is completely used up", async () => {
    const result = await payInvoice(
      invoice(1n),
      LIMITS,
      state({ spentTodayUsd8: 50n * USD }),
      deps(),
    );
    expect(result.paid).toBe(false);
  });

  it("starts the day again once a whole day has passed", async () => {
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state({ spentTodayUsd8: 50n * USD, dayStartedAt: NOW - 86_400 }),
      deps(),
    );
    expect(result.paid).toBe(true);
    expect(result.state.spentTodayUsd8).toBe(5n * USD);
    expect(result.state.dayStartedAt).toBe(NOW);
  });

  it("does not start the day again one second early", async () => {
    const result = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state({ spentTodayUsd8: 50n * USD, dayStartedAt: NOW - 86_399 }),
      deps(),
    );
    expect(result.paid).toBe(false);
  });
});

describe("a bill too large for one payment", () => {
  it("pays exactly at the one payment limit", async () => {
    const result = await payInvoice(invoice(10n * USD), LIMITS, state(), deps());
    expect(result.paid).toBe(true);
  });

  it("refuses rather than paying part of it", async () => {
    // MONEY SAFETY RULE M8. Fugu Pilot trims an oversized trade, because half a trade is
    // still a sensible trade. Half a bill is not: the rest stays owed, follows the account
    // around, and nobody decided to let it. Refusing puts it in front of a person.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(invoice(10n * USD + 1n), LIMITS, state(), deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("a person should look at it");
  });
});

describe("the stop switch", () => {
  it("pays nothing while it is on", async () => {
    // MONEY SAFETY RULE M9. This is the owner's only way out of an agent that pays without
    // asking. Deleting the `state.killed` branch takes it away.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(invoice(1n * USD), LIMITS, state({ killed: true }), deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
  });

  it("beats every other rule, including a bill that would otherwise be fine", async () => {
    const result = await payInvoice(
      invoice(1n * USD),
      LIMITS,
      state({ killed: true, spentTodayUsd8: 0n, lastPaymentAt: 0 }),
      deps(),
    );
    expect(result.reason).toContain("stop switch");
  });
});

describe("a payment that has not been proven finished", () => {
  const pending = state({
    pendingPayment: {
      amountUsd8: 5n * USD,
      windowFromSeconds: NOW - 7_200,
      windowToSeconds: NOW - 3_600,
      startedAt: NOW - 100,
      txHash: null,
    },
  });

  it("blocks every new payment", async () => {
    // MONEY SAFETY RULE M10. This is what stops a second payment when waiting for a result
    // times out after the transaction already landed.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(invoice(1n * USD), LIMITS, pending, deps({ pay }));
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("risks paying twice");
  });

  it("lets a person clear it once they have looked at the blockchain themselves", async () => {
    const result = await payInvoice(invoice(1n * USD), LIMITS, clearPendingPayment(pending), deps());
    expect(result.paid).toBe(true);
  });
});

describe("the mark of what has already been billed", () => {
  it("refuses a bill for a stretch of time already paid for", async () => {
    // MONEY SAFETY RULE M11. This is the mark that makes a restart safe. Without it a
    // process that comes back up counts the same seconds again and pays for them again, and
    // every other check is satisfied because the second bill is a perfectly valid bill.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(
      invoice(5n * USD, NOW - 7_200, NOW - 3_600),
      LIMITS,
      state({ billedThroughSeconds: NOW - 3_600 }),
      deps({ pay }),
    );
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("already been paid for");
  });

  it("refuses a bill that ends exactly where the mark already is", async () => {
    // MONEY SAFETY RULE M11, on its own. This case reaches only the first of the two checks:
    // the bill covers no new time at all while still asking for money. The overlap check
    // below cannot catch it, because the bill does not start before the mark either. Without
    // this test, deleting the first check leaves every other test still passing, because the
    // overlap check happens to produce a similar sentence.
    const pay = vi.fn(async () => HASH);
    const result = await payInvoice(
      invoice(5n * USD, NOW, NOW),
      LIMITS,
      state({ billedThroughSeconds: NOW }),
      deps({ pay }),
    );
    expect(result.paid).toBe(false);
    expect(pay).not.toHaveBeenCalled();
    expect(result.reason).toContain("has already been paid for");
  });

  it("refuses a bill that overlaps the stretch already paid for, rather than paying the new part", async () => {
    // Working out which part is new would be guesswork, and the guess would be about money.
    const result = await payInvoice(
      invoice(5n * USD, NOW - 5_400, NOW),
      LIMITS,
      state({ billedThroughSeconds: NOW - 3_600 }),
      deps(),
    );
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("overlapping bill");
  });

  it("accepts a bill that starts exactly where the last one ended", async () => {
    const result = await payInvoice(
      invoice(5n * USD, NOW - 3_600, NOW),
      LIMITS,
      state({ billedThroughSeconds: NOW - 3_600 }),
      deps(),
    );
    expect(result.paid).toBe(true);
  });

  it("moves the mark BEFORE the payment goes out, so a crash cannot rewind it", async () => {
    // The order matters more than the value. If the mark only moved after a successful
    // payment, a process that died while waiting for a result would come back and bill the
    // same seconds again.
    let savedBeforeSend: ExecuteState | null = null;
    await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({
        persistBeforeSend: (s) => {
          savedBeforeSend = s;
        },
      }),
    );
    expect(savedBeforeSend!.billedThroughSeconds).toBe(NOW);
    expect(savedBeforeSend!.pendingPayment).not.toBeNull();
  });
});

describe("the waiting time between payments", () => {
  it("pays nothing before enough time has passed", async () => {
    const result = await payInvoice(
      invoice(1n * USD),
      LIMITS,
      state({ lastPaymentAt: NOW - 59 }),
      deps(),
    );
    expect(result.paid).toBe(false);
    expect(result.reason).toContain("59 seconds");
  });

  it("pays at exactly the waiting time", async () => {
    const result = await payInvoice(
      invoice(1n * USD),
      LIMITS,
      state({ lastPaymentAt: NOW - 60 }),
      deps(),
    );
    expect(result.paid).toBe(true);
  });
});

describe("saving before sending", () => {
  it("saves first, then pays", async () => {
    const order: string[] = [];
    await payInvoice(
      invoice(1n * USD),
      LIMITS,
      state(),
      deps({
        persistBeforeSend: () => {
          order.push("save");
        },
        pay: async () => {
          order.push("pay");
          return HASH;
        },
      }),
    );
    expect(order).toEqual(["save", "pay"]);
  });

  it("refuses to pay at all when the record cannot be saved", async () => {
    // Fails closed. Not paying is one missed cycle. Paying with no record that could hold
    // back a second payment is somebody's money gone.
    const pay = vi.fn(async () => HASH);
    const err = await payInvoice(
      invoice(1n * USD),
      LIMITS,
      state(),
      deps({
        pay,
        persistBeforeSend: () => {
          throw new Error("the disk is full");
        },
      }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NeverSentError);
    expect(pay).not.toHaveBeenCalled();
    expect(wasNeverSent(err)).toBe(true);
    expect(asPaymentFailure(err)).toBeNull();
  });
});

describe("a payment that failed after touching the network", () => {
  it("throws an error carrying the state that already counted the money and moved the mark", async () => {
    // The heart of it. Failed does not mean it did not happen.
    const err = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({
        pay: async () => {
          throw new Error("waiting for the result timed out");
        },
      }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentFailedError);
    const carried = asPaymentFailure(err);
    expect(carried!.stateAfterSend.spentTodayUsd8).toBe(5n * USD);
    expect(carried!.stateAfterSend.billedThroughSeconds).toBe(NOW);
    expect(carried!.stateAfterSend.pendingPayment).not.toBeNull();
  });

  it("passes an error marked as never sent straight through", async () => {
    const original = new NeverSentError("the amount came to nothing");
    const err = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({
        pay: async () => {
          throw original;
        },
      }),
    ).catch((e) => e);
    expect(err).toBe(original);
    expect(asPaymentFailure(err)).toBeNull();
  });

  it("is still found when something upstream wraps it", async () => {
    const inner = await payInvoice(
      invoice(5n * USD),
      LIMITS,
      state(),
      deps({
        pay: async () => {
          throw new Error("the connection dropped");
        },
      }),
    ).catch((e) => e);
    const carried = asPaymentFailure(new Error("while running the cycle", { cause: inner }));
    expect(carried!.stateAfterSend.spentTodayUsd8).toBe(5n * USD);
  });

  it("gives up on a chain of causes that loops", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(asPaymentFailure(a)).toBeNull();
  });

  it("refuses to believe a marker with no real state attached", () => {
    expect(asPaymentFailure({ paymentFailure: true, stateAfterSend: { nonsense: 1 } })).toBeNull();
    expect(asPaymentFailure({ paymentFailure: true })).toBeNull();
  });
});
