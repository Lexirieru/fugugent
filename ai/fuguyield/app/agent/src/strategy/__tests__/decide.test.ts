import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import {
  DEFAULT_YIELD_THRESHOLDS,
  YieldError,
  type Pool,
  type SwitchCostModel,
  type YieldObservation,
} from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const PRINCIPAL = usd(10_000n);
const cost: SwitchCostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: usd(1n) };

/** The required threshold for a $10,000 principal: 195 bps break-even, times 2.00x = 390 bps. */
const REQUIRED_BPS = 390n;

function pool(over: Partial<Pool> & { poolId: string }): Pool {
  return {
    protocol: "venus",
    apyBps: 500n,
    tvlBase: usd(1_000_000n),
    riskScore: 10,
    isActive: true,
    apyAgeSeconds: 60,
    ...over,
  };
}

function obs(over: Partial<YieldObservation> = {}): YieldObservation {
  return {
    position: { principalBase: PRINCIPAL, current: pool({ poolId: "venus-usdt", apyBps: 500n }) },
    candidates: [],
    consecutiveFavorable: 3,
    blockNumber: 1n,
    ...over,
  };
}

describe("decide — the minimum APY spread threshold", () => {
  it("with no candidate, stays put", () => {
    const d = decide(obs(), cost);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("NO_CANDIDATE");
    expect(d.targetPoolId).toBeNull();
  });

  it("reports a break-even and a required threshold derived from the cost, not guessed", () => {
    const d = decide(obs(), cost);
    expect(d.switchCostBase).toBe(usd(16n));
    expect(d.breakEvenSpreadBps).toBe(195n);
    expect(d.requiredSpreadBps).toBe(REQUIRED_BPS);
  });

  it("a candidate with a lower APY is never attractive", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 400n })] }), cost);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("NO_BETTER_POOL");
  });

  it("the highest APY is NOT enough: a spread below the required threshold is rejected", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 880n })] }), cost);
    expect(d.spreadBps).toBe(380n);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("SPREAD_BELOW_BREAKEVEN");
    expect(d.spreadQualifies).toBe(false);
  });

  it("a spread exactly at the required threshold is enough", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 500n + REQUIRED_BPS })] }), cost);
    expect(d.spreadQualifies).toBe(true);
    expect(d.action).toBe("MIGRATE");
  });

  it("a large, confirmed spread produces a migration", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })] }), cost);
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("MIGRATION_ECONOMIC");
    expect(d.targetPoolId).toBe("aave-usdt");
    expect(d.netGainBase).toBeGreaterThan(0n);
  });

  it("the same spread on a small principal is NOT enough — the fixed gas eats it", () => {
    const small = obs({
      position: { principalBase: usd(200n), current: pool({ poolId: "venus-usdt", apyBps: 500n }) },
      candidates: [pool({ poolId: "aave-usdt", apyBps: 900n, tvlBase: usd(1_000_000n) })],
    });
    const d = decide(small, cost);
    expect(d.requiredSpreadBps).toBeGreaterThan(400n);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("SPREAD_BELOW_BREAKEVEN");
  });
});

describe("decide — confirmation prevents chasing a momentary spike", () => {
  it("a qualifying spread on only one observation is not enough", () => {
    const d = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 1 }),
      cost,
    );
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("SPREAD_NOT_CONFIRMED");
    expect(d.spreadQualifies).toBe(true);
  });

  it("two observations are still not enough, three are", () => {
    const two = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 2 }),
      cost,
    );
    const three = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 3 }),
      cost,
    );
    expect(two.action).toBe("STAY");
    expect(three.action).toBe("MIGRATE");
  });

  it("targetPoolId is still reported before confirmation, so the caller knows what was computed", () => {
    const d = decide(
      obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })], consecutiveFavorable: 0 }),
      cost,
    );
    expect(d.targetPoolId).toBe("aave-usdt");
  });
});

describe("decide — the risk gates run BEFORE the yield gates", () => {
  it("the highest APY in a pool that is too small is rejected — our own deposit would collapse that APY", () => {
    const d = decide(
      obs({
        candidates: [
          pool({ poolId: "small", apyBps: 5_000n, tvlBase: usd(50_000n) }),
          pool({ poolId: "large", apyBps: 900n }),
        ],
      }),
      cost,
    );
    expect(d.targetPoolId).toBe("large");
    expect(d.rejected.find((r) => r.poolId === "small")?.why).toBe("POOL_SHARE");
  });

  it("an implausible APY is rejected as broken data, not chased", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "mirage", apyBps: 500_000n })] }), cost);
    expect(d.action).toBe("STAY");
    expect(d.rejected[0]!.why).toBe("IMPLAUSIBLE_APY");
  });

  it("a risk score above the threshold is rejected whatever the APY", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "dangerous", apyBps: 9_000n, riskScore: 80 })] }), cost);
    expect(d.action).toBe("STAY");
    expect(d.rejected[0]!.why).toBe("RISK_SCORE");
  });

  it("an inactive pool is rejected", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "frozen", apyBps: 9_000n, isActive: false })] }), cost);
    expect(d.rejected[0]!.why).toBe("INACTIVE");
  });

  it("a stale APY is rejected — acting on an hour-old number is acting on a number that already changed", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "stale", apyBps: 9_000n, apyAgeSeconds: 7_200 })] }), cost);
    expect(d.rejected[0]!.why).toBe("STALE_DATA");
  });

  it("the pool the position already sits in is never a migration candidate", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "venus-usdt", apyBps: 900n })] }), cost);
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("NO_CANDIDATE");
  });
});

describe("decide — safety beats economics", () => {
  it("the current pool is frozen: migrate even when the spread is small", () => {
    const d = decide(
      obs({
        position: { principalBase: PRINCIPAL, current: pool({ poolId: "venus-usdt", apyBps: 500n, isActive: false }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 510n })],
      }),
      cost,
    );
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("CURRENT_POOL_UNSAFE");
    expect(d.targetPoolId).toBe("aave-usdt");
  });

  it("the current pool shrank until our share is too large: migrate", () => {
    const d = decide(
      obs({
        position: { principalBase: PRINCIPAL, current: pool({ poolId: "venus-usdt", tvlBase: usd(20_000n) }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 500n })],
      }),
      cost,
    );
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("CURRENT_POOL_UNSAFE");
  });

  it("the current pool is unsafe and no destination clears the gates: exit entirely", () => {
    const d = decide(
      obs({
        position: { principalBase: PRINCIPAL, current: pool({ poolId: "venus-usdt", isActive: false }) },
        candidates: [pool({ poolId: "also-dangerous", riskScore: 90 })],
      }),
      cost,
    );
    expect(d.action).toBe("EXIT");
    expect(d.reasonCode).toBe("NO_ELIGIBLE_POOL");
    expect(d.targetPoolId).toBeNull();
  });

  it("an emergency migration does not wait for confirmation", () => {
    const d = decide(
      obs({
        position: { principalBase: PRINCIPAL, current: pool({ poolId: "venus-usdt", isActive: false }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 500n })],
        consecutiveFavorable: 0,
      }),
      cost,
    );
    expect(d.action).toBe("MIGRATE");
  });

  it("the current position's APY data is stale: refuses to compute a spread and stays put", () => {
    const d = decide(
      obs({
        position: { principalBase: PRINCIPAL, current: pool({ poolId: "venus-usdt", apyAgeSeconds: 7_200 }) },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })],
      }),
      cost,
    );
    expect(d.action).toBe("STAY");
    expect(d.reasonCode).toBe("CURRENT_DATA_STALE");
  });

  it("unsafe beats stale: a frozen pool is left even when its data is stale", () => {
    const d = decide(
      obs({
        position: {
          principalBase: PRINCIPAL,
          current: pool({ poolId: "venus-usdt", isActive: false, apyAgeSeconds: 7_200 }),
        },
        candidates: [pool({ poolId: "aave-usdt", apyBps: 500n })],
      }),
      cost,
    );
    expect(d.action).toBe("MIGRATE");
    expect(d.reasonCode).toBe("CURRENT_POOL_UNSAFE");
  });
});

describe("decide — determinism and purity", () => {
  it("two identical calls produce identical decisions", () => {
    const o = obs({ candidates: [pool({ poolId: "a", apyBps: 900n }), pool({ poolId: "b", apyBps: 900n })] });
    expect(decide(o, cost)).toEqual(decide(o, cost));
  });

  it("an APY tie is broken by poolId alphabetically, not by input order", () => {
    const ascending = decide(
      obs({ candidates: [pool({ poolId: "aaa", apyBps: 900n }), pool({ poolId: "zzz", apyBps: 900n })] }),
      cost,
    );
    const descending = decide(
      obs({ candidates: [pool({ poolId: "zzz", apyBps: 900n }), pool({ poolId: "aaa", apyBps: 900n })] }),
      cost,
    );
    expect(ascending.targetPoolId).toBe("aaa");
    expect(descending.targetPoolId).toBe("aaa");
  });

  it("does not mutate the input observation", () => {
    const o = obs({ candidates: [pool({ poolId: "z", apyBps: 900n }), pool({ poolId: "a", apyBps: 400n })] });
    const initialOrder = o.candidates.map((c) => c.poolId);
    decide(o, cost);
    expect(o.candidates.map((c) => c.poolId)).toEqual(initialOrder);
  });
});

describe("decide — the explanation", () => {
  it("the reason uses formatted numbers, not the raw 8-decimal basis", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 900n })] }), cost);
    expect(d.reason).toContain("%");
    expect(d.reason).not.toContain("1000000000000");
  });

  it("the reason for refusing to migrate names the threshold that was not reached", () => {
    const d = decide(obs({ candidates: [pool({ poolId: "aave-usdt", apyBps: 880n })] }), cost);
    expect(d.reason).toContain("390");
  });
});

describe("decide — hard failure on nonsensical input", () => {
  it("rejects a zero principal", () => {
    expect(() => decide(obs({ position: { principalBase: 0n, current: pool({ poolId: "x" }) } }), cost)).toThrow(YieldError);
  });

  it("rejects a negative APY", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", apyBps: -1n })] }), cost)).toThrow(YieldError);
  });

  it("rejects a zero TVL", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", tvlBase: 0n })] }), cost)).toThrow(YieldError);
  });

  it("rejects a risk score outside 0..100", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", riskScore: 101 })] }), cost)).toThrow(YieldError);
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", riskScore: -1 })] }), cost)).toThrow(YieldError);
  });

  it("rejects a negative data age", () => {
    expect(() => decide(obs({ candidates: [pool({ poolId: "x", apyAgeSeconds: -1 })] }), cost)).toThrow(YieldError);
  });

  it("rejects a duplicate candidate poolId — the choice becomes ambiguous", () => {
    expect(() =>
      decide(obs({ candidates: [pool({ poolId: "x" }), pool({ poolId: "x", apyBps: 900n })] }), cost),
    ).toThrow(YieldError);
  });

  it("rejects a negative confirmation count", () => {
    expect(() => decide(obs({ consecutiveFavorable: -1 }), cost)).toThrow(YieldError);
  });

  it("rejects a zero-day horizon — the whole break-even threshold is divided by that number", () => {
    expect(() =>
      decide(obs(), cost, { ...DEFAULT_YIELD_THRESHOLDS, expectedHoldingDays: 0n }),
    ).toThrow(YieldError);
  });

  it("rejects a safety multiple below 1.00x — that formalizes a loss-making migration", () => {
    expect(() =>
      decide(obs(), cost, { ...DEFAULT_YIELD_THRESHOLDS, spreadSafetyMultipleBps: 9_999n }),
    ).toThrow(YieldError);
  });

  it("rejects a 100% maximum pool share — being the whole pool means its APY reflects only ourselves", () => {
    expect(() =>
      decide(obs(), cost, { ...DEFAULT_YIELD_THRESHOLDS, maxPoolShareBps: 10_000n }),
    ).toThrow(YieldError);
  });

  it("rejects a negative migration cost", () => {
    expect(() => decide(obs(), { ...cost, gasCostBase: -1n })).toThrow(YieldError);
  });
});
