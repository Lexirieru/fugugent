/**
 * Proof that the session key's boundary is REAL, not merely promised by our own code.
 *
 * This script uses the **exact same session** Guardian uses to repay, then attempts two
 * calls that lie OUTSIDE the allowlist:
 *
 *   1. `mUSD.transfer(...)` — the contract is allowlisted (for `approve`), but its selector
 *      is not. This tests binding at the **selector** level.
 *   2. `mBNB.approve(...)` — the selector is allowlisted (for mUSD), but the contract is
 *      not. This tests binding at the **contract** level.
 *
 * Both MUST be refused. If either gets through, the script exits with a non-zero exit code —
 * because it would mean this product's central claim is false.
 *
 * The wallet's mUSD and mBNB balances are read before and after: a genuine refusal moves
 * nothing.
 *
 * Run it from `ai/fuguguardian/app/agent`:
 *   npx tsx scripts/probe-session-boundary.ts
 */
import path from "node:path";
import { loadEnv } from "@bnbagent/studio-runtime/config";
import { createPublicClient, http, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";

import {
  AGENT_ROOT,
  GUARDIAN_SESSION_FILE,
  armAltanaSdk,
  loadGuardianSession,
  relaySender,
  sessionProvider,
  type RelayCall,
} from "./altana.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
  REPAY_ASSET_ADDRESS,
} from "../src/strategy/chain/testnet.js";
import {
  assertBoundedAllowlist,
  assertNativeSpendCap,
  assertSessionDenial,
  requiredSessionCalls,
} from "../src/strategy/chain/session.js";

const MBNB = "0xF380E8B6803aD065EF0567dd20C894a55050737c" as const;
const EOA_DEPLOYER = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;

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
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
] as const;

interface Probe {
  readonly label: string;
  readonly why: string;
  readonly call: RelayCall;
}

async function main(): Promise<void> {
  loadEnv(path.resolve(AGENT_ROOT, "../../../../contracts/.env")); // BSC_TESTNET_RPC_URL
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  }) as PublicClient;
  const chainId = await publicClient.getChainId();
  if (chainId !== 97) throw new Error(`Wrong chain: ${chainId}, must be 97.`);

  armAltanaSdk();
  const session = await loadGuardianSession();
  // The session under test MUST be the same one repay uses: if its allowlist is a different
  // one, the refusals below prove nothing.
  assertBoundedAllowlist(
    session.permissions,
    requiredSessionCalls(MOCK_LENDING_POOL_ADDRESS, REPAY_ASSET_ADDRESS),
  );
  assertNativeSpendCap(session.permissions);

  const wallet = session.walletAddress;
  const send = relaySender(sessionProvider(session, rpcUrl), publicClient);

  console.log("SESSION KEY BOUNDARY TEST — calls outside the allowlist must be refused");
  console.log(`  RPC          : ${rpcUrl}`);
  console.log(`  Wallet       : ${wallet}`);
  console.log(`  Session file : ${GUARDIAN_SESSION_FILE}`);
  console.log(`  publicKey    : ${session.publicKey}`);
  console.log("  Session allowlist (the only calls permitted):");
  for (const c of requiredSessionCalls(MOCK_LENDING_POOL_ADDRESS, REPAY_ASSET_ADDRESS)) {
    console.log(`    - ${c.to}  ${c.signature}`);
  }

  const balanceOf = async (token: `0x${string}`) =>
    publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet],
    });

  const mUsdBefore = await balanceOf(REPAY_ASSET_ADDRESS);
  const mBnbBefore = await balanceOf(MBNB);
  console.log(`\nBalances before: mUSD ${mUsdBefore} · mBNB ${mBnbBefore}`);

  const probes: readonly Probe[] = [
    {
      label: "mUSD.transfer(EOA deployer, 1 wei)",
      why: "the contract is allowlisted for approve, but the transfer selector is NOT",
      call: {
        address: REPAY_ASSET_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [EOA_DEPLOYER, 1n],
      },
    },
    {
      label: "mBNB.approve(pool, 1 wei)",
      why: "the approve selector is allowlisted for mUSD, but the mBNB contract is NOT",
      call: {
        address: MBNB,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MOCK_LENDING_POOL_ADDRESS, 1n],
      },
    },
  ];

  let gotThrough = 0;
  for (const probe of probes) {
    console.log(`\n${"-".repeat(72)}`);
    console.log(`Attempting through the session: ${probe.label}`);
    console.log(`  Why this is out of bounds: ${probe.why}`);
    try {
      const result = await send([probe.call], probe.label);
      gotThrough += 1;
      console.error(
        `  ✖ GOT THROUGH — the session managed to send it (tx ${result.transactionHash}, status ${result.status}). ` +
          "The session boundary is NOT enforced.",
      );
    } catch (err: unknown) {
      // "An exception happened" is NOT proof. A relay answering 502, a timed-out receipt, or
      // a nonce race all throw too — and none of them tests the session boundary.
      // `assertSessionDenial` demands the error really is `UnauthorizedCall` AND names the
      // contract we tried to call; any other shape is rethrown as a test failure rather than
      // accepted as evidence.
      const message = assertSessionDenial(err, probe.call.address, probe.label);
      console.log(`  ✔ REFUSED by the Altana account validator (UnauthorizedCall). The error as-is:`);
      for (const line of message.split("\n")) console.log(`    | ${line}`);
    }
  }

  const mUsdAfter = await balanceOf(REPAY_ASSET_ADDRESS);
  const mBnbAfter = await balanceOf(MBNB);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Balances after: mUSD ${mUsdAfter} · mBNB ${mBnbAfter}`);
  if (mUsdAfter !== mUsdBefore || mBnbAfter !== mBnbBefore) {
    gotThrough += 1;
    console.error("✖ The token balances CHANGED; something really was sent.");
  } else {
    console.log("✔ The token balances did not change at all — nothing was sent.");
  }

  const remaining = await publicClient.getBalance({ address: wallet });
  console.log(`Wallet tBNB balance: ${remaining} wei`);

  if (gotThrough > 0) {
    throw new Error(`${gotThrough} calls outside the allowlist were NOT refused; the session boundary is not proven.`);
  }
  console.log("\n✔ EVERY call outside the allowlist was refused. The session boundary is proven real.");
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\n✖ FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
