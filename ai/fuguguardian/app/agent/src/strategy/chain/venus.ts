/**
 * The Venus adapter, reading a real account's liquidity on BSC **mainnet**.
 * Venus and Aave v3 only exist on BSC mainnet (chain 56), not on testnet, so this read
 * deliberately targets mainnet. Read-only via `eth_call`, no transactions and no cost. The
 * agent's transaction execution still runs on testnet — only this position read crosses to
 * mainnet.
 *
 * NOT YET WIRED INTO `decide()` — and that is deliberate. `decide()` works on `Position`,
 * which needs a health factor and one aggregate liquidation threshold. The Venus
 * comptroller provides neither: `getAccountLiquidity` only gives the liquidity/shortfall
 * delta in USD, with no health factor and no combined collateral factor. To build a
 * `Position` from Venus we would have to fetch PER-MARKET data (the vToken list via
 * `getAssetsIn`, `markets(vToken).collateralFactorMantissa`, each vToken's snapshot
 * balance, and each asset's price from the oracle) and aggregate it ourselves — data this
 * adapter does not fetch at all. Until that exists, the Venus numbers here are for
 * monitoring/diagnostics only, NOT decision input.
 */
import type { PublicClient } from "viem";
import { PositionError } from "../types.js";

/** The Venus Comptroller address on BSC mainnet, verified live. */
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
 * UNITS WARNING: the scale here is DIFFERENT from `Position`.
 *
 * Every `*Base` field on `Position` uses Aave's 8-decimal basis (1e8 = $1), while Venus
 * returns USD values in a 1e18 mantissa (1e18 = $1) — a factor of 10^10 apart. That is why
 * the fields below do NOT carry the `Base` suffix: the earlier name `liquidityBase` made
 * these values look directly comparable to, or summable with, `collateralBase`/`debtBase`,
 * when the result would be off by ten billion. An explicit conversion (divide by 10^10) is
 * mandatory before this value meets an Aave-style number.
 */
export interface VenusLiquidity {
  /** The account's remaining liquidity in USD, 1e18 mantissa (not Aave's 8-decimal basis). */
  liquidityUsd18: bigint;
  /** The account's collateral shortfall in USD, 1e18 mantissa; > 0 means it is already liquidatable. */
  shortfallUsd18: bigint;
  blockNumber: bigint;
}

/**
 * Reads one account's Venus liquidity at mainnet's latest block.
 * If the `error` code the comptroller returns is not 0n, it throws a `PositionError` naming
 * that code — a caller can handle it without having to guess what a raw number means.
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
