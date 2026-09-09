/**
 * The replay.
 *
 * The failure it exists to catch is the one that cannot be seen one decision at a time: a
 * run in which every hire is cheap, correct and within its limit, and the total is money
 * nobody meant to spend.
 */
import { describe, expect, it } from "vitest";
import { runBacktest, runPuffLevel, type BacktestStep } from "../backtest.js";
import { DEFAULT_POLICY, type HiringPolicy } from "../types.js";
import { OWNER_B, SELF_OWNER, listing, liveLikeCatalog } from "./fixtures.js";

/** An hour of work at five cents a block is thirty blocks, which costs $1.50. */
function step(label: string, over: Partial<BacktestStep["request"]> = {}): BacktestStep {
  return {
    label,
    catalog: [listing({ listingId: 4n, owner: OWNER_B, name: "Fugu Yield" })],
    request: { category: "YIELD", workSeconds: 3_600n, budgetUsd8: 200_000_000n, ...over },
  };
}

describe("runBacktest", () => {
  it("adds up what a run really spent, not what each step allowed", () => {
    const report = runBacktest([step("a"), step("b"), step("c")]);
    expect(report.hires).toBe(3);
    expect(report.totalSpentUsd8).toBe(450_000_000n);
    expect(report.largestHireUsd8).toBe(150_000_000n);
  });

  it("stops a repeating hire once the window ceiling is reached", () => {
    // Fourteen hires of $1.50 is $21.00 against a window ceiling of $20.00, so the run
    // must stop before the last one. Every single decision is correct on its own.
    const steps = Array.from({ length: 14 }, (_, i) => step(`run ${i}`));
    const report = runBacktest(steps);
    expect(report.totalSpentUsd8).toBeLessThanOrEqual(DEFAULT_POLICY.windowBudgetUsd8);
    expect(report.hires).toBeLessThan(14);
    expect(Object.keys(report.refusalsByAction).length).toBeGreaterThan(0);
  });

  it("carries the running total forward and ignores one written into the request", () => {
    const first = runBacktest([step("a"), step("b")]);
    const withLie = runBacktest([
      step("a", { alreadySpentUsd8: 0n }),
      step("b", { alreadySpentUsd8: 0n }),
    ]);
    expect(withLie.totalSpentUsd8).toBe(first.totalSpentUsd8);
    expect(withLie.steps[1]?.runningTotalUsd8).toBe(300_000_000n);
  });

  it("gives the same report twice for the same steps", () => {
    const steps = [step("a"), step("b", { category: "TREASURY" }), step("c")];
    const a = JSON.stringify(runBacktest(steps), replacer);
    const b = JSON.stringify(runBacktest(steps), replacer);
    expect(a).toBe(b);
  });

  it("counts refusals by their kind, so a run of nothing-happened is readable", () => {
    const report = runBacktest([
      step("nobody offers it", { category: "TREASURY" }),
      step("too dear", { budgetUsd8: 1n }),
    ]);
    expect(report.hires).toBe(0);
    expect(report.refusalsByAction).toEqual({ NO_MATCH: 1, OVER_BUDGET: 1 });
  });

  it("never hires this agent's own listing, however many steps there are", () => {
    const steps: BacktestStep[] = Array.from({ length: 5 }, (_, i) => ({
      label: `run ${i}`,
      catalog: [listing({ listingId: 1n, owner: SELF_OWNER, agentWallet: SELF_OWNER })],
      request: { category: "YIELD", workSeconds: 3_600n, budgetUsd8: 200_000_000n },
    }));
    const report = runBacktest(steps, DEFAULT_POLICY, { owner: SELF_OWNER });
    expect(report.totalSpentUsd8).toBe(0n);
  });

  it("reports the run's own puff level from the share of the window it used", () => {
    const quiet = runBacktest([step("a")]);
    const busy = runBacktest(Array.from({ length: 13 }, (_, i) => step(`run ${i}`)));
    expect(runPuffLevel(quiet)).toBe(1);
    expect(runPuffLevel(busy)).toBe(4);
  });

  it("throws rather than reporting a run that broke the window ceiling", () => {
    // A policy whose window is smaller than one hire is refused before the run starts, so
    // this asserts the guard on the way in as well as the invariant at the end.
    const broken: HiringPolicy = { ...DEFAULT_POLICY, windowBudgetUsd8: 1n };
    expect(() => runBacktest([step("a")], broken)).toThrow();
  });

  it("works against a catalog shaped like the live one", () => {
    const report = runBacktest([
      { label: "yield", catalog: liveLikeCatalog(), request: { category: "YIELD", workSeconds: 600n, budgetUsd8: 200_000_000n } },
      { label: "grid", catalog: liveLikeCatalog(), request: { category: "GRID", workSeconds: 600n, budgetUsd8: 200_000_000n } },
      { label: "guardian", catalog: liveLikeCatalog(), request: { category: "HEALTH_FACTOR", workSeconds: 600n, budgetUsd8: 200_000_000n } },
    ]);
    expect(report.hires).toBe(3);
    // Ten minutes is five blocks: $0.25, $0.25 and $0.50 for the dearer listing.
    expect(report.totalSpentUsd8).toBe(100_000_000n);
  });
});

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
