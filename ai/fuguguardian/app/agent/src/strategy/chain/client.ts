/**
 * Builds the shared viem `PublicClient` for both on-chain adapters (Aave v3 and Venus).
 * It lives in its own file because both use it. It reads from BSC **mainnet** on purpose —
 * Venus and Aave v3 only exist there, not on testnet — so the health factor read is a real
 * position, not a simulation. Read-only, no transactions.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import { readAavePosition as readAavePositionAdapter } from "./aave.js";
import { readVenusLiquidity as readVenusLiquidityAdapter } from "./venus.js";
import type { Position } from "../types.js";
import type { VenusLiquidity } from "./venus.js";

/** A BSC mainnet RPC verified live. Backup: bsc-rpc.publicnode.com. */
export const DEFAULT_BSC_RPC_URL = "https://bsc-dataseed.bnbchain.org";

export interface Reader {
  client: PublicClient;
  readAavePosition(account: `0x${string}`): Promise<Position>;
  readVenusLiquidity(account: `0x${string}`): Promise<VenusLiquidity>;
}

/**
 * Builds a viem `PublicClient` against the `bsc` chain and returns Aave/Venus adapters
 * already bound to that client. The adapters themselves (`readAavePosition`,
 * `readVenusLiquidity`) still take `client` as an explicit parameter so they can be tested
 * separately from `createReader`.
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
