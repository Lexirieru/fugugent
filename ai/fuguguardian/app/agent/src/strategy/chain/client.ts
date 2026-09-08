/**
 * Konstruksi viem `PublicClient` bersama untuk kedua adapter on-chain
 * (Aave v3 dan Venus). Ditaruh di file sendiri karena keduanya memakainya.
 * Membaca dari BSC **mainnet** dengan sengaja — Venus dan Aave v3 hanya
 * ada di sana, tidak di testnet — sehingga health factor yang dibaca adalah
 * posisi sungguhan, bukan simulasi. Read-only, tidak ada transaksi.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import { readAavePosition as readAavePositionAdapter } from "./aave.js";
import { readVenusLiquidity as readVenusLiquidityAdapter } from "./venus.js";
import type { Position } from "../types.js";
import type { VenusLiquidity } from "./venus.js";

/** RPC BSC mainnet yang sudah diverifikasi live. Cadangan: bsc-rpc.publicnode.com. */
export const DEFAULT_BSC_RPC_URL = "https://bsc-dataseed.bnbchain.org";

export interface Reader {
  client: PublicClient;
  readAavePosition(account: `0x${string}`): Promise<Position>;
  readVenusLiquidity(account: `0x${string}`): Promise<VenusLiquidity>;
}

/**
 * Membangun `PublicClient` viem terhadap chain `bsc` dan mengembalikan
 * adapter Aave/Venus yang sudah terikat ke client tersebut. Adapter sendiri
 * (`readAavePosition`, `readVenusLiquidity`) tetap menerima `client` sebagai
 * parameter eksplisit sehingga bisa diuji terpisah dari `createReader`.
 */
export function createReader(rpcUrl: string = DEFAULT_BSC_RPC_URL): Reader {
  const client = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });

  return {
    client,
    readAavePosition: (account) => readAavePositionAdapter(client, account),
    readVenusLiquidity: (account) => readVenusLiquidityAdapter(client, account),
  };
}
