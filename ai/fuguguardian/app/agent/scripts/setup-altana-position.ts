/**
 * Opens a sample borrow position **owned by the Altana wallet**, not by the deployer EOA.
 *
 * Why this is needed: `MockLendingPool.repay(address,uint256)` has no `onBehalfOf` — it only
 * reduces `msg.sender`'s debt. The old sample position was owned by the deployer EOA, so the
 * Altana wallet could never repay it. And this is in fact the correct shape for the product:
 * **the position is owned by the user's wallet, and the agent only holds a bounded session
 * key over that wallet**.
 *
 * Setup may use admin authority — what this task proves is the repay, not the setup. So:
 *   - `mBNB.mint` is sent by the deployer EOA (MockToken's mint is open to anyone),
 *   - `approve` + `supply` + `borrow` go through Altana's **admin** path, so their
 *     `msg.sender` is the Altana wallet.
 *
 * Run it from `ai/fuguguardian/app/agent`:
 *   npx tsx scripts/setup-altana-position.ts
 */
import path from "node:path";
import { loadEnv } from "@bnbagent/studio-runtime/config";
import { createPublicClient, createWalletClient, http, type Hash, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { AGENT_ROOT, WORKSPACE_ROOT, adminProvider, armAltanaSdk, relaySender, type RelayCall } from "../src/altana.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
  REPAY_ASSET_ADDRESS,
} from "../src/strategy/chain/testnet.js";
import { formatHf, formatUsd8 } from "../src/strategy/format.js";

const ALTANA_WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const MBNB = "0xF380E8B6803aD065EF0567dd20C894a55050737c" as const;

/** Collateral: 0.2 mBNB (= $150 at $750/mBNB). Deliberately small — this is a demo, not funds. */
const COLLATERAL_UNITS = 2n * 10n ** 17n;

/** Debt: 50 mUSD -> HF 2.25 at a price of $750. Safe, and it falls into the PARTIAL_REPAY zone when the price drops. */
const DEBT_UNITS = 50n * 10n ** 18n;

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
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
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

const POOL_ABI = [
  {
    type: "function",
    name: "supply",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
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
] as const;

function assertTrue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  loadEnv(path.join(WORKSPACE_ROOT, ".studio/.env.local")); // WALLET_PASSWORD
  loadEnv(path.resolve(AGENT_ROOT, "../../../../contracts/.env")); // PRIVATE_KEY, BSC_TESTNET_RPC_URL

  const password = process.env.WALLET_PASSWORD;
  assertTrue(!!password, "WALLET_PASSWORD is empty; set it via .studio/.env.local.");
  const deployerKey = process.env.PRIVATE_KEY;
  assertTrue(!!deployerKey, "PRIVATE_KEY is empty; set it via contracts/.env.");
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  }) as PublicClient;
  const chainId = await publicClient.getChainId();
  assertTrue(chainId === 97, `Wrong chain: ${chainId}, must be 97.`);

  const readPosition = async () =>
    publicClient.readContract({
      address: MOCK_LENDING_POOL_ADDRESS,
      abi: POOL_ABI,
      functionName: "getUserAccountData",
      args: [ALTANA_WALLET],
    });

  const [openCollateral, openDebt] = await readPosition();
  console.log(`The Altana wallet's current position: collateral ${formatUsd8(openCollateral)} · debt ${formatUsd8(openDebt)}`);
  if (openCollateral > 0n && openDebt > 0n) {
    console.log("The position already exists; there is nothing to set up.");
    return;
  }

  // --- 1. Mint mBNB to the Altana wallet (the deployer EOA pays the gas) -----
  const mbnbBalance = await publicClient.readContract({
    address: MBNB,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ALTANA_WALLET],
  });
  if (mbnbBalance < COLLATERAL_UNITS) {
    const deployer = privateKeyToAccount(deployerKey as `0x${string}`);
    const wallet = createWalletClient({ account: deployer, chain: bscTestnet, transport: http(rpcUrl) });
    console.log(`\nMinting ${COLLATERAL_UNITS} units of mBNB to ${ALTANA_WALLET} (from ${deployer.address})`);
    const hash: Hash = await wallet.writeContract({
      account: deployer,
      chain: bscTestnet,
      address: MBNB,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [ALTANA_WALLET, COLLATERAL_UNITS - mbnbBalance],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assertTrue(receipt.status === "success", `the mint failed (${hash}).`);
    console.log(`  mint tx  : ${hash} (block ${receipt.blockNumber})`);
  } else {
    console.log(`\nThe Altana wallet already holds ${mbnbBalance} units of mBNB; the mint is skipped.`);
  }

  // --- 2. approve + supply + borrow through Altana's ADMIN path -------------
  armAltanaSdk();
  const admin = adminProvider(password, ALTANA_WALLET, rpcUrl);
  assertTrue(
    admin.address.toLowerCase() === ALTANA_WALLET.toLowerCase(),
    `The keystore opened ${admin.address}, not ${ALTANA_WALLET}.`,
  );
  const send = relaySender(admin, publicClient);

  const steps: readonly { label: string; call: RelayCall }[] = [
    {
      label: "approve mBNB for the pool",
      call: {
        address: MBNB,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MOCK_LENDING_POOL_ADDRESS, COLLATERAL_UNITS],
      },
    },
    {
      label: "supply mBNB as collateral",
      call: {
        address: MOCK_LENDING_POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "supply",
        args: [MBNB, COLLATERAL_UNITS],
      },
    },
    {
      label: "borrow mUSD",
      call: {
        address: MOCK_LENDING_POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "borrow",
        args: [REPAY_ASSET_ADDRESS, DEBT_UNITS],
      },
    },
  ];

  for (const { label, call } of steps) {
    console.log(`\n[Altana admin] ${label}`);
    const result = await send([call], label);
    assertTrue(result.status === 1, `${label} failed (tx ${result.transactionHash}).`);
    console.log(`  tx : ${result.transactionHash}`);
    console.log(`  https://testnet.bscscan.com/tx/${result.transactionHash}`);
  }

  const [col, debt, , lt, , hf] = await readPosition();
  console.log("\nThe Altana wallet's position after setup:");
  console.log(`  collateral : ${formatUsd8(col)}`);
  console.log(`  debt       : ${formatUsd8(debt)}`);
  console.log(`  lt         : ${lt} bps`);
  console.log(`  HF         : ${formatHf(hf)}`);
  assertTrue(col > 0n && debt > 0n, "The position was not created.");

  const remaining = await publicClient.getBalance({ address: ALTANA_WALLET });
  console.log(`\nAltana wallet tBNB balance : ${remaining} wei`);
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\n✖ FAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
