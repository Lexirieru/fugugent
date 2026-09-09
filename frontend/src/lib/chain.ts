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
  /**
   * The audit escrow. A verdict only costs something to get wrong if the bond is real
   * money sitting somewhere anybody can look at — this is where it sits.
   * `contracts/deployments/bsc-testnet.json` → `auditEscrow.proxy`.
   */
  auditEscrow: "0x0354d2a4be40f118e4d1301915ee2ff54eec8a52",
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
  {
    name: "FuguAuditEscrow",
    address: CONTRACTS.auditEscrow,
    role: "Auditor fee and bond, released or slashed",
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

/**
 * The audit-escrow cycle, run end to end on BNB Chain testnet on 2026-09-09.
 *
 * This is the mechanism the whole skill marketplace rests on: an auditor who posts a
 * bond, is paid when the verdict stands, and loses the bond when it does not. These
 * four hashes are that cycle actually happening — job 1, 5 mUSD fee, 2 mUSD bond,
 * settled. `contracts/deployments/bsc-testnet.json` → `auditEscrow.e2e`.
 */
export const AUDIT_ESCROW_CYCLE: Proof[] = [
  {
    label: "An audit job was created — developer and auditor named, skill hash bound in",
    detail:
      "createJob(auditor, fee, bond, skillHash). The contract refuses a job whose developer and auditor are the same address, so nobody audits their own skill.",
    hash: "0xa522fcb04d269a5ecc7b114bb5556faff371462e67bee4dd02f0ec2657267c22",
  },
  {
    label: "The developer funded the fee — 5 mUSD into escrow",
    detail:
      "fundFee takes no amount from its caller: the figure booked is the escrow's own balance delta, so a fee-on-transfer token cannot pay one job out of another job's money.",
    hash: "0x11488b8bbde7836bd80760ad2b5c130a101799aef6dd794e86b342ebb762534b",
  },
  {
    label: "The auditor posted a 2 mUSD bond — the thing it loses if the verdict is wrong",
    detail:
      "postBond. Without a bond an auditor risks nothing by waving a skill through, and a green badge costs nothing to hand out.",
    hash: "0x2a867edeff55920fda798f8e0dfff4f50dc19574854d8117fdef297467108862",
  },
  {
    label: "The verdict stood, so fee and bond were released — 7 mUSD to the auditor",
    detail:
      "release is not permissionless: only the developer or the arbiter may call it, and only the arbiter may slash. getJob(1) now reads status 3 (SETTLED) with the escrow balance at zero.",
    hash: "0x338030ed89923a5bc995a1170a9aa884e63e07193a8846d1ee58a5daee520c53",
  },
];

/**
 * The escrow's own deployment. The proxy and the implementation are both verified on
 * BscScan, so the explorer shows Solidity rather than bytecode.
 */
export const AUDIT_ESCROW_DEPLOYMENT = {
  proxy: CONTRACTS.auditEscrow,
  implementation: "0xf7a0e340455af3c476564d7af283d9be4d2cfabb",
  proxyTxHash: "0xabf9500a97fdbedcea1e2adc647ed2a7b0709c447e0e4826eb9d7dc9005e1442",
  block: 129993029,
  /** mUSD, 18 decimals, locked at initialize and with no setter. */
  payToken: "0x932E82632E80b06318ca969e33F99A54F1a04b10",
} as const;
