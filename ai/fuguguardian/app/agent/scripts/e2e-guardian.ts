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
import { createWalletClient, http, type Hash, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import {
  createTestnetReader,
  DEFAULT_BSC_TESTNET_RPC_URL,
  MOCK_LENDING_POOL_ADDRESS,
} from "../src/strategy/chain/testnet.js";
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

/** Mengirim satu transaksi dan menolak keras bila receipt-nya bukan "success". */
async function kirim(
  publicClient: PublicClient,
  jalankan: () => Promise<Hash>,
  label: string,
): Promise<Hash> {
  const hash = await jalankan();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  wajib(
    receipt.status === "success",
    `Transaksi ${label} gagal on-chain (status=${receipt.status}, tx=${hash}).`,
  );
  console.log(`  tx ${label.padEnd(10)}: ${hash}`);
  console.log(`     gas terpakai : ${receipt.gasUsed}`);
  console.log(`     ${tautanTx(hash)}`);
  return hash;
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
  for (let i = 1; i <= maksPercobaan; i++) {
    terakhir = await baca();
    if (syarat(terakhir)) {
      if (i > 1) console.log(`  (bacaan "${label}" konsisten setelah ${i} percobaan)`);
      return terakhir;
    }
    await new Promise((r) => setTimeout(r, jedaMs));
  }
  throw new BuktiGagal(
    `Bacaan on-chain "${label}" tidak pernah memenuhi syarat setelah ${maksPercobaan} percobaan ` +
      `(~${(maksPercobaan * jedaMs) / 1000}s). Nilai terakhir: ${JSON.stringify(terakhir, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
  );
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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

  judul("FUGU GUARDIAN — E2E di BSC testnet (chainId 97)");
  console.log(`RPC             : ${rpcUrl}`);
  console.log(`Akun            : ${account.address}`);
  console.log(`MockLendingPool : ${MOCK_LENDING_POOL_ADDRESS}`);
  console.log(`MockPriceFeedBNB: ${MOCK_PRICE_FEED_BNB}`);
  console.log(`Aset repay      : ${REPAY_ASSET_ADDRESS} (mUSD)`);
  console.log(
    `Ambang          : warn=${formatHf(DEFAULT_THRESHOLDS.warn)} partialRepay=${formatHf(DEFAULT_THRESHOLDS.partialRepay)} deleverage=${formatHf(DEFAULT_THRESHOLDS.deleverage)}`,
  );

  const chainId = await publicClient.getChainId();
  wajib(chainId === 97, `Chain salah: ${chainId}, harus 97 (BSC testnet).`);

  const tbnbAwal = await publicClient.getBalance({ address: account.address });
  console.log(`Saldo tBNB awal : ${tbnbAwal} wei`);

  // --- 2. Posisi awal -------------------------------------------------------
  judul("LANGKAH 1 — Posisi contoh sebelum apa pun disentuh");
  const posAwal = await reader.readPosition(account.address);
  cetakPosisi("Posisi awal (dibaca lewat readAavePosition apa adanya):", posAwal);
  wajib(posAwal.healthFactor !== null, "Posisi contoh tidak punya hutang; tidak ada yang bisa dibuktikan.");
  wajib(posAwal.collateralBase > 0n, "Posisi contoh tidak punya agunan.");
  const hfAwal = posAwal.healthFactor;

  const [, hargaAwalRaw] = await publicClient.readContract({
    address: MOCK_PRICE_FEED_BNB,
    abi: PRICE_FEED_ABI,
    functionName: "latestRoundData",
  });
  wajib(hargaAwalRaw > 0n, `Harga mBNB tidak masuk akal: ${hargaAwalRaw}.`);
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
  wajib(hargaSasaran > 0n, `Harga sasaran terhitung nol atau negatif: ${hargaSasaran}.`);
  wajib(
    hargaSasaran < hargaAwal,
    `Harga sasaran ${hargaSasaran} tidak lebih rendah dari harga sekarang ${hargaAwal}; posisi sudah berisiko?`,
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
    `Ramalan HF ${hfRamalan} di luar zona PARTIAL_REPAY; transaksi dibatalkan sebelum gas terbakar.`,
  );

  console.log("");
  await kirim(
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

  // --- 4. Assert dari bacaan on-chain sungguhan -----------------------------
  console.log("");
  const posTertekan = await bacaSampai(
    () => reader.readPosition(account.address),
    (p) =>
      p.healthFactor !== null &&
      p.healthFactor > DEFAULT_THRESHOLDS.deleverage &&
      p.healthFactor <= DEFAULT_THRESHOLDS.partialRepay,
    "HF masuk zona PARTIAL_REPAY",
  );
  cetakPosisi("Posisi setelah harga turun (dibaca ulang on-chain):", posTertekan);
  wajib(posTertekan.healthFactor !== null, "HF null setelah harga turun.");
  const hfSebelum = posTertekan.healthFactor;
  wajib(
    hfSebelum > DEFAULT_THRESHOLDS.deleverage && hfSebelum <= DEFAULT_THRESHOLDS.partialRepay,
    `HF on-chain ${hfSebelum} (${formatHf(hfSebelum)}) TIDAK di zona PARTIAL_REPAY ` +
      `(${DEFAULT_THRESHOLDS.deleverage} < HF <= ${DEFAULT_THRESHOLDS.partialRepay}).`,
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
  wajib(hargaRepayRaw > 0n, `Harga aset repay tidak masuk akal: ${hargaRepayRaw}.`);
  const hargaRepay = hargaRepayRaw;
  console.log(`Aset repay: desimal=${desimalRepay}, harga=${formatUsd8(hargaRepay)}, feed=${feedRepay}`);

  /** Tx repay yang benar-benar terkirim; dicatat untuk dicocokkan dengan hasil siklus. */
  const txRepayTercatat: Hash[] = [];

  /**
   * Jembatan ke rantai: menerima jumlah USD basis 8 desimal dari
   * `executeDecision` dan mengirim `repay` sungguhan. Tidak ada keputusan di
   * sini — hanya konversi satuan, approve bila perlu, dan kirim.
   */
  const sendRepay = async (asset: `0x${string}`, amountUsd8: bigint): Promise<`0x${string}`> => {
    const jumlahToken = (amountUsd8 * 10n ** BigInt(desimalRepay)) / hargaRepay;
    console.log(
      `\n  sendRepay: ${formatUsd8(amountUsd8)} → ${jumlahToken} unit token (${desimalRepay} desimal)`,
    );
    wajib(jumlahToken > 0n, `Konversi jumlah repay menghasilkan nol unit token dari ${amountUsd8}.`);

    const saldo = await publicClient.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    wajib(saldo >= jumlahToken, `Saldo token repay kurang: ${saldo} < ${jumlahToken}.`);

    const izin = await publicClient.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, MOCK_LENDING_POOL_ADDRESS],
    });
    if (izin < jumlahToken) {
      await kirim(
        publicClient,
        () =>
          wallet.writeContract({
            account,
            chain: bscTestnet,
            address: asset,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [MOCK_LENDING_POOL_ADDRESS, jumlahToken],
          }),
        "approve",
      );
    }

    const hash = await kirim(
      publicClient,
      () =>
        wallet.writeContract({
          account,
          chain: bscTestnet,
          address: MOCK_LENDING_POOL_ADDRESS,
          abi: POOL_ABI,
          functionName: "repay",
          args: [asset, jumlahToken],
        }),
      "repay",
    );
    txRepayTercatat.push(hash);
    return hash;
  };

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
      account: account.address,
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
    txRepayTercatat.length === 1 && hasil.txHash === txRepayTercatat[0],
    `Tx hash dari siklus (${hasil.txHash}) tidak cocok dengan tx repay yang benar-benar dikirim ` +
      `(${txRepayTercatat.join(", ") || "tidak ada"}).`,
  );
  wajib(
    outcome.nextExecuteState.spentTodayUsd8 === hasil.amountSentUsd8,
    "Anggaran harian tidak bertambah sebesar jumlah yang dikirim.",
  );

  // --- 6. HF sesudah, dari bacaan on-chain ---------------------------------
  judul("LANGKAH 5 — Bukti: health factor naik setelah agent bertindak");
  const posSesudah = await bacaSampai(
    () => reader.readPosition(account.address),
    (p) => p.debtBase < posTertekan.debtBase,
    "hutang berkurang setelah repay",
  );
  cetakPosisi("Posisi setelah repay (dibaca ulang on-chain):", posSesudah);
  wajib(posSesudah.healthFactor !== null, "HF null setelah repay.");
  const hfSesudah = posSesudah.healthFactor;

  wajib(
    hfSesudah > hfSebelum,
    `HF TIDAK naik: sebelum ${hfSebelum}, sesudah ${hfSesudah}. Intervensi agent tidak terbukti.`,
  );
  wajib(
    posSesudah.debtBase < posTertekan.debtBase,
    `Hutang tidak berkurang: ${posTertekan.debtBase} → ${posSesudah.debtBase}.`,
  );

  const selisih = hfSesudah - hfSebelum;
  console.log("");
  console.log(`HF sebelum intervensi  : ${formatHf(hfSebelum)}  (${hfSebelum})`);
  console.log(`HF sesudah intervensi  : ${formatHf(hfSesudah)}  (${hfSesudah})`);
  console.log(`Selisih (naik)         : ${formatHf(selisih)}  (${selisih})`);
  console.log(`Hutang                 : ${formatUsd8(posTertekan.debtBase)} → ${formatUsd8(posSesudah.debtBase)}`);
  console.log(`Zona sekarang          : ${hfSesudah > DEFAULT_THRESHOLDS.warn ? "aman (di atas warn)" : hfSesudah > DEFAULT_THRESHOLDS.partialRepay ? "WARN" : "masih PARTIAL_REPAY"}`);
  console.log(`\n✔ Terbukti: posisi keluar dari zona PARTIAL_REPAY karena aksi agent.`);

  // --- 7. Kembalikan harga --------------------------------------------------
  // Dilakukan HANYA setelah seluruh bukti di atas terkumpul, supaya keadaan
  // testnet bisa dipakai ulang. Biayanya satu transaksi ~30k gas.
  judul("LANGKAH 6 — Mengembalikan harga mBNB ke nilai semula");
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

  const [, hargaAkhir] = await bacaSampai(
    () =>
      publicClient.readContract({
        address: MOCK_PRICE_FEED_BNB,
        abi: PRICE_FEED_ABI,
        functionName: "latestRoundData",
      }),
    ([, jawaban]) => jawaban === hargaAwal,
    "harga mBNB kembali ke nilai semula",
  );
  wajib(hargaAkhir === hargaAwal, `Harga gagal dikembalikan: ${hargaAkhir} != ${hargaAwal}.`);

  const posAkhir = await bacaSampai(
    () => reader.readPosition(account.address),
    (p) => p.collateralBase === posAwal.collateralBase,
    "agunan kembali ke nilai harga semula",
  );
  cetakPosisi("\nPosisi akhir (harga sudah pulih):", posAkhir);

  const tbnbAkhir = await publicClient.getBalance({ address: account.address });
  judul("RINGKASAN");
  console.log(`HF awal ($${formatUsd8(hargaAwal).slice(1)}/mBNB)      : ${formatHf(hfAwal)}`);
  console.log(`HF setelah harga turun          : ${formatHf(hfSebelum)}`);
  console.log(`HF setelah agent membayar       : ${formatHf(hfSesudah)}   (+${formatHf(selisih)})`);
  console.log(`HF akhir (harga dipulihkan)     : ${posAkhir.healthFactor === null ? "-" : formatHf(posAkhir.healthFactor)}`);
  console.log(`Dibayar agent                   : ${formatUsd8(hasil.amountSentUsd8)}`);
  console.log(`Tx repay                        : ${hasil.txHash}`);
  console.log(`                                  ${hasil.txHash ? tautanTx(hasil.txHash) : "-"}`);
  console.log(`tBNB awal                       : ${tbnbAwal} wei`);
  console.log(`tBNB akhir                      : ${tbnbAkhir} wei`);
  console.log(`Biaya seluruh skenario          : ${tbnbAwal - tbnbAkhir} wei`);
  console.log(`\nSEMUA KLAIM TERBUKTI.`);
}

main().catch((err: unknown) => {
  console.error(`\n✖ E2E GAGAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
