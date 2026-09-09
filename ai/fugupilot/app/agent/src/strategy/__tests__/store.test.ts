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
import { initialExecuteState, type ExecuteState } from "../execute.js";

const NOW = 1_800_000_000;

function full(): ExecuteState {
  return {
    spentTodayUsd8: 12_345_678_901_234_567_890n,
    dayStartedAt: NOW,
    lastActionAt: NOW - 100,
    killed: true,
    pendingSend: {
      kind: "REBALANCE",
      venueId: "pancakeswap-v3",
      assetId: "BNB",
      amountUsd8: 98_765_432_109_876_543_210n,
      startedAt: NOW - 50,
      txHash: "0xdead0000000000000000000000000000000000000000000000000000000000ff",
      blockNumberBeforeSend: 130_000_000n,
    },
  };
}

describe("writing and reading the state back", () => {
  it("returns exactly what went in, including numbers no float could hold", () => {
    // JSON.parse turns numbers into floating point, which silently drops the last digits,
    // and the last digits of a money value are the cents.
    expect(parseExecuteState(serializeExecuteState(full()))).toEqual(full());
  });

  it("keeps a money value that is larger than a float can count exactly", () => {
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
    // Reading damaged content as "nothing stored yet" would put the budget back to zero and
    // the waiting time back to satisfied. That is releasing every limit, quietly, at the
    // moment something is already clearly wrong.
    expect(() => parseExecuteState("{ not json")).toThrow(StateStoreError);
  });

  it("refuses something that is not an object", () => {
    expect(() => parseExecuteState("[]")).toThrow(/not an object/);
    expect(() => parseExecuteState("null")).toThrow(/not an object/);
    expect(() => parseExecuteState("7")).toThrow(/not an object/);
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

  it("refuses a money value that is not made of digits", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.spentTodayUsd8 = "12.5";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/written as text/);
  });

  it("refuses a time that is not a whole number", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.lastActionAt = 1.5;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/whole number/);
  });

  it("refuses a stop switch that is not true or false", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.killed = "yes";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/true or false/);
  });

  it("refuses an in flight record with a broken transaction hash", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.pendingSend.txHash = "not a hash";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/start with 0x/);
  });

  it("refuses an in flight record missing a field", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    delete raw.pendingSend.amountUsd8;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(StateStoreError);
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
    dir = await mkdtemp(path.join(tmpdir(), "fugupilot-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("treats a file that is not there as a first run, not as damage", async () => {
    expect(await createFileStateStore(path.join(dir, "missing.json")).load()).toBeNull();
  });

  it("writes and reads back", async () => {
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    await store.save(full());
    expect(await store.load()).toEqual(full());
  });

  it("creates the directory it was pointed at", async () => {
    const store = createFileStateStore(path.join(dir, "deep", "nested", "state.json"));
    await store.save(full());
    expect(await store.load()).toEqual(full());
  });

  it("leaves no half written file behind, because it renames into place", async () => {
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    await store.save(full());
    // A rename is one step as far as anything reading is concerned, so a reader can only
    // ever see the old whole file or the new whole file, never half of one.
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
  });

  it("stops the agent on damaged content rather than quietly starting the limits again", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{ truncated", "utf8");
    await expect(createFileStateStore(file).load()).rejects.toBeInstanceOf(StateStoreError);
  });
});
