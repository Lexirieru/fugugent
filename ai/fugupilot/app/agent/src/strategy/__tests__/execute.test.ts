import { describe, expect, it, vi } from "vitest";
import {
  asSendFailure,
  clearPendingSend,
  executePlan,
  initialExecuteState,
  NeverSentError,
  reconcilePendingSend,
  SendFailedError,
  wasNeverSent,
  type ExecuteDeps,
  type ExecuteLimits,
  type ExecuteState,
} from "../execute.js";
import type { PilotPlan, PlannedAction } from "../types.js";
import type { SessionPermissions } from "../session.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

const SESSION: SessionPermissions = {
  calls: [{ to: "0x1111111111111111111111111111111111111111", signature: "swap(uint256)" }],
  spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
  expiresAt: NOW + 30 * 86_400,
};

const STEP: PlannedAction = {
  kind: "REBALANCE",
  venueId: "pancakeswap-v3",
  assetId: "BNB",
  amountUsd8: 50n * USD,
  direction: "OUT",
  reason: "the mix drifted",
};

function onePlan(overrides: Partial<PlannedAction> = {}): PilotPlan {
  const action = { ...STEP, ...overrides };
  return { actions: [action], totalUsd8: action.amountUsd8, reason: "one step" };
}

const EMPTY_PLAN: PilotPlan = { actions: [], totalUsd8: 0n, reason: "nothing to do" };

const LIMITS: ExecuteLimits = {
  maxPerActionUsd8: 100n * USD,
  maxPerDayUsd8: 200n * USD,
  minIntervalSeconds: 60,
};

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  // The day deliberately started an hour ago, not a day ago: a helper whose default state
  // already rolls the budget over would make every limit test pass for the wrong reason.
  return { ...initialExecuteState(NOW - 3_600), lastActionAt: NOW - 3_600, ...overrides };
}

function deps(overrides: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    send: async () => HASH,
    now: () => NOW,
    sessionPermissions: SESSION,
    ...overrides,
  };
}

describe("the ordinary case", () => {
  it("sends one step and hands back a state that moved", async () => {
    const result = await executePlan(onePlan(), LIMITS, state(), deps());
    expect(result.sent).toBe(true);
    expect(result.amountSentUsd8).toBe(50n * USD);
    expect(result.txHash).toBe(HASH);
    expect(result.state.spentTodayUsd8).toBe(50n * USD);
    expect(result.state.lastActionAt).toBe(NOW);
    expect(result.state.pendingSend).toBeNull();
  });

  it("never changes the state it was given", async () => {
    const before = state();
    const snapshot = JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    await executePlan(onePlan(), LIMITS, before, deps());
    expect(JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });

  it("acts on one step per cycle even when the plan has several", async () => {
    // One at a time is what makes the per step limit mean anything and what lets the waiting
    // time actually pace the agent.
    const send = vi.fn(async () => HASH);
    const plan: PilotPlan = {
      actions: [STEP, { ...STEP, assetId: "USDT" }, { ...STEP, assetId: "CAKE" }],
      totalUsd8: 150n * USD,
      reason: "three steps",
    };
    const result = await executePlan(plan, LIMITS, state(), deps({ send }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.action?.assetId).toBe("BNB");
  });
});

describe("rule 1: the stop switch", () => {
  it("sends nothing at all while it is on", async () => {
    // MONEY SAFETY RULE P2. Deleting the `state.killed` branch removes the owner's only way
    // out of a running agent.
    const send = vi.fn(async () => HASH);
    const result = await executePlan(onePlan(), LIMITS, state({ killed: true }), deps({ send }));
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(result.reason).toContain("stop switch is on");
  });

  it("beats every other rule, including a plan that would otherwise be perfectly fine", async () => {
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state({ killed: true, spentTodayUsd8: 0n, lastActionAt: 0 }),
      deps(),
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("stop switch");
  });
});

describe("rule 2: a send that has not been proven finished", () => {
  const pending = state({
    pendingSend: {
      kind: "REBALANCE",
      venueId: "pancakeswap-v3",
      assetId: "BNB",
      amountUsd8: 50n * USD,
      startedAt: NOW - 100,
      txHash: null,
      blockNumberBeforeSend: 900n,
    },
  });

  it("blocks every new send", async () => {
    // MONEY SAFETY RULE P3. This is the rule that stops the agent paying twice when waiting
    // for a result times out after the transaction already landed. Deleting the
    // `state.pendingSend != null` branch is exactly the bug Guardian paid for.
    const send = vi.fn(async () => HASH);
    const result = await executePlan(onePlan(), LIMITS, pending, deps({ send }));
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(result.reason).toContain("risks paying twice");
  });

  it("keeps blocking after a restart, because the record is part of the state", async () => {
    const reloaded: ExecuteState = JSON.parse(
      JSON.stringify(pending, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)),
      (_k, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v),
    );
    const result = await executePlan(onePlan(), LIMITS, reloaded, deps());
    expect(result.sent).toBe(false);
  });

  it("lets a person clear it once they have looked at the blockchain themselves", async () => {
    const result = await executePlan(onePlan(), LIMITS, clearPendingSend(pending), deps());
    expect(result.sent).toBe(true);
  });
});

describe("clearing the in flight record from the chain", () => {
  const pending = state({
    pendingSend: {
      kind: "REBALANCE",
      venueId: "pancakeswap-v3",
      assetId: "BNB",
      amountUsd8: 50n * USD,
      startedAt: NOW - 100,
      txHash: null,
      blockNumberBeforeSend: 900n,
    },
  });

  it("clears it when a newer block shows the step done", () => {
    expect(reconcilePendingSend(pending, 901n, true).pendingSend).toBeNull();
  });

  it("leaves it alone at the same block, even if the step looks done", () => {
    // Reading the same block back proves nothing about a transaction sent after it.
    expect(reconcilePendingSend(pending, 900n, true).pendingSend).not.toBeNull();
  });

  it("leaves it alone at a newer block when the step is not done", () => {
    // Something still waiting in the queue can land at any moment, so "not seen yet" never
    // means "will not happen". Clearing out of impatience is the double payment bug.
    expect(reconcilePendingSend(pending, 5_000n, false).pendingSend).not.toBeNull();
  });

  it("does nothing when there was nothing in flight", () => {
    expect(reconcilePendingSend(state(), 5_000n, true)).toEqual(state());
  });

  it("survives a stored state written before this field existed", () => {
    const old = { ...state(), pendingSend: undefined } as unknown as ExecuteState;
    expect(() => reconcilePendingSend(old, 5_000n, true)).not.toThrow();
  });
});

describe("rule 3: nothing to do", () => {
  it("sends nothing for an empty plan and says why", async () => {
    const send = vi.fn(async () => HASH);
    const result = await executePlan(EMPTY_PLAN, LIMITS, state(), deps({ send }));
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(result.reason).toContain("nothing to do");
  });

  it("sends nothing for a step worth nothing", async () => {
    const result = await executePlan(onePlan({ amountUsd8: 0n }), LIMITS, state(), deps());
    expect(result.sent).toBe(false);
  });
});

describe("rules 4 and 5: the limits", () => {
  it("cuts a step down to the per step limit rather than refusing it", async () => {
    // MONEY SAFETY RULE P4. Cutting down keeps the agent useful; refusing outright would
    // make one oversized step stop it forever.
    const result = await executePlan(onePlan({ amountUsd8: 500n * USD }), LIMITS, state(), deps());
    expect(result.sent).toBe(true);
    expect(result.amountSentUsd8).toBe(100n * USD);
    expect(result.cappedPerAction).toBe(true);
  });

  it("cuts a step down to what is left of today", async () => {
    const result = await executePlan(
      onePlan({ amountUsd8: 100n * USD }),
      LIMITS,
      state({ spentTodayUsd8: 170n * USD }),
      deps(),
    );
    expect(result.amountSentUsd8).toBe(30n * USD);
    expect(result.cappedPerDay).toBe(true);
  });

  it("sends nothing once today's limit is used up exactly", async () => {
    // MONEY SAFETY RULE P4. Exactly at the limit, not one unit over: the boundary is where
    // an off by one lets a whole extra step through.
    const send = vi.fn(async () => HASH);
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state({ spentTodayUsd8: 200n * USD }),
      deps({ send }),
    );
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(result.reason).toContain("used up");
  });

  it("still sends the last unit when exactly one unit is left", async () => {
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state({ spentTodayUsd8: 200n * USD - 1n }),
      deps(),
    );
    expect(result.sent).toBe(true);
    expect(result.amountSentUsd8).toBe(1n);
    expect(result.state.spentTodayUsd8).toBe(200n * USD);
  });

  it("starts the budget again once a whole day has passed", async () => {
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state({ spentTodayUsd8: 200n * USD, dayStartedAt: NOW - 86_400 }),
      deps(),
    );
    expect(result.sent).toBe(true);
    expect(result.state.spentTodayUsd8).toBe(50n * USD);
    expect(result.state.dayStartedAt).toBe(NOW);
  });

  it("does not start the budget again one second early", async () => {
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state({ spentTodayUsd8: 200n * USD, dayStartedAt: NOW - 86_399 }),
      deps(),
    );
    expect(result.sent).toBe(false);
  });
});

describe("rule 6: the waiting time between sends", () => {
  it("sends nothing before enough time has passed", async () => {
    // MONEY SAFETY RULE P4. Without this an agent watching a fast moving price would send on
    // every single interval.
    const send = vi.fn(async () => HASH);
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state({ lastActionAt: NOW - 59 }),
      deps({ send }),
    );
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(result.reason).toContain("59 seconds have passed");
  });

  it("sends at exactly the waiting time", async () => {
    const result = await executePlan(onePlan(), LIMITS, state({ lastActionAt: NOW - 60 }), deps());
    expect(result.sent).toBe(true);
  });
});

describe("rule 7: the key has to still work at the moment of sending", () => {
  it("sends nothing when the key ran out while the agent was thinking", async () => {
    // MONEY SAFETY RULE P5. The key is checked again here, not only when the agent starts.
    // Deleting this check means a send goes out with a key the account contract will
    // refuse, and the budget has already been charged by then.
    const send = vi.fn(async () => HASH);
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({ send, sessionPermissions: { ...SESSION, expiresAt: NOW - 1 } }),
    );
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(result.reason).toContain("stopped working");
  });

  it("sends nothing when the key runs out inside the safety margin", async () => {
    const result = await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW + 30 } }),
    );
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("margin");
  });

  it("leaves the state untouched when it refuses on the key, because nothing was sent", async () => {
    const before = state();
    const result = await executePlan(
      onePlan(),
      LIMITS,
      before,
      deps({ sessionPermissions: { ...SESSION, expiresAt: NOW - 1 } }),
    );
    expect(result.state).toBe(before);
  });
});

describe("rule 8: the budget is charged before the send goes out", () => {
  it("saves the in flight record before calling send", async () => {
    // MONEY SAFETY RULE P3. Without saving first, a process that dies while waiting for a
    // result leaves behind the state from BEFORE the cycle, and the next start does the
    // whole thing again.
    const order: string[] = [];
    let saved: ExecuteState | null = null;
    await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({
        persistBeforeSend: (s) => {
          order.push("save");
          saved = s;
        },
        send: async () => {
          order.push("send");
          return HASH;
        },
      }),
    );
    expect(order).toEqual(["save", "send"]);
    expect(saved!.pendingSend).not.toBeNull();
    expect(saved!.spentTodayUsd8).toBe(50n * USD);
  });

  it("refuses to send at all when the record cannot be saved", async () => {
    // Fails closed. Not paying is one missed cycle. Paying with no record that could hold
    // back a second payment is somebody's money gone.
    const send = vi.fn(async () => HASH);
    await expect(
      executePlan(
        onePlan(),
        LIMITS,
        state(),
        deps({
          send,
          persistBeforeSend: () => {
            throw new Error("the disk is full");
          },
        }),
      ),
    ).rejects.toBeInstanceOf(NeverSentError);
    expect(send).not.toHaveBeenCalled();
  });

  it("marks that refusal as never sent, so the caller does not charge the budget for it", async () => {
    const err = await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({
        persistBeforeSend: () => {
          throw new Error("the disk is full");
        },
      }),
    ).catch((e) => e);
    expect(wasNeverSent(err)).toBe(true);
    expect(asSendFailure(err)).toBeNull();
  });
});

describe("a send that failed after touching the network", () => {
  it("throws an error carrying the state that already counted the money", async () => {
    // MONEY SAFETY RULE P3, the heart of it. Failed does not mean it did not happen.
    const err = await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({
        send: async () => {
          throw new Error("waiting for the result timed out");
        },
      }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SendFailedError);
    const carried = asSendFailure(err);
    expect(carried).not.toBeNull();
    expect(carried!.stateAfterSend.spentTodayUsd8).toBe(50n * USD);
    expect(carried!.stateAfterSend.lastActionAt).toBe(NOW);
    expect(carried!.stateAfterSend.pendingSend).not.toBeNull();
  });

  it("passes an error marked as never sent straight through, unchanged", async () => {
    const original = new NeverSentError("the amount converted to nothing");
    const err = await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({
        send: async () => {
          throw original;
        },
      }),
    ).catch((e) => e);
    expect(err).toBe(original);
    expect(asSendFailure(err)).toBeNull();
  });

  it("is still found when something upstream wraps it to add context", async () => {
    // A wrapper is the most natural thing for the layer above to write, and losing the
    // carried state inside one means paying twice. This is why the marker is a property and
    // not a class.
    const inner = await executePlan(
      onePlan(),
      LIMITS,
      state(),
      deps({
        send: async () => {
          throw new Error("the connection dropped");
        },
      }),
    ).catch((e) => e);
    const wrapped = new Error("while running the cycle", { cause: inner });
    const carried = asSendFailure(wrapped);
    expect(carried).not.toBeNull();
    expect(carried!.stateAfterSend.spentTodayUsd8).toBe(50n * USD);
  });

  it("gives up on a chain of causes that loops rather than spinning forever", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(asSendFailure(a)).toBeNull();
  });

  it("refuses to believe a marker without a real state attached to it", () => {
    // Otherwise anything at all could claim to carry a state and the caller would use it.
    expect(asSendFailure({ sendFailure: true, stateAfterSend: { nonsense: 1 } })).toBeNull();
    expect(asSendFailure({ sendFailure: true })).toBeNull();
  });
});
