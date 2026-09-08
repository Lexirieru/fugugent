/**
 * Guardian's composition root: the one place that assembles the full chain read position
 * -> `decide` -> `executeDecision` -> send via the session key, together with its state
 * persistence and kill switch.
 *
 * ## Why this module exists
 *
 * Until now that assembly only lived inside `scripts/e2e-guardian.ts` as roughly 200 lines
 * that could not be reused and were guarded by no test at all. Five pieces had no
 * equivalent in `src/` whatsoever: the USD8 -> token units conversion, reading `assets()` +
 * the price feed, the balance check before sending, building the initial `ExecuteState`, and
 * composing `sendRepay`. Whoever wired up the next runtime would have copied them out of a
 * demo script, and the first copy that was off by one order of magnitude on the unit
 * conversion would not have been caught by a single test.
 *
 * Now `createGuardian` owns it, the E2E script calls it, and the backend will call the same
 * thing.
 *
 * ## What is DELIBERATELY left outside
 *
 * `sendCalls` — the Altana relay path (`AltanaWalletProvider._relayExecute`) — is injected,
 * not assembled here. Two reasons: modules in `src/strategy/` must not pull in third-party
 * SDK dependencies, and that path uses internal SDK APIs that can change without notice.
 * The injection boundary is the same boundary `chain/session.ts` uses, so this entire
 * module can be tested without touching the network at all.
 *
 * `explainDecision` is injected too, and its default is NOT an LLM but `decision.reason`
 * as-is. dGrid takes 3–46 seconds; quietly wiring it in as the default would place it on
 * the path the backend uses without anyone asking for it (CLAUDE.md #1).
 */
import type { PublicClient } from "viem";
import { readAavePosition } from "./chain/aave.js";
import { createSessionSendRepay, type SessionPermissions, type SessionRepayDeps } from "./chain/session.js";
import {
  executeDecision,
  type ExecuteLimits,
  type ExecuteState,
} from "./execute.js";
import {
  logError,
  logInfo,
  runGuardCycle,
  startGuardLoop,
  type CycleResult,
  type ExecuteFn,
  type ExplainFn,
  type GuardCycleDeps,
  type GuardCycleOutcome,
  type GuardLoopHandle,
  type Logger,
} from "./guard.js";
import { initialExecuteState, type ExecuteStateStore } from "./state/store.js";
import type { Position, Thresholds } from "./types.js";
import {
  assertFeedIsUsd8,
  assertTokenDecimalsAgree,
  usd8ToTokenUnits,
} from "./units.js";

const POOL_ASSETS_ABI = [
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "feed", type: "address" },
      { name: "ltvBps", type: "uint16" },
      { name: "liquidationThresholdBps", type: "uint16" },
      { name: "tokenDecimals", type: "uint8" },
      { name: "enabled", type: "bool" },
    ],
  },
] as const;

const PRICE_FEED_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** A Guardian assembly error: it always means "do not start the loop at all". */
export class GuardianConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianConfigError";
  }
}

export interface GuardianConfig {
  /** The position owner's wallet — whose debt is repaid, and on whose behalf the session acts. */
  account: `0x${string}`;
  /** A read-only viem client for the chain the position lives on. */
  client: PublicClient;
  /** A pool with Aave v3's `getUserAccountData` ABI. */
  pool: `0x${string}`;
  /** The debt token that may be repaid. */
  repayAsset: `0x${string}`;
  /** The session permissions exactly as they came from the session file; checked at construction. */
  permissions: SessionPermissions;
  /** The batch sender via the Altana session. See the "What is DELIBERATELY left outside" note. */
  sendCalls: SessionRepayDeps["sendCalls"];
  limits: ExecuteLimits;
  logger: Logger;
  /**
   * State persistence. **REQUIRED, and deliberately without a default.**
   *
   * An in-memory default used to live here and it was wrong: it made the most dangerous
   * option (the daily cap, the cooldown, the kill switch, and the pending-repay record all
   * lost on every restart) the one people got without typing anything. Now every caller has
   * to name it — `createFileStateStore(path)` for a real process,
   * `createMemoryStateStore()` for tests — and the second reads as a decision at the call
   * site rather than as an oversight.
   */
  stateStore: ExecuteStateStore;
  /** The clock in epoch seconds; injected so it is fully controllable in tests. */
  now?: () => number;
  /** Default: `decision.reason` as-is, NO LLM. */
  explainDecision?: ExplainFn;
  thresholds?: Thresholds;
  onCycle?: (result: CycleResult) => void;
  /** Detailed notes about the session path (unit conversion, approve). Default: silent. */
  log?: (message: string) => void;
}

/** The repay asset's configuration, read from the chain at construction rather than assumed. */
export interface RepayAssetInfo {
  readonly asset: `0x${string}`;
  readonly feed: `0x${string}`;
  readonly tokenDecimals: number;
}

export interface Guardian {
  /** The repay asset's configuration exactly as read from the chain — printed by the script, used by the backend. */
  readonly repayAsset: RepayAssetInfo;
  /** Reads the current position, anchored to a single block (see `chain/aave.ts`). */
  readPosition(): Promise<Position>;
  /** Runs ONE cycle, flowing and persisting its own state. */
  runOnce(): Promise<GuardCycleOutcome>;
  /** Runs the loop; its handle has a real `kill()` (see `guard.ts`). */
  start(intervalMs: number): GuardLoopHandle;
  /** The current execution state (budget, cooldown, kill switch, pending repay). */
  getExecuteState(): ExecuteState;
}

function requireHexAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new GuardianConfigError(`${label} is not a valid address: ${String(value)}`);
  }
  return value as `0x${string}`;
}

/**
 * Assembles a ready-to-run Guardian.
 *
 * Every read of the asset configuration happens HERE, at construction, not on the first
 * transaction: an inactive asset, inconsistent decimals, a feed that is not 8 decimals, or
 * session permissions that are too broad must all be visible before the first cycle runs —
 * not after the agent has decided to pay.
 */
export async function createGuardian(config: GuardianConfig): Promise<Guardian> {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const log = config.log ?? (() => {});
  const store = config.stateStore;
  const explain: ExplainFn = config.explainDecision ?? (async (_pos, decision) => decision.reason);

  // --- The repay asset's configuration, read from the pool -------------------
  const [feedRaw, , , tokenDecimalsFromPool, enabled] = (await config.client.readContract({
    address: config.pool,
    abi: POOL_ASSETS_ABI,
    functionName: "assets",
    args: [config.repayAsset],
  })) as readonly [`0x${string}`, number, number, number, boolean];

  if (!enabled) {
    throw new GuardianConfigError(
      `Repay asset ${config.repayAsset} is not enabled in pool ${config.pool}; there is nothing to repay.`,
    );
  }
  const feed = requireHexAddress(feedRaw, `The price feed for repay asset ${config.repayAsset}`);

  // Two independent sources for the token's decimals, plus a feed that must be 8 decimals.
  // This replaces the tautological "round-trip check" that used to be in the E2E script —
  // see the full note at the top of `units.ts`.
  const tokenDecimals = Number(
    (await config.client.readContract({
      address: config.repayAsset,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number,
  );
  assertTokenDecimalsAgree(Number(tokenDecimalsFromPool), tokenDecimals, config.repayAsset);

  const feedDecimals = Number(
    (await config.client.readContract({
      address: feed,
      abi: PRICE_FEED_ABI,
      functionName: "decimals",
    })) as number,
  );
  assertFeedIsUsd8(feedDecimals, config.repayAsset);

  /** The repay asset's price, read FRESH on every conversion — not cached at construction. */
  async function readRepayPriceUsd8(): Promise<bigint> {
    const [, answer] = (await config.client.readContract({
      address: feed,
      abi: PRICE_FEED_ABI,
      functionName: "latestRoundData",
    })) as readonly [bigint, bigint, bigint, bigint, bigint];
    if (answer <= 0n) {
      throw new GuardianConfigError(
        `Feed ${feed} reports a price of ${answer} for the repay asset; the conversion is refused.`,
      );
    }
    return answer;
  }

  // Fail fast if the feed genuinely cannot be read at all.
  await readRepayPriceUsd8();

  // --- The units bridge + the balance check ---------------------------------
  const toTokenUnits: SessionRepayDeps["toTokenUnits"] = async (asset, amountUsd8) => {
    const priceUsd8 = await readRepayPriceUsd8();
    const units = usd8ToTokenUnits(amountUsd8, tokenDecimals, priceUsd8);
    log(`units: ${amountUsd8} (USD on the 8-decimal basis) -> ${units} token units (${tokenDecimals} decimals)`);

    const balance = (await config.client.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [config.account],
    })) as bigint;
    if (balance < units) {
      // Fail BEFORE sending, rather than letting the transaction revert on chain and burn
      // gas for something one read could already have told us.
      throw new GuardianConfigError(
        `Insufficient repay token balance: ${balance} units < the ${units} units required.`,
      );
    }
    return units;
  };

  // --- The repay signer via the session key --------------------------------
  // `createSessionSendRepay` checks the session allowlist at construction and refuses to
  // run at all when `calls` is empty or missing (= unlimited permission in Altana) or is
  // broader than repay + approve.
  const sendRepay = createSessionSendRepay({
    walletAddress: config.account,
    pool: config.pool,
    repayAsset: config.repayAsset,
    permissions: config.permissions,
    toTokenUnits,
    readAllowance: async (asset, owner, spender) =>
      (await config.client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, spender],
      })) as bigint,
    sendCalls: config.sendCalls,
    log,
  });

  // --- State: loaded from the store, NOT reset on every start ---------------
  const stored = await store.load();
  let currentState: ExecuteState = stored ?? initialExecuteState(now());
  if (stored === null) {
    logInfo(config.logger, "guardian: no stored state, starting from an empty budget", {
      account: config.account,
    });
  } else {
    logInfo(config.logger, "guardian: execution state loaded from the store", {
      account: config.account,
      spentTodayUsd8: stored.spentTodayUsd8.toString(),
      killed: stored.killed,
      pendingRepay: stored.pendingRepay !== null,
    });
  }

  const readPosition = (account: `0x${string}`) =>
    readAavePosition(config.client, account, config.pool);

  const execFn: ExecuteFn = (decision, pos, state) =>
    executeDecision(decision, pos, config.limits, state, {
      repayAsset: config.repayAsset,
      sendRepay,
      now,
      // The pending record is saved BEFORE the transaction departs, not after the cycle
      // finishes: `waitForTransactionReceipt` waits up to 180 seconds, and a process that
      // dies inside that window must not leave behind a pre-cycle state file that makes a
      // restart pay again.
      persistBeforeSend: async (state) => {
        await store.save(state);
        currentState = state;
      },
    });

  const cycleDeps: GuardCycleDeps = {
    account: config.account,
    readPosition,
    executeDecision: execFn,
    explainDecision: explain,
    now,
    logger: config.logger,
    ...(config.thresholds ? { thresholds: config.thresholds } : {}),
    ...(config.onCycle ? { onCycle: config.onCycle } : {}),
  };

  return {
    repayAsset: { asset: config.repayAsset, feed, tokenDecimals },
    readPosition: () => readPosition(config.account),
    getExecuteState: () => currentState,
    runOnce: async () => {
      const outcome = await runGuardCycle(cycleDeps, currentState);
      currentState = outcome.nextExecuteState;
      try {
        await store.save(currentState);
      } catch (err) {
        // Same as inside the loop: a persistence failure is reported, not allowed to stop
        // protecting the position. Via `logError`, which swallows logger exceptions — a
        // logger that threw inside this `catch` would make `runOnce()` throw after the state
        // had already advanced.
        logError(config.logger, "guardian: failed to save the execution state", {
          account: config.account,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return outcome;
    },
    start: (intervalMs) =>
      startGuardLoop(cycleDeps, intervalMs, currentState, {
        saveExecuteState: async (state) => {
          currentState = state;
          await store.save(state);
        },
      }),
  };
}
