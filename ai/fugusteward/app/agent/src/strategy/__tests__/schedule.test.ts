import { describe, expect, it } from "vitest";
import {
  assertScheduleOptionsAreSane,
  assertSubscriptionIsSane,
  currentPeriodIndex,
  DEFAULT_SCHEDULE_OPTIONS,
  dueCharges,
  dueChargesForAll,
  lastPeriodIndex,
  periodStartSeconds,
} from "../schedule.js";
import { ScheduleError, type Subscription } from "../types.js";

const USD = 100_000_000n;
const T = 1_800_000_000;
const DAY = 86_400;
const PAYEE = "0x2222222222222222222222222222222222222222" as const;

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "office-rent",
    agentId: "rent-agent",
    payee: PAYEE,
    amountUsd8: 10n * USD,
    anchorSeconds: T,
    intervalSeconds: DAY,
    totalPeriods: null,
    active: true,
    call: { to: "0x3333333333333333333333333333333333333333", signature: "transfer(address,uint256)" },
    ...overrides,
  };
}

/** Nothing has been paid. */
const nothingSettled = () => false;

describe("checking a schedule", () => {
  it("accepts an ordinary one", () => {
    expect(() => assertSubscriptionIsSane(sub())).not.toThrow();
  });

  it("refuses one that does not say which agent may pay it", () => {
    // MONEY SAFETY RULE S1. On a wallet shared by several agents, not naming one is the same
    // as naming all of them.
    expect(() => assertSubscriptionIsSane(sub({ agentId: "" }))).toThrow(/which agent may pay it/);
  });

  it("refuses a gap of zero, which would make every second its own payment", () => {
    expect(() => assertSubscriptionIsSane(sub({ intervalSeconds: 0 }))).toThrow(/not a usable gap/);
  });

  it("refuses an amount that is not positive", () => {
    expect(() => assertSubscriptionIsSane(sub({ amountUsd8: 0n }))).toThrow(/not a positive amount/);
  });

  it("refuses a start time made of parts of seconds", () => {
    expect(() => assertSubscriptionIsSane(sub({ anchorSeconds: T + 0.5 }))).toThrow(/whole second/);
  });

  it("refuses catching up fewer than one period per cycle, which never catches up", () => {
    expect(() =>
      assertScheduleOptionsAreSane({ maxCatchUpPerCycle: 0, maxBacklogPeriods: 3 }),
    ).toThrow(/never catches up/);
  });
});

describe("where the periods fall", () => {
  it("puts period zero at the start", () => {
    expect(periodStartSeconds(sub(), 0)).toBe(T);
    expect(periodStartSeconds(sub(), 5)).toBe(T + 5 * DAY);
  });

  it("counts from a fixed point, not from whenever the agent last ran", () => {
    // An agent late by an hour is late. It does not move every future payment an hour later.
    expect(currentPeriodIndex(sub(), T + 3 * DAY + 3_600)).toBe(3);
  });

  it("says -1 before the first period has started", () => {
    expect(currentPeriodIndex(sub(), T - 1)).toBe(-1);
  });

  it("starts period zero at the exact anchor second", () => {
    expect(currentPeriodIndex(sub(), T)).toBe(0);
  });

  it("moves to the next period at the exact second it starts", () => {
    expect(currentPeriodIndex(sub(), T + DAY - 1)).toBe(0);
    expect(currentPeriodIndex(sub(), T + DAY)).toBe(1);
  });

  it("knows the last period of one that ends, and none for one that does not", () => {
    expect(lastPeriodIndex(sub({ totalPeriods: 12 }))).toBe(11);
    expect(lastPeriodIndex(sub())).toBeNull();
  });
});

describe("what is due", () => {
  it("finds nothing before the first period starts", () => {
    expect(dueCharges(sub(), T - 1, nothingSettled).due).toEqual([]);
  });

  it("finds the first period at the exact second it starts", () => {
    // Paid in advance, the way a subscription is: you pay for the month, then you get it.
    const result = dueCharges(sub(), T, nothingSettled);
    expect(result.due).toHaveLength(1);
    expect(result.due[0]!.periodIndex).toBe(0);
    expect(result.due[0]!.amountUsd8).toBe(10n * USD);
  });

  it("finds nothing for a paused one", () => {
    // Pausing is not cancelling, and it means nothing at all is due meanwhile.
    expect(dueCharges(sub({ active: false }), T + 5 * DAY, nothingSettled).due).toEqual([]);
  });

  it("finds nothing once a fixed length one has run out", () => {
    const finite = sub({ totalPeriods: 3 });
    const settled = (_id: string, index: number) => index < 3;
    expect(dueCharges(finite, T + 10 * DAY, settled).due).toEqual([]);
  });

  it("never offers a period past the last one of a fixed length schedule", () => {
    const result = dueCharges(sub({ totalPeriods: 2 }), T + 10 * DAY, nothingSettled, {
      maxCatchUpPerCycle: 10,
      maxBacklogPeriods: 100,
    });
    expect(result.due.map((c) => c.periodIndex)).toEqual([0, 1]);
  });

  it("skips a period that is already settled", () => {
    const settled = (_id: string, index: number) => index === 0;
    const result = dueCharges(sub(), T + DAY, settled);
    expect(result.due[0]!.periodIndex).toBe(1);
  });

  it("treats a payment already in flight as settled, so it is not offered again", () => {
    // MONEY SAFETY RULE S2. Anything other than this and a payment still in the air comes
    // back round as due and gets sent a second time.
    const settled = (_id: string, index: number) => index === 0;
    expect(dueCharges(sub(), T, settled).due).toEqual([]);
  });
});

describe("catching up after being switched off", () => {
  it("pays at most one late period per cycle by default", () => {
    // MONEY SAFETY RULE S3. An agent down for a month has thirty payments waiting. Sending
    // all thirty the instant it comes back is exactly the shape of an accident that empties
    // a wallet, and it happens right after something already went wrong. Deleting the
    // `due.length < options.maxCatchUpPerCycle` guard makes this fail.
    const result = dueCharges(sub(), T + 3 * DAY, nothingSettled);
    expect(result.due).toHaveLength(1);
    // Period 0 is the oldest one still inside the three period backlog, so it goes first.
    expect(result.due[0]!.periodIndex).toBe(0);
  });

  it("offers the oldest one it will look at first, so the backlog clears in order", () => {
    const result = dueCharges(sub(), T + 3 * DAY, nothingSettled, {
      maxCatchUpPerCycle: 2,
      maxBacklogPeriods: 3,
    });
    expect(result.due.map((c) => c.periodIndex)).toEqual([0, 1]);
  });

  it("refuses to pay anything further back than the backlog it looks at, and reports it", () => {
    // MONEY SAFETY RULE S4. A payment a month late is a decision, not a chore, and a person
    // makes decisions. Deleting the `oldestLookedAt` floor turns a report into a payment.
    const result = dueCharges(sub(), T + 10 * DAY, nothingSettled);
    expect(result.tooOldToPay).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(result.due.map((c) => c.periodIndex)).toEqual([7]);
  });

  it("counts how many are late but still inside the backlog", () => {
    const result = dueCharges(sub(), T + 2 * DAY, nothingSettled);
    // Periods 0 and 1 have already ended; period 2 is the one running now.
    expect(result.lateButWithinBacklog).toBe(2);
  });

  it("reports nothing too old when the settled ones cover the backlog", () => {
    const settled = (_id: string, index: number) => index < 7;
    const result = dueCharges(sub(), T + 10 * DAY, settled);
    expect(result.tooOldToPay).toEqual([]);
  });
});

describe("several repeating payments at once", () => {
  it("pays them oldest first, whatever order they were listed in", () => {
    // The order has to be the same across runs, or "what did it do and why" cannot be
    // answered after the fact.
    const a = sub({ id: "a", anchorSeconds: T + 100 });
    const b = sub({ id: "b", anchorSeconds: T });
    const forwards = dueChargesForAll([a, b], T + 200, nothingSettled);
    const backwards = dueChargesForAll([b, a], T + 200, nothingSettled);
    expect(forwards.due.map((c) => c.subscriptionId)).toEqual(["b", "a"]);
    expect(backwards.due.map((c) => c.subscriptionId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on the same second by name, so the order is still fixed", () => {
    const a = sub({ id: "zebra" });
    const b = sub({ id: "apple" });
    expect(dueChargesForAll([a, b], T, nothingSettled).due.map((c) => c.subscriptionId)).toEqual([
      "apple",
      "zebra",
    ]);
  });

  it("refuses two repeating payments sharing one name", () => {
    // The record of what has been paid is kept by that name, so two of them would share one
    // record and one of the two would never be paid at all.
    expect(() => dueChargesForAll([sub(), sub()], T, nothingSettled)).toThrow(ScheduleError);
  });

  it("carries the agent that may pay each one through onto the charge", () => {
    const result = dueChargesForAll(
      [sub({ id: "rent", agentId: "rent-agent" }), sub({ id: "compute", agentId: "compute-agent" })],
      T,
      nothingSettled,
    );
    expect(result.due.map((c) => c.agentId).sort()).toEqual(["compute-agent", "rent-agent"]);
  });
});

describe("the default settings", () => {
  it("catch up slowly and look back only a little", () => {
    expect(DEFAULT_SCHEDULE_OPTIONS.maxCatchUpPerCycle).toBe(1);
    expect(DEFAULT_SCHEDULE_OPTIONS.maxBacklogPeriods).toBe(3);
  });
});
