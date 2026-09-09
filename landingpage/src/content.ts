/**
 * Every claim the page makes, in one place.
 *
 * House rule for this repo: a number on the page must be checkable by a stranger.
 * So each entry below either carries a link someone can open, or a command someone
 * can run. Anything that could not be traced back to `docs/STATUS.md`,
 * `docs/setup/ENVIRONMENT.md` or `docs/e2e/2026-09-08-e2e-testnet.md` was dropped
 * rather than guessed.
 *
 * Two writing rules apply to every string in this file, because these strings are
 * what a reader actually sees:
 *
 *   1. No em dashes. Direct request from the repo owner.
 *   2. No jargon a reader outside crypto would have to look up.
 */

const BSCSCAN = "https://testnet.bscscan.com";

export const REPO_URL = "https://github.com/Lexirieru/fugugent";
export const STATUS_DOC_URL = `${REPO_URL}/blob/main/docs/STATUS.md`;
export const APP_URL = "https://app.hellofugu.xyz";
export const API_HEALTH_URL = "https://api.hellofugu.xyz/api/health";
export const AGENTS_URL = `${APP_URL}/agents`;
export const SKILLS_URL = `${APP_URL}/skills`;
export const AUDITORS_URL = `${APP_URL}/auditors`;

/**
 * The hero video, and the same file again behind the footer's left card. It is
 * the one asset the cream ground was measured against, so it is named once here
 * rather than pasted into two components that could drift apart.
 */
export const PLANE_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260801_022931_e13cbef4-690a-42d2-b5ee-5b3b1f483c83.mp4";
export const GUARDIAN_URL = "https://agents.hellofugu.xyz/guardian/";
/** The builder's own account. There is no HelloFugu account, and we will not imply one. */
export const X_URL = "https://x.com/lexirieru";

/* ── The catalogue, counted ─────────────────────────────────────────
 *
 * `CATALOGUE_TOTAL` is the size of the agent catalogue the marketplace reads.
 * `RENTABLE` is how many of those you can actually rent from us today, which is
 * the nine listings in `FuguRegistry` (`listingCount()` is 9, one per category,
 * ENVIRONMENT.md §G3). `EVER_ACTED` is one, and that gap is the honest part.
 */
export const CATALOGUE_TOTAL = 112;
export const CATEGORY_COUNT = 9;
export const RENTABLE = 9;
export const EVER_ACTED = 1;
export const VERIFIED_CONTRACTS = 5;

/* ── The rails ──────────────────────────────────────────────────────
 *
 * Only the five that the running code actually touches. Two more logos ship in
 * `public/logos/tracks/` (TermiX and PancakeSwap) but neither appears on any code
 * path; they are hackathon tracks, not integrations, so putting them under a
 * "built with" label would be a claim we cannot support.
 */
export type Rail = { name: string; src: string; note: string; tall?: boolean };

export const RAILS: Rail[] = [
  { name: "BNB Chain", src: "/logos/tracks/bnb-chain.svg", note: "the test network everything runs on" },
  {
    name: "BNB Agent Studio",
    src: "/logos/tracks/bnb-agent-studio.png",
    note: "how the agents are built and served",
  },
  { name: "Altana", src: "/logos/tracks/altana.svg", note: "the wallet with the spending limit", tall: true },
  { name: "dGrid", src: "/logos/tracks/dgrid.png", note: "explains a decision afterwards, never inside one" },
  { name: "8004scan", src: "/logos/tracks/8004scan.png", note: "where the agent catalogue is read from" },
];

/* ── The nine listings ──────────────────────────────────────────────
 *
 * All nine are on chain and all nine can be rented. Exactly one of them has ever
 * sent a transaction. The price gap is the capability gap: Guardian is $0.10 per
 * 120 seconds, the other eight are $0.05, and that was set deliberately.
 * Source: docs/setup/ENVIRONMENT.md §G3.
 */
export type Listing = {
  id: number;
  name: string;
  category: string;
  price: string;
  /** Has this agent ever sent a transaction on chain? Eight of nine: no. */
  hasActed: boolean;
  art: string;
  txUrl: string;
};

const LISTING_ROWS: Array<[number, string, string, string, boolean, string, string]> = [
  [1, "Fugu Guardian", "Health factor", "$0.10", true, "/brand/guardian.svg",
   "0x590d2f13731bef32c6409d32c9f278af8b897766a0a82e0b504acf6799ffeab7"],
  [2, "Fugu Rebalancer", "Rebalancing", "$0.05", false, "/brand/rebalancer.svg",
   "0x858701b4238910259427eda6181d5488c1d29bc72b33f3c957d58108694b29c1"],
  [3, "Fugu Grid", "Grid trading", "$0.05", false, "/brand/grid.svg",
   "0x326c3c909d8e55a9b07d7886b5ef314fd652f62299d1854c687dd0f65143eafb"],
  [4, "Fugu Yield", "Yield", "$0.05", false, "/brand/yield.svg",
   "0xf67c457f4a678dbbf0a62f101b6518ff8c2c42b83bbd2e7fe21d9b9d91683aa3"],
  [5, "Fugu Broker", "Hiring", "$0.05", false, "/brand/fallback.svg",
   "0x6b2a11e358ae86aa535365e5deb5d0e941e2d939e57f2890347741f936130aaf"],
  [6, "Fugu Trader", "Commerce", "$0.05", false, "/brand/fallback.svg",
   "0x34a247f4dd396825f28383d0e15c5d781ad4c3978439b4ca8886eb31aedfb715"],
  [7, "Fugu Pilot", "Autonomous", "$0.05", false, "/brand/fallback.svg",
   "0x074830b01b4ef0461114b4734c2d4eaeef34938318ca788e21a47b13d2f92eb9"],
  [8, "Fugu Meter", "Streaming", "$0.05", false, "/brand/fallback.svg",
   "0x44f98a19465d147e5ee1444bb109d78f49ad23c188e8a4bfb75b5e6579c9195d"],
  [9, "Fugu Steward", "Treasury", "$0.05", false, "/brand/fallback.svg",
   "0xf0ad5e8dc18844b4dc87cba288db97137836ba6d237a6271c46a167828de2b9c"],
];

export const LISTINGS: Listing[] = LISTING_ROWS.map(
  ([id, name, category, price, hasActed, art, tx]) => ({
    id,
    name,
    category,
    price,
    hasActed,
    art,
    txUrl: `${BSCSCAN}/tx/${tx}`,
  }),
);

/** The period every price is quoted against. Written out so nobody has to guess. */
export const PRICE_PERIOD = "per 120 seconds";

/* ── The four agents that have code behind them ─────────────────────
 *
 * `status` is the whole point of this section. Guardian has paid real money on
 * chain. The other three are listed, rentable and answer questions. They have
 * never sent a transaction, and the card has to say so before anyone pays.
 */
export type Agent = {
  name: string;
  category: string;
  does: string;
  status: "live" | "advice";
  statusLabel: string;
  detail: string;
  art: string;
  tall: boolean;
};

const ADVICE_DETAIL =
  "Listed and rentable, with a decision engine and a backtest behind it. Ask it and it answers. It cannot move money on chain yet.";

export const AGENTS: Agent[] = [
  {
    name: "Fugu Guardian",
    category: "Health Factor Monitoring",
    does: "Protects lending positions from liquidation",
    status: "live",
    statusLabel: "Live, it has acted",
    detail:
      "It has already paid down a real loan on chain, signed by a key that can only spend up to a fixed amount.",
    art: "/brand/guardian.svg",
    tall: true,
  },
  {
    name: "Fugu Rebalancer",
    category: "Rebalancing",
    does: "Manages LP ranges, resets positions automatically",
    status: "advice",
    statusLabel: "Rentable, advice only",
    detail: ADVICE_DETAIL,
    art: "/brand/rebalancer.svg",
    tall: false,
  },
  {
    name: "Fugu Grid",
    category: "Grid Trading",
    does: "Places and manages automated grid orders",
    status: "advice",
    statusLabel: "Rentable, advice only",
    detail: ADVICE_DETAIL,
    art: "/brand/grid.svg",
    tall: true,
  },
  {
    name: "Fugu Yield",
    category: "Yield Optimisation",
    does: "Routes liquidity to the highest available APR",
    status: "advice",
    statusLabel: "Rentable, advice only",
    detail: ADVICE_DETAIL,
    art: "/brand/yield.svg",
    tall: false,
  },
];

/* ── Puff levels ────────────────────────────────────────────────────
 * The design scale from docs/brand/puff-levels.md. Described as a scale, not as
 * a live reading: nothing on this page claims to be showing one.
 */
export const PUFF_LEVELS = [
  { level: 1, name: "Calm", src: "/brand/guardian-kembung-1.svg" },
  { level: 2, name: "Watchful", src: "/brand/guardian-kembung-2.svg" },
  { level: 3, name: "Strained", src: "/brand/guardian-kembung-3.svg" },
  { level: 4, name: "Critical", src: "/brand/guardian-kembung-4.svg" },
  { level: 5, name: "Emergency", src: "/brand/guardian-kembung-5.svg" },
];

/* ── What comes next ────────────────────────────────────────────────
 * None of this is built. The section that renders it says so in its own words.
 */
export type NextBuild = { title: string; does: string; piece: string };

export const NEXT_BUILDS: NextBuild[] = [
  {
    title: "Agent hiring marketplace",
    does: "Hires and pays other agents, escrow handled",
    piece: "ERC-8183 buyer side, hireErc8183Agent",
  },
  {
    title: "Agent-to-agent commerce",
    does: "Buys inference or data per call, neither side holds the other's keys",
    piece: "b402 payments, @altananetwork/x402-server",
  },
  {
    title: "Autonomous DeFi",
    does: "Rebalances, lends, stakes, copy-trades inside a cap it cannot exceed",
    piece: "Spend caps plus Aave, Venus, PancakeSwap, Lista skills",
  },
  {
    title: "Micro-payment streaming",
    does: "Pays per call, per second, per unit, with no human approving each one",
    piece: "Session key with expiry, b402",
  },
  {
    title: "Treasury or payroll",
    does: "Runs recurring payments and subscriptions on a schedule",
    piece: "Multiple agents on one wallet, different scopes",
  },
];

/* ── Proof ──────────────────────────────────────────────────────────
 * Numbers only where a link or a command backs them.
 */
export const REPAY_TX =
  "0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc";
export const REPAY_TX_URL = `${BSCSCAN}/tx/${REPAY_TX}`;
export const REPAY_BLOCK = 129852222;
export const REPAY_COST = "$4.03";
export const HF_BEFORE = "1.14";
export const HF_AFTER = "1.50";

/** The first rental. $0.50 went into escrow and stayed there. */
export const RENTAL_TX =
  "0x74fa4d9d67daea5c722f2dbc9fd1f43d7e5725d621c412e079085c7c856fe8ac";
export const RENTAL_TX_URL = `${BSCSCAN}/tx/${RENTAL_TX}`;
export const RENTAL_AMOUNT = "$0.50";
export const RENTAL_SUB_ID = 2;

/** The upgrade that widened the catalogue from four categories to nine. */
export const UPGRADE_TX =
  "0x24438b39a85ceeb9411d1cb4197ea8369eb1d1a44c3213656a43cf32c4050c5f";
export const UPGRADE_TX_URL = `${BSCSCAN}/tx/${UPGRADE_TX}`;

export const AGENT_WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0";
export const AGENT_WALLET_URL = `${BSCSCAN}/address/${AGENT_WALLET}`;

/**
 * The two calls the session key may make, and nothing else. An empty allowlist in
 * Altana means unlimited, so this list is written out in full on purpose.
 * Source: docs/STATUS.md, the session key section.
 */
export const ALLOWLIST = [
  "mLendingPool.repay(address,uint256,address)",
  "mUSD.approve(address,uint256)",
];
export const ALLOWLIST_CAP = "0.02 tBNB and 100 mUSD per day";
export const ALLOWLIST_EXPIRY = "8 October 2026";

export const CONTRACTS = [
  { name: "FuguRegistry", address: "0xb2f36070E6eae3353E8e755172B477DF213ae248" },
  { name: "FuguSubscription", address: "0xfdb083371f44Cf53181350389D3217e51B431776" },
  { name: "FuguReputation", address: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400" },
  { name: "FuguPriceOracle", address: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65" },
  { name: "FuguAuditEscrow", address: "0x0354d2a4be40f118e4d1301915ee2ff54eec8a52" },
].map((c) => ({ ...c, url: `${BSCSCAN}/address/${c.address}` }));

/** Recounted in this working tree, not carried over from an older note. */
export const TEST_COUNTS = [
  { name: "contracts", count: 150 },
  { name: "Guardian", count: 285 },
  { name: "Rebalancer", count: 130 },
  { name: "Grid", count: 144 },
  { name: "Yield", count: 141 },
  { name: "backend", count: 484 },
];

export const TEST_TOTAL = TEST_COUNTS.reduce((sum, t) => sum + t.count, 0);

/* ── The record, as rows ────────────────────────────────────────────
 *
 * These replace what a page like this would normally carry: five testimonials
 * from five named people. Nobody named has ever said anything about this product,
 * so the component keeps its shape and the content becomes things that actually
 * happened, each one opening on the block explorer.
 *
 * Row 2 has no link and that is not an omission. The call was refused by the
 * account contract before it was ever broadcast, so no hash exists. Inventing one
 * would be exactly the thing this page argues against.
 */
export type Record_ = {
  fact: string;
  who: string;
  kind: string;
  art: string;
  url: string | null;
  /** Shown instead of a link when there is nothing to link to. */
  noLinkReason?: string;
};

export const RECORDS: Record_[] = [
  {
    fact: `Guardian moved a loan's health factor from ${HF_BEFORE} to ${HF_AFTER} by paying ${REPAY_COST} of the debt down. Block ${REPAY_BLOCK.toLocaleString("en-GB")}.`,
    who: "Fugu Guardian",
    kind: "Health factor",
    art: "/brand/guardian.svg",
    url: REPAY_TX_URL,
  },
  {
    fact: "The same key tried a call that was not on its list. The wallet's own contract refused it, so it was never broadcast.",
    who: "The account contract",
    kind: "Spending limit",
    art: "/brand/maskot.svg",
    url: null,
    noLinkReason: "Refused before broadcast, so there is no transaction to open.",
  },
  {
    fact: `The first rental was signed and ${RENTAL_AMOUNT} went into escrow as subscription ${RENTAL_SUB_ID}.`,
    who: "FuguSubscription",
    kind: "Renting",
    art: "/brand/rebalancer.svg",
    url: RENTAL_TX_URL,
  },
  {
    fact: "The catalogue went from four categories to nine, and every listing that already existed read back byte for byte identical afterwards.",
    who: "FuguRegistry",
    kind: "Upgrade",
    art: "/brand/grid.svg",
    url: UPGRADE_TX_URL,
  },
  {
    fact: `${VERIFIED_CONTRACTS} contracts are live on the test network with their source published, so you can read the code next to the address.`,
    who: "The contracts",
    kind: "Published source",
    art: "/brand/yield.svg",
    url: CONTRACTS[0].url,
  },
];
