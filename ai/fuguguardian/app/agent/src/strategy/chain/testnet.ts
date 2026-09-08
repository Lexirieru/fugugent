/**
 * Adapter testnet, membaca posisi di `MockLendingPool` BSC testnet.
 * Memakai `readAavePosition` yang sudah ada apa adanya — hanya alamat pool
 * yang berbeda. Mock ini sengaja dibuat ABI-kompatibel dengan
 * `getUserAccountData` Aave v3 (diverifikasi manual lewat `cast call`
 * sebelum file ini ditulis), sehingga logika pembacaan tidak perlu ditulis
 * ulang atau disalin sama sekali.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { readAavePosition as readAavePositionAdapter } from "./aave.js";
import type { Position } from "../types.js";

/** RPC BSC testnet yang sudah diverifikasi live. */
export const DEFAULT_BSC_TESTNET_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

/** Alamat `MockLendingPool` di BSC testnet, terverifikasi live. */
export const MOCK_LENDING_POOL_ADDRESS = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;

/**
 * Alamat token hutang yang dibayar Guardian di testnet: `MockTokenUSD` (mUSD),
 * 18 desimal, satu-satunya aset hutang pada `MockLendingPool`.
 *
 * Rumahnya di sini, bukan di `execute.ts`. Modul eksekusi murni dan bebas I/O;
 * sebuah alamat rantai di dalamnya mengikatnya pada satu aset di satu chain,
 * sehingga agent kedua, protokol kedua, atau mainnet tidak bisa memakainya
 * tanpa mengedit file. `executeDecision` sekarang menerima asetnya lewat
 * `ExecuteDeps.repayAsset`.
 */
export const REPAY_ASSET_ADDRESS = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

export interface TestnetReader {
  client: PublicClient;
  readPosition(account: `0x${string}`): Promise<Position>;
}

/**
 * Membangun `PublicClient` viem terhadap `bscTestnet` dan mengembalikan
 * `readPosition` yang terikat ke `MockLendingPool`. Tidak ada logika
 * pembacaan baru di sini — hanya konstruksi client dan penyuntikan alamat
 * pool ke `readAavePosition`.
 */
export function createTestnetReader(
  rpcUrl: string = DEFAULT_BSC_TESTNET_RPC_URL,
): TestnetReader {
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  });

  return {
    client,
    readPosition: (account) =>
      readAavePositionAdapter(client, account, MOCK_LENDING_POOL_ADDRESS),
  };
}
