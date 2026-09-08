import { describe, expect, it, vi } from "vitest";
import {
  NeverSentError,
  RepaySendError,
  asRepaySendFailure,
  clearPendingRepay,
  executeDecision,
  reconcilePendingRepay,
  type ExecuteDeps,
  type ExecuteLimits,
  type ExecuteState,
  type PendingRepay,
} from "../execute.js";
import type { Decision, Position } from "../types.js";

/** The repay asset's address is now INJECTED, not a constant inside execute.ts. */
const REPAY_ASSET = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

const POS: Position = {
  protocol: "aave",
  account: "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E",
  collateralBase: 750_000_000_000n,
  debtBase: 312_500_000_000n,
  liquidationThresholdBps: 7_500n,
  healthFactor: 1_800_000_000_000_000_000n,
  blockNumber: 1n,
};

function decisionWith(action: Decision["action"], suggestedRepayBase: bigint): Decision {
  return {
    action,
    healthFactor: POS.healthFactor,
    dropToLiquidationBps: 0n,
    reason: "test",
    suggestedRepayBase,
  };
}

function limits(overrides: Partial<ExecuteLimits> = {}): ExecuteLimits {
  return {
    maxPerActionUsd8: 100_000_000_000n, // $1000
    maxPerDayUsd8: 500_000_000_000n, // $5000
    minIntervalSeconds: 300,
    ...overrides,
  };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: 1_000_000,
    lastActionAt: 0,
    killed: false,
    pendingRepay: null,
    ...overrides,
  };
}

function pending(overrides: Partial<PendingRepay> = {}): PendingRepay {
  return {
    asset: REPAY_ASSET,
    amountUsd8: 10_000_000_000n,
    startedAt: 999_000,
    txHash: null,
    debtBaseBeforeSend: POS.debtBase,
    blockNumberBeforeSend: POS.blockNumber,
    ...overrides,
  };
}

function deps(overrides: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    repayAsset: REPAY_ASSET,
    sendRepay: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe("executeDecision", () => {
  it("rule 1: the kill switch is absolute, it never sends", async () => {
    const d = decisionWith("EMERGENCY", 50_000_000_000n);
    const s = state({ killed: true });
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("rule 1: the kill switch beats everything, even when every other limit is loose", async () => {
    const d = decisionWith("PARTIAL_REPAY", 1_000n);
    const s = state({ killed: true, lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 999_999 });
    const result = await executeDecision(d, POS, limits({ minIntervalSeconds: 0 }), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it.each(["NONE", "WARN"] as const)("rule 2: a %s action never sends", async (action) => {
    const d = decisionWith(action, 0n);
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("rule 3: an amount above the per-action cap is capped, not rejected", async () => {
    const d = decisionWith("PARTIAL_REPAY", 200_000_000_000n); // $2000, cap $1000
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(true);
    expect(result.amountSentUsd8).toBe(100_000_000_000n);
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 100_000_000_000n);
  });

  it("does not cap when the amount is still below the per-action limit", async () => {
    const d = decisionWith("PARTIAL_REPAY", 50_000_000_000n); // $500
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(false);
    expect(result.amountSentUsd8).toBe(50_000_000_000n);
  });

  it("rule 4: an amount above the remaining daily budget is capped to what is left", async () => {
    const d = decisionWith("PARTIAL_REPAY", 80_000_000_000n); // $800, below the per-action cap
    const s = state({ spentTodayUsd8: 450_000_000_000n }); // left of $5000: $500
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerDay).toBe(true);
    expect(result.amountSentUsd8).toBe(50_000_000_000n); // sisa $500
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 50_000_000_000n);
  });

  it("the per-action and daily caps apply together", async () => {
    // suggestedRepayBase ($2000) > maxPerActionUsd8 ($1000) > the daily remainder ($300)
    const d = decisionWith("PARTIAL_REPAY", 200_000_000_000n);
    const s = state({ spentTodayUsd8: 470_000_000_000n }); // left of $5000: $300
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(true);
    expect(result.cappedPerDay).toBe(true);
    // The amount actually sent is the daily remainder ($300), not the per-action cap
    // ($1000) — the second cap is tighter than the first.
    expect(result.amountSentUsd8).toBe(30_000_000_000n);
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 30_000_000_000n);
  });

  it("rule 4: a zero remaining daily budget -> does not send", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 500_000_000_000n }); // already exhausted
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("rule 5: the cooldown refuses before minIntervalSeconds has passed", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 299 }); // minIntervalSeconds default 300
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("rule 5: the cooldown allows exactly once minIntervalSeconds has passed", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 300 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(dep.sendRepay).toHaveBeenCalledOnce();
  });

  it("rule 6: after a successful send, spentTodayUsd8 and lastActionAt are updated", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 5_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({ now: () => 1_000_500 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.state.spentTodayUsd8).toBe(15_000_000_000n);
    expect(result.state.lastActionAt).toBe(1_000_500);
    expect(result.state.dayStartedAt).toBe(1_000_000);
  });

  it("rule 6: the daily budget resets once 24 hours have passed", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 499_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({ now: () => 1_000_000 + 86_401 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerDay).toBe(false);
    expect(result.amountSentUsd8).toBe(10_000_000_000n);
    expect(result.state.spentTodayUsd8).toBe(10_000_000_000n);
    expect(result.state.dayStartedAt).toBe(1_000_000 + 86_401);
  });

  it("sends nothing to a real network — sendRepay is always an injected dependency", async () => {
    const d = decisionWith("EMERGENCY", 10_000_000_000n);
    const dep = deps();
    await executeDecision(d, POS, limits(), state(), dep);
    expect(dep.sendRepay).toHaveBeenCalledTimes(1);
  });

  // ————————————————————————————————————————————————————————————————
  // C2 — "failed" does not mean "did not happen"
  //
  // The old test in this spot was named "a failed send does not consume the budget" and
  // locked in the opposite of the rule below. It was written deliberately in the previous
  // round and is indeed correct for a pure function; it is WRONG for a network send, because
  // a `waitForTransactionReceipt` that times out throws AFTER the transaction landed. It was
  // replaced, not quietly deleted.
  // ————————————————————————————————————————————————————————————————

  it("an unmarked send failure STILL charges the budget and records a pending repay", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 5_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({
      sendRepay: vi.fn(async () => {
        // The failure shape that is the whole reason this rule exists: the transaction landed,
        // only reading its receipt failed.
        throw new Error("waitForTransactionReceipt timed out after 180s");
      }),
      now: () => 1_000_500,
    });

    const err = await executeDecision(d, POS, limits(), s, dep).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RepaySendError);
    const sendErr = err as RepaySendError;
    // The original error must not be lost: the caller still has to be able to read it.
    expect(sendErr.message).toContain("waitForTransactionReceipt timed out");
    expect(sendErr.cause).toBeInstanceOf(Error);

    // The budget AND the cooldown have both moved, because the money may already be gone.
    expect(sendErr.stateAfterSend.spentTodayUsd8).toBe(15_000_000_000n);
    expect(sendErr.stateAfterSend.lastActionAt).toBe(1_000_500);

    // And most decisive of all: the pending record that will hold back the next cycle,
    // complete with its reconciliation anchors.
    expect(sendErr.stateAfterSend.pendingRepay).toEqual({
      asset: REPAY_ASSET,
      amountUsd8: 10_000_000_000n,
      startedAt: 1_000_500,
      txHash: null,
      debtBaseBeforeSend: POS.debtBase,
      blockNumberBeforeSend: POS.blockNumber,
    });

    // The input object is still not mutated — this module remains pure.
    expect(s.spentTodayUsd8).toBe(5_000_000_000n);
    expect(s.pendingRepay).toBeNull();
  });

  it("an error declaring it never touched the network is rethrown as-is, the budget intact", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const original = new NeverSentError("the repay asset is not the allowlisted one; refusing to send anything");
    const dep = deps({ sendRepay: vi.fn(async () => { throw original; }) });

    const err = await executeDecision(d, POS, limits(), state(), dep).catch((e: unknown) => e);

    // Not a RepaySendError: no budget is deducted and nothing is left pending.
    expect(err).toBe(original);
    expect(err).not.toBeInstanceOf(RepaySendError);
  });

  it("a plain object error with neverSent:true is honored too (not via instanceof)", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    // `chain/session.ts` marks its own errors via a property so it does not have to inherit
    // a class from execute.ts.
    const original = Object.assign(new Error("the conversion yields zero token units"), {
      neverSent: true as const,
    });
    const dep = deps({ sendRepay: vi.fn(async () => { throw original; }) });

    await expect(executeDecision(d, POS, limits(), state(), dep)).rejects.toBe(original);
  });

  it("rule 2: a pending repay holds back EVERY new send, even when the other limits are loose", async () => {
    const d = decisionWith("EMERGENCY", 10_000_000_000n);
    const s = state({ pendingRepay: pending() });
    const dep = deps({ now: () => 9_999_999 }); // the cooldown has definitely passed

    const result = await executeDecision(d, POS, limits({ minIntervalSeconds: 0 }), s, dep);

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/has not yet been proven complete/i);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("a successful send leaves nothing pending", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const result = await executeDecision(d, POS, limits(), state(), deps());

    expect(result.sent).toBe(true);
    expect(result.state.pendingRepay).toBeNull();
  });
});

describe("reconcilePendingRepay", () => {
  it("the debt fell by EXACTLY what we paid, at a newer block = proven to have landed", () => {
    const s = state({ spentTodayUsd8: 10_000_000_000n, pendingRepay: pending() });
    const after = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber + 1n,
      debtBase: POS.debtBase - 10_000_000_000n, // = pending().amountUsd8
    });

    expect(after.pendingRepay).toBeNull();
    // The budget already deducted is NOT refunded: the transaction did go through.
    expect(after.spentTodayUsd8).toBe(10_000_000_000n);
  });

  it.each([
    ["the user repaid $1 themselves while our tx was stuck", 100_000_000n],
    ["a third-party partial liquidation, far larger", 50_000_000_000n],
    ["a fall of only one unit (a rounding remainder, not our payment)", 1n],
  ])(
    "a debt that fell for ANOTHER REASON (%s) is NOT taken as proof our repay landed",
    (_label, drop) => {
      // This is what separates "the debt fell" from "the debt fell by exactly what we paid".
      // Without that distinction our record is cleared too early, Guardian is free to act,
      // and then the first tx lands -> two payments.
      const s = state({ pendingRepay: pending() });
      const after = reconcilePendingRepay(s, {
        ...POS,
        blockNumber: POS.blockNumber + 10n,
        debtBase: POS.debtBase - (drop as bigint),
      });
      expect(after.pendingRepay).toEqual(pending());
    },
  );

  it.each([-2n, -1n, 0n, 1n, 2n])(
    "a rounding difference of %s units is still accepted (two independent floors)",
    (shift) => {
      const s = state({ pendingRepay: pending() });
      const after = reconcilePendingRepay(s, {
        ...POS,
        blockNumber: POS.blockNumber + 1n,
        debtBase: POS.debtBase - (10_000_000_000n + (shift as bigint)),
      });
      expect(after.pendingRepay).toBeNull();
    },
  );

  it("a 3-unit difference is already outside the tolerance and is refused", () => {
    const s = state({ pendingRepay: pending() });
    const after = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber + 1n,
      debtBase: POS.debtBase - (10_000_000_000n + 3n),
    });
    expect(after.pendingRepay).toEqual(pending());
  });

  it("the debt has not fallen = not yet proven -> the record is LEFT IN PLACE, even far ahead in blocks", () => {
    const s = state({ pendingRepay: pending() });
    const after = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber + 10_000n,
      debtBase: POS.debtBase,
    });

    // A transaction still in the mempool can land at any moment; "not seen yet" never means
    // "will not happen".
    expect(after.pendingRepay).toEqual(pending());
  });

  it("a fallen debt read from the same or an older block is not taken as proof", () => {
    const s = state({ pendingRepay: pending() });
    const after = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber,
      debtBase: POS.debtBase - 10_000_000_000n,
    });

    expect(after.pendingRepay).toEqual(pending());
  });

  it("with no pending record, the state is returned as-is", () => {
    const s = state();
    expect(reconcilePendingRepay(s, POS)).toBe(s);
  });

  it("executeDecision reconciles by itself before any rule, and may then send again", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ pendingRepay: pending(), lastActionAt: 0 });
    const newPos: Position = {
      ...POS,
      blockNumber: POS.blockNumber + 1n,
      debtBase: POS.debtBase - 10_000_000_000n, // = pending().amountUsd8
    };
    const dep = deps();

    const result = await executeDecision(d, newPos, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.state.pendingRepay).toBeNull();
    expect(dep.sendRepay).toHaveBeenCalledOnce();
  });
});

describe("clearPendingRepay", () => {
  it("the operator's way out: the record is dropped, the budget already charged is not refunded", () => {
    const s = state({ spentTodayUsd8: 10_000_000_000n, pendingRepay: pending() });
    const after = clearPendingRepay(s);

    expect(after.pendingRepay).toBeNull();
    expect(after.spentTodayUsd8).toBe(10_000_000_000n);
  });
});

describe("persistBeforeSend — the pending record touches disk BEFORE the tx leaves", () => {
  it("by the time sendRepay is called, the saved state ALREADY carries pendingRepay", async () => {
    // This simulates the process dying inside the 180-second receipt wait: whatever is saved
    // at the MOMENT sendRepay is called is exactly what a restart will find. If
    // `persistBeforeSend` is not called before sending, what shows up here is `null` — and
    // the restart pays again.
    const saved: ExecuteState[] = [];
    let seenAtSendTime: ExecuteState | undefined;
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const dep = deps({
      persistBeforeSend: (s) => {
        saved.push(s);
      },
      sendRepay: vi.fn(async () => {
        seenAtSendTime = saved.at(-1);
        return "0xdeadbeef" as `0x${string}`;
      }),
      now: () => 1_000_500,
    });

    await executeDecision(d, POS, limits(), state(), dep);

    expect(seenAtSendTime).toBeDefined();
    expect(seenAtSendTime?.pendingRepay).not.toBeNull();
    expect(seenAtSendTime?.pendingRepay?.amountUsd8).toBe(10_000_000_000n);
    expect(seenAtSendTime?.spentTodayUsd8).toBe(10_000_000_000n);
    expect(seenAtSendTime?.lastActionAt).toBe(1_000_500);
  });

  it("a failed save -> sends NOTHING, and its error is marked neverSent", async () => {
    // Fail closed: sending with no trace that could hold back a second payment is worse than
    // not sending at all.
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
    const dep = deps({
      persistBeforeSend: () => {
        throw new Error("the disk is full");
      },
      sendRepay,
    });

    const err = await executeDecision(d, POS, limits(), state(), dep).catch((e: unknown) => e);

    expect(sendRepay).not.toHaveBeenCalled();
    expect(err).toBeInstanceOf(NeverSentError);
    expect((err as NeverSentError).message).toContain("the disk is full");
    expect(err).not.toBeInstanceOf(RepaySendError);
  });

  it("without persistBeforeSend, sending still works (the hook is optional)", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);
    expect(result.sent).toBe(true);
  });
});

describe("asRepaySendFailure — duck-typed recognition, not instanceof", () => {
  const sampleState: ExecuteState = {
    spentTodayUsd8: 10_000_000_000n,
    dayStartedAt: 1_000_000,
    lastActionAt: 1_000_500,
    killed: false,
    pendingRepay: {
      asset: REPAY_ASSET,
      amountUsd8: 10_000_000_000n,
      startedAt: 1_000_500,
      txHash: null,
      debtBaseBeforeSend: POS.debtBase,
      blockNumberBeforeSend: POS.blockNumber,
    },
  };

  it("recognizes a genuine RepaySendError", () => {
    const err = new RepaySendError("failed", sampleState);
    expect(asRepaySendFailure(err)?.stateAfterSend).toEqual(sampleState);
  });

  it("recognizes an error that is NOT instanceof but carries the same marker", () => {
    // Two copies of the `execute.js` module in the dependency tree produce exactly this: the
    // shape is right, the class is not the same one. `instanceof` would miss it.
    const foreign = Object.assign(new Error("from another copy of the module"), {
      repaySendFailure: true,
      stateAfterSend: sampleState,
    });
    expect(foreign instanceof RepaySendError).toBe(false);
    expect(asRepaySendFailure(foreign)?.stateAfterSend).toEqual(sampleState);
  });

  it("walks the cause chain — a backend wrapper does not lose the state", () => {
    const original = new RepaySendError("failed", sampleState);
    const wrapped = new Error("failed to run the cycle (telemetry)", { cause: original });
    expect(wrapped instanceof RepaySendError).toBe(false);
    expect(asRepaySendFailure(wrapped)?.stateAfterSend).toEqual(sampleState);
  });

  it.each([
    ["an ordinary error", new Error("RPC 502")],
    ["null", null],
    ["a string", "failed"],
    ["a marker with no state", Object.assign(new Error("x"), { repaySendFailure: true })],
    [
      "a marker with a bogus state",
      Object.assign(new Error("x"), { repaySendFailure: true, stateAfterSend: { spentTodayUsd8: "10" } }),
    ],
  ])("returns null for %s — the old state stands", (_l, err) => {
    expect(asRepaySendFailure(err)).toBeNull();
  });

  it("a circular cause chain does not make it loop forever", () => {
    const a: { cause?: unknown } = new Error("a");
    const b: { cause?: unknown } = new Error("b", { cause: a });
    a.cause = b;
    expect(asRepaySendFailure(a)).toBeNull();
  });
});
