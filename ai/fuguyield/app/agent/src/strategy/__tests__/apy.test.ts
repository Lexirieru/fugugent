import { describe, expect, it } from "vitest";
import {
  breakEvenSpreadBps,
  netGainBase,
  poolShareBps,
  requiredSpreadBps,
  switchCostBase,
  yieldOverPeriodBase,
} from "../apy.js";
import { YieldError, type SwitchCostModel } from "../types.js";

const usd = (n: bigint) => n * 100_000_000n;
const PRINCIPAL = usd(10_000n);
const cost: SwitchCostModel = { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: usd(1n) };

describe("switchCostBase", () => {
  it("is the proportional cost on the principal plus the fixed gas", () => {
    // 15 bps of $10,000 = $15, plus $1 of gas = $16
    expect(switchCostBase(PRINCIPAL, cost)).toBe(usd(16n));
  });

  it("rounds UP so the migration cost is never understated", () => {
    expect(switchCostBase(1n, { swapFeeBps: 5n, slippageBps: 10n, gasCostBase: 0n })).toBe(1n);
  });

  it("a zero principal makes no sense to migrate", () => {
    expect(() => switchCostBase(0n, cost)).toThrow(YieldError);
  });
});

describe("breakEvenSpreadBps — the heart of this whole strategy", () => {
  it("moving $10,000 at a cost of $16 needs 195 bps over 30 days to break even", () => {
    expect(breakEvenSpreadBps(PRINCIPAL, usd(16n), 30n)).toBe(195n);
  });

  it("a shorter horizon demands a MUCH larger spread", () => {
    // The same cost has to be repaid over a shorter time.
    expect(breakEvenSpreadBps(PRINCIPAL, usd(16n), 7n)).toBeGreaterThan(
      breakEvenSpreadBps(PRINCIPAL, usd(16n), 30n),
    );
    expect(breakEvenSpreadBps(PRINCIPAL, usd(16n), 7n)).toBe(835n);
  });

  it("a larger principal demands a smaller spread — the fixed gas matters less and less", () => {
    expect(breakEvenSpreadBps(usd(100_000n), switchCostBase(usd(100_000n), cost), 30n)).toBeLessThan(
      breakEvenSpreadBps(PRINCIPAL, switchCostBase(PRINCIPAL, cost), 30n),
    );
  });

  it("rounds UP so the migration threshold is never too lenient", () => {
    expect(breakEvenSpreadBps(usd(1_000_000n), 1n, 365n)).toBe(1n);
  });

  it("a zero-day horizon is a question with no answer", () => {
    expect(() => breakEvenSpreadBps(PRINCIPAL, usd(16n), 0n)).toThrow(YieldError);
  });

  it("rejects a zero principal", () => {
    expect(() => breakEvenSpreadBps(0n, usd(16n), 30n)).toThrow(YieldError);
  });
});

describe("requiredSpreadBps", () => {
  it("a 2.00x multiple doubles the break-even threshold", () => {
    expect(requiredSpreadBps(195n, 20_000n)).toBe(390n);
  });

  it("a 1.00x multiple returns the break-even threshold as-is", () => {
    expect(requiredSpreadBps(195n, 10_000n)).toBe(195n);
  });

  it("rounds up", () => {
    expect(requiredSpreadBps(1n, 15_000n)).toBe(2n);
  });
});

describe("yieldOverPeriodBase", () => {
  it("5% a year on $10,000 over 365 days is $500", () => {
    expect(yieldOverPeriodBase(PRINCIPAL, 500n, 365n)).toBe(usd(500n));
  });

  it("truncates downward so the yield is never overstated", () => {
    expect(yieldOverPeriodBase(PRINCIPAL, 500n, 1n)).toBe(136_986_301n);
  });

  it("a zero APY produces zero", () => {
    expect(yieldOverPeriodBase(PRINCIPAL, 0n, 30n)).toBe(0n);
  });
});

describe("netGainBase", () => {
  it("a 400 bps spread over 30 days on $10,000 exceeds the $16 cost", () => {
    expect(netGainBase(PRINCIPAL, 400n, 30n, usd(16n))).toBeGreaterThan(0n);
  });

  it("a spread exactly at break-even yields about zero, never a large positive", () => {
    const breakEven = breakEvenSpreadBps(PRINCIPAL, usd(16n), 30n);
    const g = netGainBase(PRINCIPAL, breakEven, 30n, usd(16n));
    expect(g).toBeGreaterThanOrEqual(0n);
    expect(g).toBeLessThan(usd(1n));
  });

  it("a spread below break-even loses money", () => {
    expect(netGainBase(PRINCIPAL, 100n, 30n, usd(16n))).toBeLessThan(0n);
  });
});

describe("poolShareBps", () => {
  it("a $10,000 principal in a $100,000 pool is 1000 bps", () => {
    expect(poolShareBps(PRINCIPAL, usd(100_000n))).toBe(1_000n);
  });

  it("rounds UP so our share never looks smaller than it is", () => {
    expect(poolShareBps(1n, usd(100_000n))).toBe(1n);
  });

  it("a pool worth zero is not a pool", () => {
    expect(() => poolShareBps(PRINCIPAL, 0n)).toThrow(YieldError);
  });
});
