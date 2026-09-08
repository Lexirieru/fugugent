/**
 * Adapter Aave v3, membaca posisi pinjaman sungguhan di BSC **mainnet**.
 * Venus dan Aave v3 hanya ada di BSC mainnet (chain 56), tidak di testnet,
 * jadi pembacaan ini sengaja menyasar mainnet. Read-only lewat `eth_call`,
 * tidak ada transaksi dan tidak berbiaya. Eksekusi transaksi agent tetap
 * berjalan di testnet — hanya pembacaan posisi ini yang lintas ke mainnet.
 */
import type { PublicClient } from "viem";
import { PositionError, type Position } from "../types.js";

/** Alamat Aave v3 Pool di BSC mainnet, terverifikasi live. */
export const AAVE_V3_POOL_ADDRESS = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as const;

/** Sentinel yang dikembalikan Aave untuk healthFactor saat tidak ada hutang. */
const HF_SENTINEL_NO_DEBT = 2n ** 256n - 1n;

const AAVE_POOL_ABI = [
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

/**
 * Membaca posisi Aave v3 satu akun, DITAMBATKAN ke satu tinggi blok.
 * `healthFactor` dinormalkan menjadi null bila sentinel 2^256-1 ATAU
 * tidak ada hutang sama sekali — seluruh lapisan strategi memperlakukan
 * null sebagai "tidak ada risiko", bukan angka besar yang harus dibandingkan.
 *
 * JANGAN menghitung `healthFactor` sendiri di sini. Ia WAJIB tetap diambil apa
 * adanya dari tuple `getUserAccountData` (indeks 5), yaitu angka yang dihitung
 * protokol sendiri. `__tests__/testnet.test.ts` memakai fakta itu sebagai uji
 * diferensial: HF dari protokol dicocokkan dengan `computeHealthFactor` versi
 * TypeScript atas bacaan yang sama, dan itulah yang menangkap indeks tuple
 * tertukar atau satuan yang meleset. Begitu fungsi ini menghitung HF-nya
 * sendiri, test tersebut berubah menjadi tautologi yang hijau selamanya tanpa
 * menguji apa pun — dan tidak ada yang akan memperingatkan.
 */
export async function readAavePosition(
  client: PublicClient,
  account: `0x${string}`,
  /**
   * Alamat pool `getUserAccountData`. Default ke Aave v3 mainnet supaya
   * pemanggil lama tetap jalan tanpa perubahan. Adapter testnet
   * (`chain/testnet.ts`) menyuntikkan alamat `MockLendingPool` di sini —
   * logika pembacaan di bawah ini tidak berubah sama sekali.
   */
  poolAddress: `0x${string}` = AAVE_V3_POOL_ADDRESS,
): Promise<Position> {
  if (!client.chain) {
    throw new PositionError("Client viem tidak memiliki konfigurasi chain.");
  }

  // Blok diambil LEBIH DULU, lalu bacaannya ditambatkan ke blok itu.
  //
  // Sebelumnya keduanya ditembakkan sebagai dua panggilan RPC independen di
  // dalam `Promise.all`: `readContract` pada blok "latest" menurut node yang
  // melayaninya, dan `getBlockNumber()` terpisah. Keduanya bisa jatuh di sisi
  // berlawanan dari sebuah blok baru, sehingga `Position.blockNumber` hanya
  // kira-kira blok datanya. Untuk E2E itu tidak terlihat (ia menambatkan
  // bacaannya sendiri), tetapi indexer backend yang mewarisi adapter ini akan
  // mencatat "blok X melaporkan hutang Y" yang meleset satu blok — bug diam
  // yang tidak punya gejala sampai ada yang merekonsiliasi angkanya.
  //
  // Harganya satu panggilan RPC berurutan, bukan paralel. Node yang belum punya
  // blok itu MELEMPAR ("header not found") alih-alih diam-diam menjawab dari
  // masa lalu — arah kegagalan yang benar.
  const blockNumber = await client.getBlockNumber();
  const [totalCollateralBase, totalDebtBase, , currentLiquidationThreshold, , healthFactorRaw] =
    await client.readContract({
      address: poolAddress,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [account],
      blockNumber,
    });

  const healthFactor =
    healthFactorRaw === HF_SENTINEL_NO_DEBT || totalDebtBase === 0n ? null : healthFactorRaw;

  return {
    protocol: "aave",
    account,
    collateralBase: totalCollateralBase,
    debtBase: totalDebtBase,
    liquidationThresholdBps: currentLiquidationThreshold,
    healthFactor,
    blockNumber,
  };
}
