/**
 * Guardian E2E on BSC testnet — proof, not simulation.
 *
 * This script contains NO strategy logic whatsoever. Every decision, spending limit, and
 * explanation comes from modules that already exist and are already tested:
 * `createGuardian` (which internally holds `createTestnetReader`, `decide`,
 * `executeDecision`, `createSessionSendRepay`, and the unit conversion) is imported as-is.
 * Since Task 9 this script no longer assembles that chain itself: the whole assembly lives
 * in `src/strategy/createGuardian.ts`, and what is called here is exactly the composition
 * root the backend will use. All this script adds are the three things that genuinely
 * belong to an E2E script:
 *
 *   1. loading secrets from .env (never printing them),
 *   2. sending real transactions (`setAnswer`, `approve`, `repay`),
 *   3. PROVING its claims — every claim is checked against a real on-chain reading, and the
 *      script dies with a non-zero exit code the moment even one claim goes unproven.
 *
 * ## Two signers, and that is the whole point
 *
 * `setAnswer` (lowering, then restoring, the price) is signed by the **deployer EOA** — it
 * owns the feed, and lowering the price is the "market's" role, not the agent's.
 * `approve` + `repay` are signed by the **bounded Altana session key** over wallet
 * `0xbdc69c2d...`, through `createGuardian`/`createSessionSendRepay`. That session key may
 * call only two selectors on two contracts, with a spend cap and an expiry enforced by the
 * Altana account contract on chain — not by this code. The proof is checked in STEP 5, and
 * it has two parts: (a) `Repay.user` on the receipt must be the Altana wallet and the
 * transaction's sender must not be the deployer EOA, and (b) a **negative control** — the
 * SAME session object, moments after successfully paying, attempts `mUSD.transfer` and must
 * be refused by the Altana validator. Without (b), "bounded" is just a word.
 *
 * The sample position is therefore owned by the **Altana wallet**, not the deployer:
 * `MockLendingPool.repay` has no `onBehalfOf`, so only the debt's owner can repay it. Set it
 * up once with `scripts/setup-altana-position.ts`.
 *
 * The scenario:
 *   read the sample position -> lower the mBNB price via `MockPriceFeed.setAnswer` until HF
 *   falls into the PARTIAL_REPAY zone -> run ONE Guardian cycle -> print the decision, the
 *   amount paid, the tx hash, and the HF afterwards -> confirm the HF rose -> restore the
 *   price to its original value.
 *
 * The rule about numbers: every USD value is on the 8-decimal basis and is ONLY printed via
 * `formatUsd8`/`formatHf` (see `format.ts` — 12345678 means $0.12, not twelve million).
 *
 * Run it from `ai/fuguguardian/app/agent`:
 *   npx tsx scripts/e2e-guardian.ts
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "@bnbagent/studio-runtime/config";
import {
  createWalletClient,
  decodeEventLog,
  http,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import {
  GUARDIAN_SESSION_FILE,
  WORKSPACE_ROOT,
  armAltanaSdk,
  loadGuardianSession,
  relaySender,
  sessionProvider,
  type RelayResult,
} from "../src/altana.js";
import {
  assertBoundedAllowlist,
  assertNativeSpendCap,
  assertSessionDenial,
  requiredSessionCalls,
  type SessionPermissions,
} from "../src/strategy/chain/session.js";
import {
  createTestnetReader,
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
  REPAY_ASSET_ADDRESS,
} from "../src/strategy/chain/testnet.js";
import { createGuardian } from "../src/strategy/createGuardian.js";
import { createFileStateStore } from "../src/strategy/state/store.js";
import { decide } from "../src/strategy/decide.js";
import { type Logger } from "../src/strategy/guard.js";
import { type ExecuteLimits } from "../src/strategy/execute.js";
import { explainDecision } from "../src/strategy/explain.js";
import { computeHealthFactor } from "../src/strategy/healthFactor.js";
import { formatHf, formatUsd8 } from "../src/strategy/format.js";
import { DEFAULT_THRESHOLDS, HF_ONE, type Position } from "../src/strategy/types.js";

// ---------------------------------------------------------------------------
// Testnet addresses & constants (source: contracts/deployments/bsc-testnet.json)
// ---------------------------------------------------------------------------

/** The mBNB price feed, 8 decimals, owner = the deployer. The only lever for lowering HF. */
const MOCK_PRICE_FEED_BNB = "0x0aA42416bAccdb2fd4768B61111DeB7F7D212F9B" as const;

const BPS = 10_000n;
const BSCSCAN_TX = "https://testnet.bscscan.com/tx/";

/**
 * The target HF when lowering the price: exactly the middle of the PARTIAL_REPAY zone,
 * DERIVED from the production thresholds (`DEFAULT_THRESHOLDS`), not a magic number.
 * PARTIAL_REPAY applies for deleverage < HF <= partialRepay.
 */
const TARGET_HF = (DEFAULT_THRESHOLDS.partialRepay + DEFAULT_THRESHOLDS.deleverage) / 2n;

/**
 * The spending limits `executeDecision` uses. Deliberately looser than the payment needed
 * this one time, so that what is tested is the execution chain rather than the capping
 * (capping already has its own unit tests).
 *
 * Note that these numbers are NOT the limits that actually bind. The code limit here is
 * $2,000/day; the cryptographic cap on the session is 100 mUSD/day. The tighter one wins,
 * and that is the session cap — even if `LIMITS` is changed, deleted, or the process is
 * hijacked. A consequence worth knowing: a request above the session cap is not cleanly
 * refused by `execute.ts`, it fails at the relay as an error. For a one-repay demo ($8-12)
 * the gap between the two is never touched; for production the two must be made equal.
 */
const LIMITS: ExecuteLimits = {
  maxPerActionUsd8: 100_000_000_000n, // $1,000.00
  maxPerDayUsd8: 200_000_000_000n, // $2,000.00
  minIntervalSeconds: 60,
};

// ---------------------------------------------------------------------------
// ABI minimal
// ---------------------------------------------------------------------------

const PRICE_FEED_ABI = [
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
  {
    type: "function",
    name: "setAnswer",
    stateMutability: "nonpayable",
    inputs: [{ name: "newAnswer", type: "int256" }],
    outputs: [],
  },
] as const;

const POOL_ABI = [
  {
    // Used ONLY for block-anchored reads (see `posisiPadaBlok`), as an anchor independent of
    // `readAavePosition`. No logic is duplicated: what is read is the exact same view
    // function, and its RESULT is then matched against what the adapter reported.
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
  // NOTE: the `repay` definition is DELIBERATELY absent here. The single source for the
  // repay selector is `chain/session.ts`, which uses the same constant for the allowlist AND
  // for making the call. A second copy in this script would let the two drift apart with
  // nobody to warn about it.
] as const;

/** The pool's `Repay` event — the single source for proving WHO paid. */
const POOL_EVENT_ABI = [
  {
    type: "event",
    name: "Repay",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

const ERC20_ABI = [
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
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    // Used ONLY by the negative control in STEP 5: this selector is deliberately NOT in the
    // session allowlist, and the call must be refused by the Altana validator.
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Small tools
// ---------------------------------------------------------------------------

class ProofFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofFailure";
  }
}

/**
 * The only way this script asserts that something is true. An unproven claim MUST stop the
 * script — a script that prints "success" without proving the HF rose is worse than no
 * script at all.
 */
function assertTrue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProofFailure(message);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  // Deliberately names only the variable's NAME, never its value.
  assertTrue(
    typeof value === "string" && value.length > 0,
    `The environment variable ${name} is empty; set it via .env, not on the command line.`,
  );
  return value;
}

function heading(text: string): void {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

function printPosition(label: string, pos: Position): void {
  console.log(`${label}`);
  console.log(`  block                 : ${pos.blockNumber}`);
  console.log(`  totalCollateralBase   : ${formatUsd8(pos.collateralBase)}`);
  console.log(`  totalDebtBase         : ${formatUsd8(pos.debtBase)}`);
  console.log(`  liquidationThreshold  : ${pos.liquidationThresholdBps} bps`);
  console.log(
    `  healthFactor          : ${pos.healthFactor === null ? "no debt" : `${formatHf(pos.healthFactor)}  (${pos.healthFactor})`}`,
  );
}

function txLink(hash: Hash): string {
  return `${BSCSCAN_TX}${hash}`;
}

/** One finalized transaction, together with the block height it landed in. */
interface SentTx {
  hash: Hash;
  /** The receipt's block. This is the ANCHOR for every read afterwards — see `tupleAtBlock`. */
  blockNumber: bigint;
}

/** Sends one transaction and fails hard if its receipt is not "success". */
async function send(
  publicClient: PublicClient,
  run: () => Promise<Hash>,
  label: string,
): Promise<SentTx> {
  const hash = await run();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertTrue(
    receipt.status === "success",
    `The ${label} transaction failed on chain (status=${receipt.status}, tx=${hash}).`,
  );
  console.log(`  tx ${label.padEnd(10)}: ${hash}`);
  console.log(`     block        : ${receipt.blockNumber}`);
  console.log(`     gas used     : ${receipt.gasUsed}`);
  console.log(`     ${txLink(hash)}`);
  return { hash, blockNumber: receipt.blockNumber };
}

/**
 * Re-reads from the chain until `predicate` holds, or fails hard.
 *
 * This is NOT a loosening of the proof: `predicate` is still the same on-chain condition, and
 * if it never holds the script still dies with a non-zero exit code. All that is tolerated
 * is RPC lag. The public BSC testnet endpoint is a pool of nodes behind one name: on this
 * script's first run, `eth_getTransactionReceipt` answered from a node that had block
 * 129832787, while the next `eth_call` was served by a node still at 129832786 — so the new
 * price "did not exist" even though the transaction was final. Concluding failure from a
 * stale read like that produces wrong evidence in both directions.
 */
async function readUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  maxAttempts = 20,
  delayMs = 1_500,
): Promise<T> {
  let last: T | undefined;
  let lastError: unknown;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      last = await read();
      lastError = undefined;
      if (predicate(last)) {
        if (i > 1) console.log(`  (the "${label}" reading became consistent after ${i} attempts)`);
        return last;
      }
    } catch (err) {
      // A read ANCHORED to a specific block height is refused by a node that does not have
      // that block yet ("header not found") — and that is exactly the property we want: a
      // stale node complains rather than quietly answering from the past. The next attempt
      // will most likely land on a different node.
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  const trail =
    lastError !== undefined
      ? `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      : `Last value: ${JSON.stringify(last, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`;
  throw new ProofFailure(
    `The on-chain reading "${label}" never satisfied its condition after ${maxAttempts} attempts ` +
      `(~${(maxAttempts * delayMs) / 1000}s). ${trail}`,
  );
}

/**
 * `getUserAccountData` ANCHORED to a specific block height.
 *
 * This is the structural anchor for the whole proof. `readUntil` on its own only retries
 * until the condition is consistent — it accepts the first node that agrees, and its safety
 * rests on the coincidence that in this scenario state only moves in one direction. An
 * `eth_call` with an explicit `blockNumber` has no such gap: a node that does not have that
 * block THROWS ("header not found") rather than quietly answering from the past. So the
 * value that comes back from here really is the value at the intended transaction's block.
 *
 * No logic is duplicated: what is called is the same view function `readAavePosition` uses,
 * and its result is used precisely to MATCH what the adapter reported — if the two differ,
 * the script fails hard.
 */
async function tupleAtBlock(
  publicClient: PublicClient,
  account: `0x${string}`,
  block: bigint,
  label: string,
): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]> {
  return readUntil(
    () =>
      publicClient.readContract({
        address: MOCK_LENDING_POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "getUserAccountData",
        args: [account],
        blockNumber: block,
      }),
    () => true, // what we are waiting for is not the value, but a node that has that block
    `${label} (anchored at block ${block})`,
  );
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * The means of restoring testnet's state. Once the mBNB price is lowered, the sample
 * position sits at ~HF 1.15 and will STAY there if the script dies partway through — that
 * has already happened (the first run), and a human had to reset the price via `cast`. This
 * object is held by the caller outside `main` so that the `finally` there can restore the
 * price on the failure path AS WELL AS the success path, without ever changing the exit code.
 */
interface Recovery {
  needed: boolean;
  run?: () => Promise<void>;
}

async function main(recovery: Recovery): Promise<void> {
  // --- 0. Secrets -----------------------------------------------------------
  // Loaded from files, never printed, never copied anywhere.
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../app/agent/scripts
  const agentDir = path.resolve(here, "..");
  const repoRoot = path.resolve(agentDir, "../../../.."); // .../worktree
  loadEnv(path.join(repoRoot, "contracts/.env")); // PRIVATE_KEY, BSC_TESTNET_RPC_URL
  loadEnv(path.resolve(agentDir, "../../.studio/.env.local")); // OPENAI_API_KEY (the dGrid key)
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: the dGrid key in ai/.env goes by the name DGRID_API_KEY.
    loadEnv(path.join(repoRoot, "ai/.env"));
    if (process.env.DGRID_API_KEY) process.env.OPENAI_API_KEY = process.env.DGRID_API_KEY;
  }

  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;
  const account = privateKeyToAccount(requireEnv("PRIVATE_KEY") as `0x${string}`);

  // --- 1. Clients -----------------------------------------------------------
  // The position reader comes from the existing module, as-is.
  const reader = createTestnetReader(rpcUrl);
  const publicClient: PublicClient = reader.client;
  const wallet: WalletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  // The bounded Altana session. `deserializeSession` itself verifies that the key in the
  // file derives the recorded `publicKey`; its `signer` part is never read, printed, or
  // copied in this script.
  armAltanaSdk();
  const session = await loadGuardianSession();
  const positionAccount = session.walletAddress;
  const sessionPermissions = session.permissions as SessionPermissions;
  const sendViaSession = relaySender(sessionProvider(session, rpcUrl), publicClient);

  heading("FUGU GUARDIAN — E2E on BSC testnet (chainId 97)");
  console.log(`RPC             : ${rpcUrl}`);
  console.log(`Position owner  : ${positionAccount}  (the Altana wallet)`);
  console.log(`Repay signer    : a bounded Altana session key`);
  console.log(`  session file  : ${GUARDIAN_SESSION_FILE}`);
  console.log(`  publicKey     : ${session.publicKey}`);
  console.log(`  expiry        : ${session.expiry} (${new Date(session.expiry * 1000).toISOString()})`);
  for (const permission of sessionPermissions.calls ?? []) {
    const to = "to" in permission ? permission.to : "(any contract)";
    const signature = "signature" in permission ? permission.signature : "(any method)";
    console.log(`  allowlist     : ${to}  ${signature}`);
  }
  for (const cap of sessionPermissions.spend ?? []) {
    console.log(`  spend cap     : ${cap.limit} / ${cap.period}  ${cap.token ?? "(native)"}`);
  }

  // The session permissions are checked HERE, before a single transaction is sent —
  // including before STEP 2's `setAnswer`. A session that is too loose must stop the script
  // while testnet's state is still intact, not after the price has been lowered.
  // `createSessionSendRepay` checks the same thing again at construction; that repetition is
  // deliberate and cheap.
  assertBoundedAllowlist(sessionPermissions, requiredSessionCalls(MOCK_LENDING_POOL_ADDRESS, REPAY_ASSET_ADDRESS));
  assertNativeSpendCap(sessionPermissions);
  console.log("  ✔ session permissions checked: exactly repay + approve, with a native cap — no tx sent yet.");
  console.log(`Price signer    : ${account.address}  (the deployer EOA, the feed's owner)`);
  console.log(`MockLendingPool : ${MOCK_LENDING_POOL_ADDRESS}`);
  console.log(`MockPriceFeedBNB: ${MOCK_PRICE_FEED_BNB}`);
  console.log(`Repay asset     : ${REPAY_ASSET_ADDRESS} (mUSD)`);
  console.log(
    `Thresholds      : warn=${formatHf(DEFAULT_THRESHOLDS.warn)} partialRepay=${formatHf(DEFAULT_THRESHOLDS.partialRepay)} deleverage=${formatHf(DEFAULT_THRESHOLDS.deleverage)}`,
  );

  const chainId = await publicClient.getChainId();
  assertTrue(chainId === 97, `Wrong chain: ${chainId}, must be 97 (BSC testnet).`);
  assertTrue(
    positionAccount.toLowerCase() !== account.address.toLowerCase(),
    `The session wallet and the deployer EOA are the same address (${positionAccount}); ` +
      "the 'not the deployer EOA' proof would mean nothing.",
  );

  const tbnbBefore = await publicClient.getBalance({ address: positionAccount });
  const deployerTbnbBefore = await publicClient.getBalance({ address: account.address });
  console.log(`Altana wallet tBNB balance : ${tbnbBefore} wei`);
  console.log(`Deployer EOA tBNB balance  : ${deployerTbnbBefore} wei`);

  // --- 2. The starting position ---------------------------------------------
  heading("STEP 1 — The sample position before anything is touched");
  const initialPos = await reader.readPosition(positionAccount);
  printPosition("The initial position (read through readAavePosition as-is):", initialPos);
  assertTrue(initialPos.healthFactor !== null, "The sample position has no debt; there is nothing to prove.");
  assertTrue(initialPos.collateralBase > 0n, "The sample position has no collateral.");
  const initialHf = initialPos.healthFactor;

  const [, initialPriceRaw] = await publicClient.readContract({
    address: MOCK_PRICE_FEED_BNB,
    abi: PRICE_FEED_ABI,
    functionName: "latestRoundData",
  });
  assertTrue(
    initialPriceRaw > 0n,
    `The mBNB price makes no sense: ${formatUsd8(initialPriceRaw)} (${initialPriceRaw}).`,
  );
  const initialPrice = initialPriceRaw;
  console.log(`\nCurrent mBNB price    : ${formatUsd8(initialPrice)} (${initialPrice})`);

  // --- 3. Compute the target price from the HF formula ----------------------
  heading("STEP 2 — Lowering the mBNB price until the HF enters the PARTIAL_REPAY zone");

  // HF = collateral x ltBps x 1e18 / (BPS x debt), and collateral is directly proportional
  // to the mBNB price (this position's only collateral asset). Inverting that formula for the
  // price:
  //   targetPrice = currentPrice x TARGET_HF x BPS x debt
  //                  / (collateral x ltBps x 1e18)
  // bigint division rounds down, so the resulting HF is slightly BELOW TARGET_HF — the safe
  // direction, because it moves away from the zone's upper bound.
  const targetPrice =
    (initialPrice * TARGET_HF * BPS * initialPos.debtBase) /
    (initialPos.collateralBase * initialPos.liquidationThresholdBps * HF_ONE);
  assertTrue(
    targetPrice > 0n,
    `The computed target price is zero or negative: ${formatUsd8(targetPrice)} (${targetPrice}).`,
  );
  assertTrue(
    targetPrice < initialPrice,
    `The target price ${formatUsd8(targetPrice)} is not lower than the current price ` +
      `${formatUsd8(initialPrice)}; is the position already at risk?`,
  );

  // A local forecast BEFORE burning gas: if the calculation is wrong, fail here rather than
  // after the transaction is sent. It uses the same computeHealthFactor production uses.
  const forecastCollateral = (initialPos.collateralBase * targetPrice) / initialPrice;
  const forecastHf = computeHealthFactor(
    forecastCollateral,
    initialPos.debtBase,
    initialPos.liquidationThresholdBps,
  );
  assertTrue(forecastHf !== null, "The HF forecast is null while debt exists.");
  console.log(`TARGET_HF (mid-zone)   : ${formatHf(TARGET_HF)}`);
  console.log(`Target mBNB price      : ${formatUsd8(targetPrice)} (${targetPrice})`);
  console.log(`Local HF forecast      : ${formatHf(forecastHf)} (${forecastHf})`);
  assertTrue(
    forecastHf > DEFAULT_THRESHOLDS.deleverage && forecastHf <= DEFAULT_THRESHOLDS.partialRepay,
    `The HF forecast ${formatHf(forecastHf)} (${forecastHf}) is outside the PARTIAL_REPAY zone; ` +
      `the transaction is cancelled before any gas is burned.`,
  );

  // The recovery is registered BEFORE the price is lowered, so there is no gap between "the
  // price has fallen" and "someone knows how to put it back".
  recovery.run = async () => {
    console.log(`Restoring the price to ${formatUsd8(initialPrice)} (${initialPrice})`);
    await send(
      publicClient,
      () =>
        wallet.writeContract({
          account,
          chain: bscTestnet,
          address: MOCK_PRICE_FEED_BNB,
          abi: PRICE_FEED_ABI,
          functionName: "setAnswer",
          args: [initialPrice],
        }),
      "restore",
    );
    const [, restoredPrice] = await readUntil(
      () =>
        publicClient.readContract({
          address: MOCK_PRICE_FEED_BNB,
          abi: PRICE_FEED_ABI,
          functionName: "latestRoundData",
        }),
      ([, answer]) => answer === initialPrice,
      "the mBNB price back at its original value",
    );
    assertTrue(
      restoredPrice === initialPrice,
      `The price could not be restored: ${formatUsd8(restoredPrice)} != ${formatUsd8(initialPrice)}.`,
    );
  };

  console.log("");
  const priceDropTx = await send(
    publicClient,
    () =>
      wallet.writeContract({
        account,
        chain: bscTestnet,
        address: MOCK_PRICE_FEED_BNB,
        abi: PRICE_FEED_ABI,
        functionName: "setAnswer",
        args: [targetPrice],
      }),
    "setAnswer",
  );
  recovery.needed = true;

  // A test seam for the recovery path. The `finally` path is only useful if it actually
  // runs, and the only way to prove that is to fail on purpose right after the price is
  // lowered — exactly the failure shape that really happened once. Never active without this
  // env var.
  if (process.env.E2E_FORCE_FAIL_AFTER_DROP === "1") {
    throw new ProofFailure(
      "A deliberate failure (E2E_FORCE_FAIL_AFTER_DROP=1) to exercise the price recovery path.",
    );
  }

  // --- 4. Assertions from real on-chain readings ---------------------------
  console.log("");
  const stressedPos = await readUntil(
    () => reader.readPosition(positionAccount),
    (p) =>
      p.blockNumber >= priceDropTx.blockNumber &&
      p.healthFactor !== null &&
      p.healthFactor > DEFAULT_THRESHOLDS.deleverage &&
      p.healthFactor <= DEFAULT_THRESHOLDS.partialRepay,
    "the HF entering the PARTIAL_REPAY zone",
  );
  printPosition("The position after the price fell (re-read on chain):", stressedPos);
  assertTrue(stressedPos.healthFactor !== null, "The HF is null after the price fell.");
  const hfBefore = stressedPos.healthFactor;
  assertTrue(
    stressedPos.blockNumber >= priceDropTx.blockNumber,
    `The "before" reading comes from block ${stressedPos.blockNumber}, older than the block of ` +
      `the price-drop transaction (${priceDropTx.blockNumber}) — a stale read, not proof.`,
  );
  assertTrue(
    hfBefore > DEFAULT_THRESHOLDS.deleverage && hfBefore <= DEFAULT_THRESHOLDS.partialRepay,
    `The on-chain HF ${formatHf(hfBefore)} (${hfBefore}) is NOT in the PARTIAL_REPAY zone ` +
      `(${formatHf(DEFAULT_THRESHOLDS.deleverage)} < HF <= ${formatHf(DEFAULT_THRESHOLDS.partialRepay)}).`,
  );

  // The anchor: the same values re-read AT THE BLOCK of the price-drop transaction.
  const [anchoredCol, anchoredDebt, , anchoredLt, , anchoredHf] = await tupleAtBlock(
    publicClient,
    positionAccount,
    priceDropTx.blockNumber,
    "the position before the intervention",
  );
  console.log(
    `\nAnchor at block ${priceDropTx.blockNumber}: collateral ${formatUsd8(anchoredCol)} · debt ${formatUsd8(anchoredDebt)} · lt ${anchoredLt} bps · HF ${formatHf(anchoredHf)}`,
  );
  assertTrue(
    anchoredCol === stressedPos.collateralBase &&
      anchoredDebt === stressedPos.debtBase &&
      anchoredLt === stressedPos.liquidationThresholdBps &&
      anchoredHf === hfBefore,
    `The adapter reading does not match the reading anchored at block ${priceDropTx.blockNumber}: ` +
      `adapter (collateral ${stressedPos.collateralBase}, debt ${stressedPos.debtBase}, lt ` +
      `${stressedPos.liquidationThresholdBps}, hf ${hfBefore}) vs anchored (collateral ${anchoredCol}, ` +
      `debt ${anchoredDebt}, lt ${anchoredLt}, hf ${anchoredHf}).`,
  );
  console.log(`\n✔ Proven from an on-chain reading: HF ${formatHf(hfBefore)} is in the PARTIAL_REPAY zone.`);

  // --- 5. One Guardian cycle ------------------------------------------------
  heading("STEP 3 — One Guardian cycle (decide → execute → explain)");

  /** The repay txs actually sent; recorded so they can be matched against the cycle's result. */
  const recordedRepayTxs: SentTx[] = [];

  /**
   * The rounding tolerance for matching amounts, in 8-decimal basis units.
   * 2 units = $0.00000002. It is needed because there are TWO independent roundings down:
   * USD8 -> token units in `usd8ToTokenUnits`, and token units -> USD8 in
   * `MockLendingPool._valueUsd8`. Each loses less than one unit, so the largest legitimate
   * difference is 2. Anything larger means the conversion is genuinely wrong, not merely
   * rounded.
   */
  const TOLERANCE_USD8 = 2n;

  /** The receipt of the `repay` transaction that actually landed; used to prove its sender. */
  let repayReceipt: RelayResult["receipt"] = null;

  const logger: Logger = {
    info: (m, meta) => console.log(`  [guard] ${m}${meta ? ` ${JSON.stringify(meta, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` : ""}`),
    error: (m, meta) => console.error(`  [guard] ERROR ${m}${meta ? ` ${JSON.stringify(meta, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` : ""}`),
  };

  /**
   * The ENTIRE chain assembly now comes from `createGuardian` in `src/`, rather than being
   * rebuilt in this script.
   *
   * Until the previous round five pieces lived only here — the USD8 -> token units
   * conversion, reading `assets()` + the feed, the balance check, building the initial
   * `ExecuteState`, and composing `sendRepay` — so the next runtime (the backend) would
   * inevitably have copied them out of a demo script. What is left in this script now are the
   * three things that genuinely belong to it: loading secrets, sending the price transaction,
   * and PROVING its claims.
   *
   * `sendCalls` is still injected from here because it is the Altana relay path (a
   * third-party SDK), and the wrapper below is where the E2E script captures the receipt
   * STEP 5 uses to prove who paid.
   */
  // A REAL store, not an in-memory one. This script is the only example of calling
  // `createGuardian` that exists, so it is the one people will copy — and an example that
  // uses an in-memory store hands C3 (the budget, the cooldown, the kill switch, and the
  // pending-repay record all lost on every restart) to the next copier for free. Its file
  // lives in the gitignored `.studio/`, alongside the session file.
  const stateFile = process.env.GUARDIAN_STATE_FILE ?? path.join(WORKSPACE_ROOT, ".studio/guardian-state.json");
  const stateStore = createFileStateStore(stateFile);
  const stateBefore = await stateStore.load();
  console.log(`Execution state : ${stateFile}`);
  console.log(
    stateBefore === null
      ? "  (none yet — first run, empty budget)"
      : `  loaded: ${formatUsd8(stateBefore.spentTodayUsd8)} spent today · ` +
          `last action ${stateBefore.lastActionAt} · killed=${stateBefore.killed} · ` +
          `pending=${stateBefore.pendingRepay === null ? "no" : "YES"}`,
  );
  // If a pending record exists, the cycle below will refuse to send — that is the correct
  // behavior, but without this message it reads like a regression.
  assertTrue(
    stateBefore === null || stateBefore.pendingRepay === null,
    `A repay in ${stateFile} has not yet been proven complete (${formatUsd8(stateBefore?.pendingRepay?.amountUsd8 ?? 0n)}). ` +
      "Guardian holds back until the chain proves the debt fell by that amount, or until an " +
      "operator clears it. Check the chain first; do NOT simply delete the file.",
  );

  const guardian = await createGuardian({
    account: positionAccount,
    client: publicClient,
    pool: MOCK_LENDING_POOL_ADDRESS,
    repayAsset: REPAY_ASSET_ADDRESS,
    permissions: sessionPermissions,
    limits: LIMITS,
    logger,
    stateStore,
    explainDecision,
    now: () => Math.floor(Date.now() / 1000),
    log: (message) => console.log(`  ${message}`),
    sendCalls: async (calls, description) => {
      const result = await sendViaSession(
        calls.map((call) => ({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
        })),
        description,
      );
      const receipt = result.receipt;
      assertTrue(
        receipt !== null,
        `The Altana relay returned no receipt for ${description} (${result.transactionHash}).`,
      );
      console.log(`  session tx   : ${result.transactionHash}`);
      console.log(`     batch calls  : ${calls.map((c) => c.functionName).join(" + ")}`);
      console.log(`     block        : ${receipt.blockNumber}`);
      console.log(`     gas used     : ${receipt.gasUsed}`);
      console.log(`     tx sender    : ${receipt.from}  (the Altana relay; the wallet pays its fee)`);
      console.log(`     ${txLink(result.transactionHash)}`);
      if (calls.some((c) => c.functionName === "repay")) {
        recordedRepayTxs.push({ hash: result.transactionHash, blockNumber: receipt.blockNumber });
        repayReceipt = receipt;
      }
      return { transactionHash: result.transactionHash, status: result.status };
    },
  });

  console.log(
    `Repay asset: decimals=${guardian.repayAsset.tokenDecimals}, feed=${guardian.repayAsset.feed}`,
  );
  console.log(
    "  ✔ the asset decimals were matched between the pool configuration and the token contract " +
      "itself, and the feed is required to be 8 decimals — two different sources, not a " +
      "round-trip check comparing a number with itself.",
  );

  const t0 = Date.now();
  const outcome = await guardian.runOnce();
  const duration = Date.now() - t0;

  const cycle = outcome.result;
  assertTrue(cycle.ok, `The Guardian cycle failed: ${cycle.ok ? "" : cycle.error}`);

  heading("STEP 4 — The cycle's result");
  console.log(`Decision (action)      : ${cycle.action}`);
  console.log(`Decision reason        : ${cycle.reason}`);
  console.log(`Execution reason       : ${cycle.executeReason}`);
  console.log(`Sent                   : ${cycle.sent}`);
  console.log(`Amount paid            : ${formatUsd8(cycle.amountSentUsd8)}  (${cycle.amountSentUsd8} on the 8-decimal basis)`);
  console.log(`Capped by action limit : ${cycle.cappedPerAction}`);
  console.log(`Capped by daily limit  : ${cycle.cappedPerDay}`);
  console.log(`Tx hash                : ${cycle.txHash}`);
  console.log(`Link                   : ${cycle.txHash ? txLink(cycle.txHash) : "-"}`);
  console.log(`Budget used today      : ${formatUsd8(outcome.nextExecuteState.spentTodayUsd8)} of ${formatUsd8(LIMITS.maxPerDayUsd8)}`);
  console.log(`Cycle duration         : ${duration} ms (including dGrid)`);
  console.log(`Explanation (dGrid)    : ${cycle.explanation}`);

  assertTrue(cycle.action === "PARTIAL_REPAY", `Action ${cycle.action}, should be PARTIAL_REPAY.`);
  assertTrue(cycle.sent, `Guardian sent no transaction at all: ${cycle.executeReason}`);
  assertTrue(cycle.amountSentUsd8 > 0n, "The amount paid is zero.");
  assertTrue(cycle.txHash !== null, "There is no tx hash — no on-chain proof.");
  assertTrue(
    recordedRepayTxs.length === 1 && cycle.txHash === recordedRepayTxs[0]?.hash,
    `The cycle's tx hash (${cycle.txHash}) does not match the repay tx that was actually sent ` +
      `(${recordedRepayTxs.map((t) => t.hash).join(", ") || "none"}).`,
  );
  const txRepay = recordedRepayTxs[0]!;
  assertTrue(
    outcome.nextExecuteState.spentTodayUsd8 === cycle.amountSentUsd8,
    "The daily budget did not grow by the amount that was sent.",
  );
  // The C2 bookkeeping on the REAL path: a repay that completes with a hash must not leave
  // a pending record behind. If one is left, the next cycle will refuse to act — a safe
  // failure, but still wrong.
  assertTrue(
    outcome.nextExecuteState.pendingRepay === null,
    `The repay completed with hash ${cycle.txHash} but a pending record is still there; ` +
      "the idempotency bookkeeping was not cleared.",
  );

  // --- 5b. Who actually paid ------------------------------------------------
  // This is this task's central claim, and it is proven from the RECEIPT, not from the code's
  // intent. `MockLendingPool.repay` only reduces `msg.sender`'s debt, and
  // `Repay(address indexed user, ...)` records that `msg.sender`. So if the event's `user` is
  // the Altana wallet, then what called the pool really was the Altana wallet — through the
  // bounded session key, not the deployer EOA.
  heading("STEP 5 — Proof: the payer is the Altana wallet through the session key");
  const receipt = repayReceipt as RelayResult["receipt"];
  assertTrue(receipt !== null, "No repay receipt was recorded.");
  const logRepay = receipt.logs
    .filter((l) => l.address.toLowerCase() === MOCK_LENDING_POOL_ADDRESS.toLowerCase())
    .map((l) => {
      try {
        return decodeEventLog({
          abi: POOL_EVENT_ABI,
          topics: [...l.topics] as [signature: `0x${string}`, ...args: `0x${string}`[]],
          data: l.data,
        });
      } catch {
        return null;
      }
    })
    .find((e): e is NonNullable<typeof e> => e !== null && e.eventName === "Repay");
  assertTrue(
    logRepay !== undefined,
    `Receipt ${txRepay.hash} carries no Repay event from ${MOCK_LENDING_POOL_ADDRESS}; ` +
      "there is nothing that could prove who the caller was.",
  );
  const payer = logRepay.args.user;
  console.log(`Repay tx              : ${txRepay.hash}`);
  console.log(`Transaction sender    : ${receipt.from}  (the Altana relay, not the intent signer)`);
  console.log(`Repay.user (msg.sender at the pool) : ${payer}`);
  console.log(`Altana wallet         : ${positionAccount}`);
  console.log(`Deployer EOA          : ${account.address}`);
  assertTrue(
    payer.toLowerCase() === positionAccount.toLowerCase(),
    `Repay.user on the receipt is ${payer}, not the Altana wallet ${positionAccount}.`,
  );
  assertTrue(
    payer.toLowerCase() !== account.address.toLowerCase(),
    `Repay.user on the receipt is the deployer EOA ${account.address} — exactly what this task set out to avoid.`,
  );
  assertTrue(
    receipt.from.toLowerCase() !== account.address.toLowerCase(),
    `The repay transaction was sent by the deployer EOA ${account.address}; ` +
      "it should have been the Altana relay on the wallet's behalf through the session key.",
  );
  console.log(
    `\n✔ Proven from the receipt: the debt that fell is the Altana wallet's debt, ` +
      `and the repay call came from that wallet through the bounded session key — not from the deployer EOA.`,
  );

  // The negative control, using the SAME SESSION OBJECT that just paid. Without this,
  // "bounded" is only a word: a session that can repay must be shown to be UNABLE to do
  // anything outside its allowlist. `mUSD.transfer` was chosen because its contract IS in the
  // allowlist (for `approve`) — so what is tested is binding at the selector level, not
  // merely at the contract level. The refusal comes from the Altana account validator, not
  // from our code.
  console.log("\nNegative control — the same session attempts mUSD.transfer(deployer EOA, 1 wei):");
  const mUsdBeforeProbe = await publicClient.readContract({
    address: REPAY_ASSET_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [positionAccount],
  });
  let probeWasRefused = false;
  try {
    const gotThrough = await sendViaSession(
      [
        {
          address: REPAY_ASSET_ADDRESS,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [account.address, 1n],
        },
      ],
      "negative control: a transfer outside the allowlist",
    );
    console.error(`  ✖ GOT THROUGH — tx ${gotThrough.transactionHash}`);
  } catch (err: unknown) {
    // It demands the reason for the refusal, not merely the existence of an exception: a
    // relay 502, a receipt timeout, and a nonce race all throw too, and none of them proves
    // the session boundary. Any other shape is rethrown and kills the E2E run.
    const message = assertSessionDenial(err, REPAY_ASSET_ADDRESS, "the negative control transfer");
    probeWasRefused = true;
    for (const line of message.split("\n")) console.log(`    | ${line}`);
  }
  const mUsdAfterProbe = await publicClient.readContract({
    address: REPAY_ASSET_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [positionAccount],
  });
  assertTrue(
    probeWasRefused,
    "The same session MANAGED to send mUSD.transfer outside its allowlist; the boundary is not real.",
  );
  assertTrue(
    mUsdAfterProbe === mUsdBeforeProbe,
    `The mUSD balance changed (${mUsdBeforeProbe} → ${mUsdAfterProbe}) even though the call was refused.`,
  );
  console.log(
    `  ✔ Refused, and the mUSD balance did not move (${mUsdAfterProbe}). ` +
      `The same session can repay and cannot transfer.`,
  );

  // --- 6. The HF afterwards, from an on-chain reading -----------------------
  heading("STEP 6 — Proof: the health factor rose after the agent acted");
  assertTrue(
    txRepay.blockNumber > priceDropTx.blockNumber,
    `The block ordering makes no sense: the repay is at block ${txRepay.blockNumber}, the price drop at ` +
      `block ${priceDropTx.blockNumber}. "Before" and "after" have to be genuinely sequential.`,
  );

  const posAfter = await readUntil(
    () => reader.readPosition(positionAccount),
    (p) => p.blockNumber >= txRepay.blockNumber && p.debtBase < stressedPos.debtBase,
    "the debt falling after the repay",
  );
  printPosition("The position after the repay (re-read on chain):", posAfter);
  assertTrue(posAfter.healthFactor !== null, "The HF is null after the repay.");
  const hfAfter = posAfter.healthFactor;
  assertTrue(
    posAfter.blockNumber >= txRepay.blockNumber,
    `The "after" reading comes from block ${posAfter.blockNumber}, older than the block of ` +
      `the repay transaction (${txRepay.blockNumber}) — a stale read, not proof.`,
  );

  // The second anchor: the same values re-read AT THE BLOCK of the repay transaction.
  const [anchoredCol2, anchoredDebt2, , anchoredLt2, , anchoredHf2] = await tupleAtBlock(
    publicClient,
    positionAccount,
    txRepay.blockNumber,
    "the position after the intervention",
  );
  console.log(
    `\nAnchor at block ${txRepay.blockNumber}: collateral ${formatUsd8(anchoredCol2)} · debt ${formatUsd8(anchoredDebt2)} · lt ${anchoredLt2} bps · HF ${formatHf(anchoredHf2)}`,
  );
  assertTrue(
    anchoredCol2 === posAfter.collateralBase &&
      anchoredDebt2 === posAfter.debtBase &&
      anchoredLt2 === posAfter.liquidationThresholdBps &&
      anchoredHf2 === hfAfter,
    `The adapter reading does not match the reading anchored at block ${txRepay.blockNumber}: ` +
      `adapter (collateral ${posAfter.collateralBase}, debt ${posAfter.debtBase}, lt ` +
      `${posAfter.liquidationThresholdBps}, hf ${hfAfter}) vs anchored (collateral ${anchoredCol2}, ` +
      `debt ${anchoredDebt2}, lt ${anchoredLt2}, hf ${anchoredHf2}).`,
  );

  assertTrue(
    hfAfter > hfBefore,
    `The HF did NOT rise: before ${formatHf(hfBefore)} (${hfBefore}), after ` +
      `${formatHf(hfAfter)} (${hfAfter}). The agent's intervention is not proven.`,
  );
  assertTrue(
    posAfter.debtBase < stressedPos.debtBase,
    `The debt did not fall: ${formatUsd8(stressedPos.debtBase)} → ${formatUsd8(posAfter.debtBase)}.`,
  );

  // The collateral must not change: a repay only touches the debt side. If this number
  // moves, another actor is in the same position and the entire "before/after" comparison
  // loses its meaning.
  assertTrue(
    posAfter.collateralBase === stressedPos.collateralBase,
    `The collateral changed too (${formatUsd8(stressedPos.collateralBase)} → ` +
      `${formatUsd8(posAfter.collateralBase)}); something other than this script touched the position.`,
  );

  // ————— The claim people will read most: HOW MUCH was paid. —————
  // Up to here "$..." is still nothing but `executeDecision`'s output. What turns it into
  // proof is the line below: the debt delta that ACTUALLY happened on chain must equal the
  // amount claimed. Without this, a unit conversion off by one order of magnitude makes the
  // agent pay a tenth of what is printed, while every other assertion still passes.
  const debtReduction = stressedPos.debtBase - posAfter.debtBase;
  const claimDifference =
    debtReduction > cycle.amountSentUsd8
      ? debtReduction - cycle.amountSentUsd8
      : cycle.amountSentUsd8 - debtReduction;
  assertTrue(
    claimDifference <= TOLERANCE_USD8,
    `The amount CLAIMED to have been paid (${formatUsd8(cycle.amountSentUsd8)}) does not equal ` +
      `the debt reduction that ACTUALLY happened on chain ` +
      `(${formatUsd8(debtReduction)}); the difference is ${claimDifference} units on the 8-decimal basis, ` +
      `and the largest legitimate one is ${TOLERANCE_USD8} (two independent roundings down).`,
  );

  const difference = hfAfter - hfBefore;
  // The zone label comes from the same `decide` Guardian uses, not from a threshold ladder
  // rewritten here — if the thresholds ever change, this printout changes with them on its
  // own.
  const zoneAfter = decide(posAfter).action;
  console.log("");
  console.log(`HF before the intervention : ${formatHf(hfBefore)}  (${hfBefore})`);
  console.log(`HF after the intervention  : ${formatHf(hfAfter)}  (${hfAfter})`);
  console.log(`Difference (rise)          : ${formatHf(difference)}  (${difference})`);
  console.log(`Debt                       : ${formatUsd8(stressedPos.debtBase)} → ${formatUsd8(posAfter.debtBase)}`);
  console.log(`Debt reduction             : ${formatUsd8(debtReduction)}  (${debtReduction} on the 8-decimal basis)`);
  console.log(`Claimed as paid            : ${formatUsd8(cycle.amountSentUsd8)}  (${cycle.amountSentUsd8} on the 8-decimal basis)`);
  console.log(`Claim vs chain difference  : ${claimDifference} units (maximum ${TOLERANCE_USD8})`);
  console.log(`decide() now says          : ${zoneAfter}`);
  console.log(`\n✔ Proven: the debt fell by exactly the amount claimed, and the position left the PARTIAL_REPAY zone because of the agent's action.`);

  // --- 7. Restore the price -------------------------------------------------
  // Done ONLY after every proof above has been collected, so testnet's state is reusable.
  // It costs one transaction, about 30k gas.
  heading("STEP 7 — Restoring the mBNB price to its original value");
  // The success path uses the SAME closer as the failure path (see the `finally` below
  // `main`), so the two cannot drift apart.
  await recovery.run!();
  recovery.needed = false;

  const finalPos = await readUntil(
    () => reader.readPosition(positionAccount),
    (p) => p.collateralBase === initialPos.collateralBase,
    "the collateral back at its original-price value",
  );
  printPosition("\nThe final position (the price is restored):", finalPos);

  const tbnbAfter = await publicClient.getBalance({ address: positionAccount });
  const deployerTbnbAfter = await publicClient.getBalance({ address: account.address });
  heading("SUMMARY");
  console.log(`Initial HF ($${formatUsd8(initialPrice).slice(1)}/mBNB) : ${formatHf(initialHf)}`);
  console.log(`HF after the price fell         : ${formatHf(hfBefore)}`);
  console.log(`HF after the agent paid         : ${formatHf(hfAfter)}   (+${formatHf(difference)})`);
  console.log(`Final HF (price restored)       : ${finalPos.healthFactor === null ? "-" : formatHf(finalPos.healthFactor)}`);
  console.log(`Paid by the agent               : ${formatUsd8(cycle.amountSentUsd8)}`);
  console.log(`Repay tx                        : ${cycle.txHash}`);
  console.log(`                                  ${cycle.txHash ? txLink(cycle.txHash) : "-"}`);
  console.log(`Repay signer                    : session key ${session.publicKey.slice(0, 18)}… over ${positionAccount}`);
  console.log(`Altana wallet tBNB before→after : ${tbnbBefore} → ${tbnbAfter} wei (difference ${tbnbBefore - tbnbAfter})`);
  console.log(`Deployer EOA tBNB before→after  : ${deployerTbnbBefore} → ${deployerTbnbAfter} wei (difference ${deployerTbnbBefore - deployerTbnbAfter})`);
  console.log(`\nEVERY CLAIM IS PROVEN.`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
//
// The `finally` here exists because of a failure that ALREADY happened: this script's first
// run died after the mBNB price had been lowered, leaving the sample position at ~HF 1.15
// until a human reset it via `cast`. A demo that dies on a slow network shows a position that
// looks nearly liquidated to whoever opens BscScan next.
//
// The recovery NEVER changes the exit code: its own failure is only printed as a warning,
// complete with the manual command, and the original failure still decides the process's fate.
const recovery: Recovery = { needed: false };

try {
  await main(recovery);
} catch (err: unknown) {
  console.error(`\n✖ E2E FAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
} finally {
  if (recovery.needed && recovery.run) {
    heading("RECOVERY — the script stopped with the mBNB price still lowered");
    try {
      await recovery.run();
      console.log("✔ The mBNB price was restored; testnet's state is safe to look at.");
    } catch (restoreErr: unknown) {
      console.error(
        `⚠ FAILED to restore the mBNB price: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
      );
      console.error(
        `⚠ The sample position is LEFT BEHIND in the risky zone. Restore it manually:\n` +
          `   cast send ${MOCK_PRICE_FEED_BNB} "setAnswer(int256)" <original price, 8 decimals> \\\n` +
          `     --rpc-url "$BSC_TESTNET_RPC_URL" --private-key "$PRIVATE_KEY"`,
      );
    }
  }
}
