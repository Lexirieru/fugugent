import { describe, expect, it } from "vitest";
import { assertTariffIsSane, priceQuantity, rate } from "../rating.js";
import { readMeter } from "../meter.js";
import { MeterError, type Tariff, type UsageRecord } from "../types.js";

const T = 1_800_000_000;
const WINDOW = { fromSeconds: T, toSeconds: T + 3_600 };

/** One cent per call, flat. 1000000 on the 8 decimal basis is one cent. */
const FLAT: Tariff = {
  unit: "CALL",
  steps: [{ upToQuantity: null, priceUsd8: 1_000_000n, perQuantity: 1n }],
};

/** A cent per call for the first thousand, then a tenth of a cent. */
const LADDER: Tariff = {
  unit: "CALL",
  steps: [
    { upToQuantity: 1_000n, priceUsd8: 1_000_000n, perQuantity: 1n },
    { upToQuantity: null, priceUsd8: 100_000n, perQuantity: 1n },
  ],
};

/** A dollar per thousand calls, so a single call has a fraction in it. */
const PER_THOUSAND: Tariff = {
  unit: "CALL",
  steps: [{ upToQuantity: null, priceUsd8: 100_000_000n, perQuantity: 1_000n }],
};

function reading(records: readonly UsageRecord[]) {
  return readMeter(records, WINDOW);
}

function call(id: string, quantity: bigint): UsageRecord {
  return { id, unit: "CALL", quantity, at: T };
}

describe("checking a price ladder", () => {
  it("accepts a flat price", () => {
    expect(() => assertTariffIsSane(FLAT)).not.toThrow();
  });

  it("accepts a ladder that climbs and ends with no top", () => {
    expect(() => assertTariffIsSane(LADDER)).not.toThrow();
  });

  it("refuses a ladder with no steps", () => {
    expect(() => assertTariffIsSane({ unit: "CALL", steps: [] })).toThrow(/no steps/);
  });

  it("refuses a ladder whose last step has a top", () => {
    // MONEY SAFETY RULE M3. Use above the last step would have no price at all, and this
    // agent will not guess one. Deleting the final check lets that use fall silently off the
    // end of the bill.
    expect(() =>
      assertTariffIsSane({
        unit: "CALL",
        steps: [{ upToQuantity: 1_000n, priceUsd8: 1n, perQuantity: 1n }],
      }),
    ).toThrow(/no step above it/);
  });

  it("refuses a ladder that does not climb", () => {
    expect(() =>
      assertTariffIsSane({
        unit: "CALL",
        steps: [
          { upToQuantity: 1_000n, priceUsd8: 1n, perQuantity: 1n },
          { upToQuantity: 500n, priceUsd8: 1n, perQuantity: 1n },
          { upToQuantity: null, priceUsd8: 1n, perQuantity: 1n },
        ],
      }),
    ).toThrow(/has to climb/);
  });

  it("refuses a step that comes after one with no top, because it can never be reached", () => {
    expect(() =>
      assertTariffIsSane({
        unit: "CALL",
        steps: [
          { upToQuantity: null, priceUsd8: 1n, perQuantity: 1n },
          { upToQuantity: null, priceUsd8: 1n, perQuantity: 1n },
        ],
      }),
    ).toThrow(/can\s+never be reached/);
  });

  it("refuses a price below zero", () => {
    expect(() =>
      assertTariffIsSane({
        unit: "CALL",
        steps: [{ upToQuantity: null, priceUsd8: -1n, perQuantity: 1n }],
      }),
    ).toThrow(/below zero/);
  });

  it("refuses a step that prices nothing at a time", () => {
    expect(() =>
      assertTariffIsSane({
        unit: "CALL",
        steps: [{ upToQuantity: null, priceUsd8: 1n, perQuantity: 0n }],
      }),
    ).toThrow(/not a usable amount/);
  });
});

describe("pricing a quantity", () => {
  it("prices a flat ladder straight through", () => {
    expect(priceQuantity(250n, FLAT).amountUsd8).toBe(250n * 1_000_000n);
  });

  it("prices nothing as nothing", () => {
    expect(priceQuantity(0n, FLAT).amountUsd8).toBe(0n);
  });

  it("climbs the ladder step by step rather than pricing everything at the top step", () => {
    // MONEY SAFETY RULE M4. Ten thousand calls is one thousand at the first price plus nine
    // thousand at the second, not ten thousand at either. Getting this backwards makes every
    // bill wrong, and wrong in a way that looks plausible.
    const expected = 1_000n * 1_000_000n + 9_000n * 100_000n;
    expect(priceQuantity(10_000n, LADDER).amountUsd8).toBe(expected);
  });

  it("stays on the first step when the quantity does not reach the next one", () => {
    expect(priceQuantity(1_000n, LADDER).amountUsd8).toBe(1_000n * 1_000_000n);
  });

  it("moves onto the second step for exactly one more", () => {
    expect(priceQuantity(1_001n, LADDER).amountUsd8).toBe(1_000n * 1_000_000n + 100_000n);
  });

  it("rounds a fraction of the smallest unit upwards", () => {
    // A dollar per thousand calls is 100000 per call exactly, so use a quantity that does
    // not divide: 3 calls at a dollar per thousand is 300000, exact. 1 call at a price of
    // 1 per 3 is a third, which rounds up to 1 rather than down to 0.
    const odd: Tariff = {
      unit: "CALL",
      steps: [{ upToQuantity: null, priceUsd8: 1n, perQuantity: 3n }],
    };
    expect(priceQuantity(1n, odd).amountUsd8).toBe(1n);
    expect(priceQuantity(3n, odd).amountUsd8).toBe(1n);
    expect(priceQuantity(4n, odd).amountUsd8).toBe(2n);
  });

  it("prices per thousand exactly when it divides", () => {
    expect(priceQuantity(1_000n, PER_THOUSAND).amountUsd8).toBe(100_000_000n);
  });

  it("refuses a quantity below zero", () => {
    expect(() => priceQuantity(-1n, FLAT)).toThrow(/below zero/);
  });
});

describe("turning a reading into a bill", () => {
  it("bills each unit on its own line", () => {
    const seconds: Tariff = {
      unit: "SECOND",
      steps: [{ upToQuantity: null, priceUsd8: 100n, perQuantity: 1n }],
    };
    const invoice = rate(
      readMeter(
        [
          { id: "a", unit: "CALL", quantity: 10n, at: T },
          { id: "b", unit: "SECOND", quantity: 30n, at: T },
        ],
        WINDOW,
      ),
      [FLAT, seconds],
    );
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.totalUsd8).toBe(10n * 1_000_000n + 30n * 100n);
  });

  it("always puts the lines in the same order, whatever order the use arrived in", () => {
    // The bill is what the payment is checked against, so two readings of the same use have
    // to produce the same bill down to the byte.
    const seconds: Tariff = {
      unit: "SECOND",
      steps: [{ upToQuantity: null, priceUsd8: 100n, perQuantity: 1n }],
    };
    const forwards = rate(
      readMeter(
        [
          { id: "a", unit: "SECOND", quantity: 30n, at: T },
          { id: "b", unit: "CALL", quantity: 10n, at: T },
        ],
        WINDOW,
      ),
      [seconds, FLAT],
    );
    expect(forwards.lines.map((l) => l.unit)).toEqual(["CALL", "SECOND"]);
  });

  it("produces NO bill at all when nothing was used", () => {
    // MONEY SAFETY RULE M5, and the one the brief asked for by name. Not a bill for zero,
    // and no minimum charge either. An agent paying without anybody approving each payment
    // must never pay for something that did not happen.
    const invoice = rate(reading([]), [FLAT]);
    expect(invoice.empty).toBe(true);
    expect(invoice.lines).toEqual([]);
    expect(invoice.totalUsd8).toBe(0n);
  });

  it("produces no bill when every record was for a quantity of zero", () => {
    const invoice = rate(reading([call("a", 0n), call("b", 0n)]), [FLAT]);
    expect(invoice.empty).toBe(true);
    expect(invoice.totalUsd8).toBe(0n);
  });

  it("produces no bill when everything that arrived was outside the stretch of time", () => {
    const invoice = rate(readMeter([{ id: "a", unit: "CALL", quantity: 5n, at: T - 10 }], WINDOW), [
      FLAT,
    ]);
    expect(invoice.empty).toBe(true);
  });

  it("refuses to bill anything at all when one unit has no price", () => {
    // MONEY SAFETY RULE M3. Silently leaving the unpriced use off the bill would look like a
    // smaller bill rather than like a missing price ladder.
    expect(() =>
      rate(
        readMeter(
          [
            { id: "a", unit: "CALL", quantity: 10n, at: T },
            { id: "b", unit: "UNIT", quantity: 3n, at: T },
          ],
          WINDOW,
        ),
        [FLAT],
      ),
    ).toThrow(/does not guess a price/);
  });

  it("refuses two price ladders for the same unit", () => {
    expect(() => rate(reading([call("a", 1n)]), [FLAT, LADDER])).toThrow(/two price ladders/);
  });

  it("carries the stretch of time through onto the bill", () => {
    expect(rate(reading([call("a", 1n)]), [FLAT]).window).toEqual(WINDOW);
  });
});
