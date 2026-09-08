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
 * Membaca posisi Aave v3 satu akun pada blok terbaru mainnet.
 * `healthFactor` dinormalkan menjadi null bila sentinel 2^256-1 ATAU
 * tidak ada hutang sama sekali — seluruh lapisan strategi memperlakukan
 * null sebagai "tidak ada risiko", bukan angka besar yang harus dibandingkan.
 */
export async function readAavePosition(
  client: PublicClient,
  account: `0x${string}`,
): Promise<Position> {
  if (!client.chain) {
    throw new PositionError("Client viem tidak memiliki konfigurasi chain.");
  }

  const [
    [totalCollateralBase, totalDebtBase, , currentLiquidationThreshold, , healthFactorRaw],
    blockNumber,
  ] = await Promise.all([
    client.readContract({
      address: AAVE_V3_POOL_ADDRESS,
      abi: AAVE_POOL_ABI,
      functionName: "getUserAccountData",
      args: [account],
    }),
    client.getBlockNumber(),
  ]);

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
