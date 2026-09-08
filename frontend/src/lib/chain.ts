/**
 * Chain constants for the marketplace. Copied verbatim from
 * `contracts/deployments/bsc-testnet.json`, `docs/setup/ENVIRONMENT.md`, and
 * `docs/e2e/2026-09-08-e2e-testnet.md`.
 *
 * The binding rule: **every number shown in the UI must be clickable through to its
 * proof**. If a number has no tx hash and no verification command, it is marked openly
 * as unproven — never hidden.
 */

export const CHAIN = {
  id: 97,
  name: "BNB Smart Chain Testnet",
  explorer: "https://testnet.bscscan.com",
  /** `binance.org` is blocked from Indonesia — always override the RPC. */
  rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
} as const;

export function txUrl(hash: string): string {
  return `${CHAIN.explorer}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${CHAIN.explorer}/address/${address}`;
}

/** Truncate a long hash or address so it does not force a horizontal scroll. */
export function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export const CONTRACTS = {
  registry: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
  subscription: "0xfdb083371f44Cf53181350389D3217e51B431776",
  reputation: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
  priceOracle: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65",
} as const;

export const CONTRACT_LIST = [
  {
    name: "FuguRegistry",
    address: CONTRACTS.registry,
    role: "Agent listings, categories, curation",
  },
  {
    name: "FuguSubscription",
    address: CONTRACTS.subscription,
    role: "Escrowed hire, streamed payout, refund",
  },
  {
    name: "FuguPriceOracle",
    address: CONTRACTS.priceOracle,
    role: "Chainlink pricing, buyer picks the token",
  },
  {
    name: "FuguReputation",
    address: CONTRACTS.reputation,
    role: "Reviews gated by proof of payment",
  },
] as const;

/**
 * A single proof: one row that clicks through to BscScan, or one row that states
 * openly why there is no link. There is no third form.
 */
export type Proof = {
  label: string;
  detail: string;
  /** `null` when there genuinely is no block to open. */
  hash: string | null;
  /** Required when `hash` is null. */
  noLinkReason?: string;
};
