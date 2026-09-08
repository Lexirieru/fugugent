import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StateStoreError,
  createFileStateStore,
  createMemoryStateStore,
  initialExecuteState,
  parseExecuteState,
  serializeExecuteState,
} from "../state/store.js";
import type { ExecuteState } from "../execute.js";

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 123_456_789n,
    dayStartedAt: 1_700_000_000,
    lastActionAt: 1_700_000_500,
    killed: false,
    pendingRepay: null,
    ...overrides,
  };
}

describe("ExecuteState serialization", () => {
  it("a round trip keeps bigints as-is, not through Number()", () => {
    // A value above Number.MAX_SAFE_INTEGER: if serialization went through a plain
    // JSON.parse (float), the last digit would be silently lost — exactly the digit that
    // decides how many dollars have been spent.
    const besar = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    const original = state({ spentTodayUsd8: besar });
    const balik = parseExecuteState(serializeExecuteState(original));
    expect(balik.spentTodayUsd8).toBe(besar);
    expect(balik).toEqual(original);
  });

  it("a round trip keeps the whole pendingRepay", () => {
    const original = state({
      pendingRepay: {
        asset: "0x932E82632E80b06318ca969e33F99A54F1a04b10",
        amountUsd8: 685_000_000n,
        startedAt: 1_700_000_400,
        txHash: null,
        debtBaseBeforeSend: 2_938_888_888n,
        blockNumberBeforeSend: 129_841_266n,
      },
    });
    expect(parseExecuteState(serializeExecuteState(original))).toEqual(original);
  });

  it.each([
    ["not JSON", "{not json"],
    ["not an object", '"hello"'],
    ["spentTodayUsd8 missing", '{"version":1,"dayStartedAt":1,"lastActionAt":0,"killed":false}'],
    [
      "spentTodayUsd8 is not a decimal number",
      '{"version":1,"spentTodayUsd8":"1.5","dayStartedAt":1,"lastActionAt":0,"killed":false}',
    ],
    [
      "killed is not a boolean",
      '{"version":1,"spentTodayUsd8":"0","dayStartedAt":1,"lastActionAt":0,"killed":"no"}',
    ],
    [
      "dayStartedAt is not an integer",
      '{"version":1,"spentTodayUsd8":"0","dayStartedAt":1.5,"lastActionAt":0,"killed":false}',
    ],
    [
      "unknown version",
      '{"version":99,"spentTodayUsd8":"0","dayStartedAt":1,"lastActionAt":0,"killed":false}',
    ],
  ])("refuses corrupt contents (%s) instead of silently resetting the limits", (_label, raw) => {
    // A corrupt file read as "empty state" would put spentTodayUsd8 back to zero and
    // lastActionAt back to 0 -- that is, RELEASING the entire daily cap and the cooldown
    // with no warning at all. Fail hard.
    expect(() => parseExecuteState(raw)).toThrow(StateStoreError);
  });
});

describe("createMemoryStateStore", () => {
  it("returns null when nothing has ever been saved", async () => {
    const store = createMemoryStateStore();
    expect(await store.load()).toBeNull();
  });

  it("stores a copy, not a reference that can be mutated from outside", async () => {
    const store = createMemoryStateStore();
    const s = state();
    await store.save(s);
    s.spentTodayUsd8 = 0n;
    const dimuat = await store.load();
    expect(dimuat?.spentTodayUsd8).toBe(123_456_789n);
  });
});

describe("createFileStateStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugu-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("the file does not exist yet -> null, not a throw", async () => {
    const store = createFileStateStore(path.join(dir, "not/yet/there/state.json"));
    expect(await store.load()).toBeNull();
  });

  it("save then load returns exactly the same state", async () => {
    const file = path.join(dir, "nested/state.json");
    const store = createFileStateStore(file);
    const s = state({ killed: true, spentTodayUsd8: 685_000_000n });
    await store.save(s);
    expect(await store.load()).toEqual(s);
  });

  it("a corrupt file throws StateStoreError instead of returning an empty state", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{this is not json", "utf8");
    const store = createFileStateStore(file);
    await expect(store.load()).rejects.toThrow(StateStoreError);
  });

  it("atomic write: leaves no temporary file behind", async () => {
    const file = path.join(dir, "state.json");
    const store = createFileStateStore(file);
    await store.save(state());
    await store.save(state({ spentTodayUsd8: 1n }));
    const contents = await readFile(file, "utf8");
    expect(JSON.parse(contents).spentTodayUsd8).toBe("1");
  });
});

describe("initialExecuteState", () => {
  it("the budget day starts now, no action yet, not killed, no pending repay", () => {
    const s = initialExecuteState(1_700_000_000);
    expect(s).toEqual({
      spentTodayUsd8: 0n,
      dayStartedAt: 1_700_000_000,
      lastActionAt: 0,
      killed: false,
      pendingRepay: null,
    });
  });
});
