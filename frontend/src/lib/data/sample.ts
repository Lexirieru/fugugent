/**
 * Sumber `seed` — data contoh yang dibundel bersama aplikasi.
 *
 * Ini **bukan** simulasi backend yang berpura-pura hidup. Isinya adalah empat
 * agent yang benar-benar ada di repo ini, dengan status masing-masing dinyatakan
 * apa adanya: satu punya bukti on-chain, tiga lainnya belum punya strategi dan
 * belum terdaftar di FuguRegistry, jadi tiga-tiganya tidak bisa disewa.
 *
 * Setiap tx hash di bawah disalin dari `docs/STATUS.md` dan
 * `docs/e2e/2026-09-08-e2e-testnet.md` pada 2026-09-08. Tidak ada satu pun angka
 * di berkas ini yang tidak bisa dibuka di BscScan, kecuali yang secara eksplisit
 * menyatakan tidak punya blok untuk dibuka.
 *
 * Aturan yang mengikat berkas ini: **tidak boleh ada agent karangan.** Kartu
 * kosong lebih jujur daripada marketplace yang terlihat ramai.
 */

import type { AgentRecord, Category } from "@/lib/agent-types";
import { CONTRACTS, CHAIN } from "@/lib/chain";
import type { AgentView } from "@/lib/data/types";

/** Waktu tetap: SSR harus deterministik, dan data contoh tidak boleh terlihat segar. */
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

/** Perintah verifikasi session key. Satu `eth_call`, tanpa API key. */
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
      // USD 8 desimal: 10_000_000 = $0.10. Bukan sepuluh juta.
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
    // Bacaan terakhir: harga testnet dikembalikan ke $750 setelah jalan pembuktian.
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
 * Tiga agent sisanya. Wallet dan session key ber-batas keempatnya memang
 * terdaftar di Keystore (`docs/STATUS.md`), tetapi strateginya belum ada dan
 * tidak satu pun terdaftar di FuguRegistry — jadi tidak ada harga, tidak ada
 * bacaan risiko, dan tidak ada tombol hire.
 */
function scaffold(
  id: string,
  tokenId: string,
  name: string,
  category: Category,
  description: string,
  tags: string[],
): AgentView {
  return {
    record: baseRecord({
      id,
      tokenId,
      name,
      description,
      tags,
      isActive: false,
      // Kategorinya diketahui pasti — agent ini memang dibangun untuk kategori itu —
      // tetapi tidak ada listing on-chain yang menyatakannya, jadi ia diletakkan di
      // `classification`, tempat yang memang disediakan untuk kategori tanpa listing.
      classification: {
        category,
        confidence: 1,
        reason: "First-party agent built for this category; not listed on FuguRegistry yet.",
      },
    }),
    risk: null,
    session: null,
    proofs: [],
    notShipped:
      "Scaffold only. It has a wallet and a capped session key registered in the Altana Keystore; it does not have a strategy, and it is not listed on FuguRegistry — so it cannot be hired yet.",
    outcomes: [],
  };
}

const REBALANCER = scaffold(
  "97:2",
  "2",
  "Fugu Rebalancer",
  "REBALANCING",
  "Keeps portfolio weights and PancakeSwap v3 LP ranges where you put them — and only moves when ΔFee − Gas − Slippage − ΔIL is positive, so tidying up never costs more than it saves.",
  ["rebalancing", "pancakeswap v3", "liquidity"],
);

const GRID = scaffold(
  "97:3",
  "3",
  "Fugu Grid",
  "GRID",
  "Grid trading on PancakeSwap v3, watching slot0() itself because there is no on-chain order book. Structurally mean-reverting, which means it loses money in a trending market — that is written on its page, not buried.",
  ["grid", "pancakeswap v3", "mean reversion"],
);

const YIELD = scaffold(
  "97:4",
  "4",
  "Fugu Yield",
  "YIELD",
  "Moves funds into the highest risk-adjusted APR pool it can verify across Venus, Aave v3 and Lista — and only when the APR difference beats the cost of migrating.",
  ["yield", "venus", "aave", "lista"],
);

/** Empat agent, satu per kategori. Tidak lebih, karena tidak ada lebih. */
export const SEED_AGENTS: AgentView[] = [GUARDIAN, REBALANCER, GRID, YIELD];

/**
 * Siklus hidup marketplace yang dijalankan di jaringan sungguhan. Ini bukan
 * milik satu agent — ini bukti bahwa kontraknya bekerja, dan dipakai halaman
 * hire untuk menjelaskan apa yang akan terjadi pada uang pembeli.
 */
export const MARKETPLACE_CYCLE = [
  {
    label: "An agent was listed — Health Factor category, $0.10 per 120 seconds",
    detail: "listingCount = 1 · countByCategory(HEALTH_FACTOR) = 1",
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
