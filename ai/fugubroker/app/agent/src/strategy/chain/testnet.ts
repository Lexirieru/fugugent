/**
 * The addresses and network constants this agent works against, all on BSC testnet
 * (chain id 97).
 *
 * They are written out here rather than read from a deployment file at runtime, because
 * the agent is deployed on its own and must not need the contracts repository to start.
 * Every value below is copied from `contracts/deployments/bsc-testnet.json` and
 * `docs/setup/ENVIRONMENT.md`, and the sources are named beside each one so a reader can
 * check rather than trust.
 */

/** BSC testnet. This agent never runs anywhere else. */
export const CHAIN_ID = 97;

/**
 * The public endpoint this agent talks to the chain through.
 *
 * The wallet library's own default points at a `binance.org` address, which is blocked
 * from the network this project is built on, and the failure it produces looks like a
 * timeout rather than a block. This value must be used, and it is also why
 * `BSC_TESTNET_RPC_URL` overrides it everywhere.
 */
export const DEFAULT_BSC_TESTNET_RPC_URL =
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

/**
 * The agent catalog, address from `contracts/deployments/bsc-testnet.json`.
 * This is the upgradeable front address, which is the one to call.
 */
export const FUGU_REGISTRY_ADDRESS =
  "0xb2f36070E6eae3353E8e755172B477DF213ae248" as const;

/** The contract that takes payment for a rental and releases it as the time passes. */
export const FUGU_SUBSCRIPTION_ADDRESS =
  "0xfdb083371f44Cf53181350389D3217e51B431776" as const;

/**
 * The tokens this agent is willing to pay a rental in.
 *
 * Both have 18 decimals. USDT on BSC has 18 decimals, not the 6 it has on Ethereum, and
 * assuming otherwise makes every amount wrong by a factor of ten thousand.
 *
 * The chain's own coin is deliberately absent. The payment contract requires the coin
 * sent to equal, to the last unit, an amount it works out while the transaction runs, so
 * there is no way to set a ceiling on that path and still succeed.
 */
export const TOKEN_U = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as const;
export const TOKEN_USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;

export const ALLOWED_PAY_TOKENS = [TOKEN_U, TOKEN_USDT] as const;

/** Where a transaction can be looked up by anyone, with no key and no account. */
export function explorerTx(hash: string): string {
  return `https://testnet.bscscan.com/tx/${hash}`;
}
