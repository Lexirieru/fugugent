# Fugugent — Credentials & Environment

Split into three groups: **you provide**, **I generate**, and **produced by tooling**.

> ⚠️ **NEVER use a private key that has ever touched mainnet.**
> Every wallet in this project is a brand-new, single-use testnet wallet.

---

## A. You provide — blocking work

| # | Variable | Where from | Used for | Priority |
|---|---|---|---|---|
| A1 | `DEPLOYER_PRIVATE_KEY` | a **NEW wallet**, created specifically for testnet | deploy the 4 UUPS contracts to BSC testnet | 🔴 now |
| A2 | `DGRID_API_KEY` | https://dgrid.ai (you already have an account) | agent LLM brain + category classifier | 🔴 now |
| A3 | `SCAN8004_API_KEY` | https://8004scan.io/developers → then request Pro tier via the hackathon form https://forms.gle/jQevEPCAacBXaKG79 | primary data source for the marketplace | 🔴 now |
| A4 | `BSCSCAN_API_KEY` | https://bscscan.com/myapikey (free) | contract verification on testnet.bscscan.com | 🟠 at deploy time |
| A5 | `BSC_TESTNET_RPC_URL` | NodeReal / QuickNode / Ankr (free tier is enough) | the indexer's `eth_getLogs` is heavy — public RPCs will rate-limit it | 🟠 at indexer time |
| A6 | VPS access | yours | deploy | 🟡 at deploy time |
| A7 | DNS `hellofugu.xyz` | your registrar | `@`, `app`, `api` → VPS IP | 🟡 at deploy time |

### Notes per item

**A1 — Deployer wallet.** Create a new one:
```bash
cast wallet new
```
Fund it with tBNB: https://testnet.bnbchain.org/faucet-smart
or the official Telegram bot https://t.me/bnbchain_official_bot
(send: `I would like to get tBNB to my wallet <address>`, max 0.3 tBNB/day).
You need ~0.5 tBNB total for deploy + testing.

**A5 — Why a dedicated RPC.** Our indexer reads `Registered`/`URIUpdated` events
from the ERC-8004 registry, which holds 340k+ agents. Public RPCs will reject large
range queries. The public default (`data-seed-prebsc-1-s1.bnbchain.org`) is verified
working for light usage and is enough to get started.

> ⚠️ The SDK's built-in default RPC uses the `binance.org` domain, which is **proven to
> be blocked from Indonesian networks**. `RPC_URL` **must** be overridden in every service.

---

## B. I generate myself — nothing for you to do

| Variable | How it is produced |
|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | `openssl rand -base64 32` |
| `JWT_SECRET` / `SESSION_SECRET` | `openssl rand -hex 32` |
| `WALLET_PASSWORD` (agent admin keystore) | generated randomly, stored in `.studio/.env.local` with mode 0600 |
| Deployed contract addresses | recorded in `contracts/deployments/bsc-testnet.json` |
| Admin wallet for each agent | `bag wallet new` per agent |

---

## C. Produced by tooling — do not fill in manually

| Variable | Produced by | Notes |
|---|---|---|
| `ALTANA_SESSION` | `bag wallet session grant` | a serialized, bounded session. **Never print, parse, or copy its `signer` part.** |
| Agent wallet addresses | `bag wallet new` | 9 agents = 9 admin wallets. The five newest were generated ahead of their agents, see §G3 |
| ERC-8004 `agentId` | `bag erc8004 register` | on-chain identity for each agent |

**Every agent admin wallet needs funding** with ~0.05 tBNB + U.
U testnet faucet: contract `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3`,
call `requestTokens()` — 10 U every 30 minutes.
Alternative: the Telegram bot, send `I would like to get U to my wallet <address>`.

Total funding needed: **9 agent wallets × (0.05 tBNB + 10 U)** + **deployer 0.5 tBNB**.
Only the first four are funded today; the five wallets in §G3 hold nothing yet.

---

## D. LLM provider for Agent Studio — needs testing

Agent Studio **rejects** the combination `--wallet-kind altana` + `--llm-provider pieverse-llm`
(Altana refuses generic message signing, so Pieverse SIWE fails). Accepted providers:
`openrouter`, `openai`, `anthropic`.

Plan: use `--llm-provider openai` with the base URL pointed at dGrid
(`https://api.dgrid.ai/v1`), since dGrid is OpenAI-compatible.

```
OPENAI_API_KEY=<DGRID_API_KEY>
OPENAI_BASE_URL=https://api.dgrid.ai/v1
```

**Not yet verified** whether `studio.toml` honours the base URL override. This is one of
the two technical gates to be tested before writing any agent code. If it is rejected,
the fallback is: the agent calls dGrid from our backend rather than from inside the
Studio runtime.

---

## E. Network constants (already verified live, no need to look them up again)

```bash
CHAIN_ID=97
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545   # backup: https://bsc-testnet-rpc.publicnode.com
EXPLORER=https://testnet.bscscan.com

# Agent registry & infrastructure
ERC8004_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8183_COMMERCE=0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de
ALTANA_KEYSTORE=0x6b8361C29d05D498b1a12B54A37310f94171E94A
ALTANA_CONTROLLER=0xb530D1971f5453F3359518343F05D0AedFfF7e12
ALTANA_RELAY=https://testnet-relay.altana.network
ALTANA_EXPLORER=https://testnet.altana.network

# Tokens (ALL 18 decimals — USDT on BSC is NOT 6 decimals)
TOKEN_U=0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565
TOKEN_USDT=0x337610d27c682E347C9cD60BD4b3b107C9d34dDd
TOKEN_BUSD=0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee
TOKEN_WBNB=0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd

# Chainlink price feeds (8 decimals, verified live 2026-09-08)
FEED_BNB_USD=0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526
FEED_USDT_USD=0xEca2605f0BCF2BA5966372C99837b1F182d3D620
FEED_BUSD_USD=0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa
FEED_ETH_USD=0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7

# APIs
DGRID_BASE_URL=https://api.dgrid.ai/v1
SCAN8004_BASE_URL=https://api.8004scan.io/api/v1
DEFILLAMA_YIELDS=https://yields.llama.fi/pools
```

> Calls to 8004scan **must** include a browser `User-Agent` — without it the API
> replies HTTP 500, not 429.

---

## F. What is NOT needed

- **AWS / Azure account** — we self-host on a VPS, no AgentCore/Foundry.
- **Mainnet private keys** — everything is testnet.
- **Pieverse account** — not compatible with Altana wallets.
- **VPN** — except if we later want to test Binance Bazaar/B402, which is blocked from
  Indonesia. Not on the critical path.

---

## G. Fugugent contracts and listings on BSC testnet (recorded, not to be guessed)

The full record with gas, blocks, and the mock deployments is
`contracts/deployments/bsc-testnet.json`. This section is the short version.

### G1. Proxies and implementations

| Contract | Proxy (ERC-1967) | Implementation |
|---|---|---|
| FuguPriceOracle | `0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65` | `0x864f888330821b6025b2fe670f30e01ee8776449` |
| FuguRegistry | `0xb2f36070E6eae3353E8e755172B477DF213ae248` | `0x13836c1bc0d32def6b6c0ec2acf120c2f342f3eb` |
| FuguSubscription | `0xfdb083371f44Cf53181350389D3217e51B431776` | `0x06bc0ba1dbc3b6fd22defe7a0cd9a6cd13c15e97` |
| FuguReputation | `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400` | `0x30c92ffadad24ca079227a92a33b78683d36fde6` |
| FuguAuditEscrow | `0x0354d2a4be40f118e4d1301915ee2ff54eec8a52` | `0xf7a0e340455af3c476564d7af283d9be4d2cfabb` |

Every implementation is verified on BscScan testnet (solc `v0.8.30+commit.73712a01`,
optimizer on, 200 runs). Read the verification back with the **V2** endpoint; the V1 host
`api-testnet.bscscan.com` is deprecated and answers `NOTOK` with a message that blames the
API key rather than the endpoint:

```bash
curl -s "https://api.etherscan.io/v2/api?chainid=97&module=contract&action=getsourcecode&address=<impl>&apikey=$BSCSCAN_API_KEY"
```

`forge verify-contract` needs the same endpoint passed explicitly:
`--verifier-url "https://api.etherscan.io/v2/api?chainid=97"`.

### G2. The category upgrade of 2026-09-09

`FuguRegistry` was upgraded so the catalog holds nine categories instead of four. The five
new values were **appended** after `HEALTH_FACTOR`, so indices 0-3 keep their meaning.

| | |
|---|---|
| Implementation before | `0xd68968cf68e9930a689e0fc9d648a898050a548a` |
| Implementation after | [`0x13836c1b…`](https://testnet.bscscan.com/address/0x13836c1bc0d32def6b6c0ec2acf120c2f342f3eb#code) |
| Implementation deploy tx | `0xfa3d51060328db38a268de78705b01e9c876fa062651a55aaa4d92d514112176` |
| Upgrade tx | `0x24438b39a85ceeb9411d1cb4197ea8369eb1d1a44c3213656a43cf32c4050c5f` (block 130002412, 37,649 gas) |
| `INIT_DATA` | empty, on purpose. The widening adds no state variable, so there is no reinitializer |

Two checks anyone can repeat. Before the upgrade `countByCategory(4)` reverted with empty
data, because 4 is out of range for a four-value enum; it returns a number now. And the four
listings that already existed read back byte for byte identical before and after:

```bash
for i in 1 2 3 4; do
  cast call --rpc-url "$BSC_TESTNET_RPC_URL" 0xb2f36070E6eae3353E8e755172B477DF213ae248 \
    'getListing(uint256)((uint256,address,address,uint8,uint128,uint32,bool,bool,string))' $i
done
```

### G3. The nine listings

`listingCount()` is **9**, and `countByCategory` is 1 for every category 0 through 8.

| id | Agent | Category (enum) | Agent wallet | Registration tx |
|---|---|---|---|---|
| 1 | Fugu Guardian | HEALTH_FACTOR (3) | `0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E` | `0x590d2f13731bef32c6409d32c9f278af8b897766a0a82e0b504acf6799ffeab7` |
| 2 | Fugu Rebalancer | REBALANCING (0) | `0xb8f155D1278f0437b9De7c63911f2C0EDa485941` | `0x858701b4238910259427eda6181d5488c1d29bc72b33f3c957d58108694b29c1` |
| 3 | Fugu Grid | GRID (1) | `0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9` | `0x326c3c909d8e55a9b07d7886b5ef314fd652f62299d1854c687dd0f65143eafb` |
| 4 | Fugu Yield | YIELD (2) | `0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866` | `0xf67c457f4a678dbbf0a62f101b6518ff8c2c42b83bbd2e7fe21d9b9d91683aa3` |
| 5 | Fugu Broker | HIRING (4) | `0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3` | `0x6b2a11e358ae86aa535365e5deb5d0e941e2d939e57f2890347741f936130aaf` |
| 6 | Fugu Trader | COMMERCE (5) | `0x1B82F72346a8553a968fafD6AC07A21d4A88589f` | `0x34a247f4dd396825f28383d0e15c5d781ad4c3978439b4ca8886eb31aedfb715` |
| 7 | Fugu Pilot | AUTONOMOUS (6) | `0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D` | `0x074830b01b4ef0461114b4734c2d4eaeef34938318ca788e21a47b13d2f92eb9` |
| 8 | Fugu Meter | STREAMING (7) | `0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8` | `0x44f98a19465d147e5ee1444bb109d78f49ad23c188e8a4bfb75b5e6579c9195d` |
| 9 | Fugu Steward | TREASURY (8) | `0xB92Dd50E84560E719627AcE28b32060dbF0E7083` | `0xf0ad5e8dc18844b4dc87cba288db97137836ba6d237a6271c46a167828de2b9c` |

Listings 5 to 9 all landed in block 130003272, 5,342,324 gas in total, $0.05 per 120 seconds
each. Listing 1 is $0.10 per 120 seconds; that price gap is the capability gap.

> ⚠️ **The wallets for listings 5 to 9 were created before their agents existed.**
> `agentWallet` cannot be corrected after `list()`: `FuguRegistry` has no setter for it and
> `updateListing` does not reach it. The five directories `ai/fugubroker`, `ai/fugutrader`,
> `ai/fugupilot`, `ai/fugumeter`, `ai/fugusteward` held no wallet when the listings were
> registered, so five brand-new testnet EOAs were generated with `cast wallet new` and
> written into the listings. Their keys are in `contracts/.env` as
> `AGENT_WALLET_<NAME>_PRIVATE_KEY` (gitignored, unfunded, never used anywhere else).
>
> **Whoever builds one of these five agents must ADOPT its address rather than generate a
> new one**, or the chain and the repository will point at different wallets forever:
>
> ```bash
> cd ai/<slug>/app/agent
> bag wallet new --private-key -    # paste the key on stdin; an inline key is refused
> ```

### G4. Nine categories, and why their order is frozen

`Category` in `contracts/src/types/FuguTypes.sol`, mirrored by `CATEGORIES` in
`backend/src/types.ts`. The index is stored inside every listing, so the order is
**append-only**: reordering it silently relabels listings that already exist.

| index | enum | Agent |
|---|---|---|
| 0 | `REBALANCING` | Fugu Rebalancer |
| 1 | `GRID` | Fugu Grid |
| 2 | `YIELD` | Fugu Yield |
| 3 | `HEALTH_FACTOR` | Fugu Guardian |
| 4 | `HIRING` | Fugu Broker |
| 5 | `COMMERCE` | Fugu Trader |
| 6 | `AUTONOMOUS` | Fugu Pilot |
| 7 | `STREAMING` | Fugu Meter |
| 8 | `TREASURY` | Fugu Steward |

`contracts/test/CategoryUpgradeSafety.t.sol` fails if that order changes.
