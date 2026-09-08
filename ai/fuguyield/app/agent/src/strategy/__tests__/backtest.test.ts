import { describe, expect, it } from "vitest";
import { runBacktest, type YieldBacktestInput } from "../backtest.js";
import { YieldError, type SwitchCostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const cost: SwitchCostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: usd(1n) };

/** Two pools that take turns being the highest, by a small margin. */
function flickering(candles: number): { poolId: string; apyBps: bigint }[][] {
  const out: { poolId: string; apyBps: bigint }[][] = [];
  for (let i = 0; i < candles; i++) {
    const a = i % 2 === 0 ? 520n : 500n;
    const b = i % 2 === 0 ? 500n : 520n;
    out.push([
      { poolId: "venus-usdt", apyBps: a },
      { poolId: "aave-usdt", apyBps: b },
    ]);
  }
  return out;
}

/** One pool is clearly and consistently higher for the whole period. */
function realSpread(candles: number): { poolId: string; apyBps: bigint }[][] {
  return Array.from({ length: candles }, () => [
    { poolId: "venus-usdt", apyBps: 500n },
    { poolId: "aave-usdt", apyBps: 1_500n },
  ]);
}

function input(over: Partial<YieldBacktestInput> = {}): YieldBacktestInput {
  return {
    startPrincipalBase: usd(10_000n),
    startPoolId: "venus-usdt",
    pools: [
      { poolId: "venus-usdt", protocol: "venus", tvlBase: usd(1_000_000n), riskScore: 10 },
      { poolId: "aave-usdt", protocol: "aave", tvlBase: usd(1_000_000n), riskScore: 10 },
    ],
    apySeriesBps: flickering(60),
    daysPerCandle: 1n,
    cost: cost,
    ...over,
  };
}

describe("runBacktest — purity", () => {
  it("is deterministic", () => {
    expect(runBacktest(input())).toEqual(runBacktest(input()));
  });

  it("reports the candle count", () => {
    expect(runBacktest(input()).candles).toBe(60);
  });
});

describe("runBacktest — chasing the highest APY is a way to lose", () => {
  it("the chaser migrates on nearly every candle, the disciplined policy not at all", () => {
    const r = runBacktest(input());
    expect(r.chaser.migrations).toBeGreaterThan(40);
    expect(r.disciplined.migrations).toBe(0);
  });

  it("the chaser pays multiplied costs and ends poorer than the policy that does nothing", () => {
    const r = runBacktest(input());
    expect(r.chaser.totalCostBase).toBeGreaterThan(r.disciplined.totalCostBase);
    expect(r.chaser.finalPrincipalBase).toBeLessThan(r.passive.finalPrincipalBase);
  });

  it("the disciplined policy beats the chaser on a flickering APY", () => {
    const r = runBacktest(input());
    expect(r.disciplinedBeatsChaser).toBe(true);
  });
});

describe("runBacktest — a real spread does get taken", () => {
  it("a persistent 1000 bps spread triggers exactly one migration, not zero and not many", () => {
    const r = runBacktest(input({ apySeriesBps: realSpread(60) }));
    expect(r.disciplined.migrations).toBe(1);
  });

  it("that migration is profitable: it beats staying put", () => {
    const r = runBacktest(input({ apySeriesBps: realSpread(60) }));
    expect(r.disciplined.finalPrincipalBase).toBeGreaterThan(r.passive.finalPrincipalBase);
  });

  it("the migration only happens after confirmation, not on the first observation", () => {
    const r = runBacktest(input({ apySeriesBps: realSpread(60) }));
    expect(r.disciplined.firstMigrationCandle).toBeGreaterThanOrEqual(2);
  });

  it("a period too short to repay the cost: the disciplined policy migrates anyway", () => {
    // A $16 cost will not be repaid within a few days, but the required threshold uses
    // the 30-day horizon and still allows the move. This test records that the decision
    // never looks at the length of the series — the horizon is the assumption, not the
    // backtest's duration.
    const r = runBacktest(input({ apySeriesBps: realSpread(4) }));
    expect(r.disciplined.migrations).toBe(1);
    expect(r.disciplined.finalPrincipalBase).toBeLessThan(r.passive.finalPrincipalBase);
  });
});

describe("runBacktest — hard failure on nonsensical input", () => {
  it("rejects an empty APY series", () => {
    expect(() => runBacktest(input({ apySeriesBps: [] }))).toThrow(YieldError);
  });

  it("rejects a starting pool that is not in the pool list", () => {
    expect(() => runBacktest(input({ startPoolId: "does-not-exist" }))).toThrow(YieldError);
  });

  it("rejects an APY row that names an unknown pool", () => {
    expect(() =>
      runBacktest(input({ apySeriesBps: [[{ poolId: "ghost", apyBps: 500n }]] })),
    ).toThrow(YieldError);
  });

  it("rejects zero days per candle", () => {
    expect(() => runBacktest(input({ daysPerCandle: 0n }))).toThrow(YieldError);
  });
});
