/**
 * The testnet adapter, reading positions from `MockLendingPool` on BSC testnet.
 * It uses the existing `readAavePosition` as-is — only the pool address differs. That mock
 * is deliberately ABI-compatible with Aave v3's `getUserAccountData` (verified by hand via
 * `cast call` before this file was written), so the reading logic does not have to be
 * rewritten or copied at all.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { readAavePosition as readAavePositionAdapter } from "./aave.js";
import type { Position } from "../types.js";

/** A BSC testnet RPC verified live. */
export const DEFAULT_BSC_TESTNET_RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

/** The `MockLendingPool` address on BSC testnet, verified live. */
export const MOCK_LENDING_POOL_ADDRESS = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;

/**
 * The address of the debt token Guardian repays on testnet: `MockTokenUSD` (mUSD),
 * 18 decimals, the only debt asset on `MockLendingPool`.
 *
 * Its home is here, not in `execute.ts`. The execution module is pure and I/O-free; a chain
 * address inside it would tie it to one asset on one chain, so a second agent, a second
 * protocol, or mainnet could not use it without editing the file. `executeDecision` now
 * receives its asset via `ExecuteDeps.repayAsset`.
 */
export const REPAY_ASSET_ADDRESS = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

export interface TestnetReader {
  client: PublicClient;
  readPosition(account: `0x${string}`): Promise<Position>;
}

/**
 * Builds a viem `PublicClient` against `bscTestnet` and returns a `readPosition` bound to
 * `MockLendingPool`. There is no new reading logic here — only client construction and
 * injecting the pool address into `readAavePosition`.
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
