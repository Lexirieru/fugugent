import { describe, expect, it } from "vitest";
import {
  bandIndexOf,
  hardLowerBase,
  hardUpperBase,
  intervalsOf,
  levelPriceBase,
  lotValueBase,
  minProfitableStepBps,
  minStepBps,
  pricePosition,
  roundTripCostBps,
  softLowerBase,
  softUpperBase,
  stepBase,
} from "../grid.js";
import { DEFAULT_GRID_THRESHOLDS, GridError, type CostModel, type GridConfig } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;

const grid: GridConfig = {
  lowerBase: usd(500n),
  upperBase: usd(700n),
  levels: 11,
  capitalBase: usd(1_000n),
};

const cost: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 5_000_000n };

describe("grid geometry", () => {
  it("11 grid lines mean 10 intervals", () => {
    expect(intervalsOf(grid)).toBe(10);
  });

  it("the nominal step, $700-$500 divided by 10, is $20", () => {
    expect(stepBase(grid)).toBe(usd(20n));
  });

  it("the first line sits exactly on the lower bound and the last exactly on the upper bound", () => {
    expect(levelPriceBase(grid, 0)).toBe(usd(500n));
    expect(levelPriceBase(grid, 10)).toBe(usd(700n));
  });

  it("the lines in between are evenly spaced", () => {
    expect(levelPriceBase(grid, 5)).toBe(usd(600n));
  });

  it("rejects a line index outside 0..intervals", () => {
    expect(() => levelPriceBase(grid, -1)).toThrow(GridError);
    expect(() => levelPriceBase(grid, 11)).toThrow(GridError);
  });
});

describe("minStepBps — the spacing between lines at its narrowest point", () => {
  it("is measured at the UPPER bound, because that is where the percentage spacing is smallest", () => {
    // $20 / $700 = 2.857% -> 285 bps (truncated down)
    expect(minStepBps(grid)).toBe(285n);
  });

  it("the percentage spacing at the lower bound really is larger — this is the arithmetic grid's distortion", () => {
    const atLowerBound = (stepBase(grid) * 10_000n) / grid.lowerBase; // $20/$500 = 400 bps
    expect(atLowerBound).toBeGreaterThan(minStepBps(grid));
    expect(atLowerBound).toBe(400n);
  });

  it("the more levels, the narrower the step", () => {
    expect(minStepBps({ ...grid, levels: 21 })).toBeLessThan(minStepBps(grid));
  });
});

describe("lotValueBase", () => {
  it("$1,000 of capital divided by 10 intervals is $100 per lot", () => {
    expect(lotValueBase(grid)).toBe(usd(100n));
  });

  it("too many levels shrink every lot", () => {
    expect(lotValueBase({ ...grid, levels: 101 })).toBe(usd(10n));
  });
});

describe("roundTripCostBps — the cost of one buy-then-sell round trip", () => {
  it("twice the proportional fee plus twice the gas, measured against the lot value", () => {
    // 2*(5+10) = 30 bps, plus 2*$0.05 of gas on a $100 lot = 10 bps
    expect(roundTripCostBps(usd(100n), cost)).toBe(40n);
  });

  it("a smaller lot lets gas dominate the cost", () => {
    expect(roundTripCostBps(usd(10n), cost)).toBe(130n);
  });

  it("rounds UP so the cost is never understated", () => {
    expect(roundTripCostBps(usd(1_000_000n), { swapFeeBps: 0n, slippageBps: 0n, gasCostBase: 1n })).toBe(1n);
  });

  it("a zero lot value is not a number, it is a broken configuration", () => {
    expect(() => roundTripCostBps(0n, cost)).toThrow(GridError);
  });
});

describe("minProfitableStepBps", () => {
  it("twice the round-trip cost at the default 2.00x multiple", () => {
    expect(minProfitableStepBps(usd(100n), cost, DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps)).toBe(80n);
  });

  it("a 1.00x multiple yields a break-even grid — exactly the round-trip cost", () => {
    expect(minProfitableStepBps(usd(100n), cost, 10_000n)).toBe(40n);
  });

  it("the $500-$700 grid with 11 levels clears this requirement comfortably", () => {
    expect(minStepBps(grid)).toBeGreaterThan(
      minProfitableStepBps(lotValueBase(grid), cost, DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps),
    );
  });

  it("the same grid with 101 levels does NOT clear it — too many levels is a way to lose money slowly", () => {
    const dense = { ...grid, levels: 101 };
    expect(minStepBps(dense)).toBeLessThan(
      minProfitableStepBps(lotValueBase(dense), cost, DEFAULT_GRID_THRESHOLDS.minProfitMultipleBps),
    );
  });
});

describe("bandIndexOf and pricePosition", () => {
  it("a price at the lower bound is in band 0", () => {
    expect(bandIndexOf(usd(500n), grid)).toBe(0);
  });

  it("$600 is in band 5", () => {
    expect(bandIndexOf(usd(600n), grid)).toBe(5);
  });

  it("$619.99 is still band 5, $620 is already band 6", () => {
    expect(bandIndexOf(usd(620n) - 1n, grid)).toBe(5);
    expect(bandIndexOf(usd(620n), grid)).toBe(6);
  });

  it("a price above the upper bound is clamped to the top band, not allowed to overflow", () => {
    expect(bandIndexOf(usd(700n), grid)).toBe(9);
    expect(bandIndexOf(usd(5_000n), grid)).toBe(9);
  });

  it("a price below the lower bound is clamped to band zero", () => {
    expect(bandIndexOf(usd(1n), grid)).toBe(0);
  });

  it("the price position is reported as-is even when the band is clamped", () => {
    expect(pricePosition(usd(600n), grid)).toBe("INSIDE");
    expect(pricePosition(usd(499n), grid)).toBe("BELOW");
    expect(pricePosition(usd(701n), grid)).toBe("ABOVE");
    expect(pricePosition(usd(700n), grid)).toBe("ABOVE");
  });
});

describe("breakout bounds", () => {
  const t = DEFAULT_GRID_THRESHOLDS;

  it("the 2% upper buffer on $700 is $714", () => {
    expect(softUpperBase(grid, t)).toBe(usd(714n));
  });

  it("the 10% hard upward breakout on $700 is $770", () => {
    expect(hardUpperBase(grid, t)).toBe(usd(770n));
  });

  it("the 2% lower buffer on $500 is $490", () => {
    expect(softLowerBase(grid, t)).toBe(usd(490n));
  });

  it("the 10% hard downward breakout on $500 is $450", () => {
    expect(hardLowerBase(grid, t)).toBe(usd(450n));
  });

  it("the lower bound rounds UP so a breakout is detected earlier, not later", () => {
    // 3 * 9800 / 10000 = 2.94 -> 3, not 2
    expect(softLowerBase({ ...grid, lowerBase: 3n, upperBase: 9n }, t)).toBe(3n);
  });
});
