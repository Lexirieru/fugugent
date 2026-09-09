import { describe, expect, it } from "vitest";
import {
  chargeKey,
  clearInFlight,
  entryFor,
  inFlightEntries,
  isSettled,
  LedgerError,
  markInFlight,
  markPaid,
  pruneLedger,
  type Ledger,
} from "../ledger.js";

const USD = 100_000_000n;
const T = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

function started(ledger: Ledger, subId: string, index: number): Ledger {
  return markInFlight(ledger, {
    subscriptionId: subId,
    periodIndex: index,
    amountUsd8: 10n * USD,
    agentId: "rent-agent",
    startedAt: T,
  });
}

describe("the key for one period", () => {
  it("is made of the name and the period", () => {
    expect(chargeKey("rent", 3)).toBe("rent#3");
  });

  it("refuses a name containing the separator", () => {
    // Two different periods could otherwise end up sharing one record, and one of them would
    // never be paid while the other might be paid twice.
    expect(() => chargeKey("rent#1", 3)).toThrow(/separates a name from a period/);
  });

  it("refuses a name that is empty", () => {
    expect(() => chargeKey("", 0)).toThrow(/no name/);
  });

  it("refuses a period that is not a whole count from zero", () => {
    expect(() => chargeKey("rent", -1)).toThrow(/whole count/);
    expect(() => chargeKey("rent", 1.5)).toThrow(/whole count/);
  });
});

describe("what counts as dealt with", () => {
  it("counts a completed payment", () => {
    const ledger = markPaid(started({}, "rent", 0), "rent", 0, HASH);
    expect(isSettled(ledger, "rent", 0)).toBe(true);
  });

  it("counts a payment that is still in the air, exactly as firmly", () => {
    // MONEY SAFETY RULE S2. Answering false here is the double payment bug arriving through
    // the quietest door there is. Changing `isSettled` to only accept PAID makes this fail.
    expect(isSettled(started({}, "rent", 0), "rent", 0)).toBe(true);
  });

  it("counts nothing for a period never touched", () => {
    expect(isSettled({}, "rent", 0)).toBe(false);
    expect(isSettled(started({}, "rent", 0), "rent", 1)).toBe(false);
  });

  it("keeps different repeating payments apart", () => {
    const ledger = started({}, "rent", 0);
    expect(isSettled(ledger, "compute", 0)).toBe(false);
  });
});

describe("writing down that a payment is starting", () => {
  it("records it as in the air, with no transaction yet", () => {
    const entry = entryFor(started({}, "rent", 0), "rent", 0)!;
    expect(entry.status).toBe("IN_FLIGHT");
    expect(entry.txHash).toBeNull();
    expect(entry.amountUsd8).toBe(10n * USD);
    expect(entry.agentId).toBe("rent-agent");
  });

  it("refuses to start something already recorded", () => {
    // MONEY SAFETY RULE S6. Whether the existing record says paid or in the air, the right
    // answer is to do nothing rather than to try again.
    const ledger = started({}, "rent", 0);
    expect(() => started(ledger, "rent", 0)).toThrow(/is how one bill gets paid twice/);
  });

  it("refuses to start something already paid", () => {
    const ledger = markPaid(started({}, "rent", 0), "rent", 0, HASH);
    expect(() => started(ledger, "rent", 0)).toThrow(LedgerError);
  });

  it("never changes the record it was given", () => {
    const before: Ledger = {};
    started(before, "rent", 0);
    expect(before).toEqual({});
  });
});

describe("writing down that a payment finished", () => {
  it("keeps the transaction", () => {
    const entry = entryFor(markPaid(started({}, "rent", 0), "rent", 0, HASH), "rent", 0)!;
    expect(entry.status).toBe("PAID");
    expect(entry.txHash).toBe(HASH);
  });

  it("refuses to mark something paid that was never written down first", () => {
    // A payment that was never written down first is a payment nothing could have held back.
    expect(() => markPaid({}, "rent", 0, HASH)).toThrow(/it was ever started/);
  });
});

describe("a person clearing something that never actually went out", () => {
  it("removes a record that is in the air", () => {
    const ledger = clearInFlight(started({}, "rent", 0), "rent", 0);
    expect(isSettled(ledger, "rent", 0)).toBe(false);
  });

  it("refuses to touch a completed payment", () => {
    // MONEY SAFETY RULE S6. Undoing a completed payment is the one edit that would let it
    // happen a second time.
    const ledger = markPaid(started({}, "rent", 0), "rent", 0, HASH);
    expect(() => clearInFlight(ledger, "rent", 0)).toThrow(/would let it be paid a second time/);
  });

  it("does nothing at all for a period with no record", () => {
    expect(clearInFlight({}, "rent", 0)).toEqual({});
  });
});

describe("seeing what still needs a person", () => {
  it("lists everything still in the air, oldest first", () => {
    let ledger = markInFlight({}, {
      subscriptionId: "b",
      periodIndex: 0,
      amountUsd8: 1n,
      agentId: "x",
      startedAt: T + 10,
    });
    ledger = markInFlight(ledger, {
      subscriptionId: "a",
      periodIndex: 0,
      amountUsd8: 1n,
      agentId: "x",
      startedAt: T,
    });
    ledger = markPaid(started(ledger, "c", 0), "c", 0, HASH);
    expect(inFlightEntries(ledger).map((e) => e.subscriptionId)).toEqual(["a", "b"]);
  });
});

describe("keeping the record from growing without end", () => {
  const current = () => 100;

  it("drops completed records far enough behind that nothing will ask again", () => {
    let ledger: Ledger = {};
    for (const i of [10, 50, 98, 99]) {
      ledger = markPaid(started(ledger, "rent", i), "rent", i, HASH);
    }
    const pruned = pruneLedger(ledger, current, 5, 3);
    expect(Object.keys(pruned).sort()).toEqual(["rent#98", "rent#99"]);
  });

  it("refuses to keep less than the schedule still looks back", () => {
    // MONEY SAFETY RULE S7. Pruning a record that can still come up as due would let that
    // period be paid a second time. This is the double payment bug arriving by way of
    // tidiness, so the refusal is loud.
    expect(() => pruneLedger({}, current, 2, 3)).toThrow(/paid a second time/);
  });

  it("never drops anything still in the air, however old it is", () => {
    // Those are precisely the ones a person still has to resolve.
    const ledger = markInFlight({}, {
      subscriptionId: "rent",
      periodIndex: 1,
      amountUsd8: 1n,
      agentId: "x",
      startedAt: T,
    });
    expect(Object.keys(pruneLedger(ledger, current, 5, 3))).toEqual(["rent#1"]);
  });

  it("keeps records for a repeating payment it knows nothing about any more", () => {
    // Nothing can be proven about whether they are still needed. Keeping them costs a few
    // bytes; dropping them could cost a payment.
    const ledger = markPaid(started({}, "gone", 1), "gone", 1, HASH);
    expect(Object.keys(pruneLedger(ledger, () => null, 5, 3))).toEqual(["gone#1"]);
  });

  it("refuses a keep count that is not a whole number", () => {
    expect(() => pruneLedger({}, current, -1, 0)).toThrow(/whole count/);
  });
});
