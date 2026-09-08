import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  type CostModel,
  type GridConfig,
  type GridState,
} from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;

const grid: GridConfig = {
  lowerBase: usd(500n),
  upperBase: usd(700n),
  levels: 11,
  capitalBase: usd(1_000n),
};

const cost: CostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 5_000_000n };

function state(over: Partial<GridState> = {}): GridState {
  return { bandIndex: 5, lotsHeld: 5, consecutiveOutside: 0, outsideSide: null, ...over };
}

const observe = (dollars: bigint, s: GridState = state()) =>
  decide(grid, s, { priceBase: usd(dollars), blockNumber: 1n }, cost);

describe("decide — trading inside the range", () => {
  it("a price that does not change band means nothing is done", () => {
    const d = observe(600n);
    expect(d.action).toBe("IDLE");
    expect(d.lots).toBe(0);
    expect(d.notionalBase).toBe(0n);
  });

  it("a price falling two bands triggers a two-lot buy", () => {
    const d = observe(560n);
    expect(d.action).toBe("BUY");
    expect(d.lots).toBe(2);
    expect(d.notionalBase).toBe(usd(200n));
    expect(d.nextState.lotsHeld).toBe(7);
    expect(d.nextState.bandIndex).toBe(3);
  });

  it("a price rising three bands triggers a three-lot sell", () => {
    const d = observe(660n);
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(3);
    expect(d.notionalBase).toBe(usd(300n));
    expect(d.nextState.lotsHeld).toBe(2);
    expect(d.nextState.bandIndex).toBe(8);
  });

  it("pure function: two identical calls produce identical decisions", () => {
    expect(observe(560n)).toEqual(observe(560n));
  });

  it("does not mutate the input state", () => {
    const s = state();
    const copy = { ...s };
    observe(560n, s);
    expect(s).toEqual(copy);
  });
});

describe("decide — capital limits and inventory limits", () => {
  it("cannot buy more lots than the remaining capital capacity", () => {
    const d = observe(560n, state({ bandIndex: 5, lotsHeld: 9 }));
    expect(d.action).toBe("BUY");
    expect(d.lots).toBe(1);
    expect(d.lotsCapped).toBe(true);
    expect(d.nextState.lotsHeld).toBe(10);
  });

  it("exhausted capital means no buy at all, not a partial buy of zero", () => {
    const d = observe(560n, state({ bandIndex: 5, lotsHeld: 10 }));
    expect(d.action).toBe("IDLE");
    expect(d.lots).toBe(0);
    expect(d.lotsCapped).toBe(true);
  });

  it("cannot sell lots that are not held", () => {
    const d = observe(660n, state({ bandIndex: 5, lotsHeld: 1 }));
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(1);
    expect(d.lotsCapped).toBe(true);
    expect(d.nextState.lotsHeld).toBe(0);
  });

  it("the band still advances even when lots are capped — otherwise the same crossing would retrigger forever", () => {
    const d = observe(560n, state({ bandIndex: 5, lotsHeld: 10 }));
    expect(d.nextState.bandIndex).toBe(3);
  });
});

describe("decide — when the grid stops applying", () => {
  it("a price inside the upper buffer is not a breakout yet, only watched", () => {
    const d = observe(714n, state({ bandIndex: 9, lotsHeld: 0 }));
    expect(d.action).toBe("WATCH_BREAKOUT");
    expect(d.breakout).toBe("WATCHING_ABOVE");
    expect(d.nextState.consecutiveOutside).toBe(1);
  });

  it("an upward breakout is confirmed after three consecutive observations", () => {
    const d = observe(714n, state({ bandIndex: 9, lotsHeld: 2, consecutiveOutside: 2, outsideSide: "ABOVE" }));
    expect(d.action).toBe("EXIT_ABOVE");
    expect(d.nextState.consecutiveOutside).toBe(3);
  });

  it("the confirmation count resets as soon as the price returns inside the range", () => {
    const d = observe(600n, state({ bandIndex: 5, lotsHeld: 5, consecutiveOutside: 2, outsideSide: "ABOVE" }));
    expect(d.nextState.consecutiveOutside).toBe(0);
    expect(d.nextState.outsideSide).toBeNull();
  });

  it("flipping direction resets the count — two breaches in different directions are not a confirmation", () => {
    const d = observe(490n, state({ bandIndex: 0, lotsHeld: 5, consecutiveOutside: 2, outsideSide: "ABOVE" }));
    expect(d.nextState.outsideSide).toBe("BELOW");
    expect(d.nextState.consecutiveOutside).toBe(1);
    expect(d.action).toBe("WATCH_BREAKOUT");
  });

  it("a hard breakout exits at once, without waiting for confirmation", () => {
    const d = observe(770n, state({ bandIndex: 9, lotsHeld: 3, consecutiveOutside: 0 }));
    expect(d.action).toBe("EXIT_ABOVE");
  });

  it("a hard breakout downward exits at once", () => {
    const d = observe(450n, state({ bandIndex: 0, lotsHeld: 8, consecutiveOutside: 0 }));
    expect(d.action).toBe("EXIT_BELOW");
  });

  it("exiting means unwinding the ENTIRE inventory — a grid below its range is 100% long with no plan", () => {
    const d = observe(450n, state({ bandIndex: 0, lotsHeld: 8 }));
    expect(d.lots).toBe(8);
    expect(d.notionalBase).toBe(usd(800n));
    expect(d.nextState.lotsHeld).toBe(0);
  });

  it("exiting upward also unwinds the remaining inventory so no position is orphaned", () => {
    const d = observe(770n, state({ bandIndex: 9, lotsHeld: 3 }));
    expect(d.lots).toBe(3);
    expect(d.nextState.lotsHeld).toBe(0);
  });

  it("a price between the upper bound and the buffer may still sell the remaining lots", () => {
    // $705 is above $700 but below $714: the band clamps to 9 and the sale still happens
    const d = observe(705n, state({ bandIndex: 5, lotsHeld: 5 }));
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(4);
    expect(d.breakout).toBe("NONE");
  });

  it("a price jump straight past the buffer still sells the remaining lots before the exit is watched", () => {
    const d = observe(714n, state({ bandIndex: 5, lotsHeld: 5 }));
    expect(d.action).toBe("SELL");
    expect(d.lots).toBe(4);
    expect(d.breakout).toBe("WATCHING_ABOVE");
    expect(d.nextState.consecutiveOutside).toBe(1);
  });
});

describe("decide — the explanation", () => {
  it("the reason names the formatted price, not the raw 8-decimal number", () => {
    const d = observe(560n);
    expect(d.reason).toContain("$560.00");
    expect(d.reason).not.toContain("56000000000");
  });

  it("the exit reason says why the grid stopped applying", () => {
    const d = observe(770n, state({ bandIndex: 9, lotsHeld: 1 }));
    expect(d.reason).toContain("$770.00");
    expect(d.reason.length).toBeGreaterThan(20);
  });
});

describe("decide — hard failure on a configuration that cannot turn a profit", () => {
  it("rejects a grid whose step is narrower than one round trip's cost", () => {
    expect(() => decide({ ...grid, levels: 101 }, state({ bandIndex: 50, lotsHeld: 50 }), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects an upper bound below the lower bound", () => {
    expect(() => decide({ ...grid, lowerBase: usd(700n), upperBase: usd(500n) }, state(), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects a zero lower bound — a price of zero is not a price", () => {
    expect(() => decide({ ...grid, lowerBase: 0n }, state(), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects a range wider than 3x because the arithmetic grid's distortion becomes uncontrolled", () => {
    expect(() => decide({ ...grid, upperBase: usd(2_000n) }, state(), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("fewer than three lines is not a grid", () => {
    expect(() => decide({ ...grid, levels: 2 }, state({ bandIndex: 0, lotsHeld: 0 }), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects a fractional level count", () => {
    expect(() => decide({ ...grid, levels: 10.5 }, state(), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects zero capital", () => {
    expect(() => decide({ ...grid, capitalBase: 0n }, state(), { priceBase: usd(600n), blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects a zero or negative price — that is a broken reading, not a free asset", () => {
    expect(() => decide(grid, state(), { priceBase: 0n, blockNumber: 1n }, cost)).toThrow(GridError);
    expect(() => decide(grid, state(), { priceBase: -1n, blockNumber: 1n }, cost)).toThrow(GridError);
  });

  it("rejects lots held above the interval count", () => {
    expect(() => observe(600n, state({ lotsHeld: 11 }))).toThrow(GridError);
  });

  it("rejects a band index outside the range", () => {
    expect(() => observe(600n, state({ bandIndex: 10 }))).toThrow(GridError);
    expect(() => observe(600n, state({ bandIndex: -1 }))).toThrow(GridError);
  });

  it("an outside-observation count with no direction is an impossible state", () => {
    expect(() => observe(600n, state({ consecutiveOutside: 2, outsideSide: null }))).toThrow(GridError);
  });

  it("rejects a breakout buffer wider than the hard breakout", () => {
    expect(() =>
      decide(grid, state(), { priceBase: usd(600n), blockNumber: 1n }, cost, {
        ...DEFAULT_GRID_THRESHOLDS,
        breakoutBufferBps: 2_000n,
      }),
    ).toThrow(GridError);
  });

  it("rejects a profit multiple below 1.00x — that formalizes a loss-making grid", () => {
    expect(() =>
      decide(grid, state(), { priceBase: usd(600n), blockNumber: 1n }, cost, {
        ...DEFAULT_GRID_THRESHOLDS,
        minProfitMultipleBps: 9_999n,
      }),
    ).toThrow(GridError);
  });
});
