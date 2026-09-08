import { describe, expect, it, vi } from "vitest";
import { decide } from "../decide.js";
import { explainDecision } from "../explain.js";
import { HF_ONE, type Decision, type Position } from "../types.js";

const pos: Position = {
  protocol: "aave",
  account: "0x0000000000000000000000000000000000000001",
  collateralBase: 1000n,
  debtBase: 500n,
  liquidationThresholdBps: 8000n,
  healthFactor: 1_600_000_000_000_000_000n,
  blockNumber: 1n,
};

const decision: Decision = {
  action: "WARN",
  healthFactor: 1_600_000_000_000_000_000n,
  dropToLiquidationBps: 3750n,
  reason: "Health factor 1.60. The collateral may fall 37.5% before liquidation.",
  suggestedRepayBase: 0n,
};

describe("explainDecision", () => {
  it("uses the model's output when the call succeeds", async () => {
    const text = await explainDecision(pos, decision, {
      generate: async () => "Your position is still safe.",
    });
    expect(text).toBe("Your position is still safe.");
  });

  it("falls back to the deterministic reason when the model fails", async () => {
    const text = await explainDecision(pos, decision, {
      generate: async () => {
        throw new Error("dGrid is down");
      },
    });
    expect(text).toBe(decision.reason);
  });

  it("falls back to the deterministic reason when the model returns empty text", async () => {
    const text = await explainDecision(pos, decision, { generate: async () => "   " });
    expect(text).toBe(decision.reason);
  });

  it("never modifies the decision it was given", async () => {
    const copy = { ...decision };
    await explainDecision(pos, decision, { generate: async () => "anything" });
    expect(decision).toEqual(copy);
  });

  it("the prompt carries the health factor number and forbids inventing figures", async () => {
    let capturedPrompt = "";
    await explainDecision(pos, decision, {
      generate: async (p) => {
        capturedPrompt = p;
        return "ok";
      },
    });
    expect(capturedPrompt).toContain("1.60");
    expect(capturedPrompt.toLowerCase()).toContain("never invent numbers");
  });

  it("clears the timer once generate succeeds", async () => {
    vi.useFakeTimers();
    try {
      const text = await explainDecision(pos, decision, {
        generate: async () => "Finished before the timeout.",
      });
      expect(text).toBe("Finished before the timeout.");
      // If the 20-second timeout timer is not cleared once generate wins, it stays
      // registered here even though its result is no longer used.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the repay amount appears as readable dollars, not a raw basis number", async () => {
    // 12345678 on the 8-decimal basis = $0.12. Before the fix this raw number went into
    // the prompt as-is and could be read back to the user as tens of millions of dollars.
    const repayDecision: Decision = {
      action: "PARTIAL_REPAY",
      healthFactor: 1_150_000_000_000_000_000n,
      dropToLiquidationBps: 1304n,
      reason: "Health factor 1.15.",
      suggestedRepayBase: 12_345_678n,
    };
    let capturedPrompt = "";
    await explainDecision(pos, repayDecision, {
      generate: async (p) => {
        capturedPrompt = p;
        return "ok";
      },
    });
    expect(capturedPrompt).toContain("$0.12");
    expect(capturedPrompt).not.toContain("12345678");
    expect(capturedPrompt.toLowerCase()).toContain("us dollars");
  });

  it("the numbers in the prompt are identical to the numbers in the deterministic reason", async () => {
    // Both sides use the single formatting source (src/strategy/format.ts), so the user
    // cannot possibly see two versions of the same number.
    const p: Position = {
      protocol: "aave",
      account: "0x0000000000000000000000000000000000000001",
      collateralBase: 10_000n,
      debtBase: 6_400n,
      liquidationThresholdBps: 8000n,
      healthFactor: HF_ONE * 125n / 100n,
      blockNumber: 1n,
    };
    const d = decide(p);
    let capturedPrompt = "";
    await explainDecision(p, d, {
      generate: async (text) => {
        capturedPrompt = text;
        return "ok";
      },
    });
    expect(d.reason).toContain("1.25");
    expect(capturedPrompt).toContain("1.25");
    expect(d.reason).toContain("20.0%");
    expect(capturedPrompt).toContain("20.0%");
  });
});
