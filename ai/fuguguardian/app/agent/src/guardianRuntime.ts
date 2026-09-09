/**
 * The Fugu Guardian RUNTIME: the piece that makes the agent process actually *run* the
 * strategy instead of merely being able to describe it.
 *
 * ## Why this module exists
 *
 * `src/strategy/` has held the whole chain — read position -> `decide` -> `executeDecision`
 * -> send through the bounded session — assembled in one place (`createGuardian`) for a
 * while now. Nothing in the agent's entrypoints imported any of it: `dualMain.ts`,
 * `mcpMain.ts`, and `tools.ts` did not reference `src/strategy/` at all, so the only things
 * that ever ran the full chain were `createGuardian()` itself and `scripts/e2e-guardian.ts`.
 * A running agent that cannot run its own strategy is a demo, not a product.
 *
 * This module closes that gap and nothing else. It contains **no decision logic, no
 * thresholds, and no amounts** — every one of those still lives in `decide.ts` /
 * `execute.ts`, and this file may not second-guess them.
 *
 * ## The three properties it must have, and how each is obtained
 *
 * 1. **The monitoring loop lives inside the agent process, on a configurable interval.**
 *    It is `guardian.start(intervalMs)` — i.e. `startGuardLoop` from `guard.ts`, which is
 *    already hardened so a throwing logger or a throwing `now()` cannot stop it. This
 *    module deliberately does NOT re-implement a loop, and it must never wrap a cycle in a
 *    `try/catch` that swallows what `guard.ts` already reports.
 *
 * 2. **A configuration fault is visible at START, never at the first cycle.** Everything
 *    that can be checked before the loop exists is checked here and THROWN:
 *    the environment values (`readGuardianRuntimeConfig`), the chain id (97, testnet only),
 *    the session allowlist (`assertBoundedAllowlist` + `assertNativeSpendCap`), and then
 *    `createGuardian`'s own construction-time reads (asset enabled, two independent sources
 *    for the token decimals, an 8-decimal feed, a readable price). None of those failures
 *    is downgraded to a log line: `startGuardianRuntime` rejects, and the entrypoint lets
 *    the process die. An agent that boots "healthy" with a broken repay path is worse than
 *    an agent that refuses to boot.
 *
 * 3. **The kill switch is a lever reachable from outside the process.** It is
 *    `GuardLoopHandle.kill()` — the real one from `guard.ts`, which sets `killed`, persists
 *    it, and makes `executeDecision` refuse on its FIRST rule. It is a ONE-WAY latch: this
 *    module holds `killLatched` for the lifetime of the runtime and re-asserts it on every
 *    loop handle it ever creates, so no code path here can turn it back off.
 *
 * ## The one hazard this module exists to contain
 *
 * `Guardian` offers two ways to run a cycle — `start()` (the loop holds the state) and
 * `runOnce()` (the closure inside `createGuardian` holds it) — and they hold that state
 * SEPARATELY. Running them concurrently means two cycles read the same `ExecuteState`, both
 * see the same untouched daily budget, the same `lastActionAt`, and the same
 * `pendingRepay: null` — and both send. That is a double payment of real money, produced by
 * nothing more than exposing a "run a cycle now" tool next to a loop.
 *
 * So cycles are SERIALIZED here, and the serialization is not a convention:
 *   - a cycle in flight is detected because every cycle's very first act is to ask this
 *     module for the time (`runGuardCycle` calls `deps.now()` as its first statement);
 *   - `runCycleNow()` REFUSES with `GuardianBusyError` while one is in flight, rather than
 *     queueing behind it (a queued cycle would act on a position it read minutes ago);
 *   - while a manual cycle runs, the loop is stopped so its timer cannot start a second
 *     one, and it is replaced afterwards.
 *
 * ## Boundaries (CLAUDE.md #1)
 *
 * No LLM appears anywhere in this file. `explainDecision` is deliberately NOT wired in:
 * dGrid takes 30–46 seconds and must never sit on the path that decides whether to pay, so
 * the default (`decision.reason`, verbatim) stands. The tools built on top of this runtime
 * (`guardianTools.ts`) let a caller ask for a read, ask for a cycle, or pull the kill
 * switch — never for an amount, a threshold, or a decision.
 */
import path from "node:path";
import type { PublicClient } from "viem";
import {
  GUARDIAN_SESSION_FILE,
  WORKSPACE_ROOT,
  armAltanaSdk,
  loadGuardianSession,
  relaySender,
  sessionProvider,
} from "./altana.js";
import {
  assertBoundedAllowlist,
  assertNativeSpendCap,
  requiredSessionCalls,
  type SessionCall,
  type SessionPermissions,
  type SessionSendResult,
} from "./strategy/chain/session.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
  REPAY_ASSET_ADDRESS,
  createTestnetReader,
} from "./strategy/chain/testnet.js";
import { createGuardian, type Guardian, type RepayAssetInfo } from "./strategy/createGuardian.js";
import type { ExecuteLimits, ExecuteState } from "./strategy/execute.js";
import { logError, logInfo, type CycleResult, type GuardCycleOutcome, type GuardLoopHandle, type Logger } from "./strategy/guard.js";
import { createFileStateStore, type ExecuteStateStore } from "./strategy/state/store.js";
import type { Position } from "./strategy/types.js";

/** BSC testnet. Not configurable on purpose — CLAUDE.md #7 is "testnet only". */
export const REQUIRED_CHAIN_ID = 97;

/** A runtime configuration fault. It always means "do not start the loop". */
export class GuardianRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianRuntimeConfigError";
  }
}

/** A cycle was requested while one was already running. Refused, never queued. */
export class GuardianBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianBusyError";
  }
}

export interface GuardianRuntimeConfig {
  readonly rpcUrl: string;
  readonly intervalMs: number;
  readonly pool: `0x${string}`;
  readonly repayAsset: `0x${string}`;
  readonly sessionFile: string;
  readonly stateFile: string;
  readonly limits: ExecuteLimits;
}

/**
 * Defaults. The money ones are deliberately the SMALLEST numbers that are still useful:
 * whoever forgets to set an environment variable must end up with a cap that is too tight,
 * never one that is too loose. $10 per action and $50 per day both sit well under the
 * session's own cryptographic cap of 100 mUSD/day, so the tighter limit is always ours and
 * the chain-enforced one is the backstop, not the working limit.
 */
const DEFAULTS = {
  intervalMs: 60_000,
  maxPerActionUsd8: 1_000_000_000n, // $10.00
  maxPerDayUsd8: 5_000_000_000n, // $50.00
  minIntervalSeconds: 300,
} as const;

/** The default state file — the same one the E2E script writes, inside the gitignored `.studio/`. */
export const DEFAULT_GUARDIAN_STATE_FILE = path.join(WORKSPACE_ROOT, ".studio/guardian-state.json");

export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Is the Guardian runtime switched on for this process? Opt-in, so `bag dev` keeps working untouched. */
export function guardianRuntimeEnabled(env: EnvLike): boolean {
  const raw = (env.FUGU_GUARDIAN_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function requireAddress(raw: string | undefined, fallback: `0x${string}`, name: string): `0x${string}` {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new GuardianRuntimeConfigError(`${name} is not a valid 0x address: ${value}`);
  }
  return value as `0x${string}`;
}

function requirePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new GuardianRuntimeConfigError(`${name} must be a positive whole number, received ${JSON.stringify(raw)}.`);
  }
  return value;
}

function requireNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new GuardianRuntimeConfigError(`${name} must be a whole number of zero or more, received ${JSON.stringify(raw)}.`);
  }
  return value;
}

/**
 * Parses a USD amount on the 8-decimal basis. A decimal STRING only — never a JS number:
 * these values routinely exceed `Number.MAX_SAFE_INTEGER`, and the digit that gets lost is
 * the one that decides how many dollars leave the wallet.
 */
function requireUsd8(raw: string | undefined, fallback: bigint, name: string): bigint {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new GuardianRuntimeConfigError(
      `${name} must be a whole number of USD on the 8-decimal basis, written as digits only ` +
        `(100000000 = $1.00), received ${JSON.stringify(raw)}.`,
    );
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new GuardianRuntimeConfigError(`${name} must be greater than zero, received ${value}.`);
  }
  return parsed;
}

function requireRpcUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim() === "" ? DEFAULT_BSC_TESTNET_RPC_URL : (raw as string).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GuardianRuntimeConfigError(`The RPC URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GuardianRuntimeConfigError(`The RPC URL must be http(s), received ${value}`);
  }
  // CLAUDE.md #3: the SDK's own default points at `binance.org`, which is blocked from
  // Indonesia. Failing here beats a loop whose every cycle times out and looks like a
  // healthy-but-quiet agent.
  if (url.hostname === "binance.org" || url.hostname.endsWith(".binance.org")) {
    throw new GuardianRuntimeConfigError(
      `The RPC URL ${value} uses the binance.org domain, which is blocked from Indonesia ` +
        `(CLAUDE.md #3). Use ${DEFAULT_BSC_TESTNET_RPC_URL}.`,
    );
  }
  return value;
}

/**
 * Reads the runtime configuration from the environment. **Pure** — no I/O, no clock — so
 * every refusal below is covered by a unit test rather than discovered on a testnet.
 */
export function readGuardianRuntimeConfig(env: EnvLike): GuardianRuntimeConfig {
  const limits: ExecuteLimits = {
    maxPerActionUsd8: requireUsd8(env.FUGU_GUARDIAN_MAX_PER_ACTION_USD8, DEFAULTS.maxPerActionUsd8, "FUGU_GUARDIAN_MAX_PER_ACTION_USD8"),
    maxPerDayUsd8: requireUsd8(env.FUGU_GUARDIAN_MAX_PER_DAY_USD8, DEFAULTS.maxPerDayUsd8, "FUGU_GUARDIAN_MAX_PER_DAY_USD8"),
    minIntervalSeconds: requireNonNegativeInt(env.FUGU_GUARDIAN_MIN_INTERVAL_SECONDS, DEFAULTS.minIntervalSeconds, "FUGU_GUARDIAN_MIN_INTERVAL_SECONDS"),
  };
  if (limits.maxPerActionUsd8 > limits.maxPerDayUsd8) {
    // Not a harmless ordering quirk: it makes the per-action cap unreachable, so the number
    // an operator reads as "the most one repay can cost" is not the number in force.
    throw new GuardianRuntimeConfigError(
      `FUGU_GUARDIAN_MAX_PER_ACTION_USD8 (${limits.maxPerActionUsd8}) exceeds ` +
        `FUGU_GUARDIAN_MAX_PER_DAY_USD8 (${limits.maxPerDayUsd8}); the per-action cap would never bind.`,
    );
  }

  return {
    rpcUrl: requireRpcUrl(env.FUGU_GUARDIAN_RPC_URL ?? env.BSC_TESTNET_RPC_URL),
    intervalMs: requirePositiveInt(env.FUGU_GUARDIAN_INTERVAL_MS, DEFAULTS.intervalMs, "FUGU_GUARDIAN_INTERVAL_MS"),
    pool: requireAddress(env.FUGU_GUARDIAN_POOL, MOCK_LENDING_POOL_ADDRESS, "FUGU_GUARDIAN_POOL"),
    repayAsset: requireAddress(env.FUGU_GUARDIAN_REPAY_ASSET, REPAY_ASSET_ADDRESS, "FUGU_GUARDIAN_REPAY_ASSET"),
    sessionFile: (env.FUGU_GUARDIAN_SESSION_FILE ?? "").trim() || GUARDIAN_SESSION_FILE,
    stateFile: (env.FUGU_GUARDIAN_STATE_FILE ?? env.GUARDIAN_STATE_FILE ?? "").trim() || DEFAULT_GUARDIAN_STATE_FILE,
    limits,
  };
}

/**
 * Everything the runtime needs from the loaded session file, and NOTHING more.
 *
 * The `signer` half of that file is never represented here: it is handed straight to the
 * SDK's `deserializeSession` inside `altana.ts` and never read, printed, or copied. What
 * crosses this boundary is the wallet address, the permissions (which get checked), a
 * public key, an expiry, and a function that sends a batch.
 */
export interface GuardianSessionHandle {
  readonly walletAddress: `0x${string}`;
  readonly permissions: SessionPermissions;
  readonly publicKey: string;
  readonly expiry: number;
  readonly sendCalls: (calls: readonly SessionCall[], description: string) => Promise<SessionSendResult>;
}

/**
 * The runtime's outside world. Injected in full so the tests below never open a socket:
 * `createClient` returns a fake viem client, `loadSession` returns a fake session with a
 * spy for `sendCalls`, and the REAL `createGuardian` / `decide` / `executeDecision` /
 * `guard.ts` run underneath — which is the only way a test of "the kill switch stops a
 * send" can mean anything.
 */
export interface GuardianRuntimeDeps {
  readonly logger: Logger;
  readonly createClient: (rpcUrl: string) => PublicClient;
  readonly loadSession: (
    config: GuardianRuntimeConfig,
    client: PublicClient,
  ) => Promise<GuardianSessionHandle>;
  readonly createStateStore: (file: string) => ExecuteStateStore;
  readonly assembleGuardian: typeof createGuardian;
  /** Epoch seconds. Injected so time is controllable; wrapped internally for cycle tracking. */
  readonly clock?: () => number;
}

export interface GuardianRuntime {
  /** The position owner — the Altana wallet the bounded session acts for. */
  readonly account: `0x${string}`;
  /** The repay asset exactly as read from the chain at construction. */
  readonly repayAsset: RepayAssetInfo;
  readonly config: GuardianRuntimeConfig;
  /** The session's non-secret identity, for status output. */
  readonly session: { readonly publicKey: string; readonly expiry: number };
  /** Reads the position, anchored to one block. No state changes. */
  readPosition(): Promise<Position>;
  /**
   * Runs ONE cycle right now, on the same deterministic chain the loop runs. Throws
   * `GuardianBusyError` when a cycle is already in flight — refused, not queued.
   */
  runCycleNow(): Promise<GuardCycleOutcome>;
  /** Budget, cooldown, kill switch, pending repay. */
  getExecuteState(): ExecuteState;
  /** The last completed cycle from either path, or null. */
  getLastResult(): CycleResult | null;
  /** Pulls the kill switch. ONE-WAY: nothing in this runtime can put it back. */
  kill(): void;
  isKilled(): boolean;
  /** Is a cycle in flight right now? */
  isCycleActive(): boolean;
  /** Stops the monitoring loop (process shutdown). Does NOT clear the kill switch. */
  stop(): void;
}

/**
 * How long a "a cycle is running" flag may stand before it is treated as stale.
 *
 * The flag is cleared by the loop's `onCycle`, which `guard.ts` guarantees to reach for
 * every tick. This margin only covers the case where that guarantee is broken by something
 * unforeseen: without it, one lost `onCycle` would make `runCycleNow()` answer "busy"
 * forever, and the kill switch's neighbour tool would look broken.
 */
const CYCLE_STALE_MARGIN_MS = 300_000;

export async function startGuardianRuntime(
  config: GuardianRuntimeConfig,
  deps: GuardianRuntimeDeps,
): Promise<GuardianRuntime> {
  const clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));

  // --- Chain identity, checked before anything else ------------------------
  const client = deps.createClient(config.rpcUrl);
  const chainId = await client.getChainId();
  if (chainId !== REQUIRED_CHAIN_ID) {
    throw new GuardianRuntimeConfigError(
      `The RPC ${config.rpcUrl} reports chain id ${chainId}; Guardian only runs on ${REQUIRED_CHAIN_ID} (BSC testnet).`,
    );
  }

  // --- The bounded session, checked before the loop exists -----------------
  const session = await deps.loadSession(config, client);
  // Both checks happen here AND again inside `createSessionSendRepay`. The repetition is
  // deliberate and cheap: this one refuses to boot, that one refuses to send.
  assertBoundedAllowlist(session.permissions, requiredSessionCalls(config.pool, config.repayAsset));
  assertNativeSpendCap(session.permissions);

  const store = deps.createStateStore(config.stateFile);

  // --- Cycle tracking ------------------------------------------------------
  // Every cycle's first act is `deps.now()` (see `runGuardCycle`), so wrapping the clock is
  // what tells this module a cycle has begun. `trackCycles` stays false through
  // `createGuardian`, which calls `now()` once for the initial state — counting that as a
  // cycle would leave the flag set before a single cycle had run.
  let trackCycles = false;
  let cycleActive = false;
  let cycleActiveSinceMs = 0;

  function now(): number {
    if (trackCycles && !cycleActive) {
      cycleActive = true;
      cycleActiveSinceMs = Date.now();
    }
    return clock();
  }

  function isCycleActive(): boolean {
    if (!cycleActive) return false;
    if (Date.now() - cycleActiveSinceMs > config.intervalMs + CYCLE_STALE_MARGIN_MS) {
      logError(deps.logger, "guardian-runtime: a cycle flag went stale and was cleared", {
        account: session.walletAddress,
        sinceMs: Date.now() - cycleActiveSinceMs,
      });
      cycleActive = false;
      return false;
    }
    return true;
  }

  let lastResult: CycleResult | null = null;

  // --- Assembly. Every failure below propagates: this is start-time, not cycle-time. ----
  const guardian: Guardian = await deps.assembleGuardian({
    account: session.walletAddress,
    client,
    pool: config.pool,
    repayAsset: config.repayAsset,
    permissions: session.permissions,
    sendCalls: session.sendCalls,
    limits: config.limits,
    logger: deps.logger,
    stateStore: store,
    now,
    // `explainDecision` is left at its default (`decision.reason`, verbatim). Wiring dGrid
    // in here would put a 30–46 second LLM call inside the cycle that decides whether to
    // pay — CLAUDE.md #1.
    onCycle: (result) => {
      cycleActive = false;
      lastResult = result;
    },
    log: (message) => logInfo(deps.logger, `guardian-runtime: ${message}`),
  });

  trackCycles = true;

  const startingState = guardian.getExecuteState();
  if (startingState.pendingRepay !== null) {
    // Not a boot failure — `executeDecision` rule 2 already refuses to send while this
    // stands, which is the correct behaviour. But a Guardian that is deliberately silent
    // must SAY so, or its silence reads as health.
    logError(deps.logger, "guardian-runtime: a previous repay is not yet proven complete; NO new repay will be sent", {
      account: session.walletAddress,
      startedAt: startingState.pendingRepay.startedAt,
      txHash: startingState.pendingRepay.txHash,
      note: "the chain must show the debt fall by that exact amount, or an operator must call clearPendingRepay",
    });
  }

  // --- The loop ------------------------------------------------------------
  // `killLatched` is the runtime's own copy of the one-way latch. Every loop handle this
  // runtime ever creates has the latch re-asserted on it, so no restart can lose it.
  let killLatched = startingState.killed;
  let stopped = false;
  let manualInFlight = false;
  /** Pending replacement of the loop after an out-of-band cycle; cleared by `stop()`. */
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let loop: GuardLoopHandle = startLoop();

  function startLoop(): GuardLoopHandle {
    // Cleared BEFORE `start()`, because `startGuardLoop` fires its first tick synchronously
    // and that tick is what should set the flag.
    cycleActive = false;
    const handle = guardian.start(config.intervalMs);
    if (killLatched) handle.kill();
    return handle;
  }

  const runtime: GuardianRuntime = {
    account: session.walletAddress,
    repayAsset: guardian.repayAsset,
    config,
    session: { publicKey: session.publicKey, expiry: session.expiry },

    readPosition: () => guardian.readPosition(),

    getExecuteState: () => {
      const state = guardian.getExecuteState();
      // OR-ed, never AND-ed: while a manual cycle is in flight the latch can be newer than
      // the state it will write, and a status read must not report a kill switch as unset
      // after somebody pulled it.
      return killLatched && !state.killed ? { ...state, killed: true } : state;
    },

    getLastResult: () => lastResult,

    isCycleActive,

    isKilled: () => killLatched || guardian.getExecuteState().killed,

    kill: () => {
      killLatched = true;
      // The real lever: it sets `killed`, persists it, and from the next cycle onwards
      // `executeDecision` refuses on its first rule. It works on a stopped handle too,
      // which is why `loop` is never null.
      loop.kill();
      logInfo(deps.logger, "guardian-runtime: kill switch pulled from outside the loop", {
        account: session.walletAddress,
      });
    },

    stop: () => {
      stopped = true;
      if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      loop.stop();
      logInfo(deps.logger, "guardian-runtime: monitoring loop stopped", { account: session.walletAddress });
    },

    runCycleNow: async () => {
      if (stopped) {
        throw new GuardianBusyError("The Guardian runtime has been stopped; no cycle is run.");
      }
      if (manualInFlight || isCycleActive()) {
        throw new GuardianBusyError(
          "A Guardian cycle is already running. The request is refused rather than queued: two " +
            "cycles reading the same execution state could both send a repay.",
        );
      }
      manualInFlight = true;
      // Stopping the loop is what keeps its timer from starting a second, concurrent cycle.
      // The handle itself is KEPT: `kill()` still works through it, so the kill switch has
      // no blind window while this cycle runs.
      const paused = loop;
      paused.stop();
      cycleActive = false;
      try {
        const outcome = await guardian.runOnce();
        lastResult = outcome.result;
        return outcome;
      } finally {
        cycleActive = false;
        manualInFlight = false;
        // Re-assert the latch AFTER the manual cycle has written its own state: that state
        // was read before the kill and would otherwise carry `killed: false` into the
        // replacement loop.
        if (killLatched) paused.kill();
        // The replacement loop is scheduled a full interval away rather than started now.
        // `startGuardLoop` fires its first tick immediately, so restarting here would run a
        // SECOND cycle against a position that was read moments ago — burning RPC calls and
        // making two back-to-back tool calls answer "busy" for no reason. An out-of-band
        // cycle therefore resets the schedule, which is what an operator asking for "check
        // it now" means. `paused` stays in place until then, so `kill()` never has a blind
        // window.
        if (!stopped && restartTimer === null) {
          restartTimer = setTimeout(() => {
            restartTimer = null;
            if (!stopped) loop = startLoop();
          }, config.intervalMs);
          // Node only: never hold the process open for the sake of the monitoring loop's
          // replacement timer.
          restartTimer.unref?.();
        }
      }
    },
  };

  logInfo(deps.logger, "guardian-runtime: monitoring loop started", {
    account: session.walletAddress,
    chainId,
    pool: config.pool,
    repayAsset: config.repayAsset,
    repayAssetDecimals: guardian.repayAsset.tokenDecimals,
    priceFeed: guardian.repayAsset.feed,
    intervalMs: config.intervalMs,
    stateFile: config.stateFile,
    sessionExpiry: session.expiry,
    killed: killLatched,
  });

  return runtime;
}

// ---------------------------------------------------------------------------
// The real outside world
// ---------------------------------------------------------------------------

/** Stringifies log metadata safely — `JSON.stringify` cannot write a bigint at all. */
function stringifyMeta(meta: Record<string, unknown> | undefined): string {
  if (meta === undefined) return "";
  return ` ${JSON.stringify(meta, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}`;
}

/** A console logger in the shape `guard.ts` expects. Its throws are already swallowed there. */
export function consoleGuardianLogger(prefix = "[fugu-guardian]"): Logger {
  return {
    info: (message, meta) => console.log(`${prefix} ${message}${stringifyMeta(meta)}`),
    error: (message, meta) => console.error(`${prefix} ERROR ${message}${stringifyMeta(meta)}`),
  };
}

/**
 * The production dependencies: a real viem client, the real bounded Altana session, and a
 * real JSON-file state store.
 *
 * The state store is a FILE, never in-memory. An in-memory store loses the daily budget,
 * the cooldown, the kill switch, and the pending-repay record on every restart, which turns
 * a "$50 per day" cap into "$50 per crash".
 */
export function defaultGuardianRuntimeDeps(logger: Logger): GuardianRuntimeDeps {
  return {
    logger,
    createClient: (rpcUrl) => createTestnetReader(rpcUrl).client,
    loadSession: async (config, client) => {
      armAltanaSdk();
      // `deserializeSession` verifies for itself that the key in the file derives the
      // recorded `publicKey`. The `signer` half is never read, printed, or copied here.
      const session = await loadGuardianSession(config.sessionFile);
      const send = relaySender(sessionProvider(session, config.rpcUrl), client);
      return {
        walletAddress: session.walletAddress as `0x${string}`,
        permissions: session.permissions as SessionPermissions,
        publicKey: session.publicKey,
        expiry: session.expiry,
        sendCalls: async (calls, description) => {
          const result = await send(
            calls.map((call) => ({
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args,
            })),
            description,
          );
          return { transactionHash: result.transactionHash, status: result.status };
        },
      };
    },
    createStateStore: (file) => createFileStateStore(file),
    assembleGuardian: createGuardian,
  };
}

/**
 * The entrypoint hook: returns `null` when the runtime is switched off, and otherwise starts
 * it — **throwing on any fault** so the process dies at boot instead of serving a face that
 * reports health while its repay path is broken.
 *
 * Opt-in via `FUGU_GUARDIAN_ENABLED=1`, because the same process also serves the commercial
 * A2A/MCP faces and those must keep booting on a machine that has no Guardian session file.
 */
export async function startGuardianRuntimeFromEnv(
  env: EnvLike,
  logger: Logger,
): Promise<GuardianRuntime | null> {
  if (!guardianRuntimeEnabled(env)) {
    logInfo(
      logger,
      "guardian-runtime: disabled (set FUGU_GUARDIAN_ENABLED=1 to run the monitoring loop in this process)",
    );
    return null;
  }
  const config = readGuardianRuntimeConfig(env);
  return startGuardianRuntime(config, defaultGuardianRuntimeDeps(logger));
}
