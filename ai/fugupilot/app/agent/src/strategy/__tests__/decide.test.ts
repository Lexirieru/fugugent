import { describe, expect, it } from "vitest";
import { assertPolicyIsSane, borrowHeadroomUsd8, plan, planBorrow, totalHeldUsd8 } from "../decide.js";
import { PolicyError, RATIO_ONE, safetyRatio, type PilotPolicy, type PortfolioSnapshot } from "../types.js";
import { VenueUnavailableError } from "../venues.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;

/** One dollar on the 8 decimal basis, written out so the numbers below read as money. */
const USD = 100_000_000n;

function policy(overrides: Partial<PilotPolicy> = {}): PilotPolicy {
  return {
    targets: [
      { assetId: "BNB", weightBps: 6_000n },
      { assetId: "USDT", weightBps: 4_000n },
    ],
    driftToleranceBps: 500n,
    idleFloorUsd8: 10n * USD,
    swapVenueId: "pancakeswap-v3",
    lendVenueId: "venus",
    stakeVenueId: "lista-liquid-staking",
    minSafetyRatio: 2n * RATIO_ONE,
    copyFactorBps: 500n,
    maxCopyUsd8: 50n * USD,
    ...overrides,
  };
}

function snapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    account: ACCOUNT,
    blockNumber: 1_000n,
    holdings: [
      { assetId: "BNB", valueUsd8: 600n * USD },
      { assetId: "USDT", valueUsd8: 400n * USD },
    ],
    idleUsd8: 0n,
    collateralUsd8: 0n,
    debtUsd8: 0n,
    liquidationThresholdBps: 8_000n,
    ...overrides,
  };
}

describe("reading the owner's instructions", () => {
  it("accepts shares that add up to exactly all of it", () => {
    expect(() => assertPolicyIsSane(policy())).not.toThrow();
  });

  it("refuses shares that do not add up, rather than quietly scaling them", () => {
    // Scaling them would hide a typo in something a person wrote by hand, and every drift
    // figure computed afterwards would be wrong in a way nothing else would reveal.
    expect(() =>
      assertPolicyIsSane(
        policy({ targets: [{ assetId: "BNB", weightBps: 6_000n }, { assetId: "USDT", weightBps: 3_000n }] }),
      ),
    ).toThrow(PolicyError);
    expect(() =>
      assertPolicyIsSane(
        policy({ targets: [{ assetId: "BNB", weightBps: 6_000n }, { assetId: "USDT", weightBps: 3_000n }] }),
      ),
    ).toThrow(/add up to exactly/);
  });

  it("refuses the same holding named twice", () => {
    expect(() =>
      assertPolicyIsSane(
        policy({
          targets: [
            { assetId: "BNB", weightBps: 5_000n },
            { assetId: "BNB", weightBps: 5_000n },
          ],
        }),
      ),
    ).toThrow(/twice/);
  });

  it("refuses no allowed drift at all", () => {
    expect(() => assertPolicyIsSane(policy({ driftToleranceBps: 0n }))).toThrow(/every rounding step/);
  });

  it("refuses a safety ratio under 1.0", () => {
    // MONEY SAFETY RULE P8. Under 1.0 the lender is already entitled to sell the holdings,
    // so an instruction to borrow down to there can never be honoured.
    expect(() => assertPolicyIsSane(policy({ minSafetyRatio: RATIO_ONE - 1n }))).toThrow(/under 1.0/);
  });

  it("refuses copying more than all of somebody else's trade", () => {
    expect(() => assertPolicyIsSane(policy({ copyFactorBps: 10_001n }))).toThrow(/outside/);
  });

  it("refuses an empty set of instructions", () => {
    expect(() => assertPolicyIsSane(policy({ targets: [] }))).toThrow(/nothing to plan/);
  });
});

describe("valuing what is held", () => {
  it("adds the holdings up", () => {
    expect(totalHeldUsd8(snapshot())).toBe(1_000n * USD);
  });

  it("refuses a holding worth less than nothing", () => {
    // A reading like that is broken, and planning against it would move real money.
    expect(() =>
      totalHeldUsd8(snapshot({ holdings: [{ assetId: "BNB", valueUsd8: -1n }] })),
    ).toThrow(/below zero/);
  });

  it("copes with nothing held at all", () => {
    expect(totalHeldUsd8(snapshot({ holdings: [] }))).toBe(0n);
  });
});

describe("planning a rebalance", () => {
  it("does nothing when the mix is already what was asked for", () => {
    const result = plan(snapshot(), policy());
    expect(result.actions).toEqual([]);
    expect(result.totalUsd8).toBe(0n);
    expect(result.reason).toContain("within the allowed drift");
  });

  it("does nothing when the drift is under what is allowed", () => {
    // 6200 against a target of 6000 is a drift of 200, under the 500 allowed.
    const result = plan(
      snapshot({
        holdings: [
          { assetId: "BNB", valueUsd8: 620n * USD },
          { assetId: "USDT", valueUsd8: 380n * USD },
        ],
      }),
      policy(),
    );
    expect(result.actions).toEqual([]);
  });

  it("acts once the drift reaches what is allowed", () => {
    // 6500 against 6000 is exactly 500, the allowed drift, so it acts.
    const result = plan(
      snapshot({
        holdings: [
          { assetId: "BNB", valueUsd8: 650n * USD },
          { assetId: "USDT", valueUsd8: 350n * USD },
        ],
      }),
      policy(),
    );
    expect(result.actions).toHaveLength(2);
    const bnb = result.actions.find((a) => a.assetId === "BNB")!;
    expect(bnb.direction).toBe("OUT");
    expect(bnb.amountUsd8).toBe(50n * USD);
    const usdt = result.actions.find((a) => a.assetId === "USDT")!;
    expect(usdt.direction).toBe("IN");
    expect(usdt.amountUsd8).toBe(50n * USD);
  });

  it("produces the same plan whatever order the holdings arrive in", () => {
    // A plan that depends on the caller's array order cannot be compared against a stored
    // one, and the "have we already done this" check downstream stops meaning anything.
    const holdings = [
      { assetId: "BNB", valueUsd8: 650n * USD },
      { assetId: "USDT", valueUsd8: 350n * USD },
    ];
    const forwards = plan(snapshot({ holdings }), policy());
    const backwards = plan(snapshot({ holdings: [...holdings].reverse() }), policy());
    expect(JSON.stringify(forwards, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(backwards, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  });

  it("treats a holding it has never seen as worth nothing rather than failing", () => {
    const result = plan(snapshot({ holdings: [{ assetId: "BNB", valueUsd8: 1_000n * USD }] }), policy());
    const usdt = result.actions.find((a) => a.assetId === "USDT")!;
    expect(usdt.direction).toBe("IN");
    expect(usdt.amountUsd8).toBe(400n * USD);
  });

  it("says so plainly when nothing is held", () => {
    const result = plan(snapshot({ holdings: [] }), policy());
    expect(result.actions).toEqual([]);
    expect(result.reason).toContain("Nothing is held");
  });

  it("refuses to plan a trade on a venue that does not answer on this network", () => {
    // MONEY SAFETY RULE P1, at the planning layer this time. Removing the
    // assertVenueUsable call inside the rebalance branch of plan() makes this pass silently
    // and produce a plan naming a place the money cannot go.
    expect(() =>
      plan(
        snapshot({
          holdings: [
            { assetId: "BNB", valueUsd8: 650n * USD },
            { assetId: "USDT", valueUsd8: 350n * USD },
          ],
        }),
        policy({ swapVenueId: "aave-v3" }),
      ),
    ).toThrow(VenueUnavailableError);
  });
});

describe("putting idle money to work", () => {
  it("leaves alone what the owner asked to keep aside", () => {
    const result = plan(snapshot({ idleUsd8: 10n * USD }), policy());
    expect(result.actions.filter((a) => a.kind === "STAKE")).toEqual([]);
  });

  it("stakes only what is above the amount kept aside", () => {
    const result = plan(snapshot({ idleUsd8: 60n * USD }), policy());
    const stake = result.actions.find((a) => a.kind === "STAKE")!;
    expect(stake.amountUsd8).toBe(50n * USD);
    expect(stake.venueId).toBe("lista-liquid-staking");
  });

  it("refuses to stake anywhere that was not proven to answer", () => {
    expect(() => plan(snapshot({ idleUsd8: 60n * USD }), policy({ stakeVenueId: "aave-v3" }))).toThrow(
      VenueUnavailableError,
    );
  });
});

describe("copying somebody else's trade", () => {
  it("copies the fraction the owner set", () => {
    const result = plan(
      snapshot({ leaderTrade: { assetId: "BNB", side: "BUY", valueUsd8: 200n * USD } }),
      policy(),
    );
    const copy = result.actions.find((a) => a.kind === "COPY_TRADE")!;
    expect(copy.amountUsd8).toBe(10n * USD);
    expect(copy.direction).toBe("IN");
  });

  it("never copies more than the one time limit, however large the other trade was", () => {
    // MONEY SAFETY RULE P9. Removing the maxCopyUsd8 clamp lets somebody else's size decide
    // this agent's size, which is exactly the thing an owner sets a limit to prevent.
    const result = plan(
      snapshot({ leaderTrade: { assetId: "BNB", side: "SELL", valueUsd8: 100_000n * USD } }),
      policy(),
    );
    const copy = result.actions.find((a) => a.kind === "COPY_TRADE")!;
    expect(copy.amountUsd8).toBe(50n * USD);
    expect(copy.direction).toBe("OUT");
    expect(copy.reason).toContain("held down to");
  });

  it("copies nothing when the fraction rounds down to nothing", () => {
    const result = plan(
      snapshot({ leaderTrade: { assetId: "BNB", side: "BUY", valueUsd8: 1n } }),
      policy(),
    );
    expect(result.actions.filter((a) => a.kind === "COPY_TRADE")).toEqual([]);
  });

  it("copies nothing when the owner set the fraction to nothing", () => {
    const result = plan(
      snapshot({ leaderTrade: { assetId: "BNB", side: "BUY", valueUsd8: 200n * USD } }),
      policy({ copyFactorBps: 0n }),
    );
    expect(result.actions.filter((a) => a.kind === "COPY_TRADE")).toEqual([]);
  });
});

describe("how safe a loan is", () => {
  it("calls a loan of nothing the safest state there is rather than an error", () => {
    expect(safetyRatio(1_000n * USD, 0n, 8_000n)).toBeNull();
  });

  it("works out the ratio the way both lenders do", () => {
    // 1000 of backing counted at 80% is 800, against 400 owed, which is exactly 2.0.
    expect(safetyRatio(1_000n * USD, 400n * USD, 8_000n)).toBe(2n * RATIO_ONE);
  });
});

describe("how much more can be borrowed", () => {
  it("gives the room that keeps the loan at the ratio asked for", () => {
    // 1000 counted at 80% is 800; at a ratio of 2.0 the most that may be owed is 400.
    expect(borrowHeadroomUsd8(1_000n * USD, 0n, 8_000n, 2n * RATIO_ONE)).toBe(400n * USD);
    expect(borrowHeadroomUsd8(1_000n * USD, 300n * USD, 8_000n, 2n * RATIO_ONE)).toBe(100n * USD);
  });

  it("gives nothing rather than a negative number when the loan is already too large", () => {
    expect(borrowHeadroomUsd8(1_000n * USD, 900n * USD, 8_000n, 2n * RATIO_ONE)).toBe(0n);
  });

  it("rounds down, so the answer is never a hair over what is truly allowed", () => {
    // 1 counted at 8000 basis points over a ratio of 3.0 is 0.2666..., which rounds to 0.
    expect(borrowHeadroomUsd8(1n, 0n, 8_000n, 3n * RATIO_ONE)).toBe(0n);
  });
});

describe("planning a borrow", () => {
  it("borrows nothing when nothing was asked for", () => {
    expect(planBorrow(snapshot(), policy(), 0n).actions).toEqual([]);
  });

  it("borrows what was asked for when there is room", () => {
    const result = planBorrow(
      snapshot({ collateralUsd8: 1_000n * USD, debtUsd8: 0n }),
      policy(),
      100n * USD,
    );
    expect(result.actions[0]!.amountUsd8).toBe(100n * USD);
    expect(result.actions[0]!.venueId).toBe("venus");
  });

  it("cuts the amount down to the room rather than refusing outright", () => {
    // MONEY SAFETY RULE P8. Removing the clamp against the headroom lets an owner's typo
    // push the loan past the point where the lender may sell their holdings.
    const result = planBorrow(
      snapshot({ collateralUsd8: 1_000n * USD, debtUsd8: 0n }),
      policy(),
      10_000n * USD,
    );
    expect(result.actions[0]!.amountUsd8).toBe(400n * USD);
    expect(result.actions[0]!.reason).toContain("keeps the loan above");
  });

  it("borrows nothing when there is no room left", () => {
    const result = planBorrow(
      snapshot({ collateralUsd8: 1_000n * USD, debtUsd8: 400n * USD }),
      policy(),
      1n * USD,
    );
    expect(result.actions).toEqual([]);
    expect(result.reason).toContain("already as large as the safety ratio");
  });

  it("refuses to borrow from a lender that does not exist on this network", () => {
    expect(() =>
      planBorrow(snapshot({ collateralUsd8: 1_000n * USD }), policy({ lendVenueId: "aave-v3" }), 1n * USD),
    ).toThrow(VenueUnavailableError);
  });
});
