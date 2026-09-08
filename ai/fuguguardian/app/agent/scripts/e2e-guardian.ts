/**
 * E2E Guardian di BSC testnet — bukti, bukan simulasi.
 *
 * Skrip ini TIDAK berisi logika strategi apa pun. Seluruh keputusan, batas
 * belanja, dan penjelasan datang dari modul yang sudah ada dan sudah diuji:
 * `createTestnetReader`, `decide` (lewat `runGuardCycle`), `executeDecision`,
 * dan `explainDecision` diimpor apa adanya. Yang ditambahkan di sini hanya
 * tiga hal yang memang milik sebuah skrip E2E:
 *
 *   1. memuat rahasia dari .env (tidak pernah mencetaknya),
 *   2. mengirim transaksi sungguhan (`setAnswer`, `approve`, `repay`),
 *   3. MEMBUKTIKAN klaimnya — setiap klaim diperiksa terhadap hasil bacaan
 *      on-chain sungguhan, dan skrip mati dengan exit code bukan nol begitu
 *      satu saja klaim tidak terbukti.
 *
 * ## Dua penanda tangan, dan itulah intinya
 *
 * `setAnswer` (menurunkan lalu memulihkan harga) ditandatangani **EOA deployer**
 * — ia pemilik feed, dan menurunkan harga memang peran "pasar", bukan peran
 * agent. `approve` + `repay` ditandatangani **session key Altana ber-batas**
 * atas wallet `0xbdc69c2d…`, lewat `createSessionSendRepay`. Session key itu
 * hanya boleh memanggil dua selector di dua kontrak, dengan spend cap dan
 * expiry yang ditegakkan kontrak akun Altana di rantai — bukan oleh kode ini.
 * Buktinya diperiksa di LANGKAH 5, dan ada dua bagian: (a) `Repay.user` pada
 * receipt harus wallet Altana dan pengirim transaksinya bukan EOA deployer,
 * dan (b) **kontrol negatif** — objek sesi YANG SAMA, sesaat setelah berhasil
 * membayar, mencoba `mUSD.transfer` dan wajib ditolak validator Altana. Tanpa
 * (b), "ber-batas" hanya kata.
 *
 * Posisi contoh karena itu dimiliki **wallet Altana**, bukan deployer:
 * `MockLendingPool.repay` tidak punya `onBehalfOf`, jadi hanya pemilik hutang
 * yang bisa membayarnya. Siapkan sekali dengan `scripts/setup-altana-position.ts`.
 *
 * Skenario:
 *   baca posisi contoh → turunkan harga mBNB lewat `MockPriceFeed.setAnswer`
 *   sampai HF jatuh ke zona PARTIAL_REPAY → jalankan SATU siklus Guardian →
 *   cetak keputusan, jumlah yang dibayar, tx hash, dan HF sesudahnya →
 *   pastikan HF naik → kembalikan harga ke nilai semula.
 *
 * Aturan angka: semua nilai USD berbasis 8 desimal dan HANYA dicetak lewat
 * `formatUsd8`/`formatHf` (lihat `format.ts` — 12345678 artinya $0,12, bukan
 * dua belas juta).
 *
 * Jalankan dari `ai/fuguguardian/app/agent`:
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
  createSessionSendRepay,
  requiredSessionCalls,
  type SessionPermissions,
} from "../src/strategy/chain/session.js";
import {
  createTestnetReader,
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
} from "../src/strategy/chain/testnet.js";
import { decide } from "../src/strategy/decide.js";
import { runGuardCycle, type ExecuteFn, type Logger } from "../src/strategy/guard.js";
import {
  executeDecision,
  REPAY_ASSET_ADDRESS,
  type ExecuteLimits,
  type ExecuteState,
} from "../src/strategy/execute.js";
import { explainDecision } from "../src/strategy/explain.js";
import { computeHealthFactor } from "../src/strategy/healthFactor.js";
import { formatHf, formatUsd8 } from "../src/strategy/format.js";
import { DEFAULT_THRESHOLDS, HF_ONE, type Position } from "../src/strategy/types.js";

// ---------------------------------------------------------------------------
// Alamat & konstanta testnet (sumber: contracts/deployments/bsc-testnet.json)
// ---------------------------------------------------------------------------

/** Feed harga mBNB, 8 desimal, owner = deployer. Satu-satunya tuas untuk menurunkan HF. */
const MOCK_PRICE_FEED_BNB = "0x0aA42416bAccdb2fd4768B61111DeB7F7D212F9B" as const;

const BPS = 10_000n;
const BSCSCAN_TX = "https://testnet.bscscan.com/tx/";

/**
 * HF sasaran saat menurunkan harga: tepat di tengah zona PARTIAL_REPAY,
 * DITURUNKAN dari ambang produksi (`DEFAULT_THRESHOLDS`), bukan angka sihir.
 * PARTIAL_REPAY berlaku untuk deleverage < HF <= partialRepay.
 */
const TARGET_HF = (DEFAULT_THRESHOLDS.partialRepay + DEFAULT_THRESHOLDS.deleverage) / 2n;

/**
 * Batas belanja yang dipakai `executeDecision`. Sengaja lebih longgar daripada
 * pembayaran yang diperlukan sekali ini supaya yang diuji adalah rantai
 * eksekusinya, bukan pemotongannya (pemotongan sudah punya test unit sendiri).
 *
 * Perhatikan bahwa angka ini BUKAN batas yang sebenarnya mengikat. Batas kode
 * di sini $2.000/hari; cap kriptografis pada sesi 100 mUSD/hari. Yang menang
 * adalah yang lebih ketat, dan itu cap sesi — bahkan bila `LIMITS` diubah,
 * dihapus, atau prosesnya dibajak. Konsekuensi yang harus diketahui: permintaan
 * di atas cap sesi tidak ditolak rapi oleh `execute.ts`, melainkan gagal di
 * relay sebagai error. Untuk demo satu repay ($8–12) jarak keduanya tidak
 * pernah tersentuh; untuk produksi keduanya harus disamakan.
 */
const LIMITS: ExecuteLimits = {
  maxPerActionUsd8: 100_000_000_000n, // $1.000,00
  maxPerDayUsd8: 200_000_000_000n, // $2.000,00
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
  {
    // Dipakai HANYA untuk bacaan tertambat blok (lihat `posisiPadaBlok`), sebagai
    // jangkar independen terhadap `readAavePosition`. Tidak ada logika yang
    // diduplikasi: yang dibaca fungsi view yang sama persis, lalu HASILNYA
    // dicocokkan dengan apa yang dilaporkan adapter.
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
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Event `Repay` pool — sumber tunggal untuk membuktikan SIAPA yang membayar. */
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
    // HANYA dipakai kontrol negatif di LANGKAH 5: selector ini sengaja TIDAK
    // ada di allowlist sesi, dan panggilannya wajib ditolak validator Altana.
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
// Perkakas kecil
// ---------------------------------------------------------------------------

class BuktiGagal extends Error {
  constructor(pesan: string) {
    super(pesan);
    this.name = "BuktiGagal";
  }
}

/**
 * Satu-satunya cara skrip ini menyatakan sesuatu benar. Klaim yang tidak
 * terbukti WAJIB menghentikan skrip — skrip yang mencetak "berhasil" tanpa
 * membuktikan HF naik lebih buruk daripada tidak ada skrip sama sekali.
 */
function wajib(kondisi: boolean, pesan: string): asserts kondisi {
  if (!kondisi) throw new BuktiGagal(pesan);
}

function butuhEnv(nama: string): string {
  const nilai = process.env[nama];
  // Sengaja hanya menyebut NAMA variabelnya, tidak pernah nilainya.
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

/** Satu transaksi yang sudah final, beserta tinggi blok tempat ia mendarat. */
interface TxTerkirim {
  hash: Hash;
  /** Blok receipt. Ini JANGKAR untuk semua bacaan sesudahnya — lihat `posisiPadaBlok`. */
  blockNumber: bigint;
}

/** Mengirim satu transaksi dan menolak keras bila receipt-nya bukan "success". */
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
 * Membaca ulang dari rantai sampai `syarat` terpenuhi, atau gagal keras.
 *
 * Ini BUKAN pelonggaran bukti: `syarat` tetap kondisi on-chain yang sama, dan
 * kalau ia tidak pernah terpenuhi skrip tetap mati dengan exit code bukan nol.
 * Yang ditoleransi hanya keterlambatan RPC. Endpoint publik BSC testnet adalah
 * kumpulan node di belakang satu nama: pada percobaan pertama skrip ini,
 * `eth_getTransactionReceipt` sudah menjawab dari node yang punya blok
 * 129832787, sementara `eth_call` berikutnya dilayani node yang masih di
 * 129832786 — sehingga harga baru "belum ada" padahal transaksinya sudah
 * final. Menyimpulkan kegagalan dari bacaan basi seperti itu akan menghasilkan
 * bukti yang salah ke dua arah.
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
      // Bacaan yang DITAMBATKAN ke tinggi blok tertentu ditolak oleh node yang
      // belum punya blok itu ("header not found") — itu justru sifat yang
      // diinginkan: node basi mengeluh, bukan diam-diam menjawab dari masa lalu.
      // Percobaan berikutnya kemungkinan besar mendarat di node lain.
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
 * `getUserAccountData` yang DITAMBATKAN ke satu tinggi blok tertentu.
 *
 * Ini jangkar struktural untuk seluruh bukti. `bacaSampai` sendiri hanya
 * mencoba ulang sampai kondisinya konsisten — ia menerima node pertama yang
 * setuju, dan keamanannya bertumpu pada kebetulan bahwa dalam skenario ini
 * state hanya bergerak satu arah. `eth_call` dengan `blockNumber` eksplisit
 * tidak punya celah itu: node yang belum punya blok tersebut MELEMPAR
 * ("header not found"), bukan diam-diam menjawab dari masa lalu. Jadi nilai
 * yang kembali dari sini benar-benar nilai pada blok transaksi yang dimaksud.
 *
 * Tidak ada logika yang diduplikasi: yang dipanggil fungsi view yang sama
 * dengan yang dipakai `readAavePosition`, dan hasilnya justru dipakai untuk
 * MENCOCOKKAN apa yang dilaporkan adapter — kalau keduanya berbeda, skrip
 * gagal keras.
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
    () => true, // yang ditunggu bukan nilainya, tapi node yang punya blok itu
    `${label} (tertambat di blok ${blok})`,
  );
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * Sarana pemulihan keadaan testnet. Begitu harga mBNB diturunkan, posisi contoh
 * berada di ~HF 1,15 dan akan TETAP di sana kalau skrip mati di tengah jalan —
 * itu sudah pernah terjadi (percobaan pertama), dan seorang manusia harus
 * mereset harga lewat `cast`. Objek ini dipegang pemanggil di luar `main`
 * supaya `finally` di sana bisa memulihkan harga pada jalur gagal MAUPUN sukses,
 * tanpa pernah mengubah exit code.
 */
interface Pemulihan {
  perlu: boolean;
  jalankan?: () => Promise<void>;
}

async function main(pemulihan: Pemulihan): Promise<void> {
  // --- 0. Rahasia -----------------------------------------------------------
  // Dimuat dari file, tidak pernah dicetak, tidak pernah disalin ke mana pun.
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../app/agent/scripts
  const agentDir = path.resolve(here, "..");
  const repoRoot = path.resolve(agentDir, "../../../.."); // .../worktree
  loadEnv(path.join(repoRoot, "contracts/.env")); // PRIVATE_KEY, BSC_TESTNET_RPC_URL
  loadEnv(path.resolve(agentDir, "../../.studio/.env.local")); // OPENAI_API_KEY (kunci dGrid)
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: kunci dGrid di ai/.env memakai nama DGRID_API_KEY.
    loadEnv(path.join(repoRoot, "ai/.env"));
    if (process.env.DGRID_API_KEY) process.env.OPENAI_API_KEY = process.env.DGRID_API_KEY;
  }

  const rpcUrl = process.env.BSC_TESTNET_RPC_URL ?? DEFAULT_BSC_TESTNET_RPC_URL;
  const account = privateKeyToAccount(butuhEnv("PRIVATE_KEY") as `0x${string}`);

  // --- 1. Klien -------------------------------------------------------------
  // Pembaca posisi datang dari modul yang sudah ada, apa adanya.
  const reader = createTestnetReader(rpcUrl);
  const publicClient: PublicClient = reader.client;
  const wallet: WalletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  // Sesi Altana ber-batas. `deserializeSession` sendiri yang memverifikasi
  // bahwa kunci di dalam file menurunkan `publicKey` yang tercatat; bagian
  // `signer`-nya tidak pernah dibaca, dicetak, atau disalin di skrip ini.
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

  // Izin sesi diperiksa DI SINI, sebelum satu transaksi pun dikirim — termasuk
  // sebelum `setAnswer` LANGKAH 2. Sesi yang terlalu longgar harus menghentikan
  // skrip selagi keadaan testnet masih utuh, bukan setelah harga diturunkan.
  // `createSessionSendRepay` memeriksa hal yang sama lagi saat dikonstruksi;
  // pengulangan itu disengaja dan murah.
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

  // --- 2. Posisi awal -------------------------------------------------------
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

  // --- 3. Hitung harga sasaran dari rumus HF --------------------------------
  judul("LANGKAH 2 — Menurunkan harga mBNB sampai HF masuk zona PARTIAL_REPAY");

  // HF = collateral × ltBps × 1e18 / (BPS × debt), dan collateral berbanding
  // lurus dengan harga mBNB (satu-satunya aset agunan posisi ini). Membalik
  // rumus itu untuk harga:
  //   hargaSasaran = hargaSekarang × TARGET_HF × BPS × debt
  //                  / (collateral × ltBps × 1e18)
  // Pembagian bigint membulatkan ke bawah, jadi HF hasilnya sedikit DI BAWAH
  // TARGET_HF — arah yang aman karena menjauh dari batas atas zona.
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

  // Ramalan lokal SEBELUM membakar gas: kalau perhitungannya salah, gagal di
  // sini, bukan setelah transaksi terkirim. Memakai computeHealthFactor yang
  // sama dengan yang dipakai produksi.
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

  // Pemulihan didaftarkan SEBELUM harga diturunkan, supaya tidak ada celah
  // antara "harga sudah jatuh" dan "ada yang tahu cara mengembalikannya".
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

  // Jahitan uji untuk jalur pemulihan. Jalur `finally` hanya berguna kalau ia
  // benar-benar berjalan, dan satu-satunya cara membuktikan itu adalah gagal
  // dengan sengaja tepat setelah harga diturunkan — persis bentuk kegagalan
  // yang pernah terjadi sungguhan. Tidak pernah aktif tanpa env var ini.
  if (process.env.E2E_PAKSA_GAGAL_SETELAH_TURUN === "1") {
    throw new BuktiGagal(
      "Kegagalan disengaja (E2E_PAKSA_GAGAL_SETELAH_TURUN=1) untuk menguji jalur pemulihan harga.",
    );
  }

  // --- 4. Assert dari bacaan on-chain sungguhan -----------------------------
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

  // Jangkar: nilai yang sama dibaca ulang PADA BLOK transaksi penurunan harga.
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

  // --- 5. Satu siklus Guardian ---------------------------------------------
  judul("LANGKAH 3 — Satu siklus Guardian (decide → execute → explain)");

  // Konfigurasi aset dibaca dari pool, bukan diasumsikan: dari sini datang
  // desimal token dan feed harganya, yang dipakai mengubah USD basis 8 desimal
  // (satuan `executeDecision`) menjadi satuan token mUSD.
  const [feedRepay, , , desimalRepay, aktifRepay] = await publicClient.readContract({
    address: MOCK_LENDING_POOL_ADDRESS,
    abi: POOL_ABI,
    functionName: "assets",
    args: [REPAY_ASSET_ADDRESS],
  });
  wajib(aktifRepay, `Aset repay ${REPAY_ASSET_ADDRESS} tidak aktif di pool.`);

  const [, hargaRepayRaw] = await publicClient.readContract({
    address: feedRepay,
    abi: PRICE_FEED_ABI,
    functionName: "latestRoundData",
  });
  wajib(
    hargaRepayRaw > 0n,
    `Harga aset repay tidak masuk akal: ${formatUsd8(hargaRepayRaw)} (${hargaRepayRaw}).`,
  );
  const hargaRepay = hargaRepayRaw;
  console.log(`Aset repay: desimal=${desimalRepay}, harga=${formatUsd8(hargaRepay)}, feed=${feedRepay}`);

  /** Tx repay yang benar-benar terkirim; dicatat untuk dicocokkan dengan hasil siklus. */
  const txRepayTercatat: TxTerkirim[] = [];

  /**
   * Toleransi pembulatan untuk mencocokkan jumlah, dalam satuan basis 8 desimal.
   * 2 unit = $0,00000002. Diperlukan karena ada DUA pembulatan ke bawah yang
   * saling bebas: USD8 → unit token di `sendRepay`, dan unit token → USD8 di
   * `MockLendingPool._valueUsd8`. Masing-masing kehilangan kurang dari satu
   * unit, jadi selisih maksimum yang sah adalah 2. Lebih besar dari itu berarti
   * konversinya memang salah, bukan sekadar dibulatkan.
   */
  const TOLERANSI_USD8 = 2n;

  /** Receipt transaksi `repay` yang benar-benar mendarat; dipakai membuktikan pengirimnya. */
  let receiptRepay: RelayResult["receipt"] = null;

  /**
   * Konversi satuan — SATU-SATUNYA bagian "jembatan" yang tetap tinggal di
   * skrip ini. `createSessionSendRepay` sengaja tidak mengurusnya: modul itu
   * hanya menandatangani dan mengirim, sementara desimal token, harga feed,
   * dan pemeriksaan bolak-balik adalah urusan skenario ini.
   */
  const toTokenUnits = async (asset: `0x${string}`, amountUsd8: bigint): Promise<bigint> => {
    const jumlahToken = (amountUsd8 * 10n ** BigInt(desimalRepay)) / hargaRepay;
    console.log(
      `\n  sendRepay: ${formatUsd8(amountUsd8)} → ${jumlahToken} unit token (${desimalRepay} desimal)`,
    );
    wajib(
      jumlahToken > 0n,
      `Konversi jumlah repay menghasilkan nol unit token dari ${formatUsd8(amountUsd8)} (${amountUsd8}).`,
    );

    // Konversi diperiksa BOLAK-BALIK sebelum sepeser pun dikirim. Inilah tempat
    // kesalahan satu orde bisa masuk tanpa terlihat: kalau `desimalRepay`
    // terbaca 17, atau `hargaRepay` datang dari feed yang salah, agent membayar
    // sepersepuluh dari yang dilaporkannya — hutang tetap berkurang, HF tetap
    // naik, dan tanpa pemeriksaan ini semua assert lain tetap lolos.
    const balikanUsd8 = (jumlahToken * hargaRepay) / 10n ** BigInt(desimalRepay);
    const selisihBalikan =
      balikanUsd8 > amountUsd8 ? balikanUsd8 - amountUsd8 : amountUsd8 - balikanUsd8;
    wajib(
      selisihBalikan <= TOLERANSI_USD8,
      `Konversi USD→token tidak bolak-balik: ${formatUsd8(amountUsd8)} → ${jumlahToken} unit → ` +
        `${formatUsd8(balikanUsd8)} (selisih ${selisihBalikan} unit basis 8 desimal, ` +
        `maksimum ${TOLERANSI_USD8}). Desimal atau feed harga aset repay kemungkinan salah.`,
    );

    const saldo = await publicClient.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [posisiAkun],
    });
    wajib(
      saldo >= jumlahToken,
      `Saldo token repay kurang: ${saldo} unit < ${jumlahToken} unit yang dibutuhkan.`,
    );

    return jumlahToken;
  };

  /**
   * Penanda tangan repay: **session key Altana ber-batas**, bukan EOA deployer.
   * `createSessionSendRepay` memeriksa allowlist sesi lebih dulu dan menolak
   * berjalan sama sekali kalau `calls`-nya kosong/hilang (= izin tanpa batas
   * di Altana) atau lebih luas daripada `repay` + `approve`.
   */
  const sendRepay = createSessionSendRepay({
    walletAddress: posisiAkun,
    pool: MOCK_LENDING_POOL_ADDRESS,
    repayAsset: REPAY_ASSET_ADDRESS,
    permissions: izinSesi,
    toTokenUnits,
    readAllowance: (asset, owner, spender) =>
      publicClient.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, spender],
      }),
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
    log: (pesan) => console.log(`  ${pesan}`),
  });

  const sekarang = () => Math.floor(Date.now() / 1000);
  const stateAwal: ExecuteState = {
    spentTodayUsd8: 0n,
    dayStartedAt: sekarang(),
    lastActionAt: 0,
    killed: false,
  };

  // `executeDecision` dipakai apa adanya; hanya `limits` dan `deps` yang
  // di-partial-apply — `state` tetap mengalir eksplisit dari runGuardCycle.
  const execFn: ExecuteFn = (decision, pos, state) =>
    executeDecision(decision, pos, LIMITS, state, { sendRepay, now: sekarang });

  const logger: Logger = {
    info: (m, meta) => console.log(`  [guard] ${m}${meta ? ` ${JSON.stringify(meta, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` : ""}`),
    error: (m, meta) => console.error(`  [guard] ERROR ${m}${meta ? ` ${JSON.stringify(meta, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` : ""}`),
  };

  const t0 = Date.now();
  const outcome = await runGuardCycle(
    {
      account: posisiAkun,
      readPosition: reader.readPosition,
      executeDecision: execFn,
      explainDecision,
      now: sekarang,
      logger,
    },
    stateAwal,
  );
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

  // --- 5b. Siapa yang sebenarnya membayar ----------------------------------
  // Ini klaim inti task ini, dan ia dibuktikan dari RECEIPT, bukan dari niat
  // kode. `MockLendingPool.repay` hanya mengurangi hutang `msg.sender`, dan
  // `Repay(address indexed user, ...)` mencatat `msg.sender` itu. Jadi kalau
  // `user` pada event adalah wallet Altana, maka yang memanggil pool memang
  // wallet Altana — lewat session key ber-batas, bukan EOA deployer.
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

  // Kontrol negatif, dengan OBJEK SESI YANG SAMA yang baru saja membayar.
  // Tanpa ini, "ber-batas" hanya kata: sesi yang bisa repay harus terbukti
  // TIDAK bisa melakukan apa pun di luar allowlist-nya. `mUSD.transfer` dipilih
  // karena kontraknya justru ADA di allowlist (untuk `approve`) — jadi yang
  // diuji adalah pengikatan pada tingkat selector, bukan sekadar kontrak.
  // Penolakan datang dari validator akun Altana, bukan dari kode kita.
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
    // Menuntut alasan penolakannya, bukan sekadar keberadaan exception: relay
    // 502, receipt timeout, dan nonce race juga melempar, dan tidak satu pun
    // membuktikan batas sesi. Bentuk lain dilempar ulang dan mematikan E2E.
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

  // --- 6. HF sesudah, dari bacaan on-chain ---------------------------------
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

  // Jangkar kedua: nilai yang sama dibaca ulang PADA BLOK transaksi repay.
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

  // Agunan tidak boleh berubah: repay hanya menyentuh sisi hutang. Kalau angka
  // ini bergeser, ada aktor lain di posisi yang sama dan seluruh perbandingan
  // "sebelum/sesudah" kehilangan artinya.
  wajib(
    posSesudah.collateralBase === posTertekan.collateralBase,
    `Agunan ikut berubah (${formatUsd8(posTertekan.collateralBase)} → ` +
      `${formatUsd8(posSesudah.collateralBase)}); ada yang menyentuh posisi selain skrip ini.`,
  );

  // ————— Klaim yang paling akan dibaca orang: BERAPA yang dibayar. —————
  // Sampai di sini "$…" masih semata-mata keluaran `executeDecision`. Yang
  // membuatnya menjadi bukti adalah baris di bawah: selisih hutang yang
  // BENAR-BENAR terjadi di rantai harus sama dengan jumlah yang diklaim.
  // Tanpa ini, konversi satuan yang meleset satu orde membuat agent membayar
  // sepersepuluh dari yang tercetak, sementara semua assert lain tetap lolos.
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
  // Label zona diambil dari `decide` yang sama dengan yang dipakai Guardian,
  // bukan dari tangga ambang yang ditulis ulang di sini — kalau ambangnya kelak
  // berubah, cetakan ini ikut berubah dengan sendirinya.
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

  // --- 7. Kembalikan harga --------------------------------------------------
  // Dilakukan HANYA setelah seluruh bukti di atas terkumpul, supaya keadaan
  // testnet bisa dipakai ulang. Biayanya satu transaksi ~30k gas.
  judul("LANGKAH 7 — Mengembalikan harga mBNB ke nilai semula");
  // Jalur sukses memakai penutup yang SAMA dengan jalur gagal (lihat `finally`
  // di bawah `main`), supaya keduanya tidak bisa menyimpang satu sama lain.
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
// Titik masuk
// ---------------------------------------------------------------------------
//
// `finally` di sini ada karena satu kegagalan yang SUDAH terjadi: percobaan
// pertama skrip ini mati setelah harga mBNB diturunkan, meninggalkan posisi
// contoh pada ~HF 1,15 sampai seorang manusia meresetnya lewat `cast`. Demo
// yang mati di tengah jaringan lambat akan menampilkan posisi yang tampak
// nyaris terlikuidasi kepada siapa pun yang membuka BscScan berikutnya.
//
// Pemulihan TIDAK PERNAH mengubah exit code: kegagalannya sendiri hanya
// dicetak sebagai peringatan lengkap dengan perintah manualnya, dan kegagalan
// asli tetap yang menentukan nasib proses.
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
