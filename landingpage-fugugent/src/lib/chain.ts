/**
 * The single source of truth for every number and address shown on the landing page.
 * All of it is copied verbatim from:
 *   - contracts/deployments/bsc-testnet.json
 *   - docs/e2e/2026-09-08-e2e-testnet.md
 *   - docs/STATUS.md
 *
 * The rule: if a number has no `tx` and no verification command here, that number must
 * not appear on the page.
 */

export const CHAIN = {
  id: 97,
  name: "BNB Smart Chain Testnet",
  explorer: "https://testnet.bscscan.com",
  rpc: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
} as const;

export function txUrl(hash: string): string {
  return `${CHAIN.explorer}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${CHAIN.explorer}/address/${address}`;
}

/** Truncate a long hash or address so it reads without forcing a horizontal scroll. */
export function shorten(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** The four UUPS contracts live on testnet. Their source is not yet verified on BscScan. */
export const CONTRACTS = [
  {
    name: "FuguRegistry",
    address: "0xb2f36070E6eae3353E8e755172B477DF213ae248",
    role: "Agent listings, categories, curation",
  },
  {
    name: "FuguSubscription",
    address: "0xfdb083371f44Cf53181350389D3217e51B431776",
    role: "Escrowed hire, streamed payout, refund",
  },
  {
    name: "FuguPriceOracle",
    address: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65",
    role: "Chainlink pricing, buyer picks the token",
  },
  {
    name: "FuguReputation",
    address: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400",
    role: "Reviews gated by proof of payment",
  },
] as const;

export const ALTANA = {
  /** The user's own Altana wallet; the agent only holds a session key on top of it. */
  wallet: "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0",
  /** Altana's public Keystore — where anyone can read whether the session key is valid. */
  keystore: "0x6b8361C29d05D498b1a12B54A37310f94171E94A",
  keyHash: "0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377",
  expiry: "8 October 2026",
  dailyCap: "0.02 tBNB + 100 mUSD per day",
} as const;

/** A verification command that can be copied verbatim. No API key. */
export const VERIFY_COMMAND = `cast call --rpc-url ${CHAIN.rpc} \\
  ${ALTANA.keystore} \\
  'isValidKey(address,bytes32)(bool)' \\
  ${ALTANA.wallet} \\
  ${ALTANA.keyHash}
# true`;

export type Proof = {
  id: string;
  label: string;
  detail: string;
  /** The transaction hash, or `null` when there genuinely is no block to open. */
  hash: string | null;
  /** Used when `hash` is null — it explains why there is no link. */
  noLinkReason?: string;
};

/** Guardian's rescue cycle, signed by a bounded session key. */
export const GUARDIAN_RESCUE: Proof[] = [
  {
    id: "drop",
    label: "Collateral price pushed down to $225.31",
    detail: "Health factor falls to 1.14 — inside the PARTIAL_REPAY band",
    hash: "0xca22d26b762c0538baf995c5ef3dfe3b51277d5b8234b88d6f5c90c18ca02517",
  },
  {
    id: "repay",
    label: "Guardian repays $6.85 — approve + repay in one atomic userOp",
    detail: "Signed by the Altana session key. Health factor 1.14 → 1.50",
    hash: "0x3ec2818c148cf761f0fcaee4ad05ed9cbaeffd0a3ec6a6efcc1e1e47d7989a07",
  },
  {
    id: "denial",
    label: "Same key tries mUSD.transfer(deployer, 1 wei) — rejected",
    detail:
      "UnauthorizedCall, raised by the Altana account contract, not by our code. Zero gas.",
    hash: null,
    noLinkReason:
      "Rejected during simulation, so it was never broadcast — there is no block to open. We are saying so rather than hiding it.",
  },
  {
    id: "restore",
    label: "Price restored to $750.00 so the testnet state stays reusable",
    detail: "Collateral back to $150.00 · health factor 4.99",
    hash: "0xb704b385cc5a298821cd7f2cad71542032a3b7b2e786de08df0f24bf82481b0a",
  },
];

/** The session itself: proof that the key is registered publicly. */
export const SESSION_GRANT: Proof = {
  id: "grant",
  label: "Session key granted and registered in the Altana Keystore",
  detail: `Expires ${ALTANA.expiry} · ${ALTANA.dailyCap}`,
  hash: "0x15e67a21e5ec25f8459ac2e83798033ca9afe5a14b41143aeb28fe2a47b64b52",
};

/** The old path: the same repay, but signed by the deployer EOA. Kept as history. */
export const DEPLOYER_RESCUE: Proof = {
  id: "eoa-repay",
  label: "Earlier run of the same cycle, signed by a full-power deployer key",
  detail: "Repaid $559.02 · health factor 1.14 → 1.50 · kept as history, not as the current path",
  hash: "0x6ccb4c5a8d9f6ca5201dff73a663992dbc6a3b2efa74406e84a02d93584d5fcc",
};

/** The marketplace lifecycle, run on the real network. Total cost 0.0015 tBNB. */
export const MARKETPLACE_CYCLE: Proof[] = [
  {
    id: "list",
    label: "List an agent — Health Factor category, $0.10 per 120s",
    detail: "listingCount = 1 · countByCategory(HEALTH_FACTOR) = 1",
    hash: "0x590d2f13731bef32c6409d32c9f278af8b897766a0a82e0b504acf6799ffeab7",
  },
  {
    id: "hire",
    label: "Hire it — tBNB into escrow, priced through Chainlink",
    detail: "maxAmount + deadline enforced · subCount = 1",
    hash: "0x15810ba2b62b87931e4464b8e39b7a021398934f8a0c805dc09c6d52d7f4f6c8",
  },
  {
    id: "withdraw",
    label: "Agent withdraws only the time it has actually served",
    detail: "17668387054596 wei left in escrow, still refundable to the buyer",
    hash: "0xe0fd365d7bee36b524056c43aa6bf81351f88e6a4745f37b811e3e1fde5e4726",
  },
  {
    id: "review",
    label: "Review written — and the second one from the same wallet reverts",
    detail: "reviewCount = 1 · averageScoreX100 = 500 · the anti-sybil gate flips exactly when the agent gets paid",
    hash: "0xf7bd23695fd0da50d46b72bdb00d6b5caf7e8552f42ac7bb23b5a042e7f527a3",
  },
];
