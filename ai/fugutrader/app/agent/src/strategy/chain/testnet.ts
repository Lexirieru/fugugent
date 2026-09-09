/**
 * The addresses and network constants this agent works against, all on BSC testnet
 * (chain id 97).
 *
 * They are written out here rather than read from a deployment file at runtime, because
 * the agent is deployed on its own. Every value is copied from `docs/setup/ENVIRONMENT.md`
 * or from `@altananetwork/x402-server`'s own token table, and the source is named beside
 * each one so a reader can check rather than trust.
 */

/** BSC testnet. This agent never pays anywhere else. */
export const CHAIN_ID = 97;

/**
 * The public endpoint this agent talks to the chain through.
 *
 * The wallet library's own default points at a `binance.org` address, which is blocked
 * from the network this project is built on, and the failure it produces looks like a
 * timeout rather than a block. This value must be used.
 */
export const DEFAULT_BSC_TESTNET_RPC_URL =
  "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

/**
 * $U on BSC testnet. 18 decimals, and the signing name and version were taken from
 * `@altananetwork/x402-server`'s token table, which states they were checked against the
 * live contract.
 *
 * This is the token BNB Agent Studio buyers pay with, and the only one they pay with, so
 * a seller that wants to be payable by them has to offer it.
 */
export const U_TOKEN_TESTNET = {
  address: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
  name: "United Stables",
  version: "1",
  symbol: "U",
  decimals: 18,
} as const;

/** This agent's own wallet, which is also what the catalog listing records. */
export const TRADER_WALLET = "0x1B82F72346a8553a968fafD6AC07A21d4A88589f" as const;

/** Where a transaction can be looked up by anyone, with no key and no account. */
export function explorerTx(hash: string): string {
  return `https://testnet.bscscan.com/tx/${hash}`;
}
