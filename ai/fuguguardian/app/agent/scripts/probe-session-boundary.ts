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
  readonly kenapa: string;
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
  if (chainId !== 97) throw new Error(`Chain salah: ${chainId}, harus 97.`);

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
  const kirim = relaySender(sessionProvider(session, rpcUrl), publicClient);

  console.log("UJI BATAS SESSION KEY — panggilan di luar allowlist wajib ditolak");
  console.log(`  RPC          : ${rpcUrl}`);
  console.log(`  Wallet       : ${wallet}`);
  console.log(`  File sesi    : ${GUARDIAN_SESSION_FILE}`);
  console.log(`  publicKey    : ${session.publicKey}`);
  console.log("  Allowlist sesi (satu-satunya yang diizinkan):");
  for (const c of requiredSessionCalls(MOCK_LENDING_POOL_ADDRESS, REPAY_ASSET_ADDRESS)) {
    console.log(`    - ${c.to}  ${c.signature}`);
  }

  const saldo = async (token: `0x${string}`) =>
    publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [wallet],
    });

  const mUsdSebelum = await saldo(REPAY_ASSET_ADDRESS);
  const mBnbSebelum = await saldo(MBNB);
  console.log(`\nSaldo sebelum: mUSD ${mUsdSebelum} · mBNB ${mBnbSebelum}`);

  const probes: readonly Probe[] = [
    {
      label: "mUSD.transfer(EOA deployer, 1 wei)",
      kenapa: "kontrak di-allowlist untuk approve, tetapi selector transfer TIDAK",
      call: {
        address: REPAY_ASSET_ADDRESS,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [EOA_DEPLOYER, 1n],
      },
    },
    {
      label: "mBNB.approve(pool, 1 wei)",
      kenapa: "selector approve di-allowlist untuk mUSD, tetapi kontrak mBNB TIDAK",
      call: {
        address: MBNB,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [MOCK_LENDING_POOL_ADDRESS, 1n],
      },
    },
  ];

  let lolos = 0;
  for (const probe of probes) {
    console.log(`\n${"-".repeat(72)}`);
    console.log(`Mencoba lewat sesi: ${probe.label}`);
    console.log(`  Kenapa ini di luar batas: ${probe.kenapa}`);
    try {
      const result = await kirim([probe.call], probe.label);
      lolos += 1;
      console.error(
        `  ✖ LOLOS — sesi berhasil mengirimnya (tx ${result.transactionHash}, status ${result.status}). ` +
          "Batas sesi TIDAK ditegakkan.",
      );
    } catch (err: unknown) {
      // "An exception happened" is NOT proof. A relay answering 502, a timed-out receipt, or
      // a nonce race all throw too — and none of them tests the session boundary.
      // `assertSessionDenial` demands the error really is `UnauthorizedCall` AND names the
      // contract we tried to call; any other shape is rethrown as a test failure rather than
      // accepted as evidence.
      const pesan = assertSessionDenial(err, probe.call.address, probe.label);
      console.log(`  ✔ DITOLAK oleh validator akun Altana (UnauthorizedCall). Galat apa adanya:`);
      for (const baris of pesan.split("\n")) console.log(`    | ${baris}`);
    }
  }

  const mUsdSesudah = await saldo(REPAY_ASSET_ADDRESS);
  const mBnbSesudah = await saldo(MBNB);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`Saldo sesudah: mUSD ${mUsdSesudah} · mBNB ${mBnbSesudah}`);
  if (mUsdSesudah !== mUsdSebelum || mBnbSesudah !== mBnbSebelum) {
    lolos += 1;
    console.error("✖ Saldo token BERUBAH; sesuatu benar-benar terkirim.");
  } else {
    console.log("✔ Saldo token tidak berubah sama sekali — tidak ada yang terkirim.");
  }

  const sisa = await publicClient.getBalance({ address: wallet });
  console.log(`Saldo tBNB wallet: ${sisa} wei`);

  if (lolos > 0) {
    throw new Error(`${lolos} panggilan di luar allowlist TIDAK ditolak; batas sesi tidak terbukti.`);
  }
  console.log("\n✔ SEMUA panggilan di luar allowlist ditolak. Batas sesi terbukti nyata.");
}

try {
  await main();
} catch (err: unknown) {
  console.error(`\n✖ GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
