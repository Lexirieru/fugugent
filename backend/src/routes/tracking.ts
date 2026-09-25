/**
 * `/api/tracking/*` — the endpoints BNB Chain's Set and Earn quest reads.
 *
 * - `GET /api/tracking` — what to track: contracts, events with their signatures and
 *   topics, how agent ids and owners are recorded, and the team's own wallets.
 *   Machine-readable, so a tracker does not have to copy it out of a document.
 * - `GET /api/tracking/hires?wallet=0x…` — every hire by a wallet, with its category.
 * - `GET /api/tracking/agents?owner=0x…` — every listing and ERC-8004 identity it owns.
 * - `GET /api/tracking/reviews?wallet=0x…` — every listing it has rated.
 *
 * Every answer names the block it was read at. A malformed address is a 400 naming
 * the field, never an empty 200 that a tracker would read as "this wallet did nothing".
 */
import { Hono, type Context } from "hono";
import { redact } from "../service/agents.js";
import type { TrackingContracts, TrackingService } from "../sources/tracking.js";
import type { Address } from "../types.js";

export interface TrackingRoutesDeps {
  tracking: TrackingService;
  chainId: number;
  contracts: TrackingContracts & { identityRegistry: Address };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The team's own wallets, so their activity can be excluded from quest counts. */
export const TEAM_WALLETS: { address: Address; role: string }[] = [
  { address: "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E", role: "deployer, owner of all nine listings and their ERC-8004 identities" },
  { address: "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0", role: "Fugu Guardian agent wallet (Altana)" },
  { address: "0xb8f155D1278f0437b9De7c63911f2C0EDa485941", role: "Fugu Rebalancer agent wallet (Altana)" },
  { address: "0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9", role: "Fugu Grid agent wallet (Altana)" },
  { address: "0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866", role: "Fugu Yield agent wallet (Altana)" },
  { address: "0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3", role: "Fugu Broker agent wallet" },
  { address: "0x1B82F72346a8553a968fafD6AC07A21d4A88589f", role: "Fugu Trader agent wallet" },
  { address: "0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D", role: "Fugu Pilot agent wallet" },
  { address: "0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8", role: "Fugu Meter agent wallet" },
  { address: "0xB92Dd50E84560E719627AcE28b32060dbF0E7083", role: "Fugu Steward agent wallet" },
];

/** Topics computed with `cast keccak "<signature>"`; a test recomputes each one. */
export const TRACKED_EVENTS = [
  {
    action: "hire",
    contract: "FuguSubscription",
    signature: "Subscribed(uint256 indexed subId, uint256 indexed listingId, address indexed subscriber, address payToken, uint256 amount)",
    canonical: "Subscribed(uint256,uint256,address,address,uint256)",
    topic0: "0xd940f353ab995909b829f9eb936d8c93f805463ed78624348a2a0d363e9d0313",
    meaning: "A wallet hired an agent. `subscriber` is the hiring wallet, `listingId` the agent's listing (see FuguRegistry.getListing for its ERC-8004 id and category).",
  },
  {
    action: "deposit",
    contract: "FuguSubscription",
    signature: "Subscribed(uint256 indexed subId, uint256 indexed listingId, address indexed subscriber, address payToken, uint256 amount)",
    canonical: "Subscribed(uint256,uint256,address,address,uint256)",
    topic0: "0xd940f353ab995909b829f9eb936d8c93f805463ed78624348a2a0d363e9d0313",
    meaning: "The same event: hiring IS the deposit. `amount` of `payToken` (zero address = native tBNB) moves into FuguSubscription escrow in that transaction. There is no separate deposit call.",
  },
  {
    action: "job completion",
    contract: "FuguSubscription",
    signature: "Claimed(uint256 indexed subId, address indexed to, uint256 amountToOwner, uint256 fee)",
    canonical: "Claimed(uint256,address,uint256,uint256)",
    topic0: "0xd9cb1e2714d65a111c0f20f060176ad657496bd47a3de04ec7c3d4ca232112ac",
    meaning: "The agent was paid for time it actually served: escrow released to the listing owner. A subscription is complete once its `endsAt` has passed and it is fully claimed (getSub(subId).claimed == deposited).",
  },
  {
    action: "cancellation (revoke)",
    contract: "FuguSubscription",
    signature: "Cancelled(uint256 indexed subId, uint256 refunded)",
    canonical: "Cancelled(uint256,uint256)",
    topic0: "0xa761582a460180d55522f9f5fdc076390a1f48a7a62a8afbd45c1bb797948edb",
    meaning: "The hiring wallet stopped the agent; the unearned part of the deposit went back to it in the same transaction.",
  },
  {
    action: "rating",
    contract: "FuguReputation",
    signature: "Reviewed(uint256 indexed listingId, address indexed reviewer, uint8 score, string uri)",
    canonical: "Reviewed(uint256,address,uint8,string)",
    topic0: "0xc453ba298d9bf99d3f3cf3d86d610c59216eb771a33283442392923bb5fa8670",
    meaning: "A wallet rated an agent. Only possible after the agent has actually been paid by that wallet (FuguSubscription.hasSubscribed).",
  },
  {
    action: "agent listed (builder path)",
    contract: "FuguRegistry",
    signature: "Listed(uint256 indexed listingId, address indexed owner, uint8 indexed category, uint256 erc8004AgentId)",
    canonical: "Listed(uint256,address,uint8,uint256)",
    topic0: "0xca0a55ad3ba20c2fadb8216c21d70c4e2108eb92e4817e8dcf10726a28292a74",
    meaning: "A builder listed an agent. `list()` requires the caller to own `erc8004AgentId` in the ERC-8004 IdentityRegistry. Category enum: 0 REBALANCING, 1 GRID, 2 YIELD, 3 HEALTH_FACTOR, 4-8 other kinds.",
  },
  {
    action: "agent registered (ERC-8004)",
    contract: "ERC-8004 IdentityRegistry",
    signature: "Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
    canonical: "Registered(uint256,string,address)",
    topic0: "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a",
    meaning: "The agent identity itself, in the canonical registry. Emitted by the registry, not by us.",
  },
] as const;

function badAddress(c: Context, field: string, value: string | undefined) {
  return c.json(
    {
      error: "invalid_query",
      field,
      message: value === undefined ? `${field} is required` : `${field} must be a 0x-prefixed 20-byte address`,
    },
    400,
  );
}

export function createTrackingRoutes(deps: TrackingRoutesDeps): Hono {
  const app = new Hono();

  app.get("/tracking", (c) =>
    c.json({
      chainId: deps.chainId,
      network: "BSC testnet",
      contracts: {
        FuguSubscription: deps.contracts.subscription,
        FuguRegistry: deps.contracts.registry,
        FuguReputation: deps.contracts.reputation,
        erc8004IdentityRegistry: deps.contracts.identityRegistry,
      },
      events: TRACKED_EVENTS,
      identity: {
        agentId:
          "Every listing names an ERC-8004 agent id in the IdentityRegistry above (FuguRegistry.getListing(listingId).erc8004AgentId). FuguRegistry.list() and rebindAgentId() require the caller to own that id, so a listing cannot claim someone else's agent.",
        ownerWallet:
          "FuguRegistry.getListing(listingId).owner is the listing owner and the one paid by FuguSubscription.claim. The identity owner is IdentityRegistry.ownerOf(agentId). The agent's operating wallet is FuguRegistry.getListing(listingId).agentWallet.",
        agentKey: "Agents are addressed as `97:<erc8004AgentId>` across this API and at https://app.hellofugu.xyz/agent/97:<id>.",
      },
      endpoints: {
        hiresPerWallet: "/api/tracking/hires?wallet=0x…",
        agentsPerOwner: "/api/tracking/agents?owner=0x…",
        ratingsPerWallet: "/api/tracking/reviews?wallet=0x…",
      },
      teamWallets: TEAM_WALLETS,
    }),
  );

  async function answer<T>(c: Context, work: () => Promise<T>) {
    try {
      return c.json(await work());
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message.split("\n")[0]}` : String(err);
      return c.json({ error: "chain_read_failed", message: redact(message) }, 503);
    }
  }

  app.get("/tracking/hires", (c) => {
    const wallet = c.req.query("wallet");
    if (wallet === undefined || !ADDRESS.test(wallet)) return badAddress(c, "wallet", wallet);
    return answer(c, () => deps.tracking.hires(wallet as Address));
  });

  app.get("/tracking/agents", (c) => {
    const owner = c.req.query("owner");
    if (owner === undefined || !ADDRESS.test(owner)) return badAddress(c, "owner", owner);
    return answer(c, () => deps.tracking.agents(owner as Address));
  });

  app.get("/tracking/reviews", (c) => {
    const wallet = c.req.query("wallet");
    if (wallet === undefined || !ADDRESS.test(wallet)) return badAddress(c, "wallet", wallet);
    return answer(c, () => deps.tracking.reviews(wallet as Address));
  });

  return app;
}
