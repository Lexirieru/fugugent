/**
 * Adapter Venus, membaca likuiditas akun sungguhan di BSC **mainnet**.
 * Venus dan Aave v3 hanya ada di BSC mainnet (chain 56), tidak di testnet,
 * jadi pembacaan ini sengaja menyasar mainnet. Read-only lewat `eth_call`,
 * tidak ada transaksi dan tidak berbiaya. Eksekusi transaksi agent tetap
 * berjalan di testnet — hanya pembacaan posisi ini yang lintas ke mainnet.
 *
 * BELUM TERHUBUNG KE `decide()` — dan itu disengaja. `decide()` bekerja di atas
 * `Position`, yang butuh health factor dan satu ambang likuidasi agregat.
 * Comptroller Venus tidak menyediakan keduanya: `getAccountLiquidity` hanya
 * memberi selisih likuiditas/shortfall dalam USD, tanpa health factor dan
 * tanpa collateral factor gabungan. Untuk menyusun `Position` dari Venus,
 * kita harus mengambil data PER-MARKET (daftar vToken lewat `getAssetsIn`,
 * `markets(vToken).collateralFactorMantissa`, saldo snapshot tiap vToken, dan
 * harga tiap aset dari oracle) lalu menjumlahkannya sendiri — data yang belum
 * diambil sama sekali oleh adapter ini. Sampai itu ada, angka Venus di sini
 * hanya untuk pemantauan/diagnostik, BUKAN masukan keputusan.
 */
import type { PublicClient } from "viem";
import { PositionError } from "../types.js";

/** Alamat Venus Comptroller di BSC mainnet, terverifikasi live. */
export const VENUS_COMPTROLLER_ADDRESS = "0xfD36E2c2a6789Db23113685031d7F16329158384" as const;

const VENUS_COMPTROLLER_ABI = [
  {
    type: "function",
    name: "getAccountLiquidity",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "error", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "shortfall", type: "uint256" },
    ],
  },
] as const;

/**
 * PERHATIAN SATUAN: skala di sini BERBEDA dari `Position`.
 *
 * Semua field `*Base` pada `Position` memakai basis 8 desimal Aave (1e8 = $1),
 * sedangkan Venus mengembalikan nilai USD dalam mantissa 1e18 (1e18 = $1) —
 * selisihnya 10^10. Karena itu field di bawah TIDAK memakai sufiks `Base`:
 * nama `liquidityBase` sebelumnya membuat nilai ini tampak bisa langsung
 * dibandingkan atau dijumlahkan dengan `collateralBase`/`debtBase`, padahal
 * hasilnya akan meleset sepuluh miliar kali lipat. Konversi eksplisit
 * (bagi 10^10) wajib dilakukan sebelum nilai ini bertemu angka bergaya Aave.
 */
export interface VenusLiquidity {
  /** Sisa likuiditas akun dalam USD, mantissa 1e18 (bukan basis 8 desimal Aave). */
  liquidityUsd18: bigint;
  /** Kekurangan agunan akun dalam USD, mantissa 1e18; > 0 berarti sudah bisa dilikuidasi. */
  shortfallUsd18: bigint;
  blockNumber: bigint;
}

/**
 * Membaca likuiditas Venus satu akun pada blok terbaru mainnet.
 * Bila kode `error` yang dikembalikan comptroller bukan 0n, lempar
 * `PositionError` yang menyebut kode itu — pemanggil bisa menanganinya
 * tanpa harus menebak arti angka mentah.
 */
export async function readVenusLiquidity(
  client: PublicClient,
  account: `0x${string}`,
): Promise<VenusLiquidity> {
  const [[error, liquidity, shortfall], blockNumber] = await Promise.all([
    client.readContract({
      address: VENUS_COMPTROLLER_ADDRESS,
      abi: VENUS_COMPTROLLER_ABI,
      functionName: "getAccountLiquidity",
      args: [account],
    }),
    client.getBlockNumber(),
  ]);

  if (error !== 0n) {
    throw new PositionError(`Venus getAccountLiquidity mengembalikan kode error ${error}.`);
  }

  return {
    liquidityUsd18: liquidity,
    shortfallUsd18: shortfall,
    blockNumber,
  };
}
