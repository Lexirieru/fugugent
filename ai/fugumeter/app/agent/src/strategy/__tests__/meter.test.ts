import { describe, expect, it } from "vitest";
import { assertWindowIsSane, readingIsEmpty, readMeter } from "../meter.js";
import { MeterError, type UsageRecord } from "../types.js";

const T = 1_800_000_000;
const WINDOW = { fromSeconds: T, toSeconds: T + 3_600 };

function call(id: string, at: number, quantity = 1n): UsageRecord {
  return { id, unit: "CALL", quantity, at };
}

describe("the stretch of time", () => {
  it("accepts one that runs forwards", () => {
    expect(() => assertWindowIsSane(WINDOW)).not.toThrow();
  });

  it("accepts one of no length at all", () => {
    expect(() => assertWindowIsSane({ fromSeconds: T, toSeconds: T })).not.toThrow();
  });

  it("refuses one that runs backwards", () => {
    expect(() => assertWindowIsSane({ fromSeconds: T, toSeconds: T - 1 })).toThrow(/runs backwards/);
  });

  it("refuses one made of parts of seconds", () => {
    expect(() => assertWindowIsSane({ fromSeconds: T + 0.5, toSeconds: T + 1 })).toThrow(
      /whole seconds/,
    );
  });
});

describe("counting what was used", () => {
  it("adds up records inside the stretch of time", () => {
    const reading = readMeter([call("a", T), call("b", T + 10), call("c", T + 20)], WINDOW);
    expect(reading.totals.get("CALL")).toBe(3n);
    expect(reading.counted).toBe(3);
  });

  it("keeps each unit apart", () => {
    const reading = readMeter(
      [
        { id: "a", unit: "CALL", quantity: 5n, at: T },
        { id: "b", unit: "SECOND", quantity: 90n, at: T },
        { id: "c", unit: "UNIT", quantity: 7n, at: T },
      ],
      WINDOW,
    );
    expect(reading.totals.get("CALL")).toBe(5n);
    expect(reading.totals.get("SECOND")).toBe(90n);
    expect(reading.totals.get("UNIT")).toBe(7n);
  });

  it("counts nothing when there is nothing", () => {
    const reading = readMeter([], WINDOW);
    expect(reading.counted).toBe(0);
    expect(readingIsEmpty(reading)).toBe(true);
  });
});

describe("the boundaries of the stretch of time", () => {
  it("counts a record at the exact first second", () => {
    // The start is included. Off by one here puts one record on two bills.
    expect(readMeter([call("a", T)], WINDOW).counted).toBe(1);
  });

  it("leaves out a record at the exact last second", () => {
    // The end is excluded, and that same second is the first second of the next bill.
    const reading = readMeter([call("a", T + 3_600)], WINDOW);
    expect(reading.counted).toBe(0);
    expect(reading.outsideWindow).toBe(1);
  });

  it("counts a record one second before the end", () => {
    expect(readMeter([call("a", T + 3_599)], WINDOW).counted).toBe(1);
  });

  it("leaves out a record from before the stretch started, and says how many", () => {
    const reading = readMeter([call("a", T - 1), call("b", T + 5)], WINDOW);
    expect(reading.counted).toBe(1);
    expect(reading.outsideWindow).toBe(1);
  });
});

describe("the same thing reported twice", () => {
  it("counts it once", () => {
    // MONEY SAFETY RULE M1. A client that times out retries with the same record. Counting
    // it twice means paying twice for one thing. Deleting the `seen.has` check in readMeter
    // makes this fail.
    const reading = readMeter([call("a", T), call("a", T), call("a", T)], WINDOW);
    expect(reading.totals.get("CALL")).toBe(1n);
    expect(reading.counted).toBe(1);
    expect(reading.duplicates).toBe(2);
  });

  it("refuses two different things wearing the same id", () => {
    // Quietly keeping the first, or the larger, or the last would be inventing an answer to
    // a question nobody asked, and the answer is somebody's money.
    expect(() => readMeter([call("a", T, 1n), call("a", T, 999n)], WINDOW)).toThrow(
      /both call themselves/,
    );
  });

  it("counts a repeat that falls outside the stretch of time only once too", () => {
    const reading = readMeter([call("a", T - 5), call("a", T - 5)], WINDOW);
    expect(reading.outsideWindow).toBe(1);
    expect(reading.duplicates).toBe(1);
  });
});

describe("records that cannot be trusted", () => {
  it("refuses a record with no id at all", () => {
    // The id is the only defence against paying twice for one piece of use.
    expect(() => readMeter([call("", T)], WINDOW)).toThrow(/no id/);
  });

  it("refuses a quantity below zero", () => {
    // MONEY SAFETY RULE M2. Without this, anyone able to send records can talk a bill down
    // to nothing, or below it.
    expect(() => readMeter([call("a", T, -1n)], WINDOW)).toThrow(/below zero/);
  });

  it("refuses a time that is not a whole second", () => {
    expect(() => readMeter([call("a", T + 0.5)], WINDOW)).toThrow(/whole second/);
  });

  it("counts a record of zero as having arrived but adds no line for it", () => {
    const reading = readMeter([call("a", T, 0n)], WINDOW);
    expect(reading.counted).toBe(1);
    expect(reading.totals.has("CALL")).toBe(false);
    expect(readingIsEmpty(reading)).toBe(true);
  });
});

describe("adding up in whole numbers", () => {
  it("keeps a total larger than a float could count exactly", () => {
    const huge = 9_007_199_254_740_993n;
    const reading = readMeter([call("a", T, huge), call("b", T, 1n)], WINDOW);
    expect(reading.totals.get("CALL")).toBe(huge + 1n);
  });
});
