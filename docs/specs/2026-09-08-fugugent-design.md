# Fugugent — Design Spec

**Date:** 2026-09-08
**Status:** awaiting review
**Context:** BNB Chain Hackathon "The Smart Money Era: Build the Era"
**Supporting research:** `docs/research/01`–`06`

---

## 1. Product Positioning

**Fugugent is the front door to the BNB Chain agent economy — the place where you can
see what an agent is allowed to do with your money before you hire it.**

Other marketplaces show agents as a list. Fugugent shows agents as
**living creatures with permissions you can see and revoke**. Every agent is a
fugu fish; when its risk load rises, the fugu puffs up. Abstract metrics become
feedback you read instantly.

Positioning line (above the fold): *"You don't ask an agent a question. You
give it a job — and limits it cannot cross."*

### Why this wins

| Judging criterion | Weight | How we win |
|---|---|---|
| Functionality | high | A 4-step journey with no dead ends: land → category → URL-addressable detail → hire with 1 signature. Every empty state is prescriptive. |
| Data Quality | high | Real-time decision metrics that can be verified on-chain, not just counts. Every number has a tx hash. |
| Agent Diversity | high | 4 categories with parity enforced by a checklist, plus our own 4 first-party agents as a quality floor. |

---

## 2. Locked Decisions

See `docs/research/00-decisions.md` for the first 10 decisions. Additions from the
design session:

| # | Topic | Decision | Reason |
|---|---|---|---|
| 11 | Agent runtime | Scaffold with `bag init --wallet-kind altana`, self-hosted on a VPS | Studio has no scheduler; the cloud trial lasts only 48 hours |
| 12 | Smart contracts | 3 UUPS contracts: `FuguRegistry`, `FuguSubscription`, `FuguReputation` | Fills the gap that neither ERC-8183 (one-shot jobs) nor Altana (permissions) covers |
| 13 | Role of the LLM | Deterministic for money decisions; LLM for explanation and research | Can be backtested honestly; matches Studio's "signing is fixed code" principle |

---

## 3. System Architecture

```
                    fugugent.xyz              app.fugugent.xyz
                   ┌────────────┐            ┌──────────────────┐
                   │ landingpage│            │ frontend (Next 16)│
                   │  (Next 16) │            │ SSR discovery     │
                   └────────────┘            │ URL-based detail  │
                                             │ perms+revoke panel│
                                             └─────────┬─────────┘
                                                       │ REST + WS
                                             api.fugugent.xyz
                   ┌───────────────────────────────────▼─────────────────────┐
                   │ backend (Hono)                                          │
                   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
                   │  │ BFF/     │ │ indexer  │ │classifier│ │ scheduler  │  │
                   │  │ proxy    │ │ ERC-8004 │ │ 4 categ. │ │ BullMQ     │  │
                   │  │ 8004scan │ │ + Fugu*  │ │          │ │            │  │
                   │  └──────────┘ └──────────┘ └──────────┘ └─────┬──────┘  │
                   │       Postgres (Drizzle)  ·  Redis                │      │
                   └───────────────────────────────────────────────────┼──────┘
                                                                       │ trigger
                   ┌───────────────────────────────────────────────────▼──────┐
                   │ ai/ — 4 Fugu agents (Studio scaffold, altana wallet)      │
                   │  fugurebalancer · fugugrid · fuguyield · fuguguardian     │
                   │  A2A :9000 · MCP :8000 · x402 · sellerCore.runWork        │
                   └───────────────────────────────┬──────────────────────────┘
                                                   │ session key (bounded)
                   ┌───────────────────────────────▼──────────────────────────┐
                   │ BSC Testnet (97)                                          │
                   │  Altana Keystore 0x6b8361C2…E94A   ERC-8004 0x8004A818…   │
                   │  contracts/: FuguRegistry · FuguSubscription · FuguReput. │
                   │  PancakeSwap v3 · Venus · Aave v3                         │
                   └──────────────────────────────────────────────────────────┘
```

### Separation principles

- **The frontend never calls 8004scan directly.** Everything goes through the BFF.
  Reason: the upstream is proven to return intermittent `500 DATABASE_ERROR` (4 of 5
  attempts failed during research), it rejects requests without a browser User-Agent,
  and the API key must never leak into the browser.
- **Every data source has a fallback.** 8004scan → our own on-chain indexer →
  Postgres cache. The marketplace must never be empty when the judges open it.
- **Financial decisions never pass through an LLM.** Strategies are pure code that
  gets backtested. The LLM only explains decisions that were already made.

---

## 4. Smart Contracts

All UUPS upgradeable (OpenZeppelin `UUPSUpgradeable` + `Initializable`), Foundry,
BSC testnet. The libraries are already in `contracts/lib/`.

### 4.1 `FuguRegistry`

A curated catalog. It bridges ERC-8004 (raw identity, 309k agents, mostly spam)
with a marketplace worth showing.

```solidity
struct Listing {
    uint256 erc8004AgentId;   // canonical identity at 0x8004A818…
    address owner;            // creator, receives the revenue share
    Category category;        // REBALANCING | GRID | YIELD | HEALTH_FACTOR
    address agentWallet;      // the agent's Altana wallet
    string  metadataURI;      // extended detail beyond ERC-8004
    uint96  pricePerPeriod;   // subscription price
    uint32  periodSeconds;
    bool    active;
}
```

- `list()`, `updateListing()`, `deactivate()` — listing owner only.
- `setCurator()` — a role for marking a listing as curated (badge in the UI).
- Events `Listed`, `Updated`, `Deactivated` → indexed by the backend.
- **The `Category` enum makes 4-category parity** countable on-chain, not just a
  claim in the UI.

### 4.2 `FuguSubscription`

Periodic subscription escrow plus revenue share. This is what neither ERC-8183
(one-shot per-job escrow) nor Altana (permissions only) has.

```solidity
struct Sub {
    uint256 listingId;
    address subscriber;
    uint96  deposited;      // total placed in escrow
    uint96  claimed;        // already withdrawn by the agent
    uint64  startedAt;
    uint64  expiresAt;
    bool    cancelled;
}
```

- `subscribe(listingId, periods)` — the user deposits; the funds **stay in escrow**.
- `claim(subId)` — the agent can only withdraw **pro-rata to the time that has
  already elapsed**. There is no full up-front payment; a dead agent does not get paid.
- `cancel(subId)` — the user withdraws whatever has not been claimed, at any time.
  This satisfies the "all actions are reversible" principle.
- `_splitRevenue()` — takes `protocolFeeBps` to the treasury, the rest goes to the
  listing owner. **Payouts are visible in the explorer** — the promise HelloMinds
  failed to keep.
- **Multi-token payment with USD-denominated prices** — see §4.3.

### 4.3 `FuguPriceOracle` — the user picks the payment token

**Decision:** subscription prices are denominated in **USD (8 decimals)**, and the
user picks which token to pay with. The contract converts USD → token amount at
transaction time, using a Chainlink price feed.

Why this way, instead of per-token prices: the creator sets the price once ("$5/month")
and never has to update it every time BNB moves. The user pays with whatever is in
their wallet. It also makes price comparison between agents in the marketplace
apples-to-apples — which directly serves the Data Quality criterion.

```solidity
enum PriceSourceKind { CHAINLINK, FIXED_USD }

struct TokenConfig {
    PriceSourceKind kind;
    address feed;          // AggregatorV3Interface, empty when FIXED_USD
    uint32  maxStaleness;  // PER TOKEN — each feed has a different heartbeat
    uint8   tokenDecimals;
    uint64  fixedPriceUsd; // 8 decimals, used when FIXED_USD
    bool    enabled;
}
mapping(address => TokenConfig) public tokens;   // address(0) = native tBNB
```

`quote(token, usdAmount8) → tokenAmount` does the following:
1. read `latestRoundData()`
2. **reject if `answer <= 0`** or `block.timestamp - updatedAt > maxStaleness`
3. convert, accounting for the token decimals and the feed decimals

**The staleness threshold must be per-token.** Verified live on testnet today:
BNB/USD had just updated, while USDT/USD had last updated ~8 hours earlier. A single
uniform threshold would reject every USDT payment. Initial plan: BNB 1 hour,
stablecoins 26 hours.

**Tokens supported at launch** (all verified live on BSC testnet 97):

| Token | Address | Decimals | Price source |
|---|---|---|---|
| tBNB (native) | `address(0)` | 18 | Chainlink BNB/USD `0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526` |
| USDT | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` | **18** | Chainlink USDT/USD `0xEca2605f0BCF2BA5966372C99837b1F182d3D620` |
| BUSD | `0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee` | 18 | Chainlink BUSD/USD `0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa` |
| U | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` | 18 | `FIXED_USD` = $1.00 (no Chainlink feed; U = United Stables) |

> ⚠️ **USDT on BSC has 18 decimals, not 6.** This is a trap that has already claimed
> victims and must be tested explicitly. An alternative testnet USDT address that is
> also live: `0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684`.

**Design consequence in `FuguSubscription`:** the token amount is locked at
`subscribe()` time (not recomputed at `claim`), so price movement after subscribing
does not change anyone's entitlement. A refund at `cancel()` is paid in the same
token that was deposited. Every subscription stores its `payToken`.

**What the owner can change:** add/disable tokens, swap a feed, change staleness.
The owner **cannot** touch funds already in escrow.

### 4.4 `FuguReputation`

Anti-sybil reviews.

- `review(listingId, score, uri)` — **can only be called by a wallet with a proven
  expired/active subscription in `FuguSubscription`.** One review per subscription,
  editable once.
- Stores the `sum/count` aggregate per listing for cheap reads.
- This is a rating that is **only possible in Web3** — it cannot be faked without paying.

### 4.5 Upgrade pattern

- Proxy: ERC1967 via `UUPSUpgradeable`. `_authorizeUpgrade` is guarded by `onlyOwner`.
- Initial owner = deployer EOA; note the plan to move to a multisig after the hackathon.
- **Storage gap `uint256[45] __gap`** in every contract.
- Scripts in `contracts/script/`: `Deploy.s.sol` (deploy proxy + impl), `Upgrade.s.sol`.
- Required tests: the initializer cannot be called twice; an upgrade preserves
  storage; a non-owner cannot upgrade; pro-rata claims are correct at period
  boundaries; a review is rejected without a subscription.

---

## 5. The Four Fugu Agents

### 5.1 Shared pattern

Every agent is a project produced by `bag init <name> --wallet-kind altana
--destination self --no-onboard`, with:

- **The strategy** in `app/agent/src/strategy/` — pure deterministic code, no I/O,
  unit-testable and backtestable.
- **`sellerCore.ts` `runWork`** — bridges the strategy to execution.
- **Execution** through an Altana session key: `execute({ session, calls })`.
- **An external scheduler** (BullMQ in the backend) that calls the agent endpoint,
  because Studio has no background poller.
- **Explanations** generated by dGrid: "why I did this" in human language,
  attached to every run.

Project names must be ≤23 chars, alphanumeric, starting with a letter (AgentCore rule):
`fugurebalancer`, `fugugrid`, `fuguyield`, `fuguguardian`.

### 5.2 The agents

| Agent | Category | Protocols | Trigger | Action |
|---|---|---|---|---|
| **Fugu Rebalancer** | Rebalancing | PancakeSwap v3 | price leaves range / deviation / interval | compute a new range, check profitability after gas+slippage+IL, `decreaseLiquidity`→`mint` |
| **Fugu Grid** | Grid Trading | PancakeSwap v3 swap | keeper watches `slot0()`; price crosses a grid level | execute the swap at that level, record the fill |
| **Fugu Yield** | Yield Optimisation | Venus, Aave v3, Lista | the APR gap exceeds the migration cost threshold | move the position to the pool with the highest risk-weighted APR |
| **Fugu Guardian** | Health Factor | Venus, Aave v3 | HF falls below a threshold | partial repay / top up collateral / alert |

Parameter details, formulas, and data sources are in `docs/research/06-agent-strategies.md`.

### 5.3 Hard limits (non-negotiable)

Every agent runs under an Altana session with:
- **a call allowlist** — only the selectors and contract addresses its strategy needs
- **a spend cap** — initial recommendation 10 U/day
- **an expiry** — 30 days, shown as a countdown in the UI
- registered in the **Keystore** at `0x6b8361C29d05D498b1a12B54A37310f94171E94A`

Three known traps that must be avoided (from the Altana research):
1. An empty `calls: []` means **unlimited** permission. Always fill it explicitly.
2. USDT/USDC on BNB Chain have **18 decimals**, not 6.
3. The native spend cap also pays the relay fee — a cap that is too small makes every
   execution `FAILED` with code 300.


### 5.4 Implementation notes from the strategy research

From `docs/research/06-agent-strategies.md` — all marked verified live:

- **Grid needs its own keeper.** PancakeSwap has **no on-chain order book**; its
  "limit orders" depend on an off-chain taker. The Grid agent has to watch the pool's
  `slot0()` and execute swaps itself. This strategy is structurally mean-reversion —
  **it loses money in trending markets, and that must be stated openly**
  on the agent page. That honesty raises credibility; it does not lower it.
- **A rebalance is only executed when `ΔFee − Gas − Slippage − ΔIL > 0`.** The range
  width is a function of realized volatility (±k·σ), not a fixed percentage. Combined
  trigger: out-of-range + deviation >70–80% from the center + a cooldown to avoid churn.
- **The health factor has a ground truth.** `Venus.getAccountLiquidity()` on the
  Comptroller at `0xfD36E2c2a6789Db23113685031d7F16329158384` and
  `AaveV3Pool.getUserAccountData()` at `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`
  are both verified live. Prices from Chainlink BNB/USD
  `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` (decimals 8, verified). This is why
  Guardian is built first — its correctness can be proven against on-chain numbers.
- **Yield APR** from the DefiLlama Yields API `https://yields.llama.fi/pools`
  (chain `"BSC"`, slugs `venus-core-pool`, `aave-v3`, `lista-lending` — all present).
  **But `pancakeswap-amm-v3` does not cover BSC on DefiLlama** — PancakeSwap v3 fee
  APR has to be computed by us from on-chain events.

**Address PROVEN WRONG — do not use it:** the Aave PoolAddressesProvider
`0xA97684ea...` has no code on BSC.

**Still needs verification:** the internal Venus/Aave oracle addresses (different from
the common Chainlink feeds), and an active PancakeSwap v3 BSC subgraph endpoint
(The Graph's hosted service is deprecated).

---

## 6. Backend & Data Pipeline

### 6.1 Agent synchronization

```
8004scan API ──cron──┐
  semantic search     ├──► normalizer ──► Postgres ──► classifier ──► category
  filtered list       │                                (rule + LLM dGrid)
webhook realtime  ────┘
ERC-8004 on-chain ────► indexer (eth_getLogs) ──► fallback + verification
FuguRegistry     ─────► indexer ──► first-party listings
```

**4-category classification — 4 layers** (from the 8004scan research, proven to work live):
1. Semantic search per category (`semantic_weight=0.7`, `threshold=0.55`)
2. Population pre-filter (`is_registered`, `min_score`, `has_a2a`, `is_endpoint_verified`)
3. Targeted keyword search
4. LLM classification over the raw metadata, with the result cached

A confidence score is stored; agents that do not clear the threshold are not shown.

**Anti-spam is mandatory**: of the 309k BSC agents, most are bulk registrations. Filter
with `is_registered=true` + `min_score` + `has_a2a=true` + `owner_publisher_tier`.

### 6.2 Resilience (this answers the Data Quality criterion directly)

- Browser `User-Agent` + `X-API-Key` on every 8004scan call
- Exponential backoff retry 3–5×, circuit breaker
- Cache TTL: agent detail 60s · leaderboard 5m · trending 1m · global 60s
- **Tiered fallback**: API → cache → on-chain → curated seed
- A health endpoint that shows the status of every data source (honest with the judges)

### 6.3 Metrics we compute ourselves (the main differentiator)

Not taken from anywhere — we compute them from on-chain data:

| Metric | How it is computed |
|---|---|
| Realized APR 7d/30d | change in position value + claimed fees, from events |
| Time-in-range % (LP) | position tick vs pool tick over time |
| Cost per rebalance | `gasUsed × effectiveGasPrice` from the receipt |
| Fee vs profit ratio | claimed fees ÷ net PnL |
| Max drawdown | the equity curve per subscription |
| Distance to liquidation (%) | on-chain HF + oracle price |
| Agent uptime | success rate of scheduled runs |
| Median run latency | start→finish timestamps |
| Average cost per run | aggregate gas + LLM |

**Every number carries a tx hash that is clickable through to BscScan.**

---

## 7. Frontend

### 7.1 Journey (designed for "no dead ends")

```
landing → [See agents] → discovery (4 category tabs, SSR)
   → fugu card (metrics + level + badge) → URL-addressable detail /agent/[id]
   → "what this agent may do" panel → Hire → 1 signature → live dashboard
```

### 7.2 Anatomy of an agent card

Fugu character · name · category · **7d success rate** · run count · median latency ·
average cost/run · last active · number of active hirers · trust badges
(endpoint verified / publisher tier / health) · subscription price.

### 7.3 Detail page — the parts that set us apart

- **A permissions panel, shown to the prospective buyer before hiring**: "this agent can
  call X, on contract Y, at most Z per day, expiring in N days" — read straight from
  the on-chain Keystore, not from our claims.
- **A Revoke button** that really sends a revoke transaction.
- **A live run feed** over WebSocket: step by step + tx hash.
- Equity chart, PnL distribution, run history.
- Verified reviews (only from wallets proven to have hired).

### 7.4 Enforced UI rules

- Every empty state names an action and provides the button for it
- A cost estimate before hiring, not just a warning
- A `Hired` badge to prevent paying twice
- Detail = a URL-addressable page with a fugu OG image, not a modal
- **Never ship a half-finished control** — better to remove the element

---

### 7.5 Differentiators against the competitive landscape

From `docs/research/05-competitive-landscape.md`:

1. **A "verified on-chain" badge on every number.** Every AUM/PnL/APR is clickable
   through to a tx hash. This attacks a real failure in the market: **Giza/ARMA shut
   down in Feb 2026** after its dashboard displayed a large AUM while independent
   on-chain measurement showed positions near zero. Trust in agent marketplace numbers
   is broken — we fix it with proof, not claims.
2. **A leaderboard per category** with uniform metrics, not one global list.
3. **Head-to-head comparison** between agents in the same category —
   found in none of the competitors researched.
4. **A free simulation / dry-run mode** before putting up real money.
5. **A fee vs profit breakdown** — "net after $Y gas + $Z fees", not a headline APR.
6. **Uptime and latency as first-class trust metrics** — for health factor
   monitoring, being late is a real liquidation risk.
7. **Curation before listing** for DeFi agents — avoiding the quantity-without-quality
   problem (Virtuals: 18,000+ agents, mostly with no real product; GPT Store: spam).
8. **Metrics that are equivalent within each category** — health factor is judged by
   "distance to liquidation %", not forced onto APR. This is what makes Agent
   Diversity genuinely equal, not just four tabs.

---

## 8. Visual Identity

4 fugu characters, each with states: `idle`, `working`, `alert`, `profit`.

**The core mechanic: the fugu puffs up with its risk load.** The puff level is mapped
from the agent's real risk metrics (distance to liquidation for Guardian, drawdown for
Grid, time out of range for Rebalancer). This turns numbers into a feeling.

Fallback fugus are colored deterministically from the agent ID for third-party agents —
there is never an empty card, and it is free visual identity for 309k agents.

---

## 9. Deployment

VPS, Docker Compose + Caddy:

| Service | Contents |
|---|---|
| `caddy` | automatic TLS, reverse proxy |
| `frontend` | Next.js → `app.fugugent.xyz` |
| `landing` | Next.js → `fugugent.xyz` |
| `api` | Hono → `api.fugugent.xyz` |
| `worker` | BullMQ scheduler + indexer |
| `agent-*` | the 4 Fugu agents (A2A/MCP/x402) |
| `postgres`, `redis` | data |

`RPC_URL` **must** be overridden — the SDK default `binance.org` is proven to be
blocked from the Indonesian network. Use `https://data-seed-prebsc-1-s1.bnbchain.org:8545`
or `https://bsc-testnet-rpc.publicnode.com`.

---

## 10. Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Intermittent 8004scan `500 DATABASE_ERROR` | Empty marketplace during judging | BFF + cache + on-chain fallback + curated seed |
| R2 | **Altana SDK version conflict**: Studio pins 0.7.1 and rejects drift; the Altana research says 0.9.0 is needed for ERC-8183 on testnet | Could block the ERC-8183 bonus track | **Test this first**, before writing code. If the conflict is real: use a separate Altana SDK path in the backend, not inside the Studio project |
| R3 | dGrid cannot be installed as a Studio provider (altana rejects pieverse) | An agent with no explanation layer | Use `--llm-provider openai` + override the base URL to dGrid; if that is rejected, call dGrid from the backend, not from inside the agent |
| R4 | The Altana session expires during judging | Dead demo | 30-day expiry + a countdown in the UI + alerts |
| R5 | The native spend cap is too small → every tx `FAILED` | The agent never runs | Start with a loose cap, test end-to-end on testnet first |
| R6 | Binance Bazaar/B402 is blocked from Indonesia | The merchant discovery path is dead | Not a critical path; skip it or test it through the VPS (the VPS is outside ID) |
| R7 | Time | The scope does not get finished | Order: SC → agents → backend → frontend → landing (by priority) |

---

## 11. Open Questions

1. **R2 and R3 above must be tested before any agent code is written** — this is the
   first technical gate.
2. ~~dGrid x402 mainnet vs testnet~~ → **DECIDED: stay consistently on testnet.** The
   agent pays for inference through a normal dGrid API key. The x402 mainnet path is
   not used for now.
3. The 8004scan Pro API key — must be requested through the hackathon form.
4. ~~Subscription payment token~~ → **DECIDED: the user chooses**, prices in USD,
   converted through Chainlink. See §4.3.
5. The PancakeSwap section in `docs/research/04` was never finished (the research agent
   was cut off); part of it is covered in `06-agent-strategies.md`.

---

## 12. Order of Work

1. **Technical gate**: test R2 (Altana SDK version) and R3 (dGrid as a provider) — before anything else
2. **Smart contracts**: 3 UUPS contracts + tests + testnet deploy
3. **One complete agent** (Fugu Guardian — the easiest to verify for correctness:
   on-chain HF has a ground truth) as the pattern for the other three
4. **The other three agents**
5. **Backend**: indexer, BFF, classifier, scheduler
6. **Frontend**: discovery → detail → hire → dashboard
7. **Landing page**
8. **Agent Advantage Report** (run in parallel from the moment the first agent is alive)
