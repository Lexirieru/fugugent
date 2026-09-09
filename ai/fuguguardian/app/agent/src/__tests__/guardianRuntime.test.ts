/**
 * Tests for the Guardian RUNTIME — the wiring between the agent process and
 * `src/strategy/`.
 *
 * Two rules shape every test here:
 *
 * 1. **No network.** The viem client, the Altana session, and the state store are all
 *    injected fakes. Everything BELOW the injection point is the real thing —
 *    `createGuardian`, `decide`, `executeDecision`, `createSessionSendRepay`, `guard.ts`.
 *    That is the only way "the kill switch stopped a send" can mean anything: what refuses
 *    is `executeDecision`'s first rule, not a mock.
 *
 * 2. **Every "it does not send" test is paired with a control that DOES send.** A test
 *    asserting `sendCalls` was not called passes just as happily when the position is
 *    healthy, the cooldown is active, or the wiring is broken. The control run pins down
 *    that the only thing that changed is the kill switch.
 */
import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GuardianConfigError, createGuardian } from "../strategy/createGuardian.js";
import { SessionPermissionError, type SessionCall } from "../strategy/chain/session.js";
import { createMemoryStateStore, type ExecuteStateStore } from "../strategy/state/store.js";
import type { CycleResult, Logger } from "../strategy/guard.js";
import {
  GuardianBusyError,
  GuardianRuntimeConfigError,
  guardianRuntimeEnabled,
  readGuardianRuntimeConfig,
  startGuardianRuntime,
  type GuardianRuntime,
  type GuardianRuntimeConfig,
  type GuardianRuntimeDeps,
  type GuardianSessionHandle,
} from "../guardianRuntime.js";
import { guardianToolHandlers, registerGuardianMcpTools } from "../guardianTools.js";
import { buildMcpServer } from "../mcpMain.js";

const ACCOUNT = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const MUSD = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const FEED = "0x0aA42416bAccdb2fd4768B61111DeB7F7D212F9B" as const;
const TX = `0x${"ab".repeat(32)}` as const;

/** $7,500 collateral, $6,000 debt, LT 75% -> HF 0.9375, which `decide` calls EMERGENCY. */
const COLLATERAL = 750_000_000_000n;
const DEBT = 600_000_000_000n;
const LT_BPS = 7_500n;
const HF = (COLLATERAL * LT_BPS * 10n ** 18n) / (10_000n * DEBT);

interface FakeChainOptions {
  chainId?: number;
  enabled?: boolean;
  /** Makes `getUserAccountData` reject on its first N calls, so a cycle fails. */
  failPositionReads?: number;
  /** Gates `getUserAccountData` on an external promise, so a cycle can be held in flight. */
  gate?: () => Promise<void>;
}

function fakeChain(options: FakeChainOptions = {}) {
  let positionReads = 0;
  const readContract = vi.fn(async (args: { address: string; functionName: string }) => {
    switch (args.functionName) {
      case "assets":
        return [FEED, 6_000, Number(LT_BPS), 18, options.enabled ?? true];
      case "decimals":
        return args.address.toLowerCase() === FEED.toLowerCase() ? 8 : 18;
      case "latestRoundData":
        return [1n, 100_000_000n, 0n, 0n, 1n];
      case "balanceOf":
        return 10n ** 30n;
      case "allowance":
        return 0n;
      case "getUserAccountData": {
        positionReads += 1;
        if (options.gate) await options.gate();
        if (positionReads <= (options.failPositionReads ?? 0)) {
          throw new Error(`fake RPC failure on position read #${positionReads}`);
        }
        return [COLLATERAL, DEBT, 0n, LT_BPS, 6_000n, HF];
      }
      default:
        throw new Error(`unexpected function: ${args.functionName}`);
    }
  });
  const client = {
    chain: { id: options.chainId ?? 97 },
    readContract,
    getBlockNumber: vi.fn(async () => 1_000n),
    getChainId: vi.fn(async () => options.chainId ?? 97),
  } as unknown as PublicClient;
  return { client, readContract };
}

function silentLogger(): Logger {
  return { info: vi.fn(), error: vi.fn() };
}

const BOUNDED_PERMISSIONS = {
  calls: [
    { to: POOL, signature: "repay(address,uint256)" },
    { to: MUSD, signature: "approve(address,uint256)" },
  ],
  spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
} as const;

function testConfig(overrides: Partial<GuardianRuntimeConfig> = {}): GuardianRuntimeConfig {
  return {
    rpcUrl: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    // Long on purpose: the loop's FIRST tick fires immediately, and nothing else fires
    // unless a test advances the clock deliberately.
    intervalMs: 3_600_000,
    pool: POOL,
    repayAsset: MUSD,
    sessionFile: "/does/not/exist/session.json",
    stateFile: "/does/not/exist/state.json",
    limits: {
      maxPerActionUsd8: 100_000_000_000n, // $1,000
      maxPerDayUsd8: 200_000_000_000n, // $2,000
      minIntervalSeconds: 0, // no cooldown, so a refusal can only come from the kill switch
    },
    ...overrides,
  };
}

interface Harness {
  deps: GuardianRuntimeDeps;
  sendCalls: ReturnType<typeof vi.fn>;
  store: ExecuteStateStore;
  cycles: CycleResult[];
  logger: Logger;
}

function harness(
  chain = fakeChain(),
  permissions: unknown = BOUNDED_PERMISSIONS,
  assembleGuardian: GuardianRuntimeDeps["assembleGuardian"] = createGuardian,
): Harness {
  const sendCalls = vi.fn(
    async (_calls: readonly SessionCall[], _description: string) => ({ transactionHash: TX, status: 1 }),
  );
  const store = createMemoryStateStore();
  const cycles: CycleResult[] = [];
  const logger = silentLogger();
  const session: GuardianSessionHandle = {
    walletAddress: ACCOUNT,
    permissions: permissions as GuardianSessionHandle["permissions"],
    publicKey: "0xdeadbeef",
    expiry: 1_791_466_426,
    sendCalls,
  };
  const deps: GuardianRuntimeDeps = {
    logger,
    createClient: () => chain.client,
    loadSession: async () => session,
    createStateStore: () => store,
    assembleGuardian: async (config) =>
      assembleGuardian({
        ...config,
        // Records every cycle the loop completes without displacing the runtime's own hook.
        onCycle: (result) => {
          config.onCycle?.(result);
          cycles.push(result);
        },
      }),
    clock: () => 1_700_000_000,
  };
  return { deps, sendCalls, store, cycles, logger };
}

/**
 * Drains the microtask queue until `count` cycles have completed. Written as microtask
 * flushing rather than `vi.waitFor` so it works identically under fake timers — a cycle
 * needs no timer to finish, only its promises.
 */
async function waitForCycles(h: Harness, count: number, spins = 200): Promise<void> {
  for (let i = 0; i < spins && h.cycles.length < count; i++) await Promise.resolve();
  if (h.cycles.length < count) {
    throw new Error(`only ${h.cycles.length} cycles completed, expected ${count}`);
  }
}

// ---------------------------------------------------------------------------
// Configuration — every fault below is refused BEFORE anything starts
// ---------------------------------------------------------------------------

describe("guardianRuntimeEnabled", () => {
  it("is off unless explicitly switched on", () => {
    expect(guardianRuntimeEnabled({})).toBe(false);
    expect(guardianRuntimeEnabled({ FUGU_GUARDIAN_ENABLED: "" })).toBe(false);
    expect(guardianRuntimeEnabled({ FUGU_GUARDIAN_ENABLED: "0" })).toBe(false);
    expect(guardianRuntimeEnabled({ FUGU_GUARDIAN_ENABLED: "false" })).toBe(false);
  });

  it("accepts the usual spellings of yes", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(guardianRuntimeEnabled({ FUGU_GUARDIAN_ENABLED: value })).toBe(true);
    }
  });
});

describe("readGuardianRuntimeConfig — a malformed configuration fails at start", () => {
  it("falls back to safe defaults on an empty environment", () => {
    const config = readGuardianRuntimeConfig({});
    expect(config.intervalMs).toBe(60_000);
    expect(config.pool).toBe(POOL);
    expect(config.repayAsset).toBe(MUSD);
    // The default caps must be TIGHTER than the session's own 100 mUSD/day cryptographic cap.
    expect(config.limits.maxPerActionUsd8).toBe(1_000_000_000n);
    expect(config.limits.maxPerDayUsd8).toBe(5_000_000_000n);
    expect(config.limits.minIntervalSeconds).toBe(300);
    expect(config.rpcUrl).toContain("bnbchain.org");
  });

  it("reads every override", () => {
    const config = readGuardianRuntimeConfig({
      FUGU_GUARDIAN_INTERVAL_MS: "15000",
      FUGU_GUARDIAN_POOL: "0x1111111111111111111111111111111111111111",
      FUGU_GUARDIAN_REPAY_ASSET: "0x2222222222222222222222222222222222222222",
      FUGU_GUARDIAN_MAX_PER_ACTION_USD8: "300000000",
      FUGU_GUARDIAN_MAX_PER_DAY_USD8: "900000000",
      FUGU_GUARDIAN_MIN_INTERVAL_SECONDS: "0",
      FUGU_GUARDIAN_SESSION_FILE: "/tmp/session.json",
      FUGU_GUARDIAN_STATE_FILE: "/tmp/state.json",
      FUGU_GUARDIAN_RPC_URL: "https://example.invalid:8545",
    });
    expect(config).toMatchObject({
      intervalMs: 15_000,
      pool: "0x1111111111111111111111111111111111111111",
      repayAsset: "0x2222222222222222222222222222222222222222",
      sessionFile: "/tmp/session.json",
      stateFile: "/tmp/state.json",
      rpcUrl: "https://example.invalid:8545",
    });
    expect(config.limits.maxPerActionUsd8).toBe(300_000_000n);
    expect(config.limits.maxPerDayUsd8).toBe(900_000_000n);
    expect(config.limits.minIntervalSeconds).toBe(0);
  });

  it.each([
    ["FUGU_GUARDIAN_INTERVAL_MS", "0"],
    ["FUGU_GUARDIAN_INTERVAL_MS", "-1000"],
    ["FUGU_GUARDIAN_INTERVAL_MS", "1.5"],
    ["FUGU_GUARDIAN_INTERVAL_MS", "soon"],
    ["FUGU_GUARDIAN_POOL", "0xnothex"],
    ["FUGU_GUARDIAN_REPAY_ASSET", "0x2222"],
    ["FUGU_GUARDIAN_MAX_PER_ACTION_USD8", "10.50"],
    ["FUGU_GUARDIAN_MAX_PER_ACTION_USD8", "0"],
    ["FUGU_GUARDIAN_MAX_PER_DAY_USD8", "$50"],
    ["FUGU_GUARDIAN_MIN_INTERVAL_SECONDS", "-1"],
    ["FUGU_GUARDIAN_RPC_URL", "not a url"],
    ["FUGU_GUARDIAN_RPC_URL", "wss://data-seed-prebsc-1-s1.bnbchain.org:8545"],
  ])("refuses %s=%s", (name, value) => {
    expect(() => readGuardianRuntimeConfig({ [name]: value })).toThrow(GuardianRuntimeConfigError);
  });

  it("refuses the binance.org RPC domain, which is blocked from Indonesia (CLAUDE.md #3)", () => {
    expect(() =>
      readGuardianRuntimeConfig({ FUGU_GUARDIAN_RPC_URL: "https://bsc-testnet-dataseed.binance.org" }),
    ).toThrow(/binance\.org/);
  });

  it("refuses a per-action cap larger than the per-day cap, because it could never bind", () => {
    expect(() =>
      readGuardianRuntimeConfig({
        FUGU_GUARDIAN_MAX_PER_ACTION_USD8: "900000000",
        FUGU_GUARDIAN_MAX_PER_DAY_USD8: "300000000",
      }),
    ).toThrow(/never bind/);
  });
});

describe("startGuardianRuntime — assembly faults stop the boot, they never become a log line", () => {
  it("refuses a chain that is not BSC testnet, before the session file is even read", async () => {
    const h = harness(fakeChain({ chainId: 56 }));
    const loadSession = vi.fn(h.deps.loadSession);
    await expect(startGuardianRuntime(testConfig(), { ...h.deps, loadSession })).rejects.toThrow(
      GuardianRuntimeConfigError,
    );
    expect(loadSession).not.toHaveBeenCalled();
  });

  it("refuses a session whose allowlist is empty (= unlimited in Altana) before assembling anything", async () => {
    const h = harness(fakeChain(), { calls: [], spend: [{ limit: 1n, period: "day" }] });
    const assembleGuardian = vi.fn(createGuardian);
    await expect(startGuardianRuntime(testConfig(), { ...h.deps, assembleGuardian })).rejects.toThrow(
      SessionPermissionError,
    );
    expect(assembleGuardian).not.toHaveBeenCalled();
  });

  it("refuses a session that is broader than repay + approve", async () => {
    const h = harness(fakeChain(), {
      calls: [
        { to: POOL, signature: "repay(address,uint256)" },
        { to: MUSD, signature: "approve(address,uint256)" },
        { to: MUSD, signature: "transfer(address,uint256)" },
      ],
      spend: [{ limit: 20_000_000_000_000_000n, period: "day" }],
    });
    await expect(startGuardianRuntime(testConfig(), h.deps)).rejects.toThrow(SessionPermissionError);
  });

  it("refuses a session with no native spend cap (the relay fee would fail every send)", async () => {
    const h = harness(fakeChain(), { calls: BOUNDED_PERMISSIONS.calls, spend: [] });
    await expect(startGuardianRuntime(testConfig(), h.deps)).rejects.toThrow(SessionPermissionError);
  });

  it("lets createGuardian's own construction failure through, and never starts a loop", async () => {
    // The pool says the repay asset is disabled. `createGuardian` reads that at
    // construction; the runtime must NOT catch it and carry on looking healthy.
    const h = harness(fakeChain({ enabled: false }));
    let started = false;
    const assembleGuardian: GuardianRuntimeDeps["assembleGuardian"] = async (config) => {
      const guardian = await createGuardian(config);
      return { ...guardian, start: (ms) => { started = true; return guardian.start(ms); } };
    };
    await expect(startGuardianRuntime(testConfig(), { ...h.deps, assembleGuardian })).rejects.toThrow(
      GuardianConfigError,
    );
    expect(started).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The loop actually runs
// ---------------------------------------------------------------------------

describe("startGuardianRuntime — the monitoring loop", () => {
  it("runs its first cycle immediately, without waiting out the interval", async () => {
    const h = harness();
    const runtime = await startGuardianRuntime(testConfig(), h.deps);
    try {
      await vi.waitFor(() => expect(h.cycles.length).toBeGreaterThanOrEqual(1));
      expect(h.cycles[0]?.ok).toBe(true);
      expect(runtime.getLastResult()?.ok).toBe(true);
    } finally {
      runtime.stop();
    }
  });

  it("keeps running after a cycle FAILS, and the next cycle succeeds", async () => {
    vi.useFakeTimers();
    try {
      // The first position read rejects; everything after it is fine.
      const h = harness(fakeChain({ failPositionReads: 1 }));
      const runtime = await startGuardianRuntime(testConfig({ intervalMs: 1_000 }), h.deps);
      try {
        await waitForCycles(h, 1);
        expect(h.cycles).toHaveLength(1);
        expect(h.cycles[0]?.ok).toBe(false);

        // The proof that the loop did not die with it: the NEXT interval still fires.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(h.cycles.length).toBeGreaterThanOrEqual(2);
        expect(h.cycles[1]?.ok).toBe(true);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(h.cycles.length).toBeGreaterThanOrEqual(3);
      } finally {
        runtime.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops scheduling new cycles after stop()", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const runtime = await startGuardianRuntime(testConfig({ intervalMs: 1_000 }), h.deps);
      await waitForCycles(h, 1);
      const seen = h.cycles.length;
      runtime.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.cycles.length).toBe(seen);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses an out-of-band cycle while one is already in flight, rather than queueing it", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = true;
    const h = harness(
      fakeChain({
        gate: async () => {
          if (gated) await gate;
        },
      }),
    );
    const runtime = await startGuardianRuntime(testConfig(), h.deps);
    try {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      // The loop's first cycle is parked inside the position read.
      expect(runtime.isCycleActive()).toBe(true);
      await expect(runtime.runCycleNow()).rejects.toThrow(GuardianBusyError);
      gated = false;
      release();
      await vi.waitFor(() => expect(h.cycles.length).toBeGreaterThanOrEqual(1));
    } finally {
      runtime.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// The kill switch, pulled from OUTSIDE the loop
// ---------------------------------------------------------------------------

/** Starts a runtime whose position is in EMERGENCY, and waits for the loop's first cycle. */
async function startEmergencyRuntime(): Promise<{ runtime: GuardianRuntime; h: Harness }> {
  const h = harness();
  const runtime = await startGuardianRuntime(testConfig(), h.deps);
  await vi.waitFor(() => expect(h.cycles.length).toBeGreaterThanOrEqual(1));
  return { runtime, h };
}

describe("the kill switch", () => {
  it("CONTROL: without the kill switch, a second cycle sends again", async () => {
    const { runtime, h } = await startEmergencyRuntime();
    try {
      expect(h.sendCalls).toHaveBeenCalledTimes(1);
      const payload = await guardianToolHandlers(runtime).runCycle();
      expect(payload.status).toBe("ok");
      expect(payload.sent).toBe(true);
      expect(h.sendCalls).toHaveBeenCalledTimes(2);
    } finally {
      runtime.stop();
    }
  });

  it("once pulled from the tool, the next cycle refuses to act — and nothing is sent", async () => {
    const { runtime, h } = await startEmergencyRuntime();
    try {
      expect(h.sendCalls).toHaveBeenCalledTimes(1);

      const handlers = guardianToolHandlers(runtime);
      const killed = await handlers.killSwitch();
      expect(killed).toMatchObject({ status: "ok", killSwitchEngaged: true });

      const payload = await handlers.runCycle();
      expect(payload.status).toBe("ok");
      expect(payload.sent).toBe(false);
      // The refusal comes from `executeDecision`'s FIRST rule, not from anything here.
      expect(String(payload.executeReason)).toMatch(/[Kk]ill switch/);
      // The position is still an emergency; the decision has not changed, only the execution.
      expect(payload.action).toBe("EMERGENCY");
      expect(h.sendCalls).toHaveBeenCalledTimes(1);
    } finally {
      runtime.stop();
    }
  });

  it("is a one-way latch: it survives the cycle that follows it and is persisted", async () => {
    const { runtime, h } = await startEmergencyRuntime();
    try {
      runtime.kill();
      expect(runtime.isKilled()).toBe(true);
      await runtime.runCycleNow();
      expect(runtime.isKilled()).toBe(true);
      expect(runtime.getExecuteState().killed).toBe(true);
      // Persisted, so a restart comes back killed rather than free to spend.
      expect((await h.store.load())?.killed).toBe(true);

      // And it holds across a second out-of-band cycle, which replaces the loop handle.
      await runtime.runCycleNow();
      expect(runtime.getExecuteState().killed).toBe(true);
      expect(h.sendCalls).toHaveBeenCalledTimes(1);
    } finally {
      runtime.stop();
    }
  });

  it("keeps monitoring after the kill: cycles still run and still report the position", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const runtime = await startGuardianRuntime(testConfig({ intervalMs: 1_000 }), h.deps);
      try {
        await waitForCycles(h, 1);
        runtime.kill();
        const seen = h.cycles.length;
        await vi.advanceTimersByTimeAsync(2_000);
        expect(h.cycles.length).toBeGreaterThan(seen);
        // Monitoring continued; spending did not.
        expect(h.cycles.at(-1)?.ok).toBe(true);
        expect(h.sendCalls).toHaveBeenCalledTimes(1);
      } finally {
        runtime.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The tools, on the surface a caller actually touches
// ---------------------------------------------------------------------------

describe("the Guardian tools", () => {
  it("report every USD value through format.ts, never on the raw 8-decimal basis", async () => {
    const { runtime, h } = await startEmergencyRuntime();
    try {
      const handlers = guardianToolHandlers(runtime);
      const position = await handlers.position();
      expect(position).toMatchObject({
        status: "ok",
        account: ACCOUNT,
        collateral: "$7,500.00",
        debt: "$6,000.00",
        healthFactor: "0.93",
      });
      expect(JSON.stringify(position)).not.toContain("750000000000");

      const state = await handlers.executeState();
      expect(String(state.spentToday)).toMatch(/^\$/);
      expect(state).toMatchObject({ killSwitchEngaged: false, monitorIntervalMs: 3_600_000 });
      // The first cycle spent the per-action cap, $1,000 — 100000000000 on the raw basis.
      // That raw number must not appear anywhere in what a human is shown.
      expect(state.spentToday).toBe("$1,000.00");
      expect(JSON.stringify(state)).not.toContain("100000000000");
      expect(h.sendCalls).toHaveBeenCalledTimes(1);
    } finally {
      runtime.stop();
    }
  });

  it("answer 'unavailable' with the variable that turns them on when no loop is running", async () => {
    const handlers = guardianToolHandlers(null);
    for (const payload of [
      await handlers.position(),
      await handlers.executeState(),
      await handlers.runCycle(),
      await handlers.killSwitch(),
    ]) {
      expect(payload.status).toBe("unavailable");
      expect(String(payload.reason)).toContain("FUGU_GUARDIAN_ENABLED=1");
    }
  });

  it("are registered on the MCP server, and the kill switch works through an MCP client", async () => {
    const { runtime, h } = await startEmergencyRuntime();
    const server = buildMcpServer({ commerceSkills: false, guardian: guardianToolHandlers(runtime) });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const listed = (await client.listTools()).tools.map((t) => t.name);
      expect(listed).toEqual(
        expect.arrayContaining([
          "guardian_position",
          "guardian_execute_state",
          "guardian_run_cycle",
          "guardian_kill_switch",
        ]),
      );

      const readPayload = (result: unknown): Record<string, unknown> => {
        const content = (result as { content: { type: string; text: string }[] }).content;
        return JSON.parse(content[0]!.text) as Record<string, unknown>;
      };

      expect(readPayload(await client.callTool({ name: "guardian_position", arguments: {} }))).toMatchObject({
        status: "ok",
        healthFactor: "0.93",
      });

      // Pull the lever from the client side, then prove the next cycle refuses to act.
      expect(readPayload(await client.callTool({ name: "guardian_kill_switch", arguments: {} }))).toMatchObject({
        status: "ok",
        killSwitchEngaged: true,
      });
      const sentBefore = h.sendCalls.mock.calls.length;
      const cycle = readPayload(await client.callTool({ name: "guardian_run_cycle", arguments: {} }));
      expect(cycle).toMatchObject({ status: "ok", sent: false, action: "EMERGENCY" });
      expect(String(cycle.executeReason)).toMatch(/[Kk]ill switch/);
      expect(h.sendCalls.mock.calls.length).toBe(sentBefore);

      expect(readPayload(await client.callTool({ name: "guardian_execute_state", arguments: {} }))).toMatchObject({
        killSwitchEngaged: true,
      });
    } finally {
      runtime.stop();
      await client.close();
      await server.close();
    }
  });

  it("register on the MCP server even when no Guardian loop is running in the process", async () => {
    const server = buildMcpServer({ commerceSkills: false });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = (await client.listTools()).tools.map((t) => t.name);
      expect(listed).toContain("guardian_kill_switch");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("expose exactly four Guardian tools, and no way to clear the kill switch", () => {
    const names: string[] = [];
    const fakeServer = {
      registerTool: (name: string) => {
        names.push(name);
      },
    } as unknown as Parameters<typeof registerGuardianMcpTools>[0];
    registerGuardianMcpTools(fakeServer, guardianToolHandlers(null));
    expect(names).toEqual([
      "guardian_position",
      "guardian_execute_state",
      "guardian_run_cycle",
      "guardian_kill_switch",
    ]);
    expect(names.join(" ")).not.toMatch(/resume|revive|clear|reset|unkill/i);
  });
});
