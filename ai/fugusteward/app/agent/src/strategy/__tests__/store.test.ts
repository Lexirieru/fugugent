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
import { markInFlight, markPaid } from "../ledger.js";

const USD = 100_000_000n;
const NOW = 1_800_000_000;
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001" as const;

function full(): ExecuteState {
  let ledger = markInFlight({}, {
    subscriptionId: "office-rent",
    periodIndex: 0,
    amountUsd8: 12_345_678_901_234_567_890n,
    agentId: "rent-agent",
    startedAt: NOW - 100,
  });
  ledger = markPaid(ledger, "office-rent", 0, HASH);
  ledger = markInFlight(ledger, {
    subscriptionId: "compute",
    periodIndex: 4,
    amountUsd8: 5n * USD,
    agentId: "compute-agent",
    startedAt: NOW - 5,
  });
  return {
    killed: true,
    agents: {
      "rent-agent": { spentTodayUsd8: 40n * USD, dayStartedAt: NOW, lastPaymentAt: NOW - 100 },
      "compute-agent": { spentTodayUsd8: 5n * USD, dayStartedAt: NOW, lastPaymentAt: NOW - 5 },
    },
    ledger,
  };
}

describe("writing and reading the state back", () => {
  it("returns exactly what went in, including numbers no float could hold", () => {
    expect(parseExecuteState(serializeExecuteState(full()))).toEqual(full());
  });

  it("handles an empty state", () => {
    expect(parseExecuteState(serializeExecuteState(initialExecuteState()))).toEqual(
      initialExecuteState(),
    );
  });

  it("writes the same bytes for the same state, whatever order things were added in", () => {
    // A difference between two saved files should be a real difference, not a reordering.
    const a = full();
    const b: ExecuteState = {
      ...a,
      agents: {
        "compute-agent": a.agents["compute-agent"]!,
        "rent-agent": a.agents["rent-agent"]!,
      },
    };
    expect(serializeExecuteState(a)).toBe(serializeExecuteState(b));
  });
});

describe("refusing content that cannot be trusted", () => {
  it("refuses text that is not valid JSON", () => {
    // Reading damage as "nothing stored yet" would empty the record of what has been paid,
    // which makes every period in the backlog due again at once. That is the worst possible
    // thing to do at the moment something is already clearly wrong.
    expect(() => parseExecuteState("{ not json")).toThrow(StateStoreError);
  });

  it("refuses a format it does not know", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.version = 99;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/not one this agent knows/);
  });

  it("refuses a money value written as a number rather than as text", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.agents["rent-agent"].spentTodayUsd8 = 12345;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/written as text/);
  });

  it("refuses a record whose state cannot be read", () => {
    // MONEY SAFETY RULE S6. A record whose state cannot be read is a record that cannot hold
    // back a second payment.
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.ledger["compute#4"].status = "MAYBE";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/IN_FLIGHT or PAID/);
  });

  it("refuses a record with a broken transaction hash", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.ledger["office-rent#0"].txHash = "not a hash";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/start with 0x/);
  });

  it("refuses a record missing which agent did it", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    delete raw.ledger["compute#4"].agentId;
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/has to be text/);
  });

  it("refuses a stop switch that is not true or false", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.killed = "yes";
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/true or false/);
  });

  it("refuses a record of what has been paid that is not an object", () => {
    const raw = JSON.parse(serializeExecuteState(full()));
    raw.ledger = [];
    expect(() => parseExecuteState(JSON.stringify(raw))).toThrow(/has to be an object/);
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
    const mutable: ExecuteState = { killed: false, agents: {}, ledger: {} };
    await store.save(mutable);
    (mutable as { killed: boolean }).killed = true;
    expect((await store.load())!.killed).toBe(false);
  });
});

describe("the store backed by a file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "fugusteward-state-"));
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

  it("stops the agent on damaged content rather than emptying the record of what was paid", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{ truncated", "utf8");
    await expect(createFileStateStore(file).load()).rejects.toBeInstanceOf(StateStoreError);
  });
});
