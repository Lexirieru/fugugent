/**
 * The Aave v3 adapter, reading a real borrow position on BSC **mainnet**.
 * Venus and Aave v3 only exist on BSC mainnet (chain 56), not on testnet, so this read
 * deliberately targets mainnet. Read-only via `eth_call`, no transactions and no cost. The
 * agent's transaction execution still runs on testnet — only this position read crosses to
 * mainnet.
 */
import type { PublicClient } from "viem";
import { PositionError, type Position } from "../types.js";

/** The Aave v3 Pool address on BSC mainnet, verified live. */
export const AAVE_V3_POOL_ADDRESS = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as const;

/** The sentinel Aave returns for healthFactor when there is no debt. */
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
 * Reads one account's Aave v3 position, ANCHORED to a single block height.
 * `healthFactor` is normalized to null when it is the 2^256-1 sentinel OR when there is no
 * debt at all — the whole strategy layer treats null as "no risk", not as a large number to
 * be compared.
 *
 * DO NOT compute `healthFactor` yourself here. It MUST keep coming straight out of the
 * `getUserAccountData` tuple (index 5), i.e. the number the protocol computed itself.
 * `__tests__/testnet.test.ts` uses that fact as a differential test: the protocol's HF is
 * matched against the TypeScript `computeHealthFactor` over the same reading, and that is
 * what catches a swapped tuple index or a unit that is off. The moment this function
 * computes its own HF, that test turns into a tautology that stays green forever while
 * testing nothing — and nobody will warn you.
 */
export async function readAavePosition(
  client: PublicClient,
  account: `0x${string}`,
  /**
   * The address of the `getUserAccountData` pool. Defaults to Aave v3 mainnet so existing
   * callers keep working unchanged. The testnet adapter (`chain/testnet.ts`) injects the
   * `MockLendingPool` address here — the reading logic below does not change at all.
   */
  poolAddress: `0x${string}` = AAVE_V3_POOL_ADDRESS,
): Promise<Position> {
  if (!client.chain) {
    throw new PositionError("Client viem tidak memiliki konfigurasi chain.");
  }

  // The block is fetched FIRST, then the read is anchored to that block.
  //
  // Previously both were fired as two independent RPC calls inside `Promise.all`: a
  // `readContract` at whatever block the serving node considered "latest", and a separate
  // `getBlockNumber()`. The two can land on opposite sides of a new block, making
  // `Position.blockNumber` only approximately the block the data came from. For the E2E
  // script that is invisible (it anchors its own reads), but a backend indexer inheriting
  // this adapter would record "block X reported debt Y" off by one block — a silent bug with
  // no symptom until someone reconciles the numbers.
  //
  // The price is one sequential RPC call instead of parallel ones. A node that does not have
  // that block yet THROWS ("header not found") instead of quietly answering from the past —
  // the correct failure direction.
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
