import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileStateStore,
  createMemoryStateStore,
  parseExecuteState,
  serializeExecuteState,
  StateStoreError,
} from "../state/store.js";
import { initialExecuteState, payInvoice, type ExecuteState, type PaymentLimits } from "../execute.js";
import type { Invoice } from "../types.js";
import type { SessionPermissions } from "../session.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

function full(): ExecuteState {
  return {
    spentTodayUsd8: 12_345_678_901_234_567_890n,
    dayStartedAt: NOW,
    lastPaymentAt: NOW - 100,
    killed: true,
    billedThroughSeconds: NOW - 50,
    pendingPayment: {
      amountUsd8: 98_765_432_109_876_543_210n,
      windowFromSeconds: NOW - 3_650,
      windowToSeconds: NOW - 50,
      startedAt: NOW - 50,
      txHash: "0xdead0000000000000000000000000000000000000000000000000000000000ff",
    },
  };
}

describe("writing and reading the state back", () => {
  it("returns exactly what went in, including numbers no float could hold", () => {
    expect(parseExecuteState(serializeExecuteState(full()))).toEqual(full());
  });

  it("keeps a money value larger than a float can count exactly", () => {
    const big = { ...initialExecuteState(NOW), spentTodayUsd8: 9_007_199_254_740_993n };
    expect(parseExecuteState(serializeExecuteState(big)).spentTodayUsd8).toBe(9_007_199_254_740_993n);
  });

  it("handles a state with nothing in flight", () => {
    const clean = initialExecuteState(NOW);
    expect(parseExecuteState(serializeExecuteState(clean))).toEqual(clean);
  });
});

describe("refusing content that cannot be trusted", () => {
  it("refuses text that is not valid JSON", () => {
    expect(() => parseExecuteState("{ not json")).toThrow(StateStoreError);
  });

  it("refuses something that is not an object", () => {
    expect(() => parseExecuteState("[]")).toThrow(/not an object/);
  });

  it("refuses a format it does not know", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.version = 99;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/not one this agent knows/);
  });

  it("refuses a money value written as a number rather than as text", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.spentTodayUsd8 = 12345;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/written as text/);
  });

  it("refuses a stored state with NO billing mark, rather than filling one in", () => {
    // MONEY SAFETY RULE M11. Quietly defaulting the mark to "now" would let the seconds
    // before it be counted and paid for a second time, and nothing else would notice,
    // because the second bill would be a perfectly valid bill.
    const raw = JSON.parse(serializeExecuteState(full()));
    delete raw.billedThroughSeconds;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/whole number/);
  });

  it("refuses an in flight record with a broken transaction hash", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.pendingPayment.txHash = "not a hash";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/start with 0x/);
  });
});

describe("the store that lives in memory", () => {
  it("gives nothing back before anything was saved", async () => {
    expect(await createMemoryStateStore().load()).toBeNull();
  });

  it("gives back what was saved", async () => {
    const store = createMemoryStateStore();
    await store.save(full());
    expect(await store.load()).toEqual(full());
  });

  it("keeps a copy, so changing your own object afterwards changes nothing stored", async () => {
    const store = createMemoryStateStore();
    const mutable = { ...initialExecuteState(NOW) };
    await store.save(mutable);
    (mutable as { spentTodayUsd8: bigint }).spentTodayUsd8 = 999n;
    expect((await store.load())!.spentTodayUsd8).toBe(0n);
  });
});

describe("the store backed by a file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugumeter-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("treats a file that is not there as a first run, not as damage", async () => {
    expect(await createFileStateStore(path.join(dir, "missing.json")).load()).toBeNull();
  });

  it("writes and reads back", async () => {
    const store = createFileStateStore(path.join(dir, "state.json"));
    await store.save(full());
    expect(await store.load()).toEqual(full());
  });

  it("creates the directory it was pointed at", async () => {
    const store = createFileStateStore(path.join(dir, "deep", "nested", "state.json"));
    await store.save(full());
    expect(await store.load()).toEqual(full());
  });

  it("renames into place, so a reader never sees half a file", async () => {
    const file = path.join(dir, "state.json");
    await createFileStateStore(file).save(full());
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
  });

  it("stops the agent on damaged content rather than quietly starting the limits again", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{ truncated", "utf8");
    await expect(createFileStateStore(file).load()).rejects.toBeInstanceOf(StateStoreError);
  });
});

describe("dying in the middle of paying, then coming back", () => {
  const LIMITS: PaymentLimits = {
    maxPerPaymentUsd8: 10n * USD,
    maxPerDayUsd8: 50n * USD,
    minIntervalSeconds: 0,
  };

  const SESSION: SessionPermissions = {
    calls: [{ to: "0x1111111111111111111111111111111111111111", signature: "transfer(address,uint256)" }],
    spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
    expiresAt: NOW + 30 * 86_400,
  };

  function bill(total: bigint, from: number, to: number): Invoice {
    return {
      window: { fromSeconds: from, toSeconds: to },
      lines: [{ unit: "CALL", quantity: 1n, amountUsd8: total, explanation: "one call" }],
      totalUsd8: total,
      empty: false,
    };
  }

  it("does not pay the same seconds again after a crash between saving and sending", async () => {
    // THE WHOLE POINT OF THE BILLING MARK, end to end through the file store. The process
    // saves, then dies before the payment leaves. What it left behind already says those
    // seconds are billed and a payment is in flight, so the next start refuses both to bill
    // them again and to pay anything at all until a person has looked.
    const dir2 = await mkdtemp(path.join(tmpdir(), "fugumeter-crash-"));
    try {
      const file = path.join(dir2, "state.json");
      const store = createFileStateStore(file);
      const start: ExecuteState = { ...initialExecuteState(NOW - 3_600), billedThroughSeconds: NOW - 3_600 };
      await store.save(start);

      // First run: saves the in flight record, then the process dies.
      const crashed = await payInvoice(bill(5n * USD, NOW - 3_600, NOW), LIMITS, start, {
        pay: async () => {
          throw new Error("the process died here");
        },
        now: () => NOW,
        sessionPermissions: SESSION,
        persistBeforeSend: (s) => store.save(s),
      }).catch(() => null);
      expect(crashed).toBeNull();

      // Second run: whatever is on disk is all it knows.
      const reloaded = (await store.load())!;
      expect(reloaded.billedThroughSeconds).toBe(NOW);
      expect(reloaded.pendingPayment).not.toBeNull();

      const again = await payInvoice(bill(5n * USD, NOW - 3_600, NOW), LIMITS, reloaded, {
        pay: async () => HASH,
        now: () => NOW,
        sessionPermissions: SESSION,
      });
      expect(again.paid).toBe(false);
      expect(again.reason).toContain("risks paying twice");
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});
