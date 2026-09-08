/**
 * Adapter Venus, membaca likuiditas akun sungguhan di BSC **mainnet**.
 * Venus dan Aave v3 hanya ada di BSC mainnet (chain 56), tidak di testnet,
 * jadi pembacaan ini sengaja menyasar mainnet. Read-only lewat `eth_call`,
 * tidak ada transaksi dan tidak berbiaya. Eksekusi transaksi agent tetap
 * berjalan di testnet — hanya pembacaan posisi ini yang lintas ke mainnet.
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

export interface VenusLiquidity {
  liquidityBase: bigint;
  shortfallBase: bigint;
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
    liquidityBase: liquidity,
    shortfallBase: shortfall,
    blockNumber,
  };
}
