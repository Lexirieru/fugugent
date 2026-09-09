/**
 * The replay.
 *
 * The failure it exists to catch cannot be seen one payment at a time: a run where every
 * payment is a correct, cheap, well-bounded one cent, and the total is money nobody meant
 * to spend.
 */
import { describe, expect, it } from "vitest";
import { runPurchaseBacktest, runPuffLevel, type PurchaseStep } from "../backtest.js";
import { DEFAULT_POLICY, WAD, type PurchasePolicy } from "../types.js";
import { ONE_CENT, SELLER, USDT_TESTNET, demandBody, option } from "./fixtures.js";

function step(label: string, options = [option()]): PurchaseStep {
  return { label, demandBody: demandBody(options) };
}

describe("runPurchaseBacktest", () => {
  it("adds up what a run really spent, not what each step allowed", () => {
    const report = runPurchaseBacktest([step("a"), step("b"), step("c")]);
    expect(report.paid).toBe(3);
    expect(report.totalSpentUnits).toBe(ONE_CENT * 3n);
    expect(report.largestPaymentUnits).toBe(ONE_CENT);
  });

  it("stops a repeating payment once the window ceiling is reached", () => {
    // Five hundred and one payments of one cent is 5.01 tokens against a ceiling of 5.
    // Every single decision is correct on its own, and the run must still stop.
    const steps = Array.from({ length: 501 }, (_, i) => step(`call ${i}`));
    const report = runPurchaseBacktest(steps);
    expect(report.totalSpentUnits).toBeLessThanOrEqual(DEFAULT_POLICY.windowBudgetUnits);
    expect(report.paid).toBe(500);
    expect(report.refusalsByAction.WINDOW_EXHAUSTED).toBe(1);
  });

  it("carries the running total forward across steps", () => {
    const report = runPurchaseBacktest([step("a"), step("b")]);
    expect(report.steps[1]?.runningTotalUnits).toBe(ONE_CENT * 2n);
  });

  it("gives the same report twice for the same steps", () => {
    const steps = [step("a"), step("b", [option({ asset: USDT_TESTNET })]), step("c")];
    const a = JSON.stringify(runPurchaseBacktest(steps), replacer);
    const b = JSON.stringify(runPurchaseBacktest(steps), replacer);
    expect(a).toBe(b);
  });

  it("counts refusals by the rule that caused them, so a quiet run is readable", () => {
    const report = runPurchaseBacktest([
      step("wrong token", [option({ asset: USDT_TESTNET })]),
      step("too dear", [option({ amount: (WAD * 3n).toString() })]),
      step("wrong chain", [option({ network: "eip155:56" })]),
    ]);
    expect(report.paid).toBe(0);
    expect(report.refusalsByRule).toEqual({ TOKEN: 1, PRICE_CAP: 1, CHAIN: 1 });
  });

  it("never pays a recipient the caller did not expect, however many steps there are", () => {
    const steps: PurchaseStep[] = Array.from({ length: 5 }, (_, i) => ({
      label: `call ${i}`,
      demandBody: demandBody([option()]),
      expectedPayee: "0x000000000000000000000000000000000000bEEF" as `0x${string}`,
    }));
    const report = runPurchaseBacktest(steps);
    expect(report.totalSpentUnits).toBe(0n);
    expect(report.refusalsByRule.PAYEE).toBe(5);
  });

  it("reports the run's own puff level from the share of the window it used", () => {
    const quiet = runPurchaseBacktest([step("a")]);
    const busy = runPurchaseBacktest(Array.from({ length: 450 }, (_, i) => step(`call ${i}`)));
    expect(runPuffLevel(quiet)).toBe(1);
    expect(runPuffLevel(busy)).toBe(4);
  });

  it("continues from a running total the caller already had", () => {
    const report = runPurchaseBacktest([step("a")], DEFAULT_POLICY, {
      spentUnits: DEFAULT_POLICY.windowBudgetUnits,
      windowStartedAt: 0n,
    });
    expect(report.paid).toBe(0);
    expect(report.totalSpentUnits).toBe(0n);
    expect(report.steps[0]?.action).toBe("WINDOW_EXHAUSTED");
  });

  it("refuses a policy under which the per-call cap could never bind, before the run starts", () => {
    const broken: PurchasePolicy = { ...DEFAULT_POLICY, windowBudgetUnits: 1n };
    expect(() => runPurchaseBacktest([step("a")], broken)).toThrow();
  });

  it("works against a demand shaped like the one this project's own seller sends", () => {
    const report = runPurchaseBacktest([
      { label: "quote", demandBody: demandBody([option({ payTo: SELLER })]) },
    ]);
    expect(report.paid).toBe(1);
    expect(report.totalSpentUnits).toBe(ONE_CENT);
  });
});

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
