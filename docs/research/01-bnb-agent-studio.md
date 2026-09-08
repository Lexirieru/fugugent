# BNB Agent Studio — In-Depth Technical Research

> **Research date:** 8 September 2026
> **Context:** BNB Chain hackathon "The Smart Money Era: Build the Era" — building an agent marketplace on BSC with 4 categories (Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring).
> **Author:** research agent (Claude Code)

## Status Legend

| Mark | Meaning |
|---|---|
| ✅ **VERIFIED FACT** | There is a source URL, or I executed it myself (curl/RPC/tarball) and saw the result |
| 🟡 **ASSUMPTION / NOT VERIFIED** | Comes from a secondary summary, a third-party blog, or my own inference |
| ❌ **NOT FOUND** | Searched for, not found — along with what was tried |

---

## 1. Executive Summary

**BNB Agent Studio** is BNB Chain's toolkit for building, deploying, and monetising **"seller agents"** on BNB Smart Chain. It is not a DeFi strategy framework — it is the **identity + commerce + deployment** layer for AI agents.

The three most important findings for our architecture decisions:

1. **The CLI is an npm package, not Python.** `npm install --global @bnbagent/studio-cli` → a binary called **`bag`**. Requires **Node.js ≥ 22**. (There is also a `bnbagent-studio` Python package on PyPI, but its version lags far behind — v0.0.5 versus v0.0.13 on npm. Use npm.)

2. **There is a real, public agent discovery API — in two layers:**
   - **On-chain (most authoritative):** the ERC-8004 `AgentIdentity` contract on BSC mainnet `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` and testnet `0x8004A818BFB912233c491871b3d84c89A494BD9e`. I verified both live via RPC. Mainnet has **340,785 agents** registered as of today.
   - **Indexed API (most practical for the UI):** **8004scan** at `https://api.8004scan.io/api/v1` — a public REST API, with an OpenAPI spec, a `chain_id=56` filter, semantic search, a leaderboard, and reputation. This is what the hackathon organisers **explicitly list as required tech**, with a free Pro tier for participants.

3. **Agents are executed as a container/zip in the cloud (AWS Bedrock AgentCore, Azure AI Foundry, or BNB's own 48-hour trial), and the agent holds its own private key.** Signing is **never** exposed as an LLM tool — it is fixed code in `app/agent/src/signing.ts`. The LLM only gets read-only chain tools.

> ⚠️ **SCHEDULE WARNING:** The official hackathon page lists the build period as **5 August – 9 September 2026**. Today is **8 September 2026**. If that date is accurate, we have very little time left. **Re-verify** on the [hackathon page](https://www.bnbchain.org/en/hackathons/smart-money-era) before planning scope.

---

## 2. What BNB Agent Studio Is — Architecture & Components

### 2.1 Product positioning ✅

From the [official launch blog](https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt) and the npm package description:

> "Skills-first toolkit and bag CLI for BNB Chain seller agents: ERC-8004 identity, ERC-8183 escrowed commerce, and x402 payments."
> — `package.json` of `@bnbagent/studio-cli@0.0.13`

Studio solves three problems for an agent: **deployment**, **discoverability**, and **continuity**.

### 2.2 Components ✅

Verified from the `package.json` and README of the npm packages I downloaded and extracted:

| Package | Role | Version (8 Sep 2026) |
|---|---|---|
| `@bnbagent/studio-cli` | The `bag` CLI + IDE skills + recipes (scaffolding, wallet, diagnostics, deploy) | **0.0.13** (alpha: 0.0.14-alpha.1) |
| `@bnbagent/studio-runtime` | The library *imported* by the generated agent | 0.0.13 |
| `@bnbagent/sdk` | The BNB Chain protocol layer (ERC-8004 / ERC-8183 / wallet / x402) | **0.5.5** |
| `@bnbagent/deploy-cli` | The cloud deploy lifecycle (pinned by studio-cli) | 0.5.15 |
| `bnbagent` (PyPI) | The Python SDK equivalent of `@bnbagent/sdk` | 0.4.6 |
| `bnbagent-studio` (PyPI) | The Python version of the `bag` CLI — **far behind** | 0.0.5 |

Sources: `https://registry.npmjs.org/@bnbagent/studio-cli`, `https://registry.npmjs.org/@bnbagent/sdk`, `https://pypi.org/pypi/bnbagent/json`, `https://pypi.org/pypi/bnbagent-studio/json` — all queried directly by me.

### 2.3 Architecture layers ✅

```
┌─ Development layer ──────────────────────────────────────┐
│ bag CLI  +  IDE skill /bnbagent-studio (Claude Code/Cursor)│
│ recipes/ → generates a TypeScript project that we own     │
└───────────────────────────────────────────────────────────┘
┌─ Runtime layer ──────────────────────────────────────────┐
│ @bnbagent/studio-runtime: config, wallet providers,       │
│ policy, audit, identity, commerce, payments, storage, LLM │
└───────────────────────────────────────────────────────────┘
┌─ Protocol layer (@bnbagent/sdk) ─────────────────────────┐
│ ERC-8004 identity │ ERC-8183 escrow │ x402/B402 │ wallets │
└───────────────────────────────────────────────────────────┘
┌─ Hosting ────────────────────────────────────────────────┐
│ AWS Bedrock AgentCore │ Azure AI Foundry │ BNB trial 48h  │
└───────────────────────────────────────────────────────────┘
┌─ Chain: BNB Smart Chain (56 / 97) ───────────────────────┐
└───────────────────────────────────────────────────────────┘
```

**AWS involvement** ✅: the official blog describes Studio as "co-engineered with the AWS Generative AI Innovation Center". The default production runtime is **AWS Bedrock AgentCore**. `bag deploy prepare` even runs a read-only AgentCore quota check through the AWS CLI (optional, fail-open).

### 2.4 Standards used ✅

- **ERC-8004** — on-chain agent identity (ERC-721; the token is the agent).
- **ERC-8183** — "agentic commerce": negotiated job escrow (the `AgenticCommerce` kernel + `EvaluatorRouter` + `OptimisticPolicy`).
- **x402 / B402 / MPP** — per-HTTP-request payments. B402 is Binance's settlement rail; x402 and MPP are two alternative adapters (you cannot pick both).
- **EIP-3009** (`TransferWithAuthorization`) — gasless transfers for x402 payments.
- **A2A** (agent-to-agent) & **MCP** — the agent's "public faces".

---

## 3. Official Documentation & Repositories

| Source | URL | Status |
|---|---|---|
| Product landing page | https://www.bnbchain.org/en/bnb-agent-studio | ✅ |
| Launch blog | https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt | ✅ |
| Studio docs | https://docs.bnbchain.org/developer-kit/bnbchain-studio/ | ✅ |
| CLI reference docs | https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/ | ✅ (⚠️ somewhat stale, see §4.3) |
| SDK docs | https://docs.bnbchain.org/developer-kit/bnbagent-sdk/ | ✅ (sidebar visible) |
| SDK GitHub | https://github.com/bnb-chain/bnbagent-sdk | ✅ public |
| Studio GitHub | https://github.com/bnb-chain/bnbagent-studio | ⚠️ **404 / private.** Referenced by the npm package's `package.json` and README, but not publicly accessible at the time of this research (tried through the GitHub API and a direct fetch). Everything about Studio documented below comes from the **npm tarball**, not from the repo. |
| BNB Chain code examples | https://github.com/bnb-chain/example-hub | ✅ public |

**Docs sidebar structure** ✅ (from fetching `docs.bnbchain.org/developer-kit/bnbchain-studio/`):
`BNB Agent Studio` → Quickstart, Demo, Architecture, Configuration, CLI Reference, Deployment, Security, Troubleshooting.
`BNB Agent SDK` → Quickstart (TS), Quickstart (Python), Configuration, Architecture, **Networks & Contracts**, Examples, Security, Troubleshooting.

> ❌ I could not guess the exact URL of the "Networks & Contracts" page (`/developer-kit/bnbagent-sdk/networks-and-contracts/` → 404). But I got its content straight from the SDK code — see §7.2, which is more authoritative anyway because that is what the runtime actually uses.

---

## 4. CLI — Name, Installation, Commands

### 4.1 Package name & installation ✅

**This is the correct one** (from the `@bnbagent/studio-cli@0.0.13` README):

```bash
npm install --global @bnbagent/studio-cli
bag skills install
```

- npm package name: **`@bnbagent/studio-cli`**
- Binary name: **`bag`** (from `"bin": { "bag": "./dist/bag.js" }`)
- Licence: Apache-2.0
- `"engines": { "node": ">=22" }`
- npm maintainers: `robotbnb <yolin@bnbchain.org>`, `jardenx <devin@bnbchain.org>`, `aiden-cao <aiden.c@nodereal.io>` — consistent with BNB Chain ownership ✅

> ⚠️ **Correction to secondary sources.** Several blogs/summaries say `pip install bnbagent-studio`. That PyPI package **does exist** (v0.0.5, description: "The `bag` CLI to scaffold and deploy a bnbagent-sdk seller agent on BNB Chain") but it is 8 releases behind npm. BNB Chain's own official blog quotes the pip version. **Recommendation: use npm.**

`bag skills install` detects Claude Code and Cursor and installs the `/bnbagent-studio` skill plus 14 reference playbooks. The scripted version:

```bash
bag skills install --target both --scope user
```

### 4.2 Language ✅

The generated project is **pure TypeScript**. From the README: *"Studio generates ordinary TypeScript under `app/agent/`"*. Python is available as a parallel protocol SDK (`pip install bnbagent`), not as the primary scaffolding target.

### 4.3 `bag` command groups ✅

From the npm package README (the most up-to-date source):

| Area | Commands |
|---|---|
| Skills | `skills install`, `skills list`, `skills uninstall` |
| Project | `init`, `scan`, `recipe`, `dev`, `doctor`, `bundle` |
| Config | `config`, `env`, `agents` |
| Wallet & policy | `wallet`, `wallet session`, `budget`, `audit` |
| **Identity** | `erc8004 register`, `show`, **`resolve`**, `update-endpoint`, `update-metadata` |
| Escrow commerce | `erc8183 list`, `buy`, `status`, `submit`, `fetch`, `settle` |
| Instant payments | `x402 quote`, `buy`, `trust`, `sell init`, `sell status` |
| MPP | `mpp trust`, `quote`, `buy` |
| LLM | `llm activate`, `test`, `status`, `list-models`, `usage`, `topup`, `auto-renew` |
| Deployment | `deploy`, `deploy prepare`, `verify`, `status`, `info`, `logs`, `destroy` |
| Managed trial | `platform login`, `whoami`, `credit`, `agents`, `invoke-client`, `kill` |

⚠️ **The docs and the package are out of sync.** The CLI reference page on docs.bnbchain.org still lists `bag mcp serve`, `bag deploy agent`, and `bag erc8183 publish` — while the 0.0.13 package README calls `deploy agent` a *"deprecated compatibility alias"* and adds the `mpp` and `platform` groups that are missing from the docs. **The source of truth is `bag --help` after installing.**

### 4.4 The scaffold command ✅

```bash
bag init <name> \
  --llm-provider  pieverse-llm|openrouter|openai|anthropic|bedrock \
  --network       bsc-testnet|bsc-mainnet \
  --wallet-kind   evm-local|twak|altana \
  --storage-provider local|ipfs|s3|azure-blob \
  --protocols     A2A,MCP,X402 \
  --rails         8183|b402|both \
  --erc8183-price <base-units> \
  --b402-price    <usd> \
  --destination   self|platform \
  --runtime       agentcore|azure-foundry \
  --no-onboard
```

**Naming rules** ✅: must start with a letter, ASCII letters and digits only, maximum **23 characters**. `-`, `_`, and `.` are **rejected** (not renamed). These are AgentCore's rules.

**Important defaults** ✅:
- network: `bsc-testnet`
- wallet: `evm-local`
- LLM: `pieverse-llm`, model `auto/free` ($0/token)
- protocols: `A2A,X402`
- rails: both (8183 + B402)
- ERC-8183 price: `100000000000000000` (0.1 U)
- B402 price: `0.01` USD
- `--destination`: `platform` while the trial campaign is running

### 4.5 Generated project structure ✅

```
<name>/
├── package.json                 workspace marker
├── pnpm-workspace.yaml          packages: ["app/agent"]
├── AGENTS.md                    safety rules for the coding agent
├── agentcore/
│   ├── agentcore.json           deployment descriptor
│   └── aws-targets.json         AWS account + region
├── .studio/
│   ├── .env.local               secrets, gitignored, mode 0600
│   └── wallets/                 encrypted keystore (OUTSIDE the deployable code)
└── app/agent/
    ├── studio.toml              ← the main config file
    ├── package.json             @bnbagent/studio-runtime + @bnbagent/sdk + ai
    ├── tsconfig.json
    ├── Dockerfile               only for the container path (twak)
    └── src/
        ├── sellerCore.ts        ← OUR BUSINESS LOGIC (the runWork hook)
        ├── signing.ts           quote/verify/submit — fixed code, the LLM never touches it
        ├── tools.ts             read-only chain tools for the LLM
        ├── model.ts             LanguageModel factory (AI SDK) + auto-topup
        ├── agentCard.ts         A2A agent card (/.well-known/agent-card.json)
        ├── executor.ts
        ├── unifiedMain.ts       A2A + X402 entrypoint  (port 9000)
        ├── mcpMain.ts           MCP-only entrypoint    (port 8000/mcp)
        └── dualMain.ts          combined A2A + MCP
```

### 4.6 Config format: `app/agent/studio.toml` ✅

The sections verified to exist (grepped from the CLI's `dist/` bundle):

```
[network]                    default = "bsc-testnet" | "bsc-mainnet"
[wallet]                     kind = "evm-local" | "twak" | "altana"
[wallet.signing]             EIP-712 domain allowlist
[llm]                        provider, model
[llm.pieverse]
[llm.auto_renew]             enabled = true|false
[budget]                     max_per_day_usd
[payments.erc8183]           price (decimal string; "0" = explicitly FREE)
[payments.x402]              max_per_request_usd
[payments.x402.merchants.<name>]   domain, pay_to, per_call_cap_usd, verified
[payments.b402_seller]       price_usd
[payments.b402_seller.bazaar]
[storage]                    kind = "local"|"ipfs"|"s3"|"azure-blob"
[deploy]                     destination = "self"|"platform"
[deploy.agentcore]
[deploy.foundry]
[deploy.platform]
[agent]  [agentcore]  [project]
```

An x402 merchant example (from the skill doc, exact format):
```toml
[payments.x402.merchants.cmc]
domain = "pro-api.coinmarketcap.com"
pay_to = "0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA"
per_call_cap_usd = 0.02
verified = true
```

---

## 5. The Agent Model — Definition, Execution, Signing

### 5.1 How an agent is defined ✅

An agent is **not** a declarative YAML file. It is a **TypeScript project** with a fixed structure:

- **Capabilities / skills** → exposed through the **A2A AgentCard** at `/.well-known/agent-card.json`. The default scaffold has only **two skills**: `negotiate` and `notify_funded`. The `agentCard.ts` file is ours — the skill descriptions there are where the agent's category identity goes.
- **LLM tools** → `app/agent/src/tools.ts`, wrapped as AI SDK `tool()`s. Studio provides **15 read-only functions** in `@bnbagent/studio-runtime/tools`:
  - Wallet/chain: `walletInfo`, `walletAddress`, `walletList`, `balanceNative`, `balanceU`, `networkInfo`, `txStatus`
  - LLM: `pieverseUsage`
  - ERC-8004: `agentInfo(agentId)`, `agentByAddress(address)`
  - ERC-8183: `jobStatus`, `jobList`, `jobCount`
  - Advanced (marked "footgun"): `blockInfo`, `contractCallView` (arbitrary `eth_call` — prone to prompt injection)
- **The work being sold** → the `runWork` hook in `app/agent/src/sellerCore.ts`.
- **Triggers / schedules** → ⚠️ **THERE IS NO BUILT-IN SCHEDULER.** The README is explicit: *"There is **no** background poller."* The agent is **reactive**: it is triggered by an A2A `notify_funded` message, an HTTP request to `/x402` or `/mpp`, or an MCP tool call. There is a "best-effort in-process sweep" of other FUNDED jobs when a `notify_funded` arrives, and that is all. **A big implication for us:** monitoring agents (health factor, grid) that need periodic polling have to bring their own scheduler (EventBridge/cron); Studio does not provide one.

### 5.2 How an agent is executed ✅

One runtime, one signer, several "public faces":

| Face | Local surface | Behaviour |
|---|---|---|
| A2A | agent card + JSON-RPC on port `9000` | `negotiate` + `notify_funded` (delivery in the background) |
| MCP | Streamable HTTP `http://localhost:8000/mcp` | the same seller operations, delivered synchronously |
| A2A + MCP | A2A-native on `:9000`, `/mcp` tunnelled | shared seller core/wallet |
| X402 | `/x402` | 1 paid request, or FREE |
| MPP | `/mpp` | an alternative to X402 |

**Deployment targets** ✅ (three of them, and every `bag deploy` **must** pick one explicitly — there is no silent default):

1. **BNB managed trial** — `bag platform login && bag platform credit && bag deploy --provider bnb`. A **48-hour BSC testnet** sandbox in the operator's cloud. The clock starts at the first successful deploy; redeploying does not reset it. Resources are reclaimed automatically at expiry.
2. **AWS Bedrock AgentCore (your own account)** — `bag deploy --provider aws`. Validates the AWS identity, builds, provisions runtime secrets plus inbound Cognito OAuth, and records the live endpoint.
3. **Azure AI Foundry** — `bag deploy --provider azure`. ⚠️ Azure **rejects MCP**.

The default `evm-local` deploy is a **code zip** (no Docker needed). The container path (e.g. `twak`) needs Docker. All cloud mutations are delegated to `@bnbagent/deploy-cli`, which is run through `bunx --bun` → **requires Bun 1.3+**.

Lifecycle: `bag deploy status | logs --provider X | verify --provider X | destroy --provider X [--execute]`.

### 5.3 How an agent holds funds and signs ✅ (CRITICAL)

**The core principle (from the "5 core commitments" skill doc):**

> *"Signing is fixed handler code, never an LLM-callable tool."*
> *"ALL signing is fixed entrypoint code in `app/agent/src/signing.ts` or the runtime's bounded x402 payment handler, never an LLM-callable tool."*

Three custody options:

| Wallet | Custody model | Packaging | Notes |
|---|---|---|---|
| **`evm-local`** (default) | An encrypted V3 keystore in `.studio/wallets/` (workspace root, **outside** the deploy codeLocation) | code zip | The password comes from `WALLET_PASSWORD` in `.studio/.env.local`. At deploy time the key material is injected through the provider's secret channel (AWS Secrets Manager). |
| **`twak`** | Trust Wallet Agent Kit, self-custody, dedicated home at `.studio/twak` | container | Requires TWAK CLI ≥0.20.0 + Docker |
| **`altana`** | **An EIP-7702 session key** — the admin keystore stays local, and the runtime only receives an `ALTANA_SESSION` bounded by budget and time | zip | Not compatible with `pieverse-llm` or the paid B402 rail. B402 payouts land at the admin address. Can be explicitly revoked/renewed. |

Wallet providers at the SDK level ✅ (from the `bnbagent-sdk` README): `EVMWalletProvider` (local keystore), `TWAKProvider`, `AltanaWalletProvider` (EIP-7702 session keys, TS-only), `TurnkeyWalletProvider` (AWS Nitro enclaves), `MPCWalletProvider` (a stub).

**⚠️ An important security warning** ✅: for the **BNB managed trial**, `evm-local`/`twak` signing material is **sent to the operator's managed secret store**. The official document says: *"Use a fresh testnet-only wallet and never reuse it on mainnet."* For the Altana hackathon track, only a bounded session is sent — that is the technical reason the organisers require session keys.

**Layered spend limits** ✅: `per_call_cap_usd` (per merchant) → `[payments.x402].max_per_request_usd` → `[budget].max_per_day_usd` (a shared ledger in `.studio/spend-ledger.json`). The LLM **cannot** widen a cap or change `pay_to`.

### 5.4 Monetisation model ✅

- **ERC-8183 (job escrow):** the buyer calls `negotiate` → gets an EIP-191-signed quote (the price is clamped in code, **with no LLM involved**) → `createJob` → `registerJob` → `setBudget` → `fund` → the buyer sends `notify_funded` → the seller verifies on-chain → does the work → `submit`s the deliverable → the buyer `settle`s. There is a **24-hour dispute window** on-chain; calling `approve` before it elapses reverts with `0x17be5b7b`.
- **x402/MPP (pay per request):** a positive price → a payment challenge → settle through B402 before doing the work. `price_usd = "0"` → an anonymous FREE passthrough.

---

## 6. Discovery / Registry — How Our Marketplace Gets Agent Data

**This is the most important part for us.** There are **two paths**, and I recommend using both.

### 6.1 Path A — the 8004scan REST API (the main recommendation for the UI) ✅

**Base URL:** `https://api.8004scan.io/api/v1`
**OpenAPI spec:** `https://api.8004scan.io/openapi.json` — ✅ I downloaded it, HTTP 200, 426 KB, `"title": "8004scan Backend API", "version": "0.4.367"`.
**Documentation:** https://8004scan.io/developers · https://docs.altlayer.io/altlayer-documentation/8004-scan/overview
**Built by:** AltLayer (https://altlayer.io/8004scan)

**Auth:** the `X-API-Key: YOUR_API_KEY` header. It still works without a key (anonymous tier).

**Rate limits** ✅ (from the developers page):

| Tier | Req/min | Req/day |
|---|---|---|
| Anonymous | 30 | 1,000 |
| Free API | 600 | 100,000 |
| **Pro (free for hackathon participants)** | 500/min, 100,000/day | via [this form](https://forms.gle/jQevEPCAacBXaKG79) |

Response headers: `X-RateLimit-Tier`, `X-RateLimit-Limit-Minute`, `X-RateLimit-Remaining-Minute`, `X-RateLimit-Limit-Day`, `X-RateLimit-Remaining-Day`.

**Endpoints relevant to the marketplace** ✅ (taken from the OpenAPI spec I parsed):

```
GET /api/v1/agents                                  ← the main listing endpoint
GET /api/v1/agents/{chain_id}/{token_id}            ← detail for 1 agent
GET /api/v1/agents/{chain_id}/{registry_address}/{token_id}
GET /api/v1/agents/search/semantic                  ← natural-language search
GET /api/v1/agents/featured
GET /api/v1/agents/trending          ?period=24h|7d|30d
GET /api/v1/agents/leaderboard       ?sort_by=total_score
GET /api/v1/agents/latest
GET /api/v1/agents/most-starred
GET /api/v1/agents/best-wallet
GET /api/v1/agents/{chain_id}/{token_id}/quality
GET /api/v1/agents/scores/v5/{chain_id}/{token_id}
GET /api/v1/agents/score-history/{chain_id}/{token_id}
GET /api/v1/stats/agents/{chain_id}/{token_id}/analytics
GET /api/v1/stats/global
GET /api/v1/stats/oasf/skills                       ← the skill taxonomy!
GET /api/v1/stats/oasf/domains                      ← the domain taxonomy!
GET /api/v1/feedbacks                               ← reputation
GET /api/v1/wallets/{address}/agents
GET /api/v1/chains
POST /api/v1/agents/{chain_id}/{token_id}/health-check
POST /api/v1/agents/verify-endpoint/{chain_id}/{token_id}
POST /api/v1/webhooks/register                      ← webhooks for real-time updates
GET /api/v1/mcp/tools/search_agents                 ← there is an MCP surface too
```

**`GET /api/v1/agents` parameters** ✅ (verbatim from the OpenAPI spec — this is what makes our 4 categories filterable):

```
limit (default 20), offset (default 0)
chain_id                → 56 (BSC mainnet) / 97 (BSC testnet)
is_testnet              → true|false
owner_address
owner_publisher_tier    → OFFICIAL | VERIFIED | COMMUNITY
supported_protocol      → MCP, A2A, ...
x402_supported          → bool
is_active               → default "true" (the `active` field from ERC-8004)
is_endpoint_verified    → bool   ← IMPORTANT: filters for agents whose endpoint is actually alive
supported_trust         → reputation | crypto-economic | tee-attestation
has_mcp / has_a2a / has_oasf   → bool
is_registered           → default "true"
oasf_skill[]            → OASF skill filter (OR logic)
oasf_domain[]           → OASF domain filter (OR logic)
search, search_type (auto), search_fields
min_feedbacks, min_validations, min_score (0-100)
created_after, created_before (ISO 8601)
tags                    → comma-separated (OR)
categories              → comma-separated (OR)      ← relevant to our 4 categories
sort_by                 → created_at | stars | name | token_id | (score dimensions)
sort_order              → asc | desc
```

**`GET /api/v1/agents/search/semantic`**: `q`, `limit`, `offset`, `chain_id`, `is_active`, `semantic_weight` (0=pure text … 1=pure semantic, default 0.5), `similarity_threshold` (default 0.5).

**Response shape** ✅ (seen directly): `{"items": [ {...agent...} ], "total": N, ...}`. Agent fields include, among others, `id`, `owner_id`, `token_id`, `chain_id`, `name`, `description`, `is_active`, `total_score`.

**Live tests I ran** ✅:
- `GET /api/v1/chains` → HTTP 200. BSC is there: `{"chain_key":"bsc_mainnet","chain_id":56,"name":"BSC","is_testnet":false,"enabled":true}` and `{"chain_key":"bsc_testnet","chain_id":97,"name":"BSC Testnet","is_testnet":true,"enabled":true}`.
- `GET /api/v1/stats/global` → HTTP 200: **`total_agents: 820100`**, `total_users: 458338`, `total_feedbacks: 3654749`, `daily_new_agents: 3589`, `average_feedback_score: 82.6`.
- `GET /api/v1/agents/search/semantic?q=grid trading&chain_id=56&limit=3` → HTTP 200, returning `{"items":[...]}` with real agents.

**⚠️ RELIABILITY PROBLEM — THE ARCHITECTURE MUST ACCOUNT FOR THIS** ✅:
This API **frequently returns** `{"success":false,"error":{"code":"DATABASE_ERROR","message":"Database error occurred"}}` with HTTP 500, **intermittently**. In my testing, 4 out of 5 consecutive attempts failed before one succeeded. After roughly 50 requests I also hit **HTTP 403** (the anonymous tier rate limit).

**Architecture recommendations:**
1. Get the free Pro API key through the hackathon form **now**.
2. **Do not call 8004scan directly from the browser.** Their own documentation recommends "server-first authentication". Build a proxy/BFF in our backend.
3. **Cache aggressively + retry with backoff.** The "Data Quality" judging criterion is 35% — a marketplace that goes blank because upstream returned a 500 will be destroyed on score.
4. Prepare a **fallback to reading on-chain directly** (Path B) so the demo is never empty.

### 6.2 Path B — reading ERC-8004 directly on-chain (fallback & source of truth) ✅

**Contract addresses — I VERIFIED THESE MYSELF VIA RPC:**

| Network | Chain ID | `AgentIdentity` registry address | Evidence |
|---|---|---|---|
| **BSC Mainnet** | 56 | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | non-empty `eth_getCode`; `name()` → `"AgentIdentity"`; `symbol()` → `"AGENT"` |
| **BSC Testnet** | 97 | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | same, `eth_chainId` → `0x61` (97) |

Address source: the `NETWORKS` constant inside the `@bnbagent/sdk@0.5.5` bundle (`dist/chunk-DSR5PNLX.js`), then confirmed live through `eth_call` against a public BSC RPC.

**This registry is an ERC-721.** Each agent = 1 token. `name()` = `AgentIdentity`, `symbol()` = `AGENT`.

**The important ABI** ✅ (extracted from the SDK bundle, 65 entries):

```solidity
// EVENTS — these are what we index
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey,
                  string metadataKey, bytes metadataValue);
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId); // ownership change
event MetadataUpdate(uint256 _tokenId);
event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

// READS — these are what we call to render an agent card
function tokenURI(uint256 tokenId)  view returns (string);
function ownerOf(uint256 tokenId)   view returns (address);
function balanceOf(address owner)   view returns (uint256);
function getAgentWallet(uint256 agentId) view returns (address);
function getMetadata(uint256 agentId, string metadataKey) view returns (bytes);
function name() view returns (string);
function symbol() view returns (string);
function getVersion() pure returns (string);

// WRITES
function register() returns (uint256 agentId);
function register(string agentURI) returns (uint256 agentId);
function register(string agentURI, tuple[] metadata) returns (uint256 agentId);
function setAgentURI(uint256 agentId, string newURI);
function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue);
function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature);
function unsetAgentWallet(uint256 agentId);
```

**Event topic hashes (ready to use with `eth_getLogs`)** ✅ — computed by me with `cast keccak`:

```
Registered(uint256,string,address)              → 0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a
URIUpdated(uint256,string,address)              → 0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb
MetadataSet(uint256,string,string,bytes)        → 0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b
keccak256("built_with")  (for MetadataSet topic2) → 0xba3c72985a276b7df84ee744b387a3ebb5bc20fc15befa203130d9432939c115
```

The `getMetadata(uint256,string)` selector = `0xcb4799f2`.

**Real scale** ✅ — I did a binary search on `ownerOf()` on mainnet:
> **the highest existing agentId on BSC mainnet = 340,785**

Token IDs are **sequential** starting at 1, so enumeration is easy.

**Metadata format: `tokenURI` varies — this is a big trap** ✅. I sampled it directly and found **five different shapes**:

| agentId | `tokenURI` shape |
|---|---|
| 340785 | `data:application/json;base64,...` ← the canonical format |
| 10 | `data:application/json;enc=gzip;level=6;base64,H4sI...` ← **gzip** |
| 50 | `ipfs://QmW79S38Xd3oda1qQ1DG8wYY1h3ue7hfsf6gryguh51q25` |
| 50000 | `https://build4.io/api/standards/erc8004/agent-card/7caf3b02-...` |
| 150000–340700 | `https://metadata.evoevo.ai/agents/4778808` |
| 2 | `0x6446ad9821021eeb9f85b8a18b0153d58166d161` ← not a URI at all |
| 5000 | `{"name":"babycaisubagent-99","description":"..."}` ← bare JSON, not a data URI |
| 1000, 10000 | empty string / whitespace |

**Implication:** our parser has to handle `data:` (base64 + gzip), `ipfs://`, `https://`, bare JSON, and garbage strings — with graceful degradation. **Do not assume one format.**

**An example of a valid registration file** ✅ (agentId 1, mainnet, base64-decoded by me):

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "ClawNews",
  "description": "Hacker News for AI agents — built by agents, for agents. ...",
  "image": "https://clawnews.io/logo.png",
  "services": [
    { "name": "web", "endpoint": "https://clawnews.io" },
    { "name": "OASF", "endpoint": "https://github.com/agntcy/oasf/", "version": "0.8.0",
      "skills": ["natural_language_processing/information_retrieval_synthesis/search", "..."],
      "domains": ["media_and_entertainment/news", "technology/blockchain", "..."] },
    { "name": "agentWallet", "endpoint": "eip155:56:0x89E9E1ab11dD1B138b1dcE6d6A4a0926aaFD5029" },
    { "name": "email", "endpoint": "hello@clawnews.io" }
  ],
  "registrations": [
    { "agentId": null, "agentRegistry": "eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }
  ],
  "active": true,
  "x402Support": false,
  "supportedTrust": ["reputation"]
}
```

**This is our marketplace data schema.** Note:
- `services[].name == "OASF"` carries **structured `skills[]` and `domains[]`** → **this is the key to classifying our 4 categories** (and also why 8004scan has `oasf_skill` / `oasf_domain` filters).
- `services[].name == "agentWallet"` gives the agent's wallet address in CAIP-10 format → usable for showing real on-chain activity / P&L.
- `active` and `x402Support` are flags declared by the owner.
- The A2A endpoint is found at `services[].name == "A2A"`, and its full card at `{endpoint}/.well-known/agent-card.json`.

**⚠️ The reality of data quality** ✅: from my sampling, **the majority of the 340k agents are spam / bulk registrations** (one `metadata.evoevo.ai` farm dominates the 150,000–340,700 range; many other entries are empty). Our marketplace **must** filter. The available filters:
- `is_endpoint_verified=true` on 8004scan
- `owner_publisher_tier=OFFICIAL|VERIFIED`
- `min_score` / `min_feedbacks`
- `has_a2a=true` (agents that can actually be "hired")
- the `built_with` metadata (see below)

**Identifying agents built with BNB Agent Studio** 🟡: the SDK **automatically injects** a metadata entry with the key **`built_with`**, valued `https://github.com/bnb-chain/bnbagent-sdk#v<version>`, on every registration (verified from `ContractInterface.injectBuiltWith` plus the constant `BUILT_WITH_KEY = "built_with"` in `@bnbagent/sdk`). That means **`getMetadata(agentId, "built_with")` is how you distinguish a Studio agent from the other 340k** — and `MetadataSet` with `topic2 = 0xba3c7298...` can be `eth_getLogs`-ed to find all of them.
I did call `getMetadata` on agents #1, #100000, and #340785 → all returned `0x` (empty), meaning those agents were not built with Studio. I **did not manage to finish** the `eth_getLogs` query on the `built_with` topic (a large block range on a public RPC is too slow; the job timed out at 120s). **This is a high-priority action item** — see §11.

### 6.3 Path C — the Binance Bazaar catalogue (B402) 🟡

From the `bnbagent-studio-buying-from-bazaar.md` skill doc (part of the npm package, so its text is ✅ verified):

> "**Bazaar** (`https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/…`) — a public, auth-free **catalog** of x402 merchants."

The documented endpoints:
```
GET .../bazaar/search?query=<keyword>&limit=10
GET .../bazaar/resources
GET .../bazaar/merchant?payTo=0x…
```
Each resource carries `accepts[]` (who gets paid, in what asset, on which chain) plus 30-day quality signals: `l30DaysTotalCalls`, `l30DaysUniquePayers`.

❌ **I COULD NOT verify these endpoints.** `curl` to `www.binance.com` fails to connect from this research environment — DNS resolves to `202.169.44.80` and then "Connection refused" (most likely ISP-level blocking in Indonesia). **The team has to test this from another network / a VPN before relying on it.** Also note: this is a catalogue of **x402 merchants**, not of ERC-8004 agents — its scope differs from our main need.

### 6.4 Endpoints I tried that FAILED ❌

So nobody repeats them:

| URL | Result |
|---|---|
| `https://8004scan.io/api/agents?chain=56` | HTTP 404 (Next.js HTML) |
| `https://api.8004scan.io/agents?chain=56` | HTTP 404 `{"detail":"Not Found"}` |
| `https://api.8004scan.io/v1/agents` | HTTP 404 |
| `https://api.8004scan.io/api/v1/openapi.json` | HTTP 404 (the spec is at the root: `/openapi.json`) |
| `https://api.8004scan.io/docs` | HTTP 404 |
| `https://8004scan.io/api/v1/agents?chain=56` | HTTP 500 DATABASE_ERROR (a frontend proxy path, not the right one) |
| `https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks-and-contracts/` | HTTP 404 (could not guess the slug) |
| `https://github.com/bnb-chain/bnbagent-studio` | 404 / private |
| `https://www.binance.com/bapi/...` | Connection refused (research network) |

❌ **Not found:** an **official BNB Agent Studio discovery API of its own** (e.g. `studio.bnbchain.org/api/agents`) that lists live agents. `https://bnbagent-api.bnbchain.world` appears in the CLI bundle, but it is the **trial platform API** (auth-gated, for hosting your own agent's deliverables and lifecycle), **not** a public directory. Do not rely on it for the marketplace.

**§6 conclusion:** agent discovery = **the 8004scan API (primary) + ERC-8004 on-chain (fallback/verification)**. There is no official marketplace API beyond that.

---

## 7. Network & Contract Configuration

### 7.1 BSC networks ✅

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | **56** (`0x38`) | **97** (`0x61`) |
| SDK default RPC | `https://bsc-dataseed.binance.org` | `https://data-seed-prebsc-2-s2.binance.org:8545` |
| Paymaster (MegaFuel) | `https://bsc-megafuel.nodereal.io/` | `https://bsc-megafuel-testnet.nodereal.io` |
| Gas sponsorship | ❌ never | ✅ on by default for the canonical contracts |
| Explorer | bscscan.com | testnet.bscscan.com |

⚠️ **The SDK's default RPC uses the `binance.org` domain, which I cannot reach** (network-blocked). The public RPCs I **tested and got working** (`eth_chainId` → `0x38`):
- ✅ `https://bsc-dataseed.bnbchain.org`
- ✅ `https://bsc-rpc.publicnode.com`
- ✅ `https://1rpc.io/bnb`
- ❌ `https://binance.llamarpc.com` (empty)

The testnet one that worked: ✅ `https://data-seed-prebsc-1-s1.bnbchain.org:8545` (`eth_chainId` → `0x61`).

**Set `RPC_URL` in the env** — the CLI recipe itself warns: *"Set it to avoid the rate-limited public BSC RPC default."*

### 7.2 Contract addresses ✅ (from the `NETWORKS` and `BNB_CHAIN_ADDRESSES` constants in `@bnbagent/sdk@0.5.5`)

**BSC Mainnet (56):**
```
registryContract (ERC-8004)   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432   ✅ verified live
commerceContract (ERC-8183)   0xea4daa3100a767e86fded867729ae7446476eba6
routerContract                0x51895229e12f9876011789b04f8698af06ccd6da
policyContract                0x9c01845705b3078aa2e8cff7520a6376fd766de5
$U token (United Stables)     0xcE24439F2D9C6a2289F741120FE202248B666666
Permit2                       0x000000000022D473030F116dDEE9F6B43aC78BA3
```

**BSC Testnet (97):**
```
registryContract (ERC-8004)   0x8004A818BFB912233c491871b3d84c89A494BD9e   ✅ verified live
commerceContract (ERC-8183)   0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de
routerContract                0xd7d36d66d2f1b608a0f943f722d27e3744f66f25
policyContract                0xd6a4217588f6b1f5657a92a3e94e6422ad771cea
$U token (ERC-8183 testnet)   0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565   (18 decimals)
```
> The CLI README confirms the testnet U address: *"The ERC-8183 testnet U contract is `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`. Do not substitute the 6-decimal B402/x402 test token; it belongs to a different rail."*

The payment token's EIP-712 domain: `name = "United Stables"`, `version = "1"` (verified by the SDK team against the on-chain `DOMAIN_SEPARATOR()`).

Another address seen: `0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA` = the `pay_to` for the CoinMarketCap x402 merchant.

### 7.3 Faucets ✅

- **tBNB & U through the official Telegram bot:** https://t.me/bnbchain_official_bot
  - `I would like to get tBNB to my wallet <address>` (max 0.3 tBNB/day)
  - `I would like to get U to my wallet <address>`
- Web faucet: https://testnet.bnbchain.org/faucet-smart
- Alternative U faucet: https://united-coin-u.github.io/u-faucet/
- Faucet docs: https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/

---

## 8. Agent Templates for Our 4 Categories

### 8.1 An important negative finding ✅

**There is no ready-made template for any of the four categories.** I downloaded and extracted the entire `@bnbagent/studio-cli@0.0.13` tarball (60 files). The complete contents of `recipes/` and `skills/`:

**Recipes (code templates):**
```
recipes/agent/              signing.ts (quote/verify/submit)
recipes/wallet/
recipes/tools-chain/        chainTools.ts (15 read-only functions)
recipes/x402-buyer/         x402Buyer.ts
recipes/mpp-buyer/          mppBuyer.ts
recipes/providers/pieverse-llm/
recipes/runtimes/agentcore/       executor, model, Dockerfile, sellerCore,
                                  tools, agentCard, unifiedMain, mcpMain, dualMain
recipes/runtimes/azure-foundry/   (same)
```

**Skills (14 playbooks):** scaffolding-agent, adding-to-project, operating, selling-via-8183, selling-via-b402, buying-via-8183, buying-from-bazaar, buying-via-mpp, extending-signing, use-bnb-trial, use-aws-agentcore, use-azure-foundry, using-twak-wallet, using-altana-wallet, wiring-llm-tools.

**All of it is about an agent's commercial plumbing** (identity, payments, deployment). **Zero** of it touches rebalancing, grid trading, yield optimization, or health factor. The same is true of `bnb-chain/bnbagent-sdk` (which contains `abis/`: AgenticCommerce.json, ERC20.json, EvaluatorRouter.json, IdentityRegistry.json, OptimisticPolicy.json) and of `bnb-chain/example-hub`.

🟡 Some press sources say BNB Chain will "share reference agents and skills spanning four categories: monitoring, grid trading, health factor, yield". ❌ I **did not find** a docs page containing them. Worth re-checking: run the latest `bag skills install` (there is a `0.0.14-alpha.1` I have not inspected) and check the hackathon page for "reference agents".

**Architectural implication:** the strategy logic for all four categories **is ours to build**, then wired in through `sellerCore.ts` (`runWork`) and `tools.ts`. Studio gives us identity + monetisation + hosting, not alpha.

### 8.2 Relevant DeFi protocols on BSC

Verified by a research sub-agent; confidence varies — **re-check before hardcoding**.

**PancakeSwap v3** ✅
- `NonfungiblePositionManager` (BSC 56): `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364`
- Official agent-specific guide: https://docs.pancakeswap.finance/trading-tools/building-trading-agents-on-pancakeswap-v3
- Developer portal: https://developer.pancakeswap.finance/
- 🟡 Subgraph endpoint: **sources conflict** (two different subgraph IDs found). For the hackathon it is safer to read LP positions directly on-chain via `positions(tokenId)`.
- Relevant to: **Rebalancing (LP range)**, **Grid Trading**.

**Venus Protocol** ✅ (source: `https://raw.githubusercontent.com/VenusProtocol/venus-protocol/master/deployments/bscmainnet_addresses.json`)
- Comptroller (Unitroller): `0xfD36E2c2a6789Db23113685031d7F16329158384`
- vBNB `0xA07c5b74C9B40447a954e1466938b865b6BBea36`, vUSDC `0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8`, vUSDT `0xfD5840Cd36d94D7229439859C0112a4185BC0255`
- Health read: `getAccountLiquidity(address) → (error, liquidity, shortfall)`; `shortfall > 0` = liquidatable.
- API: `https://api.venus.io` / `https://testnetapi.venus.io`
- ⚠️ **The Venus docs explicitly forbid** using their API for balances, prices, or liquidation safety (the data is indexed and can lag). **For the Health Factor agent, read `getAccountLiquidity` live via RPC.**
- Relevant to: **Health Factor Monitoring**, **Yield Optimisation**.

**Aave v3 on BNB Chain** ✅ (source: `https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3BNB.sol`)
- PoolAddressesProvider `0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D`
- **Pool** `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`
- AaveOracle `0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697`
- AaveProtocolDataProvider `0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328`
- Health read: `Pool.getUserAccountData(address) → (..., healthFactor)`
- Relevant to: **Health Factor Monitoring**.

**Lista DAO** 🟡 — every address below is **NOT verified against a primary source**, only from a docs page summary:
- Interaction (CDP) `0xB68443Ee3e828baD1526b3e0Bdf2Dfc6b1975ec4`, lisUSD `0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5`, slisBNB `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B`
- Docs: https://docs.bsc.lista.org/
- ❌ How to read a CDP's health/collateral ratio was **not found**. We need to read the `Interaction` ABI on BscScan.

---

## 9. Environment Requirements

✅ From the `@bnbagent/studio-cli@0.0.13` README:

| Requirement | Detail | When |
|---|---|---|
| **Node.js ≥ 22** | `"engines": {"node": ">=22"}` | always |
| **Claude Code or Cursor** | for the `/bnbagent-studio` skill | the recommended flow |
| **Corepack + pnpm 10** | the generated workspace | after `bag init` |
| **Bun ≥ 1.3** | `bag deploy` runs `@bnbagent/deploy-cli` through `bunx --bun` | only at deploy time |
| **Docker** | only the container path (`twak`) | optional |
| **AWS CLI** | only the read-only AgentCore quota check | optional, fail-open |
| **The npm `@aws/agentcore` CLI** | only for `bag dev --container` | optional |

**Credentials / accounts:**
- LLM: the default is **Pieverse** with the `auto/free` model = **$0/token, no API key of your own**. The alternatives (OpenRouter/OpenAI/Anthropic/Bedrock) use our own credentials.
- Wallet: created locally by `bag wallet new`; `WALLET_PASSWORD` lives in `.studio/.env.local`.
- BNB trial: `bag platform login` (GitHub device flow).
- AWS/Azure: your own account if self-deploying.
- **The 8004scan API key**: through the hackathon Pro tier form.

**Important env vars:** `WALLET_PASSWORD`, `PIEVERSE_LLM_API_KEY`, `RPC_URL`, `STORAGE_API_URL`, `STORAGE_API_KEY`, `MPP_SECRET_KEY` (≥32 bytes, paid MPP mode), `MPP_REALM`, `ERC8004_REGISTRY_ADDRESS` (override), `ERC8183_COMMERCE_ADDRESS` / `_ROUTER_ADDRESS` / `_POLICY_ADDRESS`, `BNBAGENT_USE_PAYMASTER=0`, `ALTANA_SESSION`, `BNBAGENT_DEPLOY_COMMAND`.

---

## 10. Installation Steps on macOS (Darwin arm64)

🟡 **Not executed by me** — assembled from the official README. Allow time for troubleshooting.

```bash
# 0. Check Node ≥ 22 (MANDATORY)
node -v
# if < 22:
#   brew install node@22   OR   nvm install 22 && nvm use 22

# 1. Install the CLI globally
npm install --global @bnbagent/studio-cli
bag --version                      # sanity check

# 2. Install the IDE skill (detects Claude Code / Cursor)
bag skills install --target both --scope user
#    → RESTART / reload the IDE afterwards

# 3. Workspace prerequisites
corepack enable && corepack prepare pnpm@10 --activate

# 4. Bun (only needed at deploy time) — natively supported on Apple Silicon
curl -fsSL https://bun.sh/install | bash
bun --version                      # needs ≥ 1.3

# 5. Scaffold the first agent (testnet, non-interactive)
bag init myagent \
  --network bsc-testnet \
  --wallet-kind evm-local \
  --llm-provider pieverse-llm \
  --protocols A2A,MCP \
  --storage-provider local \
  --destination self \
  --no-onboard
cd myagent && pnpm install

# 6. Wallet + funding
bag wallet new                     # password via a hidden prompt, NEVER as an argument
bag wallet show                    # copy the address
#    → request tBNB & U from https://t.me/bnbchain_official_bot
bag wallet balance --all

# 7. Diagnostics + run locally
bag doctor
bag dev
#    A2A card: http://localhost:9000/.well-known/agent-card.json
#    MCP:      http://localhost:8000/mcp

# 8. Deploy (pick the provider EXPLICITLY)
bag deploy prepare
bag deploy --provider bnb          # 48-hour testnet trial
#   or: bag platform login && bag platform credit && bag deploy --provider bnb
bag deploy verify --provider bnb   # ← registers/updates the ERC-8004 endpoint

# 9. Manual identity registration (if needed outside the verify flow)
bag erc8004 register --endpoint https://<our-agent-url>
bag erc8004 show
bag erc8004 resolve <agent_id>
```

### Likely problems on macOS arm64

| Problem | Mitigation |
|---|---|
| **Node < 22** | The most common one. `nvm use 22`. Note that `npm -g` is tied to the active Node version. |
| **`npm install -g` needs sudo** | Use nvm/fnm, not the system Node. |
| **`bunx` missing at deploy time** | `bag deploy prepare` fails CRITICAL. Install Bun ≥1.3 first. |
| **`agentcore` CLI conflict** | If `bedrock-agentcore-starter-toolkit` (Python) wins on PATH, `bag dev --container` breaks. Make sure the npm `@aws/agentcore` comes first. |
| **Public RPC rate-limited** | Set `RPC_URL` to a dedicated RPC. |
| **The default `binance.org` RPC is ISP-blocked** ✅ confirmed in this research environment | Override it to `https://bsc-dataseed.bnbchain.org` or `https://bsc-rpc.publicnode.com`. **We will very likely hit this in Indonesia too.** |
| **`www.binance.com` is blocked** ✅ confirmed | Bazaar/B402 discovery will not work without a VPN. |
| **Project name rejected** | ≤23 chars, alphanumeric, starts with a letter, no `-`/`_`/`.` |
| **`bag` permission prompts in the IDE** | Normal and deliberate. The skill doc **forbids** granting a blanket `bag:*`, because it covers commands that spend money. |
| **Docker** | Only needed for `twak`. The `evm-local` default is a zip, no Docker. |

---

## 11. Hackathon Context (with direct architectural impact)

Sources: the [hackathon page](https://www.bnbchain.org/en/hackathons/smart-money-era) and the [main track blog](https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace).

- **Main track:** build an agent marketplace on BSC — **$30,000** in prizes + adoption as BSC's canonical agent marketplace.
- **Timeline** 🟡: build 5 Aug – **9 Sep 2026**; judging 9–23 Sep; announcement 5 Nov. **RE-VERIFY — today is 8 Sep.**
- **The four categories** (the blog uses slightly different names than our brief): Monitoring / Grid trading / Health factor / Yield. The hackathon page uses: Rebalancing (LP range management), Grid Trading, Yield Optimization (highest APR routing), Health Factor Monitoring (liquidation protection).
- **Judging criteria** 🟡: Functionality, Data Quality, Agent Diversity. One source says 35/35/30, another says "equal weighting". What is consistent: **all four categories must be surfaced with equal depth**.
- The core measure, per the blog: *"how easily someone can find an agent and hire it."*
- **Required/recommended tech:** the BNB Agent Studio CLI, **the 8004scan API (free Pro tier for participants)**, the BSC Testnet Faucet, the PancakeSwap Developer Portal, the TermiX BSC MCP server, the Altana SDK/skills.
- **Submission requirements:** the marketplace has to be **publicly accessible and functional throughout judging**; the agents have to be **live on BSC**; include a wallet address.
- **Partner tracks (stackable):** Altana 50,000 XP (needs a session key with a spend cap + expiry registered on-chain and a user-visible revocation), TermiX $6k/$3k/$1k (needs an "Agent Advantage Report": ≥3 real tasks run with and without the agent), PancakeSwap 1,000 CAKE.

---

## 12. Architecture Recommendations

1. **Discovery = the 8004scan API as the primary source, on-chain as the fallback.** Get the Pro API key now. Build a BFF/proxy in the backend (not browser-side calls) with caching plus retry/backoff. The upstream is demonstrably flaky (intermittent DATABASE_ERROR) and "Data Quality" is a headline judging criterion.
2. **Build our own thin ERC-8004 indexer** as a safety net: `eth_getLogs` for `Registered` + `URIUpdated` on `0x8004A169…` (56) and `0x8004A818…` (97), store `agentId → owner → agentURI`, resolve the URI (handling base64/gzip/ipfs/https/bare JSON), and cache it. This also demonstrates "real-time data" to the judges.
3. **Classifying the 4 categories** works best through the **OASF `skills[]` / `domains[]`** in the registration file, backed up by 8004scan semantic search and keyword matching on `name`/`description`. Also provide a manually curated category mapping as a guarantee that none of the four categories is ever empty.
4. **Spam filtering is mandatory.** Most of the 340k mainnet agents are bulk registrations. Use `is_endpoint_verified`, `owner_publisher_tier`, `min_score`, `has_a2a`, and the `built_with` metadata.
5. **Publish our own agents** for all four categories (Studio gives identity + hosting; we write the strategies ourselves). This also guarantees even category coverage — 30% of the score.
6. **Health Factor: read on-chain directly** (`Venus.getAccountLiquidity`, `AaveV3Pool.getUserAccountData`), never an indexed API.
7. **Do not count on a Studio scheduler — there is none.** Provide our own cron/EventBridge for the monitoring agents.
8. **For the Altana track**, use `--wallet-kind altana` from the start; it is the only option that gives a budget- and time-bounded session key that can be revoked — exactly what is required.

---

## 13. Open Questions / Unverified

### Not yet verified — the team needs to check

1. 🟡 **The hackathon deadline dates.** Two sources say the build ends 9 Sep 2026 (tomorrow). Confirm on the official page before fixing scope.
2. 🟡 **The judging criteria weights.** 35/35/30 versus "equal" — sources differ. Find the official rubric.
3. ❌ **The "reference agents" for the 4 categories.** Mentioned in the press, absent from CLI package 0.0.13 and from the docs. Check `@bnbagent/studio-cli@0.0.14-alpha.1` and the hackathon page.
4. ❌ **`eth_getLogs` for `MetadataSet` on the `built_with` topic** is unfinished (a large block range times out on a public RPC). **This determines how many Studio agents are actually live on BSC** — a very important question for a "BNB Agent Studio agent" marketplace. Run it with a dedicated RPC (QuickNode/NodeReal) and chunk the block range.
5. ❌ **The full response schema of `GET /api/v1/agents`.** I hit HTTP 403 (anonymous rate limit) before I could dump one complete record. Once we have an API key, dump `https://api.8004scan.io/openapi.json` → `components.schemas` for the exact fields (rating, categories, performance, pricing).
6. ❌ **Whether 8004scan exposes an agent's "price" and "performance/returns".** There is `total_score`, `quality`, `scores/v5`, `feedbacks`, and `analytics` — but I have not verified whether there is a service price or a P&L metric. If not, prices have to come from each agent's ERC-8183 `negotiate` / x402 challenge.
7. 🟡 **The Binance Bazaar endpoints.** Documented in the official skill file, but unreachable for me (network-blocked). Test them from another network.
8. 🟡 **The Lista DAO addresses** and how to read a CDP's health — not from a primary source yet.
9. 🟡 **The PancakeSwap v3 subgraph endpoint** — the subgraph IDs conflict between sources.
10. ❌ **The `bnb-chain/bnbagent-studio` repo (404/private).** Everything about Studio in this document comes from the npm tarball. If the repo opens up, the `docs/design/*` and `docs/guides/*` files the skills reference would be very useful.
11. ❌ **ERC-8183 as a discovery source.** `bag erc8183 list` exists, but I have not mapped out whether the commerce contract exposes an indexable list of providers/sellers for finding agents that actually transact. The `JobCreated` / `ProviderSet` / `JobCompleted` events on `0xea4daa31…` (56) could be a source of a **real track record** — very valuable for the "Data Quality" criterion.
12. 🟡 **macOS arm64 compatibility.** Not executed yet. The main risks: Node <22, Bun, and the `agentcore` CLI conflict.
13. 🟡 **BASCAN** — announced on X as the "first ERC-8004 Public Agent Registry Scan on BNB Chain". No docs or product URL found. Treat it as non-existent.

### What I explicitly did NOT find ❌

- An **official BNB Agent Studio** agent discovery API (`studio.bnbchain.org/api/...` or similar). All that exists is `bnbagent-api.bnbchain.world` (auth-gated, the trial platform, not a public directory).
- An official subgraph (The Graph / Goldsky / Envio) for ERC-8004 on BSC.
- An API endpoint returning qualified "performance"/returns per DeFi agent.
- Official templates/skills for rebalancing, grid trading, yield optimization, or health factor monitoring.

---

## Appendix A — Commands I ran, reproducible

```bash
# Package verification
curl -s https://registry.npmjs.org/@bnbagent/studio-cli | jq '.["dist-tags"], .versions|keys'
curl -s https://pypi.org/pypi/bnbagent/json | jq .info.version

# Download & inspect the CLI (without installing)
URL=$(curl -s https://registry.npmjs.org/@bnbagent/studio-cli \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['versions'][d['dist-tags']['latest']]['dist']['tarball'])")
curl -sL "$URL" | tar -xz && ls package/skills package/recipes

# Verify the ERC-8004 registry live
cast call --rpc-url https://bsc-dataseed.bnbchain.org \
  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "name()(string)"      # → AgentIdentity
cast call --rpc-url https://bsc-dataseed.bnbchain.org \
  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "tokenURI(uint256)(string)" 1

# Topic hashes for indexing
cast keccak "Registered(uint256,string,address)"
cast keccak "built_with"

# 8004scan
curl -s https://api.8004scan.io/openapi.json | jq '.paths|keys'
curl -s "https://api.8004scan.io/api/v1/stats/global" | jq .total_agents
curl -s "https://api.8004scan.io/api/v1/agents?chain_id=56&limit=5" -H "X-API-Key: $KEY"
```

## Appendix B — Snapshot of the numbers (8 Sep 2026)

| Metric | Value | Source |
|---|---|---|
| ERC-8004 agents on BSC mainnet | **340,785** (highest agentId) | my `ownerOf()` binary search ✅ |
| Total agents across all chains (8004scan) | **820,100** | `GET /stats/global` ✅ |
| Total users (8004scan) | 458,338 | same ✅ |
| Total feedbacks | 3,654,749 | same ✅ |
| New agents per day | 3,589 | same ✅ |
| Average feedback score | 82.6 | same ✅ |
| The "BNB Chain has >200k ERC-8004 agents" claim | **Confirmed and already exceeded** — 340k+ | my on-chain measurement ✅ |
