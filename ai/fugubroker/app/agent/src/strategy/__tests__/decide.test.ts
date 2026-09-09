/**
 * One test per decision rule, named after the rule.
 *
 * The point of the naming is not tidiness. Every rule in `select.ts` and `decide.ts` is a
 * branch that refuses to spend money, and a branch that refuses is invisible when it
 * breaks: the agent goes on working, it just starts paying for things it used to put
 * aside. So each rule below has at least one test that FAILS if the rule is deleted, and
 * that claim was checked by deleting each rule in turn and watching the suite go red.
 */
import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import { DEFAULT_POLICY, HiringError, type HiringPolicy, type HiringRequest } from "../types.js";
import {
  FIVE_CENTS,
  OWNER_A,
  OWNER_B,
  OWNER_C,
  OWNER_D,
  SELF_OWNER,
  TEN_CENTS,
  listing,
  liveLikeCatalog,
} from "./fixtures.js";

/**
 * One hour of work and two dollars to spend.
 *
 * An hour in the 120-second blocks the live listings use is 30 blocks, so at the five cents
 * a block those listings charge the work costs $1.50. Two dollars therefore leaves room
 * without being so large that the money rules never run.
 */
function request(over: Partial<HiringRequest> = {}): HiringRequest {
  return { category: "YIELD", workSeconds: 3_600n, budgetUsd8: 200_000_000n, ...over };
}

describe("rule CATEGORY", () => {
  it("never hires an agent that offers a different capability", () => {
    const d = decide(liveLikeCatalog(), request({ category: "GRID" }));
    expect(d.action).toBe("HIRE");
    expect(d.chosen?.category).toBe("GRID");
    expect(d.chosen?.listingId).toBe(3n);
  });

  it("answers NO_MATCH when nobody offers the capability at all", () => {
    const d = decide(liveLikeCatalog(), request({ category: "TREASURY" }));
    expect(d.action).toBe("NO_MATCH");
    expect(d.chosen).toBeNull();
    expect(d.rejected.every((r) => r.rule === "CATEGORY")).toBe(true);
  });

  it("puts a wrong-capability listing aside with the CATEGORY reason, not silently", () => {
    const d = decide(liveLikeCatalog(), request({ category: "YIELD" }));
    const grid = d.rejected.find((r) => r.listingId === 3n);
    expect(grid?.rule).toBe("CATEGORY");
  });
});

describe("rule INACTIVE", () => {
  it("refuses a listing that is switched off, even when it is the only one and affordable", () => {
    const catalog = [listing({ listingId: 1n, category: "YIELD", active: false })];
    const d = decide(catalog, request());
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected[0]?.rule).toBe("INACTIVE");
  });

  it("chooses the active one when a switched-off listing is cheaper", () => {
    const catalog = [
      listing({ listingId: 1n, owner: OWNER_A, priceUsd8PerPeriod: 1_000_000n, active: false }),
      listing({ listingId: 2n, owner: OWNER_B, priceUsd8PerPeriod: TEN_CENTS }),
    ];
    const d = decide(catalog, request({ budgetUsd8: 500_000_000n }));
    expect(d.chosen?.listingId).toBe(2n);
  });
});

describe("rule SELF", () => {
  it("refuses to pay a listing owned by this agent", () => {
    const catalog = [listing({ listingId: 1n, owner: SELF_OWNER, agentWallet: SELF_OWNER })];
    const d = decide(catalog, request(), DEFAULT_POLICY, { owner: SELF_OWNER });
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected[0]?.rule).toBe("SELF");
  });

  it("refuses when only the working address matches, not the paid address", () => {
    const catalog = [listing({ listingId: 1n, owner: OWNER_A, agentWallet: SELF_OWNER })];
    const d = decide(catalog, request(), DEFAULT_POLICY, { agentWallet: SELF_OWNER });
    expect(d.rejected[0]?.rule).toBe("SELF");
  });

  it("compares addresses without caring about letter case", () => {
    const catalog = [listing({ listingId: 1n, owner: SELF_OWNER.toUpperCase() as `0x${string}` })];
    const d = decide(catalog, request(), DEFAULT_POLICY, { owner: SELF_OWNER });
    expect(d.rejected[0]?.rule).toBe("SELF");
  });
});

describe("rule EXCLUDED_OWNER", () => {
  it("refuses an owner the caller listed as one they will not pay", () => {
    const d = decide(liveLikeCatalog(), request({ excludeOwners: [OWNER_D] }));
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected.find((r) => r.listingId === 4n)?.rule).toBe("EXCLUDED_OWNER");
  });

  it("leaves everyone else alone", () => {
    const d = decide(liveLikeCatalog(), request({ excludeOwners: [OWNER_A] }));
    expect(d.action).toBe("HIRE");
    expect(d.chosen?.listingId).toBe(4n);
  });
});

describe("rule NOT_CURATED", () => {
  it("refuses an unvetted listing when the caller asked for vetting", () => {
    const d = decide(liveLikeCatalog(), request({ requireCurated: true }));
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected.find((r) => r.listingId === 4n)?.rule).toBe("NOT_CURATED");
  });

  it("accepts an unvetted listing when the caller did not ask for vetting", () => {
    const d = decide(liveLikeCatalog(), request());
    expect(d.action).toBe("HIRE");
    expect(d.chosen?.curated).toBe(false);
  });

  it("accepts a vetted listing when vetting was asked for", () => {
    const catalog = liveLikeCatalog().map((l) =>
      l.listingId === 4n ? { ...l, curated: true } : l,
    );
    const d = decide(catalog, request({ requireCurated: true }));
    expect(d.chosen?.listingId).toBe(4n);
  });
});

describe("rule NO_ONCHAIN_EXECUTION", () => {
  it("refuses an advice-only listing when the caller needs the work carried out", () => {
    const d = decide(liveLikeCatalog(), request({ requireOnchainExecution: true }));
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected.find((r) => r.listingId === 4n)?.rule).toBe("NO_ONCHAIN_EXECUTION");
  });

  it("accepts the one listing that claims it carries work out", () => {
    const d = decide(
      liveLikeCatalog(),
      request({ category: "HEALTH_FACTOR", requireOnchainExecution: true, budgetUsd8: 500_000_000n }),
    );
    expect(d.chosen?.listingId).toBe(1n);
  });
});

describe("rule PERIOD_LENGTH", () => {
  it("refuses a block of time shorter than the shortest this agent rents by", () => {
    const catalog = [listing({ listingId: 1n, periodSeconds: 30n })];
    const d = decide(catalog, request());
    expect(d.rejected[0]?.rule).toBe("PERIOD_LENGTH");
  });

  it("refuses a block of time longer than the longest this agent rents by", () => {
    const catalog = [listing({ listingId: 1n, periodSeconds: 60n * 60n * 24n * 400n })];
    const d = decide(catalog, request());
    expect(d.rejected[0]?.rule).toBe("PERIOD_LENGTH");
  });

  it("accepts both ends of the band, because a boundary that refuses itself is a bug", () => {
    for (const seconds of [DEFAULT_POLICY.minPeriodSeconds, DEFAULT_POLICY.maxPeriodSeconds]) {
      const catalog = [listing({ listingId: 1n, periodSeconds: seconds })];
      const d = decide(catalog, request({ workSeconds: 1n }));
      expect(d.action).toBe("HIRE");
    }
  });
});

describe("rule PRICE_PER_PERIOD", () => {
  it("refuses a listing that repriced far above what this agent pays per block", () => {
    const catalog = [listing({ listingId: 1n, priceUsd8PerPeriod: 60_000_000n })];
    const d = decide(catalog, request({ budgetUsd8: 500_000_000n }));
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected[0]?.rule).toBe("PRICE_PER_PERIOD");
  });

  it("is a separate rule from the total limit, so a repriced listing is refused rather than shortened", () => {
    // One block of 60 seconds costs $0.60, which is above the per-block limit of $0.50, and
    // the caller has $5.00 to spend. A rebalancer that only had a total limit would happily
    // buy one block. The right answer is to stop.
    const catalog = [listing({ listingId: 1n, priceUsd8PerPeriod: 60_000_000n, periodSeconds: 60n })];
    const d = decide(catalog, request({ workSeconds: 60n, budgetUsd8: 500_000_000n }));
    expect(d.action).toBe("BLOCKED_BY_POLICY");
  });

  it("accepts a price exactly on the limit", () => {
    const catalog = [
      listing({ listingId: 1n, priceUsd8PerPeriod: DEFAULT_POLICY.maxPricePerPeriodUsd8 }),
    ];
    const d = decide(catalog, request({ workSeconds: 1n, budgetUsd8: 500_000_000n }));
    expect(d.action).toBe("HIRE");
  });
});

describe("rule TOO_MANY_PERIODS", () => {
  it("refuses rather than buying less time than the work needs", () => {
    // 120-second blocks, and a policy that allows 2 of them, against an hour of work.
    const policy: HiringPolicy = { ...DEFAULT_POLICY, maxPeriods: 2n };
    const d = decide([listing({ listingId: 1n })], request(), policy);
    expect(d.action).toBe("BLOCKED_BY_POLICY");
    expect(d.rejected[0]?.rule).toBe("TOO_MANY_PERIODS");
  });

  it("buys exactly enough blocks and never fewer", () => {
    // An hour of work in 120-second blocks is 30 blocks exactly.
    const d = decide([listing({ listingId: 1n })], request());
    expect(d.chosen?.periods).toBe(30n);
    expect(d.chosen?.coveredSeconds).toBe(3_600n);
  });

  it("rounds a part-used block up, so the rental never ends before the work does", () => {
    const d = decide([listing({ listingId: 1n })], request({ workSeconds: 3_601n }));
    expect(d.chosen?.periods).toBe(31n);
    expect(d.chosen?.coveredSeconds).toBeGreaterThan(3_601n);
  });
});

describe("rule OVER_BUDGET", () => {
  it("refuses when the only candidate costs more than the caller allows", () => {
    // 30 blocks at $0.05 is $1.50, and the caller allows $1.00.
    const d = decide([listing({ listingId: 1n })], request({ budgetUsd8: 100_000_000n }));
    expect(d.action).toBe("OVER_BUDGET");
    expect(d.chosen).toBeNull();
  });

  it("tells OVER_BUDGET apart from BLOCKED_BY_POLICY, because they need different fixes", () => {
    const tooDear = decide([listing({ listingId: 1n })], request({ budgetUsd8: 100_000_000n }));
    const refused = decide(
      [listing({ listingId: 1n, active: false })],
      request({ budgetUsd8: 100_000_000_000n }),
    );
    expect(tooDear.action).toBe("OVER_BUDGET");
    expect(refused.action).toBe("BLOCKED_BY_POLICY");
  });

  it("accepts a total exactly on the limit", () => {
    // 30 blocks at $0.05 is exactly $1.50.
    const d = decide([listing({ listingId: 1n })], request({ budgetUsd8: 150_000_000n }));
    expect(d.action).toBe("HIRE");
    expect(d.chosen?.totalUsd8).toBe(150_000_000n);
  });

  it("uses the smaller of the caller's limit and this agent's own", () => {
    const policy: HiringPolicy = { ...DEFAULT_POLICY, maxTotalUsd8: 100_000_000n };
    const d = decide([listing({ listingId: 1n })], request({ budgetUsd8: 100_000_000_000n }), policy);
    expect(d.budgetUsd8).toBe(100_000_000n);
    expect(d.action).toBe("OVER_BUDGET");
  });
});

describe("rule WINDOW_EXHAUSTED", () => {
  it("stops once the window ceiling has already been spent, whatever the catalog offers", () => {
    const d = decide(
      liveLikeCatalog(),
      request({ alreadySpentUsd8: DEFAULT_POLICY.windowBudgetUsd8 }),
    );
    expect(d.action).toBe("WINDOW_EXHAUSTED");
    expect(d.chosen).toBeNull();
    expect(d.puffLevel).toBe(4);
  });

  it("shrinks the limit to what is left of the window, rather than ignoring the total", () => {
    // $20.00 window, $19.00 already spent, so $1.00 is left. Thirty blocks cost $1.50.
    const d = decide(
      [listing({ listingId: 1n })],
      request({ budgetUsd8: 500_000_000n, alreadySpentUsd8: 1_900_000_000n }),
    );
    expect(d.budgetUsd8).toBe(100_000_000n);
    expect(d.action).toBe("OVER_BUDGET");
  });

  it("still hires when the window has room", () => {
    const d = decide([listing({ listingId: 1n })], request({ alreadySpentUsd8: 1_000_000n }));
    expect(d.action).toBe("HIRE");
  });
});

describe("the ranking", () => {
  it("chooses the cheapest total", () => {
    const catalog = [
      listing({ listingId: 1n, owner: OWNER_A, priceUsd8PerPeriod: TEN_CENTS }),
      listing({ listingId: 2n, owner: OWNER_B, priceUsd8PerPeriod: FIVE_CENTS }),
    ];
    const d = decide(catalog, request({ budgetUsd8: 1_000_000_000n }));
    expect(d.chosen?.listingId).toBe(2n);
    expect(d.runnerUp?.listingId).toBe(1n);
  });

  it("prefers a vetted listing when two cost the same", () => {
    const catalog = [
      listing({ listingId: 1n, owner: OWNER_A, curated: false }),
      listing({ listingId: 2n, owner: OWNER_B, curated: true }),
    ];
    const d = decide(catalog, request({ budgetUsd8: 1_000_000_000n }));
    expect(d.chosen?.listingId).toBe(2n);
  });

  it("falls back to the lower listing id, so the answer never depends on the read order", () => {
    const catalog = [
      listing({ listingId: 7n, owner: OWNER_A }),
      listing({ listingId: 2n, owner: OWNER_B }),
    ];
    const forward = decide(catalog, request({ budgetUsd8: 1_000_000_000n }));
    const backward = decide([...catalog].reverse(), request({ budgetUsd8: 1_000_000_000n }));
    expect(forward.chosen?.listingId).toBe(2n);
    expect(backward.chosen?.listingId).toBe(2n);
  });

  it("gives the same answer twice for the same input", () => {
    const first = decide(liveLikeCatalog(), request());
    const second = decide(liveLikeCatalog(), request());
    expect(JSON.stringify(first, replacer)).toBe(JSON.stringify(second, replacer));
  });
});

describe("the puff level", () => {
  it("is 0 when nothing was committed", () => {
    expect(decide(liveLikeCatalog(), request({ category: "TREASURY" })).puffLevel).toBe(0);
  });

  it("rises with the share of the limit the hire commits", () => {
    // Thirty blocks at $0.05 is $1.50.
    // Forty minutes is 20 blocks, which costs $1.00 against the $5.00 this agent allows
    // itself, so one fifth of the limit.
    const calm = decide(
      [listing({ listingId: 1n })],
      request({ workSeconds: 2_400n, budgetUsd8: 10_000_000_000n }),
    );
    const tight = decide([listing({ listingId: 1n })], request({ budgetUsd8: 160_000_000n }));
    expect(calm.puffLevel).toBe(1);
    expect(tight.puffLevel).toBe(4);
    expect(tight.puffLevel).toBeGreaterThan(calm.puffLevel);
  });
});

describe("inputs that make no sense fail hard", () => {
  it("refuses a negative amount of work rather than rounding it up to one block", () => {
    expect(() => decide(liveLikeCatalog(), request({ workSeconds: -1n }))).toThrow(HiringError);
  });

  it("refuses a negative limit", () => {
    expect(() => decide(liveLikeCatalog(), request({ budgetUsd8: -1n }))).toThrow(HiringError);
  });

  it("refuses a catalog with the same listing twice", () => {
    const catalog = [listing({ listingId: 1n }), listing({ listingId: 1n })];
    expect(() => decide(catalog, request())).toThrow(/twice/);
  });

  it("refuses a listing priced at zero, because the contract cannot store one", () => {
    const catalog = [listing({ listingId: 1n, priceUsd8PerPeriod: 0n })];
    expect(() => decide(catalog, request())).toThrow(HiringError);
  });

  it("refuses a listing renting in blocks of zero seconds", () => {
    const catalog = [listing({ listingId: 1n, periodSeconds: 0n })];
    expect(() => decide(catalog, request())).toThrow(HiringError);
  });

  it("refuses a policy under which nothing could ever be hired", () => {
    expect(() => decide(liveLikeCatalog(), request(), { ...DEFAULT_POLICY, maxTotalUsd8: 0n })).toThrow(
      HiringError,
    );
    expect(() =>
      decide(liveLikeCatalog(), request(), { ...DEFAULT_POLICY, maxPeriods: 0n }),
    ).toThrow(HiringError);
    expect(() =>
      decide(liveLikeCatalog(), request(), { ...DEFAULT_POLICY, intentTtlSeconds: 0n }),
    ).toThrow(HiringError);
  });

  it("refuses a policy whose per-block limit could never bind", () => {
    expect(() =>
      decide(liveLikeCatalog(), request(), {
        ...DEFAULT_POLICY,
        maxPricePerPeriodUsd8: DEFAULT_POLICY.maxTotalUsd8 + 1n,
      }),
    ).toThrow(/dead weight/);
  });

  it("refuses a policy whose per-hire limit could never bind", () => {
    expect(() =>
      decide(liveLikeCatalog(), request(), {
        ...DEFAULT_POLICY,
        windowBudgetUsd8: DEFAULT_POLICY.maxTotalUsd8 - 1n,
      }),
    ).toThrow(/look like a control/);
  });

  it("refuses a block-length band that is empty", () => {
    expect(() =>
      decide(liveLikeCatalog(), request(), {
        ...DEFAULT_POLICY,
        minPeriodSeconds: 100n,
        maxPeriodSeconds: 10n,
      }),
    ).toThrow(HiringError);
  });
});

describe("the sentence a caller reads", () => {
  it("names the money and the time when it hires", () => {
    const d = decide([listing({ listingId: 1n, name: "Fugu Yield" })], request());
    expect(d.reason).toContain("Fugu Yield");
    expect(d.reason).toContain("$1.50000000");
    expect(d.reason).toContain("1 hour");
  });

  it("says nothing was paid when it refuses", () => {
    for (const d of [
      decide(liveLikeCatalog(), request({ category: "TREASURY" })),
      decide([listing({ listingId: 1n })], request({ budgetUsd8: 1n })),
      decide([listing({ listingId: 1n, active: false })], request()),
      decide(liveLikeCatalog(), request({ alreadySpentUsd8: 100_000_000_000n })),
    ]) {
      expect(d.action).not.toBe("HIRE");
      expect(d.reason.toLowerCase()).toContain("nothing was paid");
    }
  });

  it("never uses an em dash, which the repo owner asked for directly", () => {
    const d = decide(liveLikeCatalog(), request());
    expect(d.reason).not.toContain("—");
  });
});

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
