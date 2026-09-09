/**
 * Every claim the page makes, in one place.
 *
 * House rule for this repo: a number on the page must be checkable by a stranger.
 * So each entry below either carries a link someone can open, or a command someone
 * can run. Anything that could not be traced back to `docs/STATUS.md`,
 * `docs/e2e/2026-09-08-e2e-testnet.md` or a command run in this working tree was
 * dropped rather than guessed.
 */

const BSCSCAN = "https://testnet.bscscan.com";

export const REPO_URL = "https://github.com/Lexirieru/fugugent";
export const STATUS_DOC_URL = `${REPO_URL}/blob/main/docs/STATUS.md`;

/* ── The rails ──────────────────────────────────────────────────────
 *
 * Only the five that the running code actually touches. Two more logos ship in
 * `public/logos/tracks/` — TermiX and PancakeSwap — but neither appears on any
 * code path; they are hackathon tracks, not integrations, so putting them under
 * a "built with" label would be a claim we cannot support.
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

/* ── The four agents that exist ─────────────────────────────────────
 *
 * `state` is the whole point of this section. Guardian has paid real money on
 * chain. The other three are listed, rentable and answer questions — they have
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

export const AGENTS: Agent[] = [
  {
    name: "Fugu Guardian",
    category: "Health Factor Monitoring",
    does: "Protects lending positions from liquidation",
    status: "live",
    statusLabel: "Live — it has acted",
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
    statusLabel: "Rentable — advice only",
    detail:
      "Listed and rentable, with a decision engine and a backtest behind it. Ask it and it answers. It cannot move money on chain yet.",
    art: "/brand/rebalancer.svg",
    tall: false,
  },
  {
    name: "Fugu Grid",
    category: "Grid Trading",
    does: "Places and manages automated grid orders",
    status: "advice",
    statusLabel: "Rentable — advice only",
    detail:
      "Listed and rentable, with a decision engine and a backtest behind it. Ask it and it answers. It cannot move money on chain yet.",
    art: "/brand/grid.svg",
    tall: true,
  },
  {
    name: "Fugu Yield",
    category: "Yield Optimisation",
    does: "Routes liquidity to the highest available APR",
    status: "advice",
    statusLabel: "Rentable — advice only",
    detail:
      "Listed and rentable, with a decision engine and a backtest behind it. Ask it and it answers. It cannot move money on chain yet.",
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

export const AGENT_WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0";
export const AGENT_WALLET_URL = `${BSCSCAN}/address/${AGENT_WALLET}`;

export const CONTRACTS = [
  { name: "FuguRegistry", address: "0xb2f36070E6eae3353E8e755172B477DF213ae248" },
  { name: "FuguSubscription", address: "0xfdb083371f44Cf53181350389D3217e51B431776" },
  { name: "FuguReputation", address: "0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400" },
  { name: "FuguPriceOracle", address: "0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65" },
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
