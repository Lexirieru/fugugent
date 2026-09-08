/**
 * The ABI fragments the frontend actually calls. Not the full ABIs: only the
 * functions in use, so every signature here can be read side by side with
 * `contracts/src/*.sol` without scrolling.
 *
 * Every signature below has been **verified against the live contracts** on BSC
 * testnet with `eth_call` — the field order of `Sub` and `Listing` matches what
 * the proxies actually return, rather than being guessed from the source.
 */

/** `FuguSubscription.sol` — the only contract that holds funds. */
export const SUBSCRIPTION_ABI = [
  {
    type: "function",
    name: "subscribe",
    stateMutability: "payable",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "periods", type: "uint32" },
      { name: "payToken", type: "address" },
      { name: "maxAmount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "subId", type: "uint256" }],
  },
  {
    type: "function",
    name: "subCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getSub",
    stateMutability: "view",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "listingId", type: "uint256" },
          { name: "subscriber", type: "address" },
          { name: "payToken", type: "address" },
          { name: "deposited", type: "uint128" },
          { name: "claimed", type: "uint128" },
          { name: "startedAt", type: "uint64" },
          { name: "endsAt", type: "uint64" },
          { name: "cancelled", type: "bool" },
          { name: "feeBps", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "periodPriceRef",
    stateMutability: "view",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "hasSubscribed",
    stateMutability: "view",
    inputs: [
      { name: "listingId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "event",
    name: "Subscribed",
    inputs: [
      { name: "subId", type: "uint256", indexed: true },
      { name: "listingId", type: "uint256", indexed: true },
      { name: "subscriber", type: "address", indexed: true },
      { name: "payToken", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** `FuguPriceOracle.sol` — USD in 8-decimal base to a token amount. */
export const ORACLE_ABI = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "usdAmount8", type: "uint256" },
    ],
    outputs: [{ name: "tokenAmount", type: "uint256" }],
  },
] as const;

/** `FuguRegistry.sol` — the listing catalogue. Read to get the price that actually applies. */
export const REGISTRY_ABI = [
  {
    type: "function",
    name: "getListing",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "erc8004AgentId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "agentWallet", type: "address" },
          { name: "category", type: "uint8" },
          { name: "priceUsd8PerPeriod", type: "uint128" },
          { name: "periodSeconds", type: "uint32" },
          { name: "active", type: "bool" },
          { name: "curated", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
] as const;

/** Native coin. `FuguSubscription` uses `address(0)` for tBNB. */
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000" as const;
