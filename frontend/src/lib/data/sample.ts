/**
 * The `seed` source — sample data bundled with the app.
 *
 * This is **not** a backend simulation pretending to be live. It is the four
 * agents that actually exist in this repository, each with its real status stated
 * plainly. All four are now listed on FuguRegistry and can be hired; what
 * separates them is what happens after you pay. Fugu Guardian has moved money on
 * chain and has the transactions to prove it. The other three ship a deterministic
 * decision engine and a backtest and have **never sent an on-chain transaction** —
 * their on-chain listing metadata says `onchainExecution: false`, and so does
 * every card and page here.
 *
 * That distinction is the one that decides whether somebody feels cheated after
 * paying, so it is never left implied: "hireable" and "able to act" are written as
 * two different claims.
 *
 * Every tx hash below is copied from `docs/STATUS.md` and
 * `docs/e2e/2026-09-08-e2e-testnet.md`; the registration hashes were verified
 * against `FuguRegistry.getListing` on chain. Nothing in this file is a number
 * that cannot be opened on BscScan, except where it says outright that there is no
 * block to open.
 *
 * The binding rule for this file: **no invented agents.** An empty card is more
 * honest than a marketplace that merely looks busy.
 */

import type { AgentRecord, Category } from "@/lib/agent-types";
import { CONTRACTS, CHAIN } from "@/lib/chain";
import type { AgentView } from "@/lib/data/types";

/** A fixed time: SSR must be deterministic, and sample data must not look fresh. */
export const SEED_FETCHED_AT = "2026-09-08T00:00:00.000Z";

const DEPLOYER = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;
const ALTANA_WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const ALTANA_KEYSTORE = "0x6b8361C29d05D498b1a12B54A37310f94171E94A" as const;
const ALTANA_KEYHASH =
  "0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377" as const;
const MOCK_POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const MOCK_USD = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

function baseRecord(over: Partial<AgentRecord> & Pick<AgentRecord, "id" | "tokenId" | "name">): AgentRecord {
  return {
    chainId: CHAIN.id,
    registryAddress: CONTRACTS.registry,
    agentId: null,
    description: "",
    imageUrl: null,
    agentType: "defi",
    tags: [],
    categories: [],
    skills: [],
    domains: ["defi"],
    supportedProtocols: ["A2A", "MCP"],
    ownerAddress: DEPLOYER,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: null,
    isActive: true,
    isVerified: false,
    isEndpointVerified: false,
    x402Supported: false,
    reputation: {
      totalScore: null,
      healthScore: null,
      totalFeedbacks: 0,
      averageScore: null,
      starCount: 0,
    },
    classification: null,
    fuguListing: null,
    source: "seed",
    fetchedAt: SEED_FETCHED_AT,
    createdAt: null,
    updatedAt: SEED_FETCHED_AT,
    similarityScore: null,
    ...over,
  };
}

/** The session key verification command. One `eth_call`, no API key. */
const VERIFY_SESSION = `cast call --rpc-url ${CHAIN.rpc} \\
  ${ALTANA_KEYSTORE} \\
  'isValidKey(address,bytes32)(bool)' \\
  ${ALTANA_WALLET} \\
  ${ALTANA_KEYHASH}
# true`;

const GUARDIAN: AgentView = {
  record: baseRecord({
    id: "97:1",
    tokenId: "1",
    name: "Fugu Guardian",
    description:
      "Watches a lending position and repays debt before it can be liquidated. It reads the health factor from chain, decides with deterministic code — never an LLM — and signs through an Altana session key that is allowed to call exactly two functions.",
    tags: ["health factor", "lending", "liquidation", "session key"],
    skills: ["monitor-position", "partial-repay", "deleverage"],
    domains: ["defi", "lending"],
    agentWallet: ALTANA_WALLET,
    fuguListing: {
      listingId: 1n,
      erc8004AgentId: 1n,
      owner: DEPLOYER,
      agentWallet: ALTANA_WALLET,
      category: "HEALTH_FACTOR",
      // USD, 8 decimals: 10_000_000 = $0.10. Not ten million.
      priceUsd8PerPeriod: 10_000_000n,
      periodSeconds: 120,
      active: true,
      curated: true,
      metadataURI: "",
    },
  }),
  risk: {
    level: 1,
    metricLabel: "Health factor",
    metricValue: "4.99",
    companion: "Collateral can fall 79.9% before liquidation.",
    observedAt: SEED_FETCHED_AT,
    blockNumber: null,
    // The last reading: the testnet price was restored to $750 after the proof run.
    proofTxHash: "0xb704b385cc5a298821cd7f2cad71542032a3b7b2e786de08df0f24bf82481b0a",
  },
  session: {
    keystore: ALTANA_KEYSTORE,
    wallet: ALTANA_WALLET,
    keyHash: ALTANA_KEYHASH,
    calls: [
      { contract: "MockLendingPool", address: MOCK_POOL, signature: "repay(address,uint256)" },
      { contract: "mUSD", address: MOCK_USD, signature: "approve(address,uint256)" },
    ],
    dailyCap: "0.02 tBNB + 100 mUSD per day",
    expiry: "8 October 2026",
    grantTxHash: "0x15e67a21e5ec25f8459ac2e83798033ca9afe5a14b41143aeb28fe2a47b64b52",
    verifyCommand: VERIFY_SESSION,
  },
  proofs: [
    {
      label: "Session key granted and registered in the Altana Keystore",
      detail: "Two functions, 0.02 tBNB + 100 mUSD per day, expires 8 October 2026.",
      hash: "0x15e67a21e5ec25f8459ac2e83798033ca9afe5a14b41143aeb28fe2a47b64b52",
    },
    {
      label: "Repaid $4.03 of debt — approve + repay in one atomic userOp",
      detail:
        "Health factor 1.14 → 1.50, re-read from chain at block 129852222. Repay.user on the receipt is the Altana wallet, not the deployer.",
      hash: "0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc",
    },
    {
      label: "The same key tried mUSD.transfer(deployer, 1 wei) and was refused",
      detail:
        "UnauthorizedCall, raised by the Altana account contract — not by our code. Zero gas, no balance moved.",
      hash: null,
      noLinkReason:
        "it was refused while the relay simulated the userOp, so it was never broadcast and there is no block to open. We would rather say that than quietly drop the row.",
    },
    {
      label: "Testnet collateral price restored to $750.00",
      detail: "Health factor back to 4.99 — the state stays reusable for the next run.",
      hash: "0xb704b385cc5a298821cd7f2cad71542032a3b7b2e786de08df0f24bf82481b0a",
    },
  ],
  notShipped:
    "The strategy is proven end to end by a script, not yet wired into the A2A/MCP runtime the agent serves. Hiring records payment on-chain; it does not start an autonomous loop today.",
  outcomes: [
    "Moved a position from health factor 1.14 to 1.50 by repaying $4.03 — the on-chain debt fell by exactly the amount claimed, to the last of 8 decimals.",
    "Refused an off-allowlist transfer from its own session key: zero gas, nothing broadcast.",
    "Ran against a lending pool we deployed and control ourselves — Aave v3 ABI, but never Aave, Venus, or anyone else's money.",
  ],
};

/**
 * The other three agents. All three are listed on FuguRegistry and hireable, at
 * $0.05 per 120-second period — half of Guardian's price, deliberately, because
 * each one ships a decision engine and a backtest and nothing that executes.
 *
 * What they do **not** have is an on-chain executor. Their listing metadata carries
 * `onchainExecution: false`, they have never sent a transaction, and hiring one
 * puts money into escrow without starting an autonomous loop. That sentence lives
 * in `notShipped`, which the card, the detail page, and the hire panel all show —
 * the last one directly above the pay button, where it still changes a decision.
 */
function strategyAgent(args: {
  id: string;
  tokenId: string;
  name: string;
  category: Category;
  description: string;
  tags: string[];
  /** `FuguRegistry` listing id, verified with `getListing` on chain. */
  listingId: bigint;
  erc8004AgentId: bigint;
  agentWallet: `0x${string}`;
  /** Registration transaction, block 129903555. */
  listedTxHash: string;
  /** How anyone can re-run this agent's own test suite. */
  verifyCommand: string;
}): AgentView {
  return {
    record: baseRecord({
      id: args.id,
      tokenId: args.tokenId,
      name: args.name,
      description: args.description,
      tags: args.tags,
      isActive: true,
      agentWallet: args.agentWallet,
      classification: {
        category: args.category,
        confidence: 1,
        reason: "First-party agent built for this category, and listed on FuguRegistry.",
      },
      fuguListing: {
        listingId: args.listingId,
        erc8004AgentId: args.erc8004AgentId,
        owner: DEPLOYER,
        agentWallet: args.agentWallet,
        category: args.category,
        // USD, 8 decimals: 5_000_000 = $0.05. Half of Guardian, because half of the
        // work is done — the decision, not the execution.
        priceUsd8PerPeriod: 5_000_000n,
        periodSeconds: 120,
        active: true,
        curated: false,
        // The on-chain listing carries a base64 JSON blob (summary, limits, verify
        // command, `onchainExecution: false`). It is not mirrored here: this sample
        // exists so the UI can be built without a backend, not to duplicate chain
        // state. `getListing` is the source, and the proof below opens it.
        metadataURI: "",
      },
    }),
    // No live reading: nothing runs, so the fish is drawn hollow rather than at a
    // guessed level.
    risk: null,
    session: null,
    proofs: [
      {
        label: "Listed on FuguRegistry",
        detail: `Listing #${args.listingId} — $0.05 per 2 minutes, category ${args.category}.`,
        hash: args.listedTxHash,
      },
      {
        label: "Never executed on chain",
        detail: `This agent's wallet ${args.agentWallet} has sent no strategy transaction. ${args.verifyCommand}`,
        hash: null,
        noLinkReason:
          "There is no transaction to open, which is the claim: the decision engine is tested, the executor is not built.",
      },
    ],
    notShipped:
      "Hireable, but it cannot act yet. This agent ships a deterministic decision engine and a backtest — its listing metadata says onchainExecution: false — and it has never sent an on-chain transaction. Hiring it places your payment in escrow and does not start an autonomous loop.",
    outcomes: [],
  };
}

const REBALANCER = strategyAgent({
  id: "97:2",
  tokenId: "2",
  name: "Fugu Rebalancer",
  category: "REBALANCING",
  description:
    "Keeps portfolio weights and PancakeSwap v3 LP ranges where you put them — and only moves when ΔFee − Gas − Slippage − ΔIL is positive, so tidying up never costs more than it saves.",
  tags: ["rebalancing", "pancakeswap v3", "liquidity"],
  listingId: 2n,
  erc8004AgentId: 8005n,
  agentWallet: "0xb8f155D1278f0437b9De7c63911f2C0EDa485941",
  listedTxHash: "0x858701b4238910259427eda6181d5488c1d29bc72b33f3c957d58108694b29c1",
  verifyCommand: "cd ai/fugurebalancer/app/agent && corepack pnpm test  # 88 tests",
});

const GRID = strategyAgent({
  id: "97:3",
  tokenId: "3",
  name: "Fugu Grid",
  category: "GRID",
  description:
    "Grid trading on PancakeSwap v3, watching slot0() itself because there is no on-chain order book. Structurally mean-reverting, which means it loses money in a trending market — that is written on its page, not buried.",
  tags: ["grid", "pancakeswap v3", "mean reversion"],
  listingId: 3n,
  erc8004AgentId: 8006n,
  agentWallet: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
  listedTxHash: "0x326c3c909d8e55a9b07d7886b5ef314fd652f62299d1854c687dd0f65143eafb",
  verifyCommand: "cd ai/fugugrid/app/agent && corepack pnpm test  # 99 tests",
});

const YIELD = strategyAgent({
  id: "97:4",
  tokenId: "4",
  name: "Fugu Yield",
  category: "YIELD",
  description:
    "Moves funds into the highest risk-adjusted APR pool it can verify across Venus, Aave v3 and Lista — and only when the APR difference beats the cost of migrating.",
  tags: ["yield", "venus", "aave", "lista"],
  listingId: 4n,
  erc8004AgentId: 8007n,
  agentWallet: "0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866",
  listedTxHash: "0xf67c457f4a678dbbf0a62f101b6518ff8c2c42b83bbd2e7fe21d9b9d91683aa3",
  verifyCommand: "cd ai/fuguyield/app/agent && corepack pnpm test  # 93 tests",
});

/** Four agents, one per category. No more, because there are no more. */
export const SEED_AGENTS: AgentView[] = [GUARDIAN, REBALANCER, GRID, YIELD];

/**
 * The marketplace lifecycle, run on the real network. It belongs to no single
 * agent — it is the evidence that the contracts work, and the hire page uses it to
 * explain what is about to happen to a buyer's money.
 */
export const MARKETPLACE_CYCLE = [
  {
    label: "An agent was listed — Health Factor category, $0.10 per 120 seconds",
    detail:
      "The first listing: listingCount went to 1, countByCategory(HEALTH_FACTOR) to 1. The registry now holds four, one per category.",
    hash: "0x590d2f13731bef32c6409d32c9f278af8b897766a0a82e0b504acf6799ffeab7",
  },
  {
    label: "It was hired — tBNB into escrow, priced through Chainlink",
    detail: "maxAmount + deadline enforced on the way in · subCount = 1",
    hash: "0x15810ba2b62b87931e4464b8e39b7a021398934f8a0c805dc09c6d52d7f4f6c8",
  },
  {
    label: "The agent withdrew only the time it had actually served",
    detail: "17668387054596 wei stayed in escrow, still refundable to the buyer",
    hash: "0xe0fd365d7bee36b524056c43aa6bf81351f88e6a4745f37b811e3e1fde5e4726",
  },
  {
    label: "A review was written — and a second one from the same wallet reverted",
    detail:
      "reviewCount = 1 · averageScoreX100 = 500 · the anti-sybil gate opens exactly when the agent gets paid",
    hash: "0xf7bd23695fd0da50d46b72bdb00d6b5caf7e8552f42ac7bb23b5a042e7f527a3",
  },
] as const;
