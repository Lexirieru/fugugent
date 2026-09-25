# HelloFugu — Set and Earn tracking details

For the BNB Chain Phase 2 team. Everything below can be checked without an account:
the contracts on BscScan, the endpoints with `curl`.

The same content is served machine-readable at
**https://api.hellofugu.xyz/api/tracking**.

## Network

**BSC testnet, chain 97.** Stated on every page of the marketplace (badge in the header)
and in the footer's contract list. Mainnet migration is planned. The registry reader
already carries the mainnet IdentityRegistry address (`0x8004A169…a432`).

## Contracts

| Contract | Address | Role |
|---|---|---|
| FuguSubscription | [`0xfdb083371f44Cf53181350389D3217e51B431776`](https://testnet.bscscan.com/address/0xfdb083371f44Cf53181350389D3217e51B431776) | Hire, deposit (escrow), payout by the second, cancel/refund |
| FuguRegistry | [`0xb2f36070E6eae3353E8e755172B477DF213ae248`](https://testnet.bscscan.com/address/0xb2f36070E6eae3353E8e755172B477DF213ae248) | Listings: ERC-8004 agent id, owner, category, price |
| FuguReputation | [`0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400`](https://testnet.bscscan.com/address/0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400) | Ratings, gated on having paid the agent |
| ERC-8004 IdentityRegistry | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | The canonical registry; the whole catalogue is read from it |

All three Fugu contracts are UUPS proxies with verified implementations.

## Events

| Action | Contract | Event | topic0 |
|---|---|---|---|
| **Hire** | FuguSubscription | `Subscribed(uint256 indexed subId, uint256 indexed listingId, address indexed subscriber, address payToken, uint256 amount)` | `0xd940f353ab995909b829f9eb936d8c93f805463ed78624348a2a0d363e9d0313` |
| **Deposit** | FuguSubscription | the same `Subscribed` event: hiring *is* the deposit. `amount` of `payToken` (zero address = native tBNB) goes into escrow in that transaction. | same |
| **Job completion** | FuguSubscription | `Claimed(uint256 indexed subId, address indexed to, uint256 amountToOwner, uint256 fee)`: escrow released to the agent for time served. A subscription is complete when `endsAt` has passed and `getSub(subId).claimed == deposited`. | `0xd9cb1e2714d65a111c0f20f060176ad657496bd47a3de04ec7c3d4ca232112ac` |
| **Rating** | FuguReputation | `Reviewed(uint256 indexed listingId, address indexed reviewer, uint8 score, string uri)` | `0xc453ba298d9bf99d3f3cf3d86d610c59216eb771a33283442392923bb5fa8670` |
| Cancellation (revoke) | FuguSubscription | `Cancelled(uint256 indexed subId, uint256 refunded)` | `0xa761582a460180d55522f9f5fdc076390a1f48a7a62a8afbd45c1bb797948edb` |
| Agent listed (builder path) | FuguRegistry | `Listed(uint256 indexed listingId, address indexed owner, uint8 indexed category, uint256 erc8004AgentId)` | `0xca0a55ad3ba20c2fadb8216c21d70c4e2108eb92e4817e8dcf10726a28292a74` |

**Category of a hire:** `Subscribed.listingId` → `FuguRegistry.getListing(listingId).category`
(`0` REBALANCING, `1` GRID, `2` YIELD, `3` HEALTH_FACTOR). This is the category the listing owner
declared on chain, not a label we infer.

## How agent ids and owner wallets are recorded

- **ERC-8004 is used.** Every listing stores an `erc8004AgentId` in the IdentityRegistry above.
  `FuguRegistry.list()` requires the caller to own that id (`ownerOf(id) == msg.sender`), so a
  builder can only list their own agent. Our nine listings are ids **2480–2488**.
- **Listing owner:** `FuguRegistry.getListing(listingId).owner`, which is also who FuguSubscription pays.
- **Identity owner:** `IdentityRegistry.ownerOf(agentId)`.
- **Agent's operating wallet:** `FuguRegistry.getListing(listingId).agentWallet`.
- Agents are addressed as `97:<erc8004AgentId>` in the API and at
  `https://app.hellofugu.xyz/agent/97:<id>`.

## API

Contract state, read through Multicall3, and stamped with the block it was read at.

| Question | Endpoint |
|---|---|
| Hires per wallet (with each hire's category, and `categoriesHired`) | `GET https://api.hellofugu.xyz/api/tracking/hires?wallet=0x…` |
| Agents per owner (FuguRegistry listings + ERC-8004 identities) | `GET https://api.hellofugu.xyz/api/tracking/agents?owner=0x…` |
| Ratings per wallet | `GET https://api.hellofugu.xyz/api/tracking/reviews?wallet=0x…` |

A malformed address is answered with a 400 that names the field. A failed chain read is
answered with a 503 and the reason. Neither ever comes back as an empty 200.

## Team wallets (exclude from quest counts)

| Address | Role |
|---|---|
| `0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E` | Deployer; owner of all nine listings and identities |
| `0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0` | Fugu Guardian agent wallet |
| `0xb8f155D1278f0437b9De7c63911f2C0EDa485941` | Fugu Rebalancer agent wallet |
| `0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9` | Fugu Grid agent wallet |
| `0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866` | Fugu Yield agent wallet |
| `0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3` | Fugu Broker agent wallet |
| `0x1B82F72346a8553a968fafD6AC07A21d4A88589f` | Fugu Trader agent wallet |
| `0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D` | Fugu Pilot agent wallet |
| `0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8` | Fugu Meter agent wallet |
| `0xB92Dd50E84560E719627AcE28b32060dbF0E7083` | Fugu Steward agent wallet |

## Where to see it working

- Marketplace: https://app.hellofugu.xyz — no login or wallet needed to browse.
- Catalogue source and freshness: https://api.hellofugu.xyz/api/health
- Hire → cancel end to end: `frontend/e2e/hire-flow.mjs` drives the real UI against a fork
  of BSC testnet and fails if the wallet is ever asked for an ERC-20 approval.
- Repository: https://github.com/Lexirieru/fugugent
