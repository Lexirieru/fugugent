/**
 * Membuat posisi pinjaman contoh yang **dimiliki wallet Altana**, bukan EOA deployer.
 *
 * Kenapa ini perlu: `MockLendingPool.repay(address,uint256)` tidak punya
 * `onBehalfOf` — ia hanya mengurangi hutang `msg.sender`. Posisi contoh yang
 * lama dimiliki EOA deployer, jadi wallet Altana tidak akan pernah bisa
 * membayarnya. Bentuk yang benar untuk produknya justru ini: **posisi dimiliki
 * wallet pengguna, dan agent hanya memegang session key ber-batas atas wallet
 * itu**.
 *
 * Penyiapan boleh memakai kewenangan admin — yang sedang dibuktikan task ini
 * adalah repay-nya, bukan setup-nya. Jadi:
 *   - `mBNB.mint` dikirim EOA deployer (mint MockToken terbuka untuk siapa pun),
 *   - `approve` + `supply` + `borrow` dikirim lewat jalur **admin** Altana,
 *     sehingga `msg.sender`-nya adalah wallet Altana.
 *
 * Jalankan dari `ai/fuguguardian/app/agent`:
 *   npx tsx scripts/setup-altana-position.ts
 */
import path from "node:path";
import { loadEnv } from "@bnbagent/studio-runtime/config";
import { createPublicClient, createWalletClient, http, type Hash, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { AGENT_ROOT, WORKSPACE_ROOT, adminProvider, armAltanaSdk, relaySender, type RelayCall } from "./altana.js";
import {
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
  REPAY_ASSET_ADDRESS,
} from "../src/strategy/chain/testnet.js";
import { formatHf, formatUsd8 } from "../src/strategy/format.js";

const ALTANA_WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const MBNB = "0xF380E8B6803aD065EF0567dd20C894a55050737c" as const;

/** Agunan: 0,2 mBNB (= $150 pada $750/mBNB). Sengaja kecil — ini demo, bukan dana. */
const COLLATERAL_UNITS = 2n * 10n ** 17n;

/** Hutang: 50 mUSD → HF 2,25 pada harga $750. Aman, dan turun ke zona PARTIAL_REPAY saat harga jatuh. */
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

function wajib(kondisi: boolean, pesan: string): asserts kondisi {
  if (!kondisi) throw new Error(pesan);
}

async function main(): Promise<void> {
  loadEnv(path.join(WORKSPACE_ROOT, ".studio/.env.local")); // WALLET_PASSWORD
  loadEnv(path.resolve(AGENT_ROOT, "../../../../contracts/.env")); // PRIVATE_KEY, BSC_TESTNET_RPC_URL

  const password = process.env.WALLET_PASSWORD;
  wajib(!!password, "WALLET_PASSWORD kosong; isi lewat .studio/.env.local.");
  const deployerKey = process.env.PRIVATE_KEY;
  wajib(!!deployerKey, "PRIVATE_KEY kosong; isi lewat contracts/.env.");
  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;

  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  }) as PublicClient;
  const chainId = await publicClient.getChainId();
  wajib(chainId === 97, `Chain salah: ${chainId}, harus 97.`);

  const posisi = async () =>
    publicClient.readContract({
      address: MOCK_LENDING_POOL_ADDRESS,
      abi: POOL_ABI,
      functionName: "getUserAccountData",
      args: [ALTANA_WALLET],
    });

  const [colAwal, debtAwal] = await posisi();
  console.log(`Posisi wallet Altana saat ini: agunan ${formatUsd8(colAwal)} · hutang ${formatUsd8(debtAwal)}`);
  if (colAwal > 0n && debtAwal > 0n) {
    console.log("Posisi sudah ada; tidak ada yang perlu disiapkan.");
    return;
  }

  // --- 1. Mint mBNB ke wallet Altana (EOA deployer yang membayar gas) --------
  const saldoMbnb = await publicClient.readContract({
    address: MBNB,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ALTANA_WALLET],
  });
  if (saldoMbnb < COLLATERAL_UNITS) {
    const deployer = privateKeyToAccount(deployerKey as `0x${string}`);
    const wallet = createWalletClient({ account: deployer, chain: bscTestnet, transport: http(rpcUrl) });
    console.log(`\nMint ${COLLATERAL_UNITS} unit mBNB ke ${ALTANA_WALLET} (dari ${deployer.address})`);
    const hash: Hash = await wallet.writeContract({
      account: deployer,
      chain: bscTestnet,
      address: MBNB,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [ALTANA_WALLET, COLLATERAL_UNITS - saldoMbnb],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    wajib(receipt.status === "success", `mint gagal (${hash}).`);
    console.log(`  tx mint  : ${hash} (blok ${receipt.blockNumber})`);
  } else {
    console.log(`\nWallet Altana sudah punya ${saldoMbnb} unit mBNB; mint dilewati.`);
  }

  // --- 2. approve + supply + borrow lewat jalur ADMIN Altana ----------------
  armAltanaSdk();
  const admin = adminProvider(password, ALTANA_WALLET, rpcUrl);
  wajib(
    admin.address.toLowerCase() === ALTANA_WALLET.toLowerCase(),
    `Keystore membuka ${admin.address}, bukan ${ALTANA_WALLET}.`,
  );
  const kirim = relaySender(admin, publicClient);

  const langkah: readonly { label: string; call: RelayCall }[] = [
    {
      label: "approve mBNB ke pool",
      call: {
        address: MBNB,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MOCK_LENDING_POOL_ADDRESS, COLLATERAL_UNITS],
      },
    },
    {
      label: "supply mBNB sebagai agunan",
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

  for (const { label, call } of langkah) {
    console.log(`\n[admin Altana] ${label}`);
    const result = await kirim([call], label);
    wajib(result.status === 1, `${label} gagal (tx ${result.transactionHash}).`);
    console.log(`  tx : ${result.transactionHash}`);
    console.log(`  https://testnet.bscscan.com/tx/${result.transactionHash}`);
  }

  const [col, debt, , lt, , hf] = await posisi();
  console.log("\nPosisi wallet Altana setelah penyiapan:");
  console.log(`  agunan : ${formatUsd8(col)}`);
  console.log(`  hutang : ${formatUsd8(debt)}`);
  console.log(`  lt     : ${lt} bps`);
  console.log(`  HF     : ${formatHf(hf)}`);
  wajib(col > 0n && debt > 0n, "Posisi tidak terbentuk.");

  const sisa = await publicClient.getBalance({ address: ALTANA_WALLET });
  console.log(`\nSaldo tBNB wallet Altana : ${sisa} wei`);
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\n✖ GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
}
