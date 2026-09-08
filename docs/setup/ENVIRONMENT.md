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
| A7 | DNS `fugugent.xyz` | your registrar | `@`, `app`, `api` → VPS IP | 🟡 at deploy time |

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
| Agent wallet addresses | `bag wallet new` | 4 agents = 4 admin wallets |
| ERC-8004 `agentId` | `bag erc8004 register` | on-chain identity for each agent |

**Every agent admin wallet needs funding** with ~0.05 tBNB + U.
U testnet faucet: contract `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3`,
call `requestTokens()` — 10 U every 30 minutes.
Alternative: the Telegram bot, send `I would like to get U to my wallet <address>`.

Total funding needed: **4 agent wallets × (0.05 tBNB + 10 U)** + **deployer 0.5 tBNB**.

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
