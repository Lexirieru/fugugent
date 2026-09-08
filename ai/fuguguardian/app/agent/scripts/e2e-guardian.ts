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
} from "./altana.js";
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

class BuktiGagal extends Error {
  constructor(pesan: string) {
    super(pesan);
    this.name = "BuktiGagal";
  }
}

/**
 * The only way this script asserts that something is true. An unproven claim MUST stop the
 * script — a script that prints "success" without proving the HF rose is worse than no
 * script at all.
 */
function wajib(kondisi: boolean, pesan: string): asserts kondisi {
  if (!kondisi) throw new BuktiGagal(pesan);
}

function butuhEnv(nama: string): string {
  const nilai = process.env[nama];
  // Deliberately names only the variable's NAME, never its value.
  wajib(
    typeof nilai === "string" && nilai.length > 0,
    `Variabel lingkungan ${nama} kosong; isi lewat .env, jangan di baris perintah.`,
  );
  return nilai;
}

function judul(teks: string): void {
  console.log(`\n${"=".repeat(72)}\n${teks}\n${"=".repeat(72)}`);
}

function cetakPosisi(label: string, pos: Position): void {
  console.log(`${label}`);
  console.log(`  blok                  : ${pos.blockNumber}`);
  console.log(`  totalCollateralBase   : ${formatUsd8(pos.collateralBase)}`);
  console.log(`  totalDebtBase         : ${formatUsd8(pos.debtBase)}`);
  console.log(`  liquidationThreshold  : ${pos.liquidationThresholdBps} bps`);
  console.log(
    `  healthFactor          : ${pos.healthFactor === null ? "tidak ada hutang" : `${formatHf(pos.healthFactor)}  (${pos.healthFactor})`}`,
  );
}

function tautanTx(hash: Hash): string {
  return `${BSCSCAN_TX}${hash}`;
}

/** One finalized transaction, together with the block height it landed in. */
interface TxTerkirim {
  hash: Hash;
  /** The receipt's block. This is the ANCHOR for every read afterwards — see `posisiPadaBlok`. */
  blockNumber: bigint;
}

/** Sends one transaction and fails hard if its receipt is not "success". */
async function kirim(
  publicClient: PublicClient,
  jalankan: () => Promise<Hash>,
  label: string,
): Promise<TxTerkirim> {
  const hash = await jalankan();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  wajib(
    receipt.status === "success",
    `Transaksi ${label} gagal on-chain (status=${receipt.status}, tx=${hash}).`,
  );
  console.log(`  tx ${label.padEnd(10)}: ${hash}`);
  console.log(`     blok         : ${receipt.blockNumber}`);
  console.log(`     gas terpakai : ${receipt.gasUsed}`);
  console.log(`     ${tautanTx(hash)}`);
  return { hash, blockNumber: receipt.blockNumber };
}

/**
 * Re-reads from the chain until `syarat` holds, or fails hard.
 *
 * This is NOT a loosening of the proof: `syarat` is still the same on-chain condition, and
 * if it never holds the script still dies with a non-zero exit code. All that is tolerated
 * is RPC lag. The public BSC testnet endpoint is a pool of nodes behind one name: on this
 * script's first run, `eth_getTransactionReceipt` answered from a node that had block
 * 129832787, while the next `eth_call` was served by a node still at 129832786 — so the new
 * price "did not exist" even though the transaction was final. Concluding failure from a
 * stale read like that produces wrong evidence in both directions.
 */
async function bacaSampai<T>(
  baca: () => Promise<T>,
  syarat: (nilai: T) => boolean,
  label: string,
  maksPercobaan = 20,
  jedaMs = 1_500,
): Promise<T> {
  let terakhir: T | undefined;
  let galatTerakhir: unknown;
  for (let i = 1; i <= maksPercobaan; i++) {
    try {
      terakhir = await baca();
      galatTerakhir = undefined;
      if (syarat(terakhir)) {
        if (i > 1) console.log(`  (bacaan "${label}" konsisten setelah ${i} percobaan)`);
        return terakhir;
      }
    } catch (err) {
      // A read ANCHORED to a specific block height is refused by a node that does not have
      // that block yet ("header not found") — and that is exactly the property we want: a
      // stale node complains rather than quietly answering from the past. The next attempt
      // will most likely land on a different node.
      galatTerakhir = err;
    }
    await new Promise((r) => setTimeout(r, jedaMs));
  }
  const jejak =
    galatTerakhir !== undefined
      ? `Galat terakhir: ${galatTerakhir instanceof Error ? galatTerakhir.message : String(galatTerakhir)}`
      : `Nilai terakhir: ${JSON.stringify(terakhir, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`;
  throw new BuktiGagal(
    `Bacaan on-chain "${label}" tidak pernah memenuhi syarat setelah ${maksPercobaan} percobaan ` +
      `(~${(maksPercobaan * jedaMs) / 1000}s). ${jejak}`,
  );
}

/**
 * `getUserAccountData` ANCHORED to a specific block height.
 *
 * This is the structural anchor for the whole proof. `bacaSampai` on its own only retries
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
async function tuplePadaBlok(
  publicClient: PublicClient,
  akun: `0x${string}`,
  blok: bigint,
  label: string,
): Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]> {
  return bacaSampai(
    () =>
      publicClient.readContract({
        address: MOCK_LENDING_POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "getUserAccountData",
        args: [akun],
        blockNumber: blok,
      }),
    () => true, // what we are waiting for is not the value, but a node that has that block
    `${label} (tertambat di blok ${blok})`,
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
interface Pemulihan {
  perlu: boolean;
  jalankan?: () => Promise<void>;
}

async function main(pemulihan: Pemulihan): Promise<void> {
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
  const account = privateKeyToAccount(butuhEnv("PRIVATE_KEY") as `0x${string}`);

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
  const posisiAkun = session.walletAddress;
  const izinSesi = session.permissions as SessionPermissions;
  const kirimSesi = relaySender(sessionProvider(session, rpcUrl), publicClient);

  judul("FUGU GUARDIAN — E2E di BSC testnet (chainId 97)");
  console.log(`RPC             : ${rpcUrl}`);
  console.log(`Pemilik posisi  : ${posisiAkun}  (wallet Altana)`);
  console.log(`Penandatangan repay : session key Altana ber-batas`);
  console.log(`  file sesi     : ${GUARDIAN_SESSION_FILE}`);
  console.log(`  publicKey     : ${session.publicKey}`);
  console.log(`  expiry        : ${session.expiry} (${new Date(session.expiry * 1000).toISOString()})`);
  for (const izin of izinSesi.calls ?? []) {
    const to = "to" in izin ? izin.to : "(kontrak apa pun)";
    const signature = "signature" in izin ? izin.signature : "(metode apa pun)";
    console.log(`  allowlist     : ${to}  ${signature}`);
  }
  for (const cap of izinSesi.spend ?? []) {
    console.log(`  spend cap     : ${cap.limit} / ${cap.period}  ${cap.token ?? "(native)"}`);
  }

  // The session permissions are checked HERE, before a single transaction is sent —
  // including before STEP 2's `setAnswer`. A session that is too loose must stop the script
  // while testnet's state is still intact, not after the price has been lowered.
  // `createSessionSendRepay` checks the same thing again at construction; that repetition is
  // deliberate and cheap.
  assertBoundedAllowlist(izinSesi, requiredSessionCalls(MOCK_LENDING_POOL_ADDRESS, REPAY_ASSET_ADDRESS));
  assertNativeSpendCap(izinSesi);
  console.log("  ✔ izin sesi diperiksa: persis repay + approve, dengan cap native — belum ada tx dikirim.");
  console.log(`Penandatangan harga : ${account.address}  (EOA deployer, pemilik feed)`);
  console.log(`MockLendingPool : ${MOCK_LENDING_POOL_ADDRESS}`);
  console.log(`MockPriceFeedBNB: ${MOCK_PRICE_FEED_BNB}`);
  console.log(`Aset repay      : ${REPAY_ASSET_ADDRESS} (mUSD)`);
  console.log(
    `Ambang          : warn=${formatHf(DEFAULT_THRESHOLDS.warn)} partialRepay=${formatHf(DEFAULT_THRESHOLDS.partialRepay)} deleverage=${formatHf(DEFAULT_THRESHOLDS.deleverage)}`,
  );

  const chainId = await publicClient.getChainId();
  wajib(chainId === 97, `Chain salah: ${chainId}, harus 97 (BSC testnet).`);
  wajib(
    posisiAkun.toLowerCase() !== account.address.toLowerCase(),
    `Wallet sesi dan EOA deployer adalah alamat yang sama (${posisiAkun}); ` +
      "bukti 'bukan EOA deployer' tidak akan berarti apa-apa.",
  );

  const tbnbAwal = await publicClient.getBalance({ address: posisiAkun });
  const tbnbDeployerAwal = await publicClient.getBalance({ address: account.address });
  console.log(`Saldo tBNB wallet Altana : ${tbnbAwal} wei`);
  console.log(`Saldo tBNB EOA deployer  : ${tbnbDeployerAwal} wei`);

  // --- 2. The starting position ---------------------------------------------
  judul("LANGKAH 1 — Posisi contoh sebelum apa pun disentuh");
  const posAwal = await reader.readPosition(posisiAkun);
  cetakPosisi("Posisi awal (dibaca lewat readAavePosition apa adanya):", posAwal);
  wajib(posAwal.healthFactor !== null, "Posisi contoh tidak punya hutang; tidak ada yang bisa dibuktikan.");
  wajib(posAwal.collateralBase > 0n, "Posisi contoh tidak punya agunan.");
  const hfAwal = posAwal.healthFactor;

  const [, hargaAwalRaw] = await publicClient.readContract({
    address: MOCK_PRICE_FEED_BNB,
    abi: PRICE_FEED_ABI,
    functionName: "latestRoundData",
  });
  wajib(
    hargaAwalRaw > 0n,
    `Harga mBNB tidak masuk akal: ${formatUsd8(hargaAwalRaw)} (${hargaAwalRaw}).`,
  );
  const hargaAwal = hargaAwalRaw;
  console.log(`\nHarga mBNB sekarang   : ${formatUsd8(hargaAwal)} (${hargaAwal})`);

  // --- 3. Compute the target price from the HF formula ----------------------
  judul("LANGKAH 2 — Menurunkan harga mBNB sampai HF masuk zona PARTIAL_REPAY");

  // HF = collateral x ltBps x 1e18 / (BPS x debt), and collateral is directly proportional
  // to the mBNB price (this position's only collateral asset). Inverting that formula for the
  // price:
  //   hargaSasaran = hargaSekarang x TARGET_HF x BPS x debt
  //                  / (collateral x ltBps x 1e18)
  // bigint division rounds down, so the resulting HF is slightly BELOW TARGET_HF — the safe
  // direction, because it moves away from the zone's upper bound.
  const hargaSasaran =
    (hargaAwal * TARGET_HF * BPS * posAwal.debtBase) /
    (posAwal.collateralBase * posAwal.liquidationThresholdBps * HF_ONE);
  wajib(
    hargaSasaran > 0n,
    `Harga sasaran terhitung nol atau negatif: ${formatUsd8(hargaSasaran)} (${hargaSasaran}).`,
  );
  wajib(
    hargaSasaran < hargaAwal,
    `Harga sasaran ${formatUsd8(hargaSasaran)} tidak lebih rendah dari harga sekarang ` +
      `${formatUsd8(hargaAwal)}; posisi sudah berisiko?`,
  );

  // A local forecast BEFORE burning gas: if the calculation is wrong, fail here rather than
  // after the transaction is sent. It uses the same computeHealthFactor production uses.
  const agunanRamalan = (posAwal.collateralBase * hargaSasaran) / hargaAwal;
  const hfRamalan = computeHealthFactor(
    agunanRamalan,
    posAwal.debtBase,
    posAwal.liquidationThresholdBps,
  );
  wajib(hfRamalan !== null, "Ramalan HF null padahal hutang ada.");
  console.log(`TARGET_HF (tengah zona): ${formatHf(TARGET_HF)}`);
  console.log(`Harga sasaran mBNB     : ${formatUsd8(hargaSasaran)} (${hargaSasaran})`);
  console.log(`HF ramalan lokal       : ${formatHf(hfRamalan)} (${hfRamalan})`);
  wajib(
    hfRamalan > DEFAULT_THRESHOLDS.deleverage && hfRamalan <= DEFAULT_THRESHOLDS.partialRepay,
    `Ramalan HF ${formatHf(hfRamalan)} (${hfRamalan}) di luar zona PARTIAL_REPAY; ` +
      `transaksi dibatalkan sebelum gas terbakar.`,
  );

  // The recovery is registered BEFORE the price is lowered, so there is no gap between "the
  // price has fallen" and "someone knows how to put it back".
  pemulihan.jalankan = async () => {
    console.log(`Mengembalikan harga ke ${formatUsd8(hargaAwal)} (${hargaAwal})`);
    await kirim(
      publicClient,
      () =>
        wallet.writeContract({
          account,
          chain: bscTestnet,
          address: MOCK_PRICE_FEED_BNB,
          abi: PRICE_FEED_ABI,
          functionName: "setAnswer",
          args: [hargaAwal],
        }),
      "restore",
    );
    const [, hargaPulih] = await bacaSampai(
      () =>
        publicClient.readContract({
          address: MOCK_PRICE_FEED_BNB,
          abi: PRICE_FEED_ABI,
          functionName: "latestRoundData",
        }),
      ([, jawaban]) => jawaban === hargaAwal,
      "harga mBNB kembali ke nilai semula",
    );
    wajib(
      hargaPulih === hargaAwal,
      `Harga gagal dikembalikan: ${formatUsd8(hargaPulih)} != ${formatUsd8(hargaAwal)}.`,
    );
  };

  console.log("");
  const txTurun = await kirim(
    publicClient,
    () =>
      wallet.writeContract({
        account,
        chain: bscTestnet,
        address: MOCK_PRICE_FEED_BNB,
        abi: PRICE_FEED_ABI,
        functionName: "setAnswer",
        args: [hargaSasaran],
      }),
    "setAnswer",
  );
  pemulihan.perlu = true;

  // A test seam for the recovery path. The `finally` path is only useful if it actually
  // runs, and the only way to prove that is to fail on purpose right after the price is
  // lowered — exactly the failure shape that really happened once. Never active without this
  // env var.
  if (process.env.E2E_PAKSA_GAGAL_SETELAH_TURUN === "1") {
    throw new BuktiGagal(
      "Kegagalan disengaja (E2E_PAKSA_GAGAL_SETELAH_TURUN=1) untuk menguji jalur pemulihan harga.",
    );
  }

  // --- 4. Assertions from real on-chain readings ---------------------------
  console.log("");
  const posTertekan = await bacaSampai(
    () => reader.readPosition(posisiAkun),
    (p) =>
      p.blockNumber >= txTurun.blockNumber &&
      p.healthFactor !== null &&
      p.healthFactor > DEFAULT_THRESHOLDS.deleverage &&
      p.healthFactor <= DEFAULT_THRESHOLDS.partialRepay,
    "HF masuk zona PARTIAL_REPAY",
  );
  cetakPosisi("Posisi setelah harga turun (dibaca ulang on-chain):", posTertekan);
  wajib(posTertekan.healthFactor !== null, "HF null setelah harga turun.");
  const hfSebelum = posTertekan.healthFactor;
  wajib(
    posTertekan.blockNumber >= txTurun.blockNumber,
    `Bacaan "sebelum" datang dari blok ${posTertekan.blockNumber}, lebih tua daripada blok ` +
      `transaksi penurunan harga (${txTurun.blockNumber}) — bacaan basi, bukan bukti.`,
  );
  wajib(
    hfSebelum > DEFAULT_THRESHOLDS.deleverage && hfSebelum <= DEFAULT_THRESHOLDS.partialRepay,
    `HF on-chain ${formatHf(hfSebelum)} (${hfSebelum}) TIDAK di zona PARTIAL_REPAY ` +
      `(${formatHf(DEFAULT_THRESHOLDS.deleverage)} < HF <= ${formatHf(DEFAULT_THRESHOLDS.partialRepay)}).`,
  );

  // The anchor: the same values re-read AT THE BLOCK of the price-drop transaction.
  const [colTambat, debtTambat, , ltTambat, , hfTambat] = await tuplePadaBlok(
    publicClient,
    posisiAkun,
    txTurun.blockNumber,
    "posisi sebelum intervensi",
  );
  console.log(
    `\nJangkar blok ${txTurun.blockNumber}: agunan ${formatUsd8(colTambat)} · hutang ${formatUsd8(debtTambat)} · lt ${ltTambat} bps · HF ${formatHf(hfTambat)}`,
  );
  wajib(
    colTambat === posTertekan.collateralBase &&
      debtTambat === posTertekan.debtBase &&
      ltTambat === posTertekan.liquidationThresholdBps &&
      hfTambat === hfSebelum,
    `Bacaan adapter tidak cocok dengan bacaan tertambat di blok ${txTurun.blockNumber}: ` +
      `adapter (agunan ${posTertekan.collateralBase}, hutang ${posTertekan.debtBase}, lt ` +
      `${posTertekan.liquidationThresholdBps}, hf ${hfSebelum}) vs tertambat (agunan ${colTambat}, ` +
      `hutang ${debtTambat}, lt ${ltTambat}, hf ${hfTambat}).`,
  );
  console.log(`\n✔ Terbukti dari bacaan on-chain: HF ${formatHf(hfSebelum)} ada di zona PARTIAL_REPAY.`);

  // --- 5. One Guardian cycle ------------------------------------------------
  judul("LANGKAH 3 — Satu siklus Guardian (decide → execute → explain)");

  /** The repay txs actually sent; recorded so they can be matched against the cycle's result. */
  const txRepayTercatat: TxTerkirim[] = [];

  /**
   * The rounding tolerance for matching amounts, in 8-decimal basis units.
   * 2 units = $0.00000002. It is needed because there are TWO independent roundings down:
   * USD8 -> token units in `usd8ToTokenUnits`, and token units -> USD8 in
   * `MockLendingPool._valueUsd8`. Each loses less than one unit, so the largest legitimate
   * difference is 2. Anything larger means the conversion is genuinely wrong, not merely
   * rounded.
   */
  const TOLERANSI_USD8 = 2n;

  /** The receipt of the `repay` transaction that actually landed; used to prove its sender. */
  let receiptRepay: RelayResult["receipt"] = null;

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
  const stateSebelum = await stateStore.load();
  console.log(`State eksekusi : ${stateFile}`);
  console.log(
    stateSebelum === null
      ? "  (belum ada — jalan pertama, anggaran kosong)"
      : `  dimuat: terpakai ${formatUsd8(stateSebelum.spentTodayUsd8)} hari ini · ` +
          `aksi terakhir ${stateSebelum.lastActionAt} · killed=${stateSebelum.killed} · ` +
          `menggantung=${stateSebelum.pendingRepay === null ? "tidak" : "YA"}`,
  );
  // If a pending record exists, the cycle below will refuse to send — that is the correct
  // behavior, but without this message it reads like a regression.
  wajib(
    stateSebelum === null || stateSebelum.pendingRepay === null,
    `Ada repay yang belum terbukti selesai di ${stateFile} (${formatUsd8(stateSebelum?.pendingRepay?.amountUsd8 ?? 0n)}). ` +
      "Guardian menahan diri sampai rantai membuktikan hutang berkurang sebesar itu, atau sampai " +
      "operator membereskannya. Periksa rantai lebih dulu; JANGAN hapus berkasnya begitu saja.",
  );

  const guardian = await createGuardian({
    account: posisiAkun,
    client: publicClient,
    pool: MOCK_LENDING_POOL_ADDRESS,
    repayAsset: REPAY_ASSET_ADDRESS,
    permissions: izinSesi,
    limits: LIMITS,
    logger,
    stateStore,
    explainDecision,
    now: () => Math.floor(Date.now() / 1000),
    log: (pesan) => console.log(`  ${pesan}`),
    sendCalls: async (calls, description) => {
      const hasil = await kirimSesi(
        calls.map((call) => ({
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
        })),
        description,
      );
      const receipt = hasil.receipt;
      wajib(
        receipt !== null,
        `Relay Altana tidak mengembalikan receipt untuk ${description} (${hasil.transactionHash}).`,
      );
      console.log(`  tx sesi      : ${hasil.transactionHash}`);
      console.log(`     isi batch    : ${calls.map((c) => c.functionName).join(" + ")}`);
      console.log(`     blok         : ${receipt.blockNumber}`);
      console.log(`     gas terpakai : ${receipt.gasUsed}`);
      console.log(`     pengirim tx  : ${receipt.from}  (relay Altana; wallet membayar fee-nya)`);
      console.log(`     ${tautanTx(hasil.transactionHash)}`);
      if (calls.some((c) => c.functionName === "repay")) {
        txRepayTercatat.push({ hash: hasil.transactionHash, blockNumber: receipt.blockNumber });
        receiptRepay = receipt;
      }
      return { transactionHash: hasil.transactionHash, status: hasil.status };
    },
  });

  console.log(
    `Aset repay: desimal=${guardian.repayAsset.tokenDecimals}, feed=${guardian.repayAsset.feed}`,
  );
  console.log(
    "  ✔ desimal aset dicocokkan antara konfigurasi pool dan kontrak tokennya sendiri, dan " +
      "feed dituntut 8 desimal — dua sumber berbeda, bukan cek bolak-balik yang membandingkan " +
      "sebuah angka dengan dirinya sendiri.",
  );

  const t0 = Date.now();
  const outcome = await guardian.runOnce();
  const durasi = Date.now() - t0;

  const hasil = outcome.result;
  wajib(hasil.ok, `Siklus Guardian gagal: ${hasil.ok ? "" : hasil.error}`);

  judul("LANGKAH 4 — Hasil siklus");
  console.log(`Keputusan (action)     : ${hasil.action}`);
  console.log(`Alasan keputusan       : ${hasil.reason}`);
  console.log(`Alasan eksekusi        : ${hasil.executeReason}`);
  console.log(`Terkirim               : ${hasil.sent}`);
  console.log(`Jumlah dibayar         : ${formatUsd8(hasil.amountSentUsd8)}  (${hasil.amountSentUsd8} basis 8 desimal)`);
  console.log(`Dipotong batas aksi    : ${hasil.cappedPerAction}`);
  console.log(`Dipotong batas harian  : ${hasil.cappedPerDay}`);
  console.log(`Tx hash                : ${hasil.txHash}`);
  console.log(`Tautan                 : ${hasil.txHash ? tautanTx(hasil.txHash) : "-"}`);
  console.log(`Anggaran terpakai hari : ${formatUsd8(outcome.nextExecuteState.spentTodayUsd8)} dari ${formatUsd8(LIMITS.maxPerDayUsd8)}`);
  console.log(`Durasi siklus          : ${durasi} ms (termasuk dGrid)`);
  console.log(`Penjelasan (dGrid)     : ${hasil.explanation}`);

  wajib(hasil.action === "PARTIAL_REPAY", `Aksi ${hasil.action}, seharusnya PARTIAL_REPAY.`);
  wajib(hasil.sent, `Guardian tidak mengirim transaksi apa pun: ${hasil.executeReason}`);
  wajib(hasil.amountSentUsd8 > 0n, "Jumlah yang dibayar nol.");
  wajib(hasil.txHash !== null, "Tidak ada tx hash — tidak ada bukti on-chain.");
  wajib(
    txRepayTercatat.length === 1 && hasil.txHash === txRepayTercatat[0]?.hash,
    `Tx hash dari siklus (${hasil.txHash}) tidak cocok dengan tx repay yang benar-benar dikirim ` +
      `(${txRepayTercatat.map((t) => t.hash).join(", ") || "tidak ada"}).`,
  );
  const txRepay = txRepayTercatat[0]!;
  wajib(
    outcome.nextExecuteState.spentTodayUsd8 === hasil.amountSentUsd8,
    "Anggaran harian tidak bertambah sebesar jumlah yang dikirim.",
  );
  // The C2 bookkeeping on the REAL path: a repay that completes with a hash must not leave
  // a pending record behind. If one is left, the next cycle will refuse to act — a safe
  // failure, but still wrong.
  wajib(
    outcome.nextExecuteState.pendingRepay === null,
    `Repay sudah selesai dengan hash ${hasil.txHash} tetapi catatan menggantung masih ada; ` +
      "pembukuan idempotensi tidak dibereskan.",
  );

  // --- 5b. Who actually paid ------------------------------------------------
  // This is this task's central claim, and it is proven from the RECEIPT, not from the code's
  // intent. `MockLendingPool.repay` only reduces `msg.sender`'s debt, and
  // `Repay(address indexed user, ...)` records that `msg.sender`. So if the event's `user` is
  // the Altana wallet, then what called the pool really was the Altana wallet — through the
  // bounded session key, not the deployer EOA.
  judul("LANGKAH 5 — Bukti: yang membayar adalah wallet Altana lewat session key");
  const receipt = receiptRepay as RelayResult["receipt"];
  wajib(receipt !== null, "Tidak ada receipt repay yang tercatat.");
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
  wajib(
    logRepay !== undefined,
    `Receipt ${txRepay.hash} tidak memuat event Repay dari ${MOCK_LENDING_POOL_ADDRESS}; ` +
      "tidak ada yang bisa membuktikan siapa pemanggilnya.",
  );
  const pembayar = logRepay.args.user;
  console.log(`Tx repay              : ${txRepay.hash}`);
  console.log(`Pengirim transaksi    : ${receipt.from}  (relay Altana, bukan penanda tangan intent)`);
  console.log(`Repay.user (msg.sender di pool) : ${pembayar}`);
  console.log(`Wallet Altana         : ${posisiAkun}`);
  console.log(`EOA deployer          : ${account.address}`);
  wajib(
    pembayar.toLowerCase() === posisiAkun.toLowerCase(),
    `Repay.user pada receipt adalah ${pembayar}, bukan wallet Altana ${posisiAkun}.`,
  );
  wajib(
    pembayar.toLowerCase() !== account.address.toLowerCase(),
    `Repay.user pada receipt adalah EOA deployer ${account.address} — persis yang task ini hendak hindari.`,
  );
  wajib(
    receipt.from.toLowerCase() !== account.address.toLowerCase(),
    `Transaksi repay dikirim oleh EOA deployer ${account.address}; ` +
      "seharusnya oleh relay Altana atas nama wallet lewat session key.",
  );
  console.log(
    `\n✔ Terbukti dari receipt: hutang yang berkurang adalah hutang wallet Altana, ` +
      `dan panggilan repay datang dari wallet itu lewat session key ber-batas — bukan dari EOA deployer.`,
  );

  // The negative control, using the SAME SESSION OBJECT that just paid. Without this,
  // "bounded" is only a word: a session that can repay must be shown to be UNABLE to do
  // anything outside its allowlist. `mUSD.transfer` was chosen because its contract IS in the
  // allowlist (for `approve`) — so what is tested is binding at the selector level, not
  // merely at the contract level. The refusal comes from the Altana account validator, not
  // from our code.
  console.log("\nKontrol negatif — sesi yang sama mencoba mUSD.transfer(EOA deployer, 1 wei):");
  const mUsdSebelumProbe = await publicClient.readContract({
    address: REPAY_ASSET_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [posisiAkun],
  });
  let probeDitolak = false;
  try {
    const lolos = await kirimSesi(
      [
        {
          address: REPAY_ASSET_ADDRESS,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [account.address, 1n],
        },
      ],
      "kontrol negatif: transfer di luar allowlist",
    );
    console.error(`  ✖ LOLOS — tx ${lolos.transactionHash}`);
  } catch (err: unknown) {
    // It demands the reason for the refusal, not merely the existence of an exception: a
    // relay 502, a receipt timeout, and a nonce race all throw too, and none of them proves
    // the session boundary. Any other shape is rethrown and kills the E2E run.
    const pesan = assertSessionDenial(err, REPAY_ASSET_ADDRESS, "kontrol negatif transfer");
    probeDitolak = true;
    for (const baris of pesan.split("\n")) console.log(`    | ${baris}`);
  }
  const mUsdSesudahProbe = await publicClient.readContract({
    address: REPAY_ASSET_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [posisiAkun],
  });
  wajib(
    probeDitolak,
    "Sesi yang sama BERHASIL mengirim mUSD.transfer di luar allowlist; batasnya tidak nyata.",
  );
  wajib(
    mUsdSesudahProbe === mUsdSebelumProbe,
    `Saldo mUSD berubah (${mUsdSebelumProbe} → ${mUsdSesudahProbe}) padahal panggilannya ditolak.`,
  );
  console.log(
    `  ✔ Ditolak, dan saldo mUSD tidak bergerak (${mUsdSesudahProbe}). ` +
      `Sesi yang sama bisa repay, tidak bisa transfer.`,
  );

  // --- 6. The HF afterwards, from an on-chain reading -----------------------
  judul("LANGKAH 6 — Bukti: health factor naik setelah agent bertindak");
  wajib(
    txRepay.blockNumber > txTurun.blockNumber,
    `Urutan blok tidak masuk akal: repay di blok ${txRepay.blockNumber}, penurunan harga di ` +
      `blok ${txTurun.blockNumber}. "Sebelum" dan "sesudah" harus benar-benar berurutan.`,
  );

  const posSesudah = await bacaSampai(
    () => reader.readPosition(posisiAkun),
    (p) => p.blockNumber >= txRepay.blockNumber && p.debtBase < posTertekan.debtBase,
    "hutang berkurang setelah repay",
  );
  cetakPosisi("Posisi setelah repay (dibaca ulang on-chain):", posSesudah);
  wajib(posSesudah.healthFactor !== null, "HF null setelah repay.");
  const hfSesudah = posSesudah.healthFactor;
  wajib(
    posSesudah.blockNumber >= txRepay.blockNumber,
    `Bacaan "sesudah" datang dari blok ${posSesudah.blockNumber}, lebih tua daripada blok ` +
      `transaksi repay (${txRepay.blockNumber}) — bacaan basi, bukan bukti.`,
  );

  // The second anchor: the same values re-read AT THE BLOCK of the repay transaction.
  const [colTambat2, debtTambat2, , ltTambat2, , hfTambat2] = await tuplePadaBlok(
    publicClient,
    posisiAkun,
    txRepay.blockNumber,
    "posisi sesudah intervensi",
  );
  console.log(
    `\nJangkar blok ${txRepay.blockNumber}: agunan ${formatUsd8(colTambat2)} · hutang ${formatUsd8(debtTambat2)} · lt ${ltTambat2} bps · HF ${formatHf(hfTambat2)}`,
  );
  wajib(
    colTambat2 === posSesudah.collateralBase &&
      debtTambat2 === posSesudah.debtBase &&
      ltTambat2 === posSesudah.liquidationThresholdBps &&
      hfTambat2 === hfSesudah,
    `Bacaan adapter tidak cocok dengan bacaan tertambat di blok ${txRepay.blockNumber}: ` +
      `adapter (agunan ${posSesudah.collateralBase}, hutang ${posSesudah.debtBase}, lt ` +
      `${posSesudah.liquidationThresholdBps}, hf ${hfSesudah}) vs tertambat (agunan ${colTambat2}, ` +
      `hutang ${debtTambat2}, lt ${ltTambat2}, hf ${hfTambat2}).`,
  );

  wajib(
    hfSesudah > hfSebelum,
    `HF TIDAK naik: sebelum ${formatHf(hfSebelum)} (${hfSebelum}), sesudah ` +
      `${formatHf(hfSesudah)} (${hfSesudah}). Intervensi agent tidak terbukti.`,
  );
  wajib(
    posSesudah.debtBase < posTertekan.debtBase,
    `Hutang tidak berkurang: ${formatUsd8(posTertekan.debtBase)} → ${formatUsd8(posSesudah.debtBase)}.`,
  );

  // The collateral must not change: a repay only touches the debt side. If this number
  // moves, another actor is in the same position and the entire "before/after" comparison
  // loses its meaning.
  wajib(
    posSesudah.collateralBase === posTertekan.collateralBase,
    `Agunan ikut berubah (${formatUsd8(posTertekan.collateralBase)} → ` +
      `${formatUsd8(posSesudah.collateralBase)}); ada yang menyentuh posisi selain skrip ini.`,
  );

  // ————— The claim people will read most: HOW MUCH was paid. —————
  // Up to here "$..." is still nothing but `executeDecision`'s output. What turns it into
  // proof is the line below: the debt delta that ACTUALLY happened on chain must equal the
  // amount claimed. Without this, a unit conversion off by one order of magnitude makes the
  // agent pay a tenth of what is printed, while every other assertion still passes.
  const hutangBerkurang = posTertekan.debtBase - posSesudah.debtBase;
  const selisihKlaim =
    hutangBerkurang > hasil.amountSentUsd8
      ? hutangBerkurang - hasil.amountSentUsd8
      : hasil.amountSentUsd8 - hutangBerkurang;
  wajib(
    selisihKlaim <= TOLERANSI_USD8,
    `Jumlah yang DIKLAIM dibayar (${formatUsd8(hasil.amountSentUsd8)}) tidak sama dengan ` +
      `pengurangan hutang yang BENAR-BENAR terjadi di rantai ` +
      `(${formatUsd8(hutangBerkurang)}); selisih ${selisihKlaim} unit basis 8 desimal, ` +
      `maksimum yang sah ${TOLERANSI_USD8} (pembulatan ke bawah dua arah).`,
  );

  const selisih = hfSesudah - hfSebelum;
  // The zone label comes from the same `decide` Guardian uses, not from a threshold ladder
  // rewritten here — if the thresholds ever change, this printout changes with them on its
  // own.
  const zonaSesudah = decide(posSesudah).action;
  console.log("");
  console.log(`HF sebelum intervensi  : ${formatHf(hfSebelum)}  (${hfSebelum})`);
  console.log(`HF sesudah intervensi  : ${formatHf(hfSesudah)}  (${hfSesudah})`);
  console.log(`Selisih (naik)         : ${formatHf(selisih)}  (${selisih})`);
  console.log(`Hutang                 : ${formatUsd8(posTertekan.debtBase)} → ${formatUsd8(posSesudah.debtBase)}`);
  console.log(`Hutang berkurang       : ${formatUsd8(hutangBerkurang)}  (${hutangBerkurang} basis 8 desimal)`);
  console.log(`Diklaim dibayar        : ${formatUsd8(hasil.amountSentUsd8)}  (${hasil.amountSentUsd8} basis 8 desimal)`);
  console.log(`Selisih klaim vs rantai: ${selisihKlaim} unit (maksimum ${TOLERANSI_USD8})`);
  console.log(`Keputusan decide() kini: ${zonaSesudah}`);
  console.log(`\n✔ Terbukti: hutang berkurang persis sebesar yang diklaim, dan posisi keluar dari zona PARTIAL_REPAY karena aksi agent.`);

  // --- 7. Restore the price -------------------------------------------------
  // Done ONLY after every proof above has been collected, so testnet's state is reusable.
  // It costs one transaction, about 30k gas.
  judul("LANGKAH 7 — Mengembalikan harga mBNB ke nilai semula");
  // The success path uses the SAME closer as the failure path (see the `finally` below
  // `main`), so the two cannot drift apart.
  await pemulihan.jalankan!();
  pemulihan.perlu = false;

  const posAkhir = await bacaSampai(
    () => reader.readPosition(posisiAkun),
    (p) => p.collateralBase === posAwal.collateralBase,
    "agunan kembali ke nilai harga semula",
  );
  cetakPosisi("\nPosisi akhir (harga sudah pulih):", posAkhir);

  const tbnbAkhir = await publicClient.getBalance({ address: posisiAkun });
  const tbnbDeployerAkhir = await publicClient.getBalance({ address: account.address });
  judul("RINGKASAN");
  console.log(`HF awal ($${formatUsd8(hargaAwal).slice(1)}/mBNB)      : ${formatHf(hfAwal)}`);
  console.log(`HF setelah harga turun          : ${formatHf(hfSebelum)}`);
  console.log(`HF setelah agent membayar       : ${formatHf(hfSesudah)}   (+${formatHf(selisih)})`);
  console.log(`HF akhir (harga dipulihkan)     : ${posAkhir.healthFactor === null ? "-" : formatHf(posAkhir.healthFactor)}`);
  console.log(`Dibayar agent                   : ${formatUsd8(hasil.amountSentUsd8)}`);
  console.log(`Tx repay                        : ${hasil.txHash}`);
  console.log(`                                  ${hasil.txHash ? tautanTx(hasil.txHash) : "-"}`);
  console.log(`Penanda tangan repay            : session key ${session.publicKey.slice(0, 18)}… atas ${posisiAkun}`);
  console.log(`tBNB wallet Altana awal→akhir   : ${tbnbAwal} → ${tbnbAkhir} wei (selisih ${tbnbAwal - tbnbAkhir})`);
  console.log(`tBNB EOA deployer awal→akhir    : ${tbnbDeployerAwal} → ${tbnbDeployerAkhir} wei (selisih ${tbnbDeployerAwal - tbnbDeployerAkhir})`);
  console.log(`\nSEMUA KLAIM TERBUKTI.`);
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
const pemulihan: Pemulihan = { perlu: false };

try {
  await main(pemulihan);
} catch (err: unknown) {
  console.error(`\n✖ E2E GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
} finally {
  if (pemulihan.perlu && pemulihan.jalankan) {
    judul("PEMULIHAN — skrip berhenti dengan harga mBNB masih diturunkan");
    try {
      await pemulihan.jalankan();
      console.log("✔ Harga mBNB dipulihkan; keadaan testnet aman untuk dilihat.");
    } catch (errPulih: unknown) {
      console.error(
        `⚠ GAGAL memulihkan harga mBNB: ${errPulih instanceof Error ? errPulih.message : String(errPulih)}`,
      );
      console.error(
        `⚠ Posisi contoh TERTINGGAL di zona berisiko. Pulihkan manual:\n` +
          `   cast send ${MOCK_PRICE_FEED_BNB} "setAnswer(int256)" <harga semula 8 desimal> \\\n` +
          `     --rpc-url "$BSC_TESTNET_RPC_URL" --private-key "$PRIVATE_KEY"`,
      );
    }
  }
}
