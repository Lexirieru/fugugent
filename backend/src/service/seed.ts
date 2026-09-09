/**
 * The curated seed — **the fourth and last level** of the tiered fallback.
 *
 * This is what answers when 8004scan is down, the Postgres cache is empty, and
 * the on-chain `FuguRegistry` holds no listings yet. Without this file the
 * marketplace could appear empty in front of the judges; with it the marketplace
 * has content — **and admits plainly where that content came from**.
 *
 * ## Rules that bind this file
 *
 * 1. **No fictional agents.** The four agents here really exist: they were
 *    scaffolded with BNB Agent Studio under `ai/`, each has its own Altana admin
 *    wallet whose address is written in `ai/<agent>/app/agent/studio.toml`, and
 *    their sessions are registered in the on-chain Altana Keystore
 *    (`0x6b8361C29d05D498b1a12B54A37310f94171E94A`, `isValidKey` → `true`).
 *    Anyone can verify it without an API key:
 *
 *    ```bash
 *    cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
 *      0x6b8361C29d05D498b1a12B54A37310f94171E94A \
 *      'isValidKey(address,bytes32)(bool)' <AGENT_WALLET> <KEY_HASH>
 *    ```
 *
 * 2. **It claims nothing that has not happened.** None of the four agents has an
 *    ERC-8004 `agentId` yet (produced by `bag erc8004 register`) nor a listing in
 *    `FuguRegistry`. So `agentId`, `registryAddress`, and `fuguListing` are all
 *    `null`; reputation is zero; `isVerified: false`. Putting an invented price
 *    here would render a subscribe button that cannot be paid — exactly the lie
 *    we want to avoid.
 *
 * 3. **`tokenId` is deliberately not a decimal number.** It has the form
 *    `seed-<name>`, so `id` = `97:seed-fugugrid` cannot be mistaken for a real
 *    ERC-8004 token by any layer. Once `bag erc8004 register` has run, the
 *    `tokenId` here is replaced with the real number and no other layer needs to
 *    change.
 *
 * 4. **`fetchedAt` = the curation date, not `now`.** The consequence is that the
 *    `ageSeconds` the user sees is the real age of this data — days, not zero
 *    seconds. Faking `fetchedAt` as `now` would let curated data masquerade as
 *    fresh data.
 *
 * 5. **The seed is never written into the Postgres cache.** If it were, the next
 *    read would report `source: "cache"` for rows that actually came from the
 *    seed — and the provenance that is this layer's entire value would be lost.
 *    That rule is enforced in `agents.ts`, and tested there.
 *
 * ## The descriptions are not marketing copy
 *
 * Each agent's description is written in English and uses terms that genuinely
 * explain its strategy (`grid trading`, `portfolio rebalancing`,
 * `yield farming`, `health factor`). That is not a coincidence: `seed.test.ts`
 * runs `classify()` over each record and demands that the classifier agree with
 * its curated category. If a description turned into an empty slogan, that test
 * goes red — the seed must not contain a sentence that explains nothing.
 */

import type {
  Address,
  AgentDetailResult,
  AgentListPage,
  AgentRecord,
  Category,
} from "../types.js";
import { makeAgentKey } from "../types.js";

/** The chain these four agents live on. BSC testnet — the only one supported. */
export const SEED_CHAIN_ID = 97;

/**
 * When this seed was last checked against reality (wallets, sessions,
 * `bag doctor` 14 PASS / 0 FAIL). Used as `fetchedAt` so the data age shown to
 * the user is the real age.
 */
export const CURATED_SEED_AT = "2026-09-08T00:00:00.000Z";

interface SeedSpec {
  slug: string;
  name: string;
  category: Category;
  description: string;
  tags: string[];
  /** The Altana admin wallet address — sourced from `ai/<agent>/app/agent/studio.toml`. */
  agentWallet: Address;
}

/**
 * The four Fugugent agents. Their category, protocols, and wallet are copied
 * from `ai/CLAUDE.md` and `ai/<agent>/app/agent/studio.toml` — not invented.
 */
const SEED_SPECS: readonly SeedSpec[] = [
  {
    slug: "fugurebalancer",
    name: "FuguRebalancer",
    category: "REBALANCING",
    description:
      "Portfolio rebalancing agent for PancakeSwap v3 concentrated liquidity positions on BNB Chain. " +
      "It repositions the LP range back to its target allocation when price leaves the range, when " +
      "deviation from target exceeds the configured band, or on a fixed interval — whichever comes first. " +
      "The strategy is deterministic code and can be backtested; no language model decides money.",
    tags: ["rebalancing", "pancakeswap-v3", "bnb-chain"],
    agentWallet: "0xb8f155D1278f0437b9De7c63911f2C0EDa485941",
  },
  {
    slug: "fugugrid",
    name: "FuguGrid",
    category: "GRID",
    description:
      "Grid trading agent on PancakeSwap v3. A keeper watches the pool slot0() tick and fills " +
      "pre-computed grid orders across the configured grid levels, buying low and selling high " +
      "within the band. Grid levels are computed by deterministic code, never by a language model.",
    tags: ["grid-trading", "pancakeswap-v3", "bnb-chain"],
    agentWallet: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9",
  },
  {
    slug: "fuguyield",
    name: "FuguYield",
    category: "YIELD",
    description:
      "Yield farming optimizer across Venus, Aave v3 and Lista on BNB Chain. It moves capital to the " +
      "best APY only when the measured spread beats the full cost of moving, and auto-compounds rewards " +
      "in between. Every move is a deterministic rule over on-chain data, not a language model guess.",
    tags: ["yield-farming", "venus", "aave", "lista"],
    agentWallet: "0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866",
  },
  {
    slug: "fuguguardian",
    name: "FuguGuardian",
    category: "HEALTH_FACTOR",
    description:
      "Health factor guardian for Venus and Aave v3 borrowing positions. It watches the health factor " +
      "and the collateral ratio, and repays debt for liquidation protection before the position crosses " +
      "the liquidation threshold. Executes through a bounded Altana session key with an explicit call allowlist.",
    tags: ["health-factor", "liquidation-protection", "venus", "aave"],
    agentWallet: "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0",
  },
] as const;

function toRecord(spec: SeedSpec): AgentRecord {
  const tokenId = `seed-${spec.slug}`;
  return {
    id: makeAgentKey(SEED_CHAIN_ID, tokenId),
    chainId: SEED_CHAIN_ID,
    tokenId,
    // Not registered in any registry yet — see rule 2 in the file header.
    registryAddress: null,
    agentId: null,

    name: spec.name,
    description: spec.description,
    imageUrl: null,
    agentType: "trading",
    tags: [...spec.tags],
    categories: [],
    // OASF only exists on `MCPAgentDetail` in 8004scan; we have no equivalent
    // for our own agents, so it is left empty (neutral for the classifier).
    skills: [],
    domains: [],
    // Genuinely exposed by all four agents: `protocols = ["A2A","MCP"]` in studio.toml.
    supportedProtocols: ["A2A", "MCP"],

    ownerAddress: null,
    ownerUsername: null,
    ownerPublisherTier: null,
    agentWallet: spec.agentWallet,

    // Wallet + session verified on-chain and `bag doctor` 14 PASS / 0 FAIL.
    isActive: true,
    // `isVerified` in this product means "curated via FuguRegistry.setCurated".
    // That has not happened yet, so false — even though these agents are ours.
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

    classification: {
      category: spec.category,
      confidence: 1,
      reason: "Fugugent curated seed: the category was set by the agent's author, not guessed",
    },
    fuguListing: null,

    source: "seed",
    fetchedAt: CURATED_SEED_AT,
    createdAt: null,
    updatedAt: null,
    similarityScore: null,
  };
}

/**
 * A fresh copy of the four seed records.
 *
 * Always a deep copy: a caller that mutates the result (e.g. a classifier
 * overwriting `classification`, or the HTTP layer turning bigints into strings)
 * must not corrupt the seed for the next request.
 *
 * `_now` is accepted so the signature stays stable should the seed ever need to
 * depend on time; today the seed's age is determined entirely by
 * {@link CURATED_SEED_AT}.
 */
export function seedAgents(_now: Date = new Date()): AgentRecord[] {
  return SEED_SPECS.map(toRecord);
}

export interface SeedListOptions {
  limit?: number;
  offset?: number;
}

/**
 * The shape of the seed source. Async and shaped like the other sources, so
 * `agents.ts` treats all four levels in exactly the same way — and so tests can
 * inject a seed that **throws**, which must still not take the caller down.
 */
export interface SeedSource {
  listAgents(category: Category, opts?: SeedListOptions): Promise<AgentListPage>;
  getAgent(id: string): Promise<AgentDetailResult>;
}

export interface SeedSourceOptions {
  /** Injected so the page's `fetchedAt` is deterministic in tests. */
  now?: () => Date;
}

export function createSeedSource(options: SeedSourceOptions = {}): SeedSource {
  const now = options.now ?? (() => new Date());

  return {
    async listAgents(category: Category, opts: SeedListOptions = {}): Promise<AgentListPage> {
      const fetchedAt = now().toISOString();
      const limit = Math.max(1, Math.trunc(opts.limit ?? 20));
      const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
      const matching = seedAgents(now()).filter(
        (agent) => agent.classification?.category === category,
      );
      return {
        items: matching.slice(offset, offset + limit),
        total: matching.length,
        limit,
        offset,
        source: "seed",
        healthy: true,
        reason: null,
        fetchedAt,
      };
    },

    async getAgent(id: string): Promise<AgentDetailResult> {
      const fetchedAt = now().toISOString();
      const hit = seedAgents(now()).find((agent) => agent.id === id) ?? null;
      return {
        agent: hit,
        source: "seed",
        healthy: true,
        reason: hit === null ? `agent ${id} is not in the curated seed` : null,
        fetchedAt,
      };
    },
  };
}
