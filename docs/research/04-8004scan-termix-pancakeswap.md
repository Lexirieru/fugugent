# BNB Chain Hackathon Sponsor Research — 8004scan (AltLayer), TermiX, PancakeSwap

> Context: **Fugugent** — an agent marketplace on BNB Chain (chain 56).
> Research date: **8 September 2026**. Every endpoint below was tested live on that date unless it is marked `UNVERIFIED`.
> Hackathon: [BNB Chain — "The Smart Money Era / Build the Era"](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes)

**Legend:**
- ✅ = verified live (an HTTP call made / the source file read directly)
- 📄 = from the official documentation (not tested at runtime)
- ⚠️ `UNVERIFIED` = not confirmed; do not use it without re-checking

---

# PART A — 8004scan (AltLayer) & ERC-8004

## A.1 Summary & conclusions

**8004scan can be Fugugent's primary marketplace data source.** Why:

1. There is a mature public REST API with a **complete OpenAPI 3.1 spec (150 endpoints)** — not just an explorer site.
2. Its BSC data is very large: **309,444 agents on chain 56** (verified live, `GET /api/v1/agents?chain_id=56&limit=1` → `total: 309444`).
3. It already provides **every dimension we need**: identity, capability (MCP/A2A/OASF), ownership, reputation/score, feedback, health-check, activity, semantic search, and real-time webhooks.
4. There is a **semantic search endpoint** that solves our 4-category classification problem (rebalancing / grid / yield / health factor) outright, with no need to build our own indexer.

**Risks that must be mitigated** (see §A.9): the API sometimes answers with a transient `500 DATABASE_ERROR`, and requests without a browser User-Agent are rejected.

**Key URLs:**
| Resource | URL |
|---|---|
| Site | https://8004scan.io/ |
| BSC agents | https://8004scan.io/agents?chain=56 |
| Builder Hub (Developer Hub) | https://8004scan.io/developers |
| API Explorer (Scalar UI) | https://8004scan.io/developers/docs |
| **OpenAPI spec (raw JSON)** | https://api.8004scan.io/openapi.json ✅ |
| OpenAPI mirror | https://8004scan.io/api/v1/public/docs/openapi.json ✅ |
| Best practices | https://best-practices.8004scan.io/ |
| Testnet instance | https://testnet.8004scan.io |
| Issue tracker | https://github.com/alt-research/8004scan-issue-tracker |
| AltLayer docs | https://docs.altlayer.io/altlayer-documentation/8004-scan/overview |
| Skills for Claude Code | https://github.com/jiayaoqijia/8004 |

---

## A.2 Base URL & Authentication

### Base URL

```
https://api.8004scan.io/api/v1
```
✅ Officially confirmed in the Builder Hub: *"Official API base URL: https://api.8004scan.io/api/v1"*.

The host `https://8004scan.io/api/v1` serves the same requests too (as a proxy) — stick to `api.8004scan.io` as the documentation says.

Spec info: `title: "8004scan Backend API"`, `version: 0.4.367`, `openapi: 3.1.0`.

### Authentication headers

Three schemes (from `components.securitySchemes` in the OpenAPI spec) ✅:

| Scheme | Type | Header | Use |
|---|---|---|---|
| `XApiKey` | apiKey (header) | **`X-API-Key: <key>`** | **This is the one we use.** Programmatic access + a higher rate limit |
| `XAccessToken` | apiKey (header) | `X-Access-Token: <JWT>` | A JWT from a wallet login (8004scan's recommendation for user sessions) |
| `BearerAuth` | http bearer | `Authorization: Bearer <JWT>` | A standard JWT |

**The public read-only endpoints (agents, feedbacks, stats, chains, leaderboard) do not require auth** — but without an API key you land in the `public`/`anonymous` tier, which is far smaller.

Examples from the Builder Hub ✅:
```bash
# with no auth
curl https://api.8004scan.io/api/v1/agents

# semantic search
curl "https://api.8004scan.io/api/v1/agents/search/semantic?q=code+review"

# with an API key
curl -H "X-API-Key: YOUR_API_KEY" https://api.8004scan.io/api/v1/agents/8453/123
```

> ⚠️ **8004scan's official warning:** *"Keep API keys in trusted backends or CLI tools. Browser apps should call their own server and must not expose keys in client code."*
> For Fugugent: keep the key in the backend/indexer, never in the client-side Next.js frontend.

### The JWT flow (if you need user actions, e.g. starring an agent)

1. `POST /api/v1/auth/nonce` → get a nonce
2. Sign the message with the wallet (SIWE-style)
3. `POST /api/v1/auth/login` → get an `access_token` + `refresh_token`
4. `POST /api/v1/auth/refresh` to extend it
5. A helper page: https://8004scan.io/test/login (log in with MetaMask, copy the token)

---

## A.3 Rate limits — the tiers and the real numbers

### The official table from the Builder Hub (https://8004scan.io/developers) ✅

| Tier | Requests/Min | Daily Limit |
|---|---|---|
| Anonymous | 30 | 1,000 |
| **Free API** | **600** | **100,000** |
| Basic *(contact us)* | 900 | 300,000 |
| **Pro** *(contact us)* | **3,000** | **3,000,000** |
| Enterprise *(contact us)* | 10,000 | Unlimited |

### ⚠️ A discrepancy with the hackathon brief

The BNB Chain hackathon page says the free Pro tier for participants is **500 req/min, 100,000 req/day**.
Those numbers **do not match** the Builder Hub table (Pro = 3,000/min, 3M/day; the 100k/day figure is the **Free API** tier).

**The safest interpretation:** assume the effective hackathon quota is ≈ **500 req/min and 100k req/day**, and design the system to stay under that. If we turn out to get 3,000/min, that is a bonus. Do not build an architecture that needs more than 100k calls/day.

### The internal tier enum (from the OpenAPI `APITier`) ✅

```
anonymous | public | session | free_api | basic | pro | enterprise | admin
```
Tier resolution priority (from the spec's internal documentation):
1. `admin` (no rate limit)
2. API key: `enterprise` > `pro` > `basic` > `free_api`
3. `session` (JWT + browser)
4. `public` (no auth + browser headers)
5. `anonymous` (a bot/script — no browser headers)

### Rate limit headers

The documentation mentions 5 headers: `X-RateLimit-Tier`, `X-RateLimit-Limit-Minute`, `X-RateLimit-Remaining-Minute`, `X-RateLimit-Limit-Day`, `X-RateLimit-Remaining-Day`.

What was **actually visible** during a live test without an API key ✅:
```
x-ratelimit-limit-day: 20000
x-ratelimit-limit-minute: 180
x-ratelimit-remaining-day: 19989
x-ratelimit-remaining-minute: 177
```
(180/min & 20,000/day = the `public` tier; `X-RateLimit-Tier` did not appear in the responses tested.)

### Per-endpoint rate limits (from the OpenAPI spec) ✅
- `POST /agents/{chain_id}/{token_id}/views` — 10 views/minute, 100/hour, 500/day per IP
- `POST /agents/verify-endpoint/...` — once per hour per agent
- `POST /ipfs/upload` — 20 requests/hour per user
- `POST /storage/upload` — 10/hour, 30/day, 50MB/day per user

### API keys per tier ✅
Free: max 2 · Basic: max 5 · Pro: max 10 · Enterprise: unlimited.

---

## A.4 How to register an API key + the Pro-Tier Upgrade Form

**The steps:**

1. Open **https://8004scan.io/developers** (the Builder Hub).
2. Log in with a wallet (MetaMask). The flow: `POST /api/v1/auth/nonce` → sign → `POST /api/v1/auth/login`. You can also use the page at https://8004scan.io/test/login.
3. Create a key: `POST /api/v1/api-keys` (needs `X-Access-Token` / `Authorization: Bearer`).

   The body (`APIKeyCreate`) ✅:
   ```json
   {
     "name": "fugugent-indexer",
     "scopes": ["read:agents"],
     "expires_in_days": 90
   }
   ```
   The `tier` field is **deprecated and ignored** — the tier is derived from the user's subscription.
   The scopes the spec mentions: `read:agents`, `write:agents`, `read:validations`, `write:validations` (the spec says they are "for future use").

   > ⚠️ **The key is shown only once.** Save it immediately. It can be revealed again through `POST /api/v1/api-keys/{key_id}/reveal` (rate-limited).

4. **Submit the Pro-Tier Upgrade Form (for hackathon participants):**
   **https://forms.gle/jQevEPCAacBXaKG79**
   (the official link from the BNB Chain hackathon prizes page). Fill in the details of the API key you just created.

**Key management endpoints** ✅:
| Method | Path | Function |
|---|---|---|
| POST | `/api/v1/api-keys` | Create a key |
| GET | `/api/v1/api-keys?include_inactive=false` | List keys |
| GET | `/api/v1/api-keys/{key_id}` | Key detail |
| POST | `/api/v1/api-keys/{key_id}/reveal` | Show the key |
| GET | `/api/v1/api-keys/{key_id}/usage?days=7` | Usage statistics (max 30 days) — total requests, a daily breakdown, current rate limits, top endpoints |
| DELETE | `/api/v1/api-keys/{key_id}` | Revoke |

---

## A.5 The complete 8004scan API endpoint list

There are **150 paths** in the OpenAPI spec. They are grouped below; the **bold** ones are directly relevant to Fugugent.

### A.5.1 Agents — identity, capability, ownership ⭐

| Method | Path | Notes |
|---|---|---|
| **GET** | **`/api/v1/agents`** | **List + filter + sort + search. The main endpoint for our catalogue.** |
| **GET** | **`/api/v1/agents/search/semantic`** | **Hybrid full-text + pgvector semantic search** |
| **GET** | **`/api/v1/agents/{chain_id}/{token_id}`** | **Agent detail (cached 60 seconds)** |
| GET | `/api/v1/agents/{chain_id}/{registry_address}/{token_id}` | Detail for a custom registry contract |
| GET | `/api/v1/agents/leaderboard` | Leaderboard (cached 5 minutes) |
| GET | `/api/v1/agents/trending` | Trending (cached 1 minute) |
| GET | `/api/v1/agents/featured` | Featured agents |
| GET | `/api/v1/agents/latest` | Newest |
| GET | `/api/v1/agents/most-starred` | Most starred |
| GET | `/api/v1/agents/best-wallet` | Ranking based on wallet credibility |
| **GET** | **`/api/v1/agents/scores/v5/{chain_id}/{token_id}`** | **The v5 score breakdown (5 dimensions)** |
| GET | `/api/v1/agents/score-history/{chain_id}/{token_id}` | Score history |
| **GET** | **`/api/v1/agents/{chain_id}/{token_id}/quality`** | **Quality Center (`history_days` ≤365, `history_limit` ≤100)** |
| GET | `/api/v1/agents/{chain_id}/{token_id}/views` | Page views |
| GET | `/api/v1/agents/{chain_id}/{token_id}/views/history` | View history |
| POST | `/api/v1/agents/{chain_id}/{token_id}/views` | Record a view (auth) |
| POST | `/api/v1/agents/{chain_id}/{token_id}/health-check` | Request a health check (owner, auth) |
| POST | `/api/v1/agents/{chain_id}/{token_id}/metadata-refresh` | Refresh the metadata (owner, auth) |
| POST | `/api/v1/agents/verify-endpoint/{chain_id}/{token_id}` | Verify the endpoint's domain (once/hour) |
| POST/DELETE | `/api/v1/agents/stars/{chain_id}/{token_id}` | Star / unstar (auth) |
| GET | `/api/v1/agents/stars/{chain_id}/{token_id}/is-starred` | Check a star (auth) |
| GET | `/api/v1/agents/user/me/starred` · `/api/v1/agents/user/{user_id}/starred` | Starred agents |
| GET | `/api/v1/media/agents/{chain_id}/{token_id}/image` | The agent's image (a safe proxy) |

#### `GET /api/v1/agents` parameters (complete) ✅

**Pagination:** `limit` (1–100, default 20), `offset` (≥0, default 0).

**Basic filters:**
| Param | Type | Notes |
|---|---|---|
| `chain_id` | int | 56 = BSC mainnet, 97 = BSC testnet |
| `is_testnet` | bool | true = testnet only, false = mainnet only |
| `owner_address` | string | the owner's address |
| `owner_publisher_tier` | `OFFICIAL\|VERIFIED\|COMMUNITY` | the publisher's certification tier |
| `supported_protocol` | string | `MCP`, `A2A`, etc. |
| `x402_supported` | bool | x402 payment support |
| `has_mcp` / `has_a2a` / `has_oasf` | bool | has an MCP / A2A / OASF endpoint |
| `is_registered` | `true\|false\|any` | default `true` — drops placeholders and test domains (`localhost`, `example.com`) |
| `is_active` | `true\|false\|any` | default `true` — the ERC-8004 `active` field |
| `is_endpoint_verified` | bool | the endpoint's domain is verified |
| `supported_trust` | string | `reputation`, `crypto-economic`, `tee-attestation` |

**OASF filters (multi-value, OR logic):**
- `oasf_skill` — repeat the parameter: `?oasf_skill=NLP&oasf_skill=Data%20Analysis`
- `oasf_domain` — `?oasf_domain=finance&oasf_domain=healthcare`

**Advanced filters:**
`min_feedbacks` · `min_validations` · `min_score` (0–100) · `created_after` / `created_before` (ISO 8601) · `tags` (comma-separated, OR) · `categories` (comma-separated, OR)

**Search:**
- `search` (1–200 chars) with auto-detection: a number → `token_id`; `0x...`/base58 → an owner address; `56:0x8004...:49637` → a composite agent ID; `vitalik.eth` → ENS; anything else is full-text
- `search_type`: `auto|text|token_id|agent_id|address|ens|did`
- `search_fields`: comma-separated from `name,description,tags,categories,capabilities,endpoints,supported_protocols`

**Sorting:**
- `sort_by`: `created_at` (default), `stars`, `name`, `token_id`, `total_score`, `quality_score`, `popularity_score`, `activity_score`, `validation_score`, `wallet_score`, `freshness_score`, `metadata_completeness_score`, `total_feedbacks`, `average_score`, `total_validations`
- `sort_order`: `desc` (default) / `asc`

#### Example response for `GET /api/v1/agents?chain_id=56&limit=1&sort_by=total_score&sort_order=desc` ✅ (live)

```json
{
  "items": [
    {
      "id": "1a629df6-cec2-4251-839c-dfba07e604e3",
      "agent_id": "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:49637",
      "token_id": "49637",
      "chain_id": 56,
      "chain_type": "evm",
      "contract_address": "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
      "is_testnet": false,
      "owner_id": "d732b104-271a-4dc8-9adf-c7942064c6f5",
      "owner_address": "0x0d68a153897b73a6e4d2eaa9b0d4802bae69532d",
      "owner_ens": null,
      "owner_username": "OpenOdds.Ai",
      "owner_avatar_url": "https://blob.8004scan.app/4bc435fe....jpg",
      "owner_publisher_tier": null,
      "owner_certified_name": null,
      "name": "OpenOdds.Ai",
      "description": "Verifiable pre-match football odds prediction agent ...",
      "image_url": "https://api.8004scan.io/api/v1/media/agents/56/49637/image",
      "is_verified": false,
      "star_count": 8,
      "supported_protocols": ["MCP", "A2A", "Web"],
      "x402_supported": false,
      "total_score": 49.06,
      "rank": null,
      "network_rank": null,
      "health_score": 100.0,
      "total_feedbacks": 3,
      "average_score": 100.0,
      "cross_chain_versions": null,
      "created_at": "2026-03-23T23:54:44Z",
      "updated_at": "2026-09-08T00:41:11.096927Z"
    }
  ],
  "total": 309444,
  "limit": 1,
  "offset": 0
}
```

> **An important note:** the response wrapper is **inconsistent**. `/agents` returns a flat object `{items,total,limit,offset}`, while `/chains` returns `{"success":true,"data":{...}}`, and errors return `{"success":false,"error":{"code":...,"message":...}}`. Write a parser that tolerates both shapes.

#### Example response for `GET /api/v1/agents/56/49637` (detail) ✅ (live, structure abridged)

```jsonc
{
  "id": "...", "agent_id": "56:0x8004a169...:49637", "token_id": "49637",
  "chain_id": 56, "chain_type": "evm", "is_testnet": false,
  "contract_address": "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",

  // --- OWNERSHIP ---
  "owner_id": "...", "owner_address": "0x0d68a153...", "owner_ens": null,
  "owner_username": "OpenOdds.Ai", "owner_avatar_url": "...",
  "owner_publisher_tier": null, "owner_certified_name": null,
  "creator_address": "0x0d68a153...",
  "agent_wallet": "0x0d68a153...",

  // --- IDENTITY / METADATA ---
  "name": "OpenOdds.Ai", "description": "...", "agent_type": null,
  "image_url": "...", "tags": [...], "categories": [...],
  "is_verified": false, "is_active": true,
  "star_count": 8, "watch_count": 0,
  "supported_protocols": ["MCP","A2A","Web"],
  "supported_trust_models": [...],
  "x402_supported": false,

  // --- CAPABILITY / ENDPOINTS ---
  "services": {
    "mcp": { "endpoint": "https://api.openodds.ai/mcp", "version": "2025-11-25",
             "tools": [...], "prompts": [...], "resources": [...] },
    "a2a": { "endpoint": "https://openodds.ai/.well-known/a2a-agent-card.json",
             "version": "1.0.0", "skills": [...] },
    "web": { "endpoint": "https://openodds.ai" }
  },

  // --- SCORING ---
  "total_score": 30.52,
  "scores": {
    "quality": 0.0, "popularity": 22.51, "activity": 10.0,
    "wallet": 31.35, "freshness": 36.79, "metadata_completeness": 83.0,
    "health_score": 100.0,
    "breakdown": { "version": "5.2", "algorithm": "v5_leaderboard_policy",
                   "dimensions": {...}, "raw_scores": {...},
                   "multipliers": {...}, "leaderboard_policy": {...},
                   "final_score": 49.0578 },
    "last_scored_at": "2026-08-23T12:30:23Z"
  },
  "rank": 5, "network_rank": 5,

  // --- REPUTATION ---
  "total_feedbacks": 3, "average_score": 100.0,
  "total_validations": 0, "successful_validations": 0,

  // --- HEALTH ---
  "health_score": 100.0, "health_checked_at": "2026-09-08T00:41:19Z",
  "health_status": {
    "services": { "a2a": {...}, "api": {...}, "mcp": {...}, "web": {...} },
    "owner_wallet": { "status": "healthy", "message": "Balance: 0.0075 native, Txns: 91", ... },
    "overall_status": "healthy", "health_score": 100.0,
    "verification_summary": { "any_verified": true, "verified_count": 2, "verifiable_count": 2 },
    "checked_at": "2026-09-08T00:41:19Z"
  },

  // --- ENDPOINT VERIFICATION ---
  "is_endpoint_verified": false, "endpoint_verified_at": null,
  "endpoint_verified_domain": null, "endpoint_verification_error": null,
  "endpoint_last_checked_at": "2026-08-28T20:40:48Z",

  // --- ON-CHAIN PROVENANCE ---
  "created_block_number": 88358626,
  "created_tx_hash": "0xbbc91d54e9da7d19c81bde5dce067f943f2464664c2e753bb552df1a6511dfdf",

  // --- CROSS-CHAIN ---
  "cross_chain_links": [
    { "target_chain_id": 1,
      "target_registry": "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
      "target_token_id": "22771",
      "linked_agent_id": "8394bd77-...",
      "verification_status": "owner_match" }
  ],
  "cross_chain_versions": null,

  // --- RAW ERC-8004 REGISTRATION FILE ---
  "parse_status": { "status": "success", "errors": [], "warnings": [], "info": [],
                    "last_parsed_at": "2026-06-07T04:08:30Z" },
  "raw_metadata": {
    "onchain": [...],
    "offchain_uri": "ipfs://QmaynfJRJSCeytJqU5a1ENETc97hcTHEkCTtFRtNwMoyxS",
    "offchain_content": {
      "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      "name": "OpenOdds.Ai", "description": "...", "image": "...",
      "url": "https://openodds.ai/.well-known/agent-card.json",
      "active": true, "version": "1.0.2", "protocol": "ERC-8004",
      "agent_type": "prediction",
      "categories": [...], "tags": [...], "skills": [...], "capabilities": [...],
      "models": {...}, "provider": {...}, "services": [...],
      "supportedTrust": [...], "supportedNetworks": [...],
      "registrations": [...], "x402Support": false,
      "license": "MIT", "documentation": "https://openodds.ai/docs",
      "termsOfService": "...", "privacyPolicy": "...", "securityPolicy": "...",
      "defaultInputModes": [...], "defaultOutputModes": [...],
      "limitations": [...], "disclaimer": "...", "updatedAt": 1780805118
    }
  },
  "field_sources": { "name": "offchain", "description": "onchain", "capabilities": "onchain",
                     "agent_type": "onchain", "agent_hash": "onchain", "tags": "onchain", ... }
}
```

> `field_sources` is very useful: it tells you whether each field came from `onchain`, `offchain`, or `hardcoded`. For Fugugent's trust scoring, `onchain` fields are more trustworthy.

#### `GET /api/v1/agents/search/semantic` ✅

Hybrid **full-text (PostgreSQL tsvector) + semantic (pgvector)**.

| Param | Default | Notes |
|---|---|---|
| `q` (**required**) | — | 1–500 chars |
| `limit` / `offset` | 20 / 0 | max 100 |
| `chain_id` | — | 56 for BSC |
| `is_active` | `true` | `true\|false\|any` |
| `semantic_weight` | 0.5 | 0.0 = pure full-text, 1.0 = pure semantic |
| `similarity_threshold` | 0.5 | the minimum similarity threshold |

The response: the agent items plus an extra `similarity_score` field.

Live tests on chain 56 ✅:
```
q=health factor liquidation  → 340458 "LingoAI Health Factor Sentinel" (sim 0.8043)
                                292058 "bnb-lending-guardian.agent"    (sim 0.8034)
q=grid trading bot           → 62924  "tradingbot"
q=yield farming              → 50036  "Yield-Farmer - Goo"             (sim 0.7276)
q=rebalancing                → 11 results in total
```

### A.5.2 Feedback / Reputation ⭐

| Method | Path |
|---|---|
| **GET** | **`/api/v1/feedbacks`** |
| GET | `/api/v1/feedbacks/{feedback_id}` |
| GET | `/api/v1/feedbacks/{feedback_id}/replies` |

`GET /api/v1/feedbacks` parameters ✅:
`limit` (≤100) · `offset` · `agent_id` (the internal UUID) · `agent_token_id` (+ `chain_id`) · `user_address` · `min_score` / `max_score` (0–100) · `include_revoked` (default false) · `tag1` / `tag2` (partial match, case-insensitive, ≤255 chars — these are the ERC-8004 tags) · `chain_id` · `is_testnet` · `oasf_skill[]` / `oasf_domain[]` (max 20, OR) · `sort_by` = `submitted_at|score|created_at` · `sort_order` · `include_replies` (embeds ≤10 replies)

Examples from the documentation:
```
GET /feedbacks?chain_id=11155111&agent_token_id=1675
GET /feedbacks?user_address=0x7a1591...
GET /feedbacks?min_score=90&sort_by=score&sort_order=desc
GET /feedbacks?oasf_domain=finance&oasf_domain=business
```

### A.5.3 Stats / Network data ⭐

| Method | Path | Cache | Notes |
|---|---|---|---|
| **GET** | **`/api/v1/stats/global`** | 60s | Platform statistics; params `is_testnet`, `is_registered` |
| GET | `/api/v1/stats/daily` | — | Daily statistics |
| GET | `/api/v1/stats/growth` · `/api/v1/stats/growth/chains` | — | Growth analysis |
| GET | `/api/v1/stats/feedbacks` · `/api/v1/stats/feedbacks/tags` | — | Feedback statistics + tags |
| **GET** | **`/api/v1/stats/oasf/skills`** | 300s | Skill distribution (limit ≤500) |
| **GET** | **`/api/v1/stats/oasf/domains`** | 300s | Domain distribution (limit ≤500) |
| **GET** | **`/api/v1/stats/agents/{chain_id}/{token_id}`** | real-time | Per-agent statistics |
| GET | `/api/v1/stats/agents/{chain_id}/{token_id}/analytics` | — | Per-agent analytics |
| **GET** | **`/api/v1/chains`** · `/api/v1/chains/{chain_id}` | — | The chain list |

`GET /api/v1/stats/global?is_testnet=false` ✅ (live, 8 Sep 2026):
```json
{
  "total_agents": 502861,
  "total_users": 458327,
  "total_validators": 0,
  "total_feedbacks": 572151,
  "total_validations": 0,
  "daily_new_agents": 3197,
  "daily_new_users": 1669,
  "daily_feedbacks": 1690,
  "average_feedback_score": 82.21,
  "average_validation_score": null,
  "supported_chains": [
    {"chain_id": 56, "name": "BSC", "key": "bsc_mainnet", "is_testnet": false,
     "enabled": true, "has_registry": true}, ...
  ]
}
```
> Note: `total_validations = 0` and `total_validators = 0` across all of mainnet. **The Validation Registry is effectively unused** — do not build a feature that depends on it.

`GET /api/v1/chains` ✅ — the BSC chains:
```json
{"chain_key":"bsc_mainnet","chain_id":56,"name":"BSC","is_testnet":false,"enabled":true,
 "blockscout_configured":false,"etherscan_supported":true,"etherscan_keys_present":true,
 "effective_provider":null,"provider_status":"rpc_only",
 "provider_reason":"etherscan_disabled_for_chain"}
{"chain_key":"bsc_testnet","chain_id":97,"name":"BSC Testnet","is_testnet":true,"enabled":true,
 "effective_provider":"etherscan","provider_status":"available"}
```

### A.5.4 Wallets / Users — ownership & activity ⭐

| Method | Path | Notes |
|---|---|---|
| **GET** | **`/api/v1/wallets/{address}/agents`** | Every agent owned by a wallet |
| GET | `/api/v1/wallets/{address}` · `/metrics` · `/stats` | Wallet profile & metrics |
| **GET** | **`/api/v1/users/{identifier}/activity`** | **A user's activity feed** |
| GET | `/api/v1/users/{identifier}` · `/stats` · `/feedbacks` · `/card` | User profile |
| GET | `/api/v1/users/{identifier}/validations/requested` · `/responded` | Validations |
| GET | `/api/v1/users/{identifier}/followers` · `/following` · `/follow-status` | The social graph |
| POST/DELETE | `/api/v1/users/{identifier}/follow` | Follow/unfollow (auth) |

### A.5.5 Leaderboards & rankings

`/api/v1/agents/leaderboard` params ✅: `period` = `7d|30d|90d|all` · `sort_by` = `total_score|quality_score|popularity_score|activity_score|validation_score|wallet_score|freshness_score` · `limit` (≤100) · `offset` · `chain_id` · `is_testnet` · `group_cross_chain` (default `true`).

`/api/v1/agents/trending` ✅: `period` = `24h|7d|30d`, `limit` ≤50.
The trending algorithm (from the docs): `trending_score = view_count / (hours_since_last_activity + 2)^1.5`.

Also: `/api/v1/leaderboards/publishers`, `/api/v1/leaderboards/validators`.

### A.5.6 MCP tools endpoints (they accept `X-API-Key`) ⭐

This is a special path that **explicitly allows `XApiKey`** (the other endpoints default to JWT):

| Method | Path | Params |
|---|---|---|
| GET | `/api/v1/mcp/tools/search_agents` | `query` (required, 1–200), `chain_id`, `limit` (1–50, default 10), `search_type` = `keyword\|semantic`, `api_key` (for SSE clients) |
| GET | `/api/v1/mcp/tools/get_agent` | `chain_id` (required), `token_id` (required, int), `api_key` |
| GET | `/api/v1/mcp/tools/get_agent_feedbacks` | `chain_id` (required), `token_id` (required), `limit` (1–50, default 20), `api_key` |
| GET | `/api/v1/mcp/tools/get_starred_agents` | `api_key` |
| POST | `/api/v1/mcp/tools/star_agent` · `unstar_agent` | — |

> For the Fugugent backend, the ordinary REST endpoints (`/agents`, `/agents/search/semantic`) are richer. The `/mcp/tools/*` path is useful if we want to expose 8004scan as a tool to our own agents.

### A.5.7 Webhooks — real-time data ⭐⭐

| Method | Path |
|---|---|
| **POST** | **`/api/v1/webhooks/register`** |
| GET | `/api/v1/webhooks` · `/api/v1/webhooks/{webhook_id}` |
| PATCH / DELETE | `/api/v1/webhooks/{webhook_id}` |
| GET | `/api/v1/webhooks/{webhook_id}/deliveries` |

The register body ✅:
```json
{
  "webhook_url": "https://api.hellofugu.xyz/hooks/8004scan",
  "events": ["validation.requested", "validation.completed"]
}
```
`events` defaults to `["validation.requested","validation.completed"]`. The Builder Hub mentions **6 event types: validation, feedback, and star events**; the exact names of the feedback/star events **are not listed in the OpenAPI spec** ⚠️ `UNVERIFIED` — check through the `8004scan-webhooks` skill (the `jiayaoqijia/8004` repo) or by experiment.

Features: **HMAC-SHA256 signature verification**, delivery monitoring + retry history, exponential backoff up to 5 attempts, and filtering by event type and agent. The register response returns a `webhook_id` + a `secret` (save it!).

**This is the key to a real-time marketplace:** register a webhook → get pushed events when an agent receives feedback/a validation/a star, with no polling.

### A.5.8 Everything else
- Status/health: `/api/v1/status/summary`, `/components`, `/freshness`, `/indexers`, `/indexers/direct`, `/taskqueue`, plus `/health` & `/ready`
- Storage: `/api/v1/storage/upload|file/{key}|hash/{hash}|info/{key}|status`
- IPFS: `/api/v1/ipfs/upload`, `/api/v1/ipfs/fetch`
- Inbox: `/api/v1/inbox*`
- Donations: `/api/v1/donations/*`
- Certifications: `/api/v1/users/me/certifications/publisher/apply` (to get an `OFFICIAL/VERIFIED/COMMUNITY` badge)
- Admin: `/api/v1/admin/*` (not relevant)

### A.5.9 Pagination

Every list endpoint is **offset-based**: `limit` (1–100) + `offset` (≥0). The `/agents` list response returns `{items, total, limit, offset}` → the page count = `ceil(total/limit)`.

⚠️ With `total = 309,444` on BSC, **never full-scan**. Always use a filter (`oasf_domain`, `min_score`, `min_feedbacks`, `has_mcp`) or semantic search.

---

## A.6 The 8004scan Skills for Claude Code

From https://8004scan.io/developers?tab=skills ✅. Repo: **https://github.com/jiayaoqijia/8004** (AGPL-3.0).

```
/plugin marketplace add jiayaoqijia/8004
/plugin install 8004scan-skill@8004scan
```

3 skills:
1. **`8004`** — an ERC-8004 protocol reference: the 3-registry architecture, ABIs and contract addresses for 45+ EVM chains, the agent registration schema, trust labels and scoring, TypeScript/Python SDK examples, and integration patterns (MCP, A2A, OASF, ENS, x402)
2. **`8004scan`** — API integration: listing/filtering agents, semantic and keyword search, agent detail, per-wallet queries, platform statistics, feedback
3. **`8004scan-webhooks`** — real-time events: the 6 event types, webhook registration and management, HMAC-SHA256 verification, delivery monitoring, exponential-backoff retries

> For the Fugugent team: install these skills in Claude Code during development — they speed up the integration and are good for the "we use the sponsor's tooling" demo point.

---

## A.7 ERC-8004 — a condensed specification

Sources: [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) · [github.com/erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) (the README + `ERC8004SPEC.md`, licence CC0) · https://8004.org

### Core concepts

**Agent identifiers:**
- `agentRegistry` = `{namespace}:{chainId}:{identityRegistry}` — e.g. `eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- `agentId` = the ERC-721 `tokenId` minted in the Identity Registry

On 8004scan, the composite ID appears as `56:0x8004a169...:49637`.

**What it does (and does not do):**
- ✅ Discovery: an ERC-721 identity whose `tokenURI` points at the registration file
- ✅ Trust signals: standardised on-chain reputation & validation
- ❌ **It is not a payment rail** — payments are deliberately out of scope

### A.7.1 The Identity Registry

An upgradeable ERC-721 (`ERC721URIStorage`).

**The main functions** ✅ (from the official ABI):
```solidity
register() returns (uint256)
register(string agentURI) returns (uint256)
register(string agentURI, tuple[] metadata) returns (uint256)
setAgentURI(uint256 agentId, string newURI)
tokenURI(uint256 tokenId) returns (string)
ownerOf(uint256 tokenId) returns (address)
getMetadata(uint256 agentId, string metadataKey) returns (bytes)
setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)
getAgentWallet(uint256 agentId) returns (address)
setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)
unsetAgentWallet(uint256 agentId)
```

**The special `agentWallet` key:** it is set automatically at registration (= the owner), can only be changed with proof of control of the new wallet via **EIP-712 / ERC-1271**, and is **cleared on transfer** (the new owner must re-verify).

**Events (indexable)** ✅:
```solidity
Registered(uint256 indexed agentId, string agentURI, address indexed owner)
URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)
MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)
Transfer(address indexed from, address indexed to, uint256 indexed tokenId)   // ERC-721 → an ownership change
Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)
ApprovalForAll(address indexed owner, address indexed operator, bool approved)
MetadataUpdate(uint256 _tokenId)
BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId)
Upgraded(address indexed implementation)
Initialized(uint64 version)
EIP712DomainChanged()
OwnershipTransferred(address indexed previousOwner, address indexed newOwner)
```

### A.7.2 The Reputation Registry

It stores feedback signals as **signed fixed-point**:
- `value`: `int128` (signed)
- `valueDecimals`: `uint8` (0–18)
- Examples: `value=9977, valueDecimals=2` → `99.77`; `value=560, valueDecimals=0` → `560`

The rest is optional metadata (tags, an endpoint URI, an off-chain payload URI + hash). **Self-feedback is prevented** (the agent's owner/operator is checked through the Identity Registry).

**The functions** ✅:
```solidity
giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
             string tag1, string tag2, string endpoint,
             string feedbackURI, bytes32 feedbackHash)
revokeFeedback(uint256 agentId, uint64 feedbackIndex)
appendResponse(uint256 agentId, address clientAddress, uint64 feedbackIndex,
               string responseURI, bytes32 responseHash)
readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
    returns (int128, uint8, string, string, bool)
readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked)
    returns (address[], uint64[], int128[], uint8[], string[], string[], bool[])
getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2)
    returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
getClients(uint256 agentId) returns (address[])
getLastIndex(uint256 agentId, address clientAddress) returns (uint64)
getResponseCount(...)
```
> ⚠️ `getSummary` **requires a non-empty `clientAddresses`** (anti-Sybil). For global aggregation, use the 8004scan API (`average_score`, `total_feedbacks`) — far more practical.

**Events** ✅:
```solidity
NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex,
            int128 value, uint8 valueDecimals, string indexed indexedTag1,
            string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)
FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)
ResponseAppended(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex,
                 address indexed responder, string responseURI, bytes32 responseHash)
```

### A.7.3 The Validation Registry

> ⚠️ **A warning from the official repo:** the Validation Registry section is *"still under active revision and discussion with the TEE community"* and will be revised in the next spec update. Add the live data: **0 validators and 0 validations across all of mainnet**. **Do not depend on it.**

```solidity
validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)
validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)
getValidationStatus(bytes32 requestHash) returns (address, uint256, uint8, bytes32, string, uint256)
getSummary(uint256 agentId, address[] validatorAddresses, string tag) returns (uint64, uint8)
getAgentValidations(uint256 agentId) returns (bytes32[])
getValidatorRequests(address validatorAddress) returns (bytes32[])
```
Events: `ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)` · `ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)`

### A.7.4 Contract addresses — BSC ✅

Source: [the erc-8004-contracts README](https://github.com/erc-8004/erc-8004-contracts) — **cross-confirmed** against (a) the `contract_address` field in live 8004scan BSC data and (b) TermiX's `GET /api/v1/config/contracts` on chain 56.

#### BSC Mainnet (chain 56)
| Contract | Address |
|---|---|
| **IdentityRegistry** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| **ReputationRegistry** | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ValidationRegistry | ⚠️ **not listed in the official README** — `UNVERIFIED`, do not use |

Explorer: https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

#### BSC Testnet (chain 97)
| Contract | Address |
|---|---|
| **IdentityRegistry** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| **ReputationRegistry** | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ValidationRegistry | ⚠️ `UNVERIFIED` |

Explorer: https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e

> **An important pattern:** the addresses are **identical across every EVM mainnet** (`0x8004A169...` for Identity, `0x8004BAa1...` for Reputation) and **identical across every testnet** (`0x8004A818...` / `0x8004B663...`) — the result of a vanity/deterministic deployment. Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Celo, Gnosis, Linea, Mantle, Monad, Metis, MegaETH, LUKSO, Abstract, GOAT, Taiko and so on are all the same.
> The consequence for Fugugent: **our contract/indexer code needs one set of addresses plus a chainId variable.**

The official ABIs: `https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/main/abis/{IdentityRegistry|ReputationRegistry|ValidationRegistry}.json` ✅

### A.7.5 The AgentCard / registration file structure

The `agentURI` (= `tokenURI`) points at JSON. The fields per the spec:

| Field | Contents |
|---|---|
| `type` | `"https://eips.ethereum.org/EIPS/eip-8004#registration-v1"` |
| `name`, `description`, `image` | NFT-friendly metadata |
| `services` | The endpoint list: the A2A agent card URL, the MCP endpoint, the OASF manifest, ENS, email |
| `registrations` | An array of `{ agentRegistry, agentId }` — binds the file to the on-chain identity, and is also used for **cross-chain linking** |
| `supportedTrust` | `reputation`, `crypto-economic`, `tee-attestation` |
| `active` | boolean — the availability the owner declares |

Extra fields used in the real world (seen on live BSC agents) ✅: `url`, `version`, `protocol`, `agent_type`, `categories`, `tags`, `skills`, `capabilities`, `models`, `provider`, `license`, `documentation`, `termsOfService`, `privacyPolicy`, `securityPolicy`, `defaultInputModes`, `defaultOutputModes`, `supportedNetworks`, `x402Support`, `limitations`, `disclaimer`, `updatedAt`, `verification`, `externalLink`, `contact`, `erc8004`.

**A real example from BSC** — the tokenURI can be `data:application/json;base64,...` (inline, as seen on TermiX agent `340793`), or `ipfs://Qm...` (agent `49637`), or HTTPS.

A minimal inline registration (decoded from a live BSC agent) ✅:
```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Ave.ai Trading Agent",
  "description": "AI-driven multi-chain trading agent with on-chain reputation.",
  "image": "https://www.iconaves.com/logo/pro.ave.ai.png",
  "active": true,
  "supportedTrust": ["reputation"]
}
```

**Endpoint domain verification (optional):** host a `.well-known/agent-registration.json` file on the endpoint's domain containing matching registration info. 8004scan exposes it through `is_endpoint_verified` and `POST /api/v1/agents/verify-endpoint/{chain_id}/{token_id}` (once/hour).

### A.7.6 The end-to-end flow for registering a Fugugent agent

1. `register(agentURI)` on the BSC IdentityRegistry → get an `agentId`
2. Publish the registration file (IPFS/HTTPS), set it with `setAgentURI(agentId, uri)`
3. (Optional) `setAgentWallet(...)` with EIP-712/1271 proof
4. Collect feedback from clients through `giveFeedback(...)` on the ReputationRegistry
5. Aggregate trust: `getSummary(...)` on-chain, or pull it from the 8004scan API
6. Trigger `POST /api/v1/agents/{chain_id}/{token_id}/metadata-refresh` so 8004scan indexes it quickly

---

## A.8 Classifying agents into Fugugent's 4 categories

The target categories: **(1) rebalancing · (2) grid trading · (3) yield · (4) health factor**.

ERC-8004 has no canonical category field (the contents of `tags`/`categories` are whatever the publisher writes). The recommendation: **a 4-layer classification pipeline whose results we cache in our own DB.**

### Layer 1 — Semantic search as the candidate generator (the strongest) ✅

Proven to work on BSC:
```bash
GET /api/v1/agents/search/semantic
    ?q=<query>&chain_id=56&limit=100&semantic_weight=0.7&similarity_threshold=0.55
```

Queries per category (run several, merge the results, dedupe by `agent_id`):

| Category | Suggested queries |
|---|---|
| **Rebalancing** | `portfolio rebalancing agent`, `liquidity position rebalancing`, `auto rebalance LP range`, `concentrated liquidity manager` |
| **Grid trading** | `grid trading bot`, `automated grid strategy`, `range order trading bot`, `DCA grid strategy` |
| **Yield** | `yield farming optimizer`, `APY routing agent`, `auto-compounding vault`, `yield aggregator` |
| **Health factor** | `health factor monitor`, `liquidation protection agent`, `lending position guardian`, `collateral ratio alert` |

Live results proving the signal is strong ✅:
- `health factor liquidation` → **"LingoAI Health Factor Sentinel"** (sim 0.804), **"bnb-lending-guardian.agent"** (sim 0.803)
- `yield farming` → **"Yield-Farmer - Goo"** (sim 0.728)
- `grid trading bot` → **"tradingbot"**
- The filter `oasf_domain=technology/blockchain/defi&chain_id=56` → **"Sentinels Grid Trader"**, "Sentinels Health Guard", "Sentinels Security Scout"

Store the `similarity_score` as the initial confidence.

### Layer 2 — Pre-filters to narrow the population

Before (or alongside) the semantic search, cut 309k agents down to thousands:
```
GET /api/v1/agents?chain_id=56
    &is_registered=true          # drop placeholders and test domains
    &is_active=true              # only the ones the owner declares active
    &has_mcp=true                # or has_a2a=true — it must have a real endpoint
    &min_score=20                # a minimum v5 score
    &oasf_domain=technology/blockchain/defi
    &oasf_domain=finance/markets/crypto
    &oasf_domain=finance_and_business/investment_services
    &limit=100&offset=0
```

**The real OASF taxonomy on mainnet** ✅ (`GET /api/v1/stats/oasf/domains?is_testnet=false`) — the DeFi-relevant domains:

| Domain | Agent count |
|---|---|
| `technology/blockchain/cryptocurrency` | 5,530 |
| `finance/markets/crypto` | 4,940 |
| `finance/global_economics` | 3,546 |
| `technology/security/cybersecurity` | 1,872 |
| `technology/blockchain` | 752 |
| `finance_and_business/finance` | 469 |
| `trust_and_safety/risk_management` | 463 |
| `technology/blockchain/smart_contracts` | 448 |
| **`technology/blockchain/defi`** | **442** |
| `finance_and_business/investment_services` | 380 |
| `trust_and_safety/fraud_prevention` | 292 |

The relevant skills ✅ (`GET /api/v1/stats/oasf/skills?is_testnet=false`):

| Skill | Count |
|---|---|
| `analytical_skills/market_insights` | 4,940 |
| `analytical_skills/data_analysis/crypto_analysis` | 4,940 |
| `evaluation_monitoring/anomaly_detection` | 1,373 |
| `advanced_reasoning_planning/strategic_planning` | 810 |
| `security_privacy/threat_detection` | 1,586 |

> Note: everything has `is_standard: false` and `category_id: null` — this taxonomy is **de facto publisher-defined**, not an official OASF enum. Do not hardcode it; pull the list every 5 minutes (cached 300s) and match on prefixes.

### Layer 3 — Targeted keyword search

```
GET /api/v1/agents?chain_id=56&search=rebalanc&search_type=text
    &search_fields=name,description,tags,capabilities&limit=100
```
Keywords: `rebalanc`, `grid`, `yield`, `APY`, `APR`, `health factor`, `liquidation`, `collateral`, `LP`, `liquidity`, `vault`, `compound`, `pancakeswap`, `venus`, `aave`.
Also filter directly: `tags=defi,trading,yield` and `categories=...`.

### Layer 4 — LLM classification over `raw_metadata.offchain_content`

For each candidate, fetch the detail (`GET /api/v1/agents/56/{token_id}`) and feed the LLM:
- `raw_metadata.offchain_content.description`, `.skills`, `.capabilities`, `.categories`, `.tags`, `.agent_type`
- `services.mcp.tools[]` — **the MCP tool names are the strongest signal** (e.g. a `rebalancePosition`, `openGridOrder`, or `getHealthFactor` tool)
- `services.a2a.skills[]`

The output: `{category, confidence, evidence}`. Store it in the Fugugent DB and refresh it weekly, or when a webhook tells us something changed.

### Quality signals for ranking within a category

Once classified, sort using the fields 8004scan already provides:
| Signal | Field |
|---|---|
| Overall score | `total_score` (5–95), `scores.breakdown` (v5, 5 dimensions) |
| Liveness | `health_score`, `health_status.overall_status`, `health_checked_at` |
| Reputation | `average_score`, `total_feedbacks` (use `min_feedbacks=1`) |
| Publisher credibility | `owner_publisher_tier` (`OFFICIAL`/`VERIFIED`/`COMMUNITY`), `scores.wallet` |
| Endpoint authenticity | `is_endpoint_verified`, `endpoint_verified_domain` |
| Completeness | `scores.metadata_completeness`, `parse_status.status` |
| Traction | `star_count`, views (`/views`, `/views/history`) |
| Freshness | `scores.freshness`, `updated_at` |
| Payment model | `x402_supported` |

The v5 score weights (from the leaderboard documentation) ✅: Engagement 30% · Service 25% · Publisher 20% · Compliance 15% · Momentum 10%.

### Recommended Fugugent data architecture

```
8004scan API (X-API-Key)                      ERC-8004 on BSC (fallback)
   │                                                │
   ├─ cron sync (semantic + filtered list)          ├─ Registered / URIUpdated events
   ├─ webhook push (feedback/star/validation)       ├─ NewFeedback events
   ▼                                                ▼
        Fugugent Postgres  ──►  classifier (rules + LLM)  ──►  4 categories
                           ──►  cache TTL 60s for detail, 5m for the leaderboard
                           ▼
                     Fugugent Marketplace API/UI
```
Match our TTLs to the upstream cache: agent detail 60s, leaderboard 5 minutes, trending 1 minute, OASF stats 5 minutes, global stats 60s.

---

## A.9 ⚠️ Operational problems found during live testing (8 Sep 2026)

1. **A request without a browser User-Agent comes back `HTTP 500`.**
   ```
   curl "https://api.8004scan.io/api/v1/agents?limit=1"                    → 500
   curl -H "User-Agent: curl/8.0" ".../agents?limit=1"                     → 500
   curl -A "Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36" ".../agents"   → 200 ✅
   ```
   This is consistent with the `ANONYMOUS` tier ("a bot/script — no browser headers"), but it should be a 429, not a 500.
   **Mitigation:** always send a sensible `User-Agent` **and** an `X-API-Key`, from the backend.

2. **`500 {"success":false,"error":{"code":"DATABASE_ERROR"}}` is transient.**
   `has_mcp=true` failed once and then worked on retry. `tags=` and `search_type=text` also failed at times.
   **Mandatory mitigation:** retry with exponential backoff (3–5 attempts), a circuit breaker, and **always keep a local cache** so the UI is never empty.

3. **The response shape is not uniform** — `{items,...}` vs `{success,data}` vs `{success,error}`. Write a wrapper parser.

4. **The Validation Registry is empty** (0 validators, 0 validations across every mainnet). Trust features have to rest on reputation + health, not validation.

5. **The volume is large:** 309k agents on BSC, 3,197 new agents per day platform-wide. Many are placeholders/spam (`"Agent #340784"` with no description and `total_score: 0`). Using `is_registered=true`, `min_score`, `min_feedbacks`, or `has_mcp=true` is **mandatory**.

---

# PART B — TermiX

## B.1 The product and an important rebranding ⚠️

**`https://app.termix.ai/` now 301-redirects to `https://www.agent.family/`** ✅ (verified live on 8 Sep 2026). The product is still TermiX/AACP; its front-end brand has changed. The documentation stays at `docs.termix.ai`.

**Tagline:** *"The marketplace where AI agents hire agents."*

**AACP = the Agent Autonomous Commerce Protocol** — *"trustless economic infrastructure for autonomous AI agent commerce"*. The TermiX Platform is AACP's marketplace implementation.

It stands on:
- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** for agent identity and reputation
- **ERC-8183** for job escrow
- **USDC/USDT** settlement on BNB Chain & Base

> 🔑 **A strategic insight for Fugugent:** TermiX uses **exactly the same ERC-8004 IdentityRegistry** on BSC (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) — confirmed from a live `GET /api/v1/config/contracts`. That means **an agent we register in ERC-8004 on BSC automatically has the same identity on TermiX and is visible on 8004scan.** One registration → three surfaces. That is a very strong narrative point for the judges.

### URLs

| Resource | URL |
|---|---|
| The app | https://www.agent.family/ (formerly https://app.termix.ai/) |
| Docs | https://docs.termix.ai/ |
| Docs index (llms.txt) | https://docs.termix.ai/llms.txt |
| OpenAPI | https://docs.termix.ai/api-reference/openapi.json |
| **BSC MCP server** | **https://github.com/TermiX-official/bsc-mcp** |
| Agent Skills (AACP) | https://github.com/TermiX-official/termix-agent-skills |
| Whitepaper | https://github.com/TermiX-official/aacp-whitepaper |
| Testnet AACP frontend | https://aacp.termix.live |
| Testnet AACP backend | https://aacp-backend.termix.live |
| GitHub org | https://github.com/TermiX-official |
| X/Twitter | https://x.com/termix_ai |

## B.2 The hiring & pricing model

### One identity, roles decided per transaction

Every participant has an **Agent NFT** minted through the ERC-8004 Identity Registry. Identity is **not** split into "client" versus "provider" — the same agent can be the buyer on one order and the seller on another.

Two extra roles are **granted by the operator** (they appear in the `roles[]` array):
- **Evaluator** — sits on a 3-seat panel that votes on challenged deliveries; earns an evaluator fee
- **Arbitrator** — decides escalated disputes; earns an arbitrator fee

An empty `roles[]` is normal and does not stop you buying or selling.

### Two ways work starts

| Path | How it starts | Suited to |
|---|---|---|
| **Listing** | The provider publishes a fixed-price service. The buyer buys it directly, or opens a conversation and accepts a custom offer | Productised, repeatable services |
| **Request** | The buyer publishes a request (a "prepayment order") with a budget range. Providers find it and submit offers | Bespoke work, competitive quoting |
| **Bounty** | A brand funds a pool of identical reward slots; any qualifying provider can claim one, fulfil it with proof, and get paid (through `CampaignVault`, which locks the `providerBond`) | Mass campaigns |

### The order lifecycle

```
PENDING_ACCEPT → FUNDED / IN_PROGRESS → DELIVERED → SETTLED
                                            │
                                            ├─ redo (once) → IN_PROGRESS
                                            └─ challenge → IN_DISPUTE → SETTLED
```
Money moves **only** through the escrow contract, and the database state is projected from on-chain events by an indexer — not from the fact that we broadcast a transaction.

**The backend never holds keys and never broadcasts on our behalf.** Endpoints that change on-chain state return an **unsigned tx-intent**:
```json
{ "action": "submitDelivery", "chainId": 56, "contract": "0x…",
  "callData": "0x…", "value": "0", "status": "PREPARED", "nonceKey": "…" }
```

### Fees & settlement

| Parameter | Applies to | Read from |
|---|---|---|
| `protocolFeeBps` | The protocol's share of a settled amount | `GET /api/v1/config/contracts`, per currency |
| `campaignProtocolFeeBps` | The protocol's share of a bounty reward | `GET /api/v1/config/contracts` |
| `evaluatorFeeBps` | The evaluator panel (disputed orders only) | The escrow contract → `evaluatorFeeAmount` |
| `arbitratorFeeBps` | The arbitrator (only on escalation) | The escrow contract → `arbitratorFeeAmount` |
| `challengeBondAmount` | Posted by whoever opens a challenge | The escrow contract |

**The live values on BSC (8 Sep 2026)** ✅: `protocolFeeBps: 200` and `campaignProtocolFeeBps: 200` → **2%**. The site markets this as "1–3%" versus "~20%" on conventional platforms.

**Settlement with no dispute:** the provider gets `budget − protocol fee`; the protocol fee recipient gets `budget × protocolFeeBps / 10_000`. The provider's locked stake is released, and the result is recorded to reputation as a success. `claimAfterTimeout` pays out identically to an explicit accept.

**Settlement with a dispute:**
```
budget
  ├─ protocol fee   budget × protocolFeeBps
  ├─ evaluator fee  budget × evaluatorFeeBps   (split evenly across 3 seats, the dust to the first seat)
  ├─ arbitrator fee budget × arbitratorFeeBps  (only on escalation)
  └─ the remainder ──────► the winning party
```
If the provider loses, its locked stake is slashed to the buyer. The challenge bond goes to the winning party.

**Cancellation:** `cancelPending` (the buyer, before the provider accepts) → a full refund. `cancelExpired` (anyone, once `deliveryDueAt` passes with no delivery) → a full refund, **with no protocol fee**.

**Nothing is left hanging** — every path has a permissionless exit: `claimAfterTimeout`, `cancelExpired`, `finalizeAfterTimeout`, `reclaimExpired`. *"There is no auto-settle worker anywhere in the system."*

### Staking

Stake is per agent, per currency, in the `TermixStaking` contract. Three balances: `available`, `locked`, `slashed`.

**Threshold ≠ Lock** (the most common integration mistake):
- **A threshold** = the minimum total stake needed to qualify; it locks nothing. Its sources: a request's `minStake`, an order's `desiredStake`, a listing's `bondAmount`, a bounty's `providerBond`
- **A lock** = moved from available to locked when work is taken on; `providerLockBps × budget` for an order, and the **full `providerBond`** for a bounty slot

Live on BSC ✅: `providerLockBps: 0` for both USDC and USDT → **ordinary orders lock no stake**; a buyer's stake number is purely a qualification threshold.

Gate errors: `STAKE_GATE_NOT_MET`, `STAKE_FREE_INSUFFICIENT` (HTTP 403 with a message giving the exact shortfall).

**Slashing** happens when: an order dispute is lost (→ to the buyer), a bounty slot dispute is lost / `maxSubmitSeconds` passes / a rejection goes unchallenged / a claim is removed as abandoned (→ to the brand). Slashing is capped at the amount actually locked for that order/slot. **A provider who is merely late delivering is not slashed** — `cancelExpired` refunds in full with no fee; the cost is the lost payment plus a reputation hit.

### Reputation (the `TermixReputation` contract)

A score from **1–100**, not self-reported and not editable. Only authorised recorders (the escrow and the bounty vault) may write it, at settlement.

Four numbers per agent: `completedOrders`, `successfulOrders`, `disputedOrders`, `lastUpdatedAt`.
The writer functions: `recordOrderResult(agentId, success, disputed)` and `recordChallengeResult(agentId, providerUpheld)`.

**The formula** (a success rate with a Bayesian prior, minus the dispute rate):
```
total        = completedOrders + priorTotal
successScore = (successfulOrders + priorSuccess) × 100 / total
disputeRate  = disputedOrders × 100 / total
score        = successScore − disputeRate      (floor of 1)
```
The default prior: 5 virtual orders, 3 successful → a new agent starts at **60**.

| Completed orders (all successful, no disputes) | Score |
|---|---|
| 0 | 60 |
| 5 | 80 |
| 20 | 92 |
| 50 | 96 |

The display convention: ≥80 is high, 50–79 medium, <50 low.
Read it from: `GET /api/v1/explorer/agents` (`reputationScore`, `completedJobs`, `passRate`, `stake`) · `GET /api/v1/agents/:handle` · `GET /api/v1/explorer/leaderboard` (window `24h|7d|30d|all`) · on-chain `TermixReputation.getScore(agentId)`.

Reputation is **portable** (it lives in the contract, not the platform's DB) but **per chain** — an agent on BNB Chain and one on Base are separate identities.

### Service categories in the marketplace
Code & Smart Contracts (audits, integrations, scripts) · Security & Verification (reviews, threat models, exploit analysis) · Data & Research (labelling, extraction, analysis, datasets) · Design & Brand · Market & Protocol Research · AI Automation.
(The last two categories were seen in live `GET /api/v1/listings` data.)

## B.3 TermiX networks & contracts ✅

| | BNB Chain (default) | Base |
|---|---|---|
| Chain ID | `56` | `8453` |
| API base | `https://platform-backend.prod.termix.live` | `https://platform-backend-base.prod.termix.live` |
| RPC | `https://bsc-rpc.publicnode.com` | `https://base-rpc.publicnode.com` |
| Explorer | `https://bscscan.com` | `https://basescan.org` |
| Gas token | BNB | ETH |
| Settlement | USDC, USDT | USDC, USDT |

> ⚠️ Each chain is a separate world: its own accounts, agents, listings, orders, stake, and settlement. A `404` on an ID you are sure is right usually means the wrong chain's base URL.

**The live BSC contract addresses** — the result of `GET https://platform-backend.prod.termix.live/api/v1/config/contracts` ✅ (8 Sep 2026):

| Contract | Address |
|---|---|
| IdentityRegistry / agentNft | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` *(= the canonical ERC-8004 one)* |
| TermixReputation | `0xFf3f7038c4919A420B30D7B3533cb386D5898189` |
| **USDC** (token) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (18 decimals) |
| USDC — TermixEscrow | `0x6A52ba4C84b348FaEAe13dDC7A97b4F6af23913C` |
| USDC — TermixStaking | `0x0Bd066f5113e6B8336b06F8Aa3EF90D37F7e65FC` |
| USDC — CampaignVault | `0x5BaE7834B32a4b357F65dd20248068993466D294` |
| **USDT** (token) | `0x55d398326f99059fF775485246999027B3197955` (18 decimals) |
| USDT — TermixEscrow | `0xCE02f987D8b8AF694E13C8a843Db9c77caBF544c` |
| USDT — TermixStaking | `0x1DcafFB7275fa2650d480a4F939A0C0D5874750B` |
| USDT — CampaignVault | `0x16261F2BCbE8Ee47065C5ecB4be32c1571289809` |

> 📌 **Do not hardcode these.** The documentation is firm: fetch `/api/v1/config/contracts` at startup and cache it per session. Each settlement currency has its own set of contracts. `settlementCurrency` (singular) is a legacy USDC-only field — do not use it for USDT flows.

## B.4 The TermiX REST API

Base: `https://platform-backend.prod.termix.live`, everything prefixed with `/api/v1/`.

**Authentication:**
| Mode | Header | Scope |
|---|---|---|
| None | — | Public reads: config, stats, explorer, listings, bounties, request discovery |
| Session JWT | `Authorization: Bearer <accessToken>` | Everything the wallet owner does |
| API key | `Authorization: Bearer <apiKey>` | M2M, scopes `acn:rpc` / `a2a:rpc` |
| A2A runtime token | `Authorization: Bearer <runtimeToken>` | One agent's inbox and replies |

```bash
curl -X POST "$AACP_API/api/v1/auth/nonce" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0xYourAddress"}'
```

**Conventions:** money = a decimal display string (`"15"`, `"33.5"`), scaled using `settlementCurrencies[].decimals` · timestamps are ISO-8601 UTC · IDs are database cuids (some endpoints also accept the on-chain `agentTokenId`) · paging is `page` + `pageSize` (max 100) → `{items, page, pageSize, total, totalPages}` · the **schema is strict**: an unknown field → HTTP 400.

**Endpoint groups** (docs: https://docs.termix.ai/api-reference/overview):
`/config` · `/agents` (mint, storefront, explorer, stake, A2A) · `/listings` · `/requests` · `/offers` (quotes, revisions, acceptance, funding) · `/orders` · `/disputes` · `/bounties` · `/explorer` + `/metrics` (stats, leaderboard, dashboard) · `/realtime` (SSE)

**Tested live** ✅:
- `GET /api/v1/config/contracts` → 200, the full config
- `GET /api/v1/listings?pageSize=2` → 200, real listings with `title`, `category`, `skillTag`, `tags[]`, `description`
- `GET /api/v1/explorer/agents?pageSize=2` → 200; the items contain `completedJobs`, `stake`, `reputationScore`, `passRate`, `onTimeRate`, and a nested `agent{agentTokenId, name, description, tokenUri, a2aEndpoint, a2aStatus, presence, verified, topRated, pro, metrics{...}}`
- `GET /api/v1/metrics/network` → **401 UNAUTHORIZED** (needs auth)
- `GET /api/v1/explorer/leaderboard?window=7d&pageSize=2` → **400** `Unrecognized key(s) in object: 'pageSize'` (proof of the strict schema — use `page`/the correct param names per the docs)

The stake endpoints: `POST /api/v1/agents/:id/stake/deposit-intent` (approveStake then depositStake) · `POST /api/v1/agents/:id/stake/withdraw-intent` · `GET /api/v1/metrics/provider/treasury`.

## B.5 TermiX's open-source BSC MCP server ⭐

**Repo:** https://github.com/TermiX-official/bsc-mcp (public, MIT, the `TermiX-official` org) ✅

**⚠️ The npm package name ≠ the repo name.** The repo is `bsc-mcp`, but `package.json` declares:
```json
{ "name": "bnbchain-mcp", "version": "1.0.12", "bin": { "bnbchain-mcp": "build/index.js" } }
```
The MCP server name exposed to clients is `"bsc-mcp"` (from `src/main.ts`).

### Install & configuration ✅

```bash
# 1. Install globally
npm install -g bnbchain-mcp

# 2. The setup wizard
bnbchain-mcp --init
```
The wizard asks for:
- **A BSC Wallet Private Key** (required)
- **A Wallet Password** (required, at least 6 characters) — the private key is stored encrypted with **AES-256 + bcrypt**
- **A custom RPC URL** (optional, defaults to `https://bsc-dataseed.binance.org`)

After setup, the tool **auto-configures Claude Desktop** by modifying:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Manual configuration (Claude Desktop / Claude Code / Cursor — the standard MCP form):
```json
{
  "mcpServers": {
    "bsc-mcp": {
      "command": "bnbchain-mcp"
    }
  }
}
```
> ⚠️ The repo does not document this exact JSON block; the form above is derived from the `bin` entry in `package.json` plus the `StdioServerTransport` in `src/main.ts`. Mark it `UNVERIFIED` until tested. A guaranteed alternative: `"command": "node", "args": ["<path>/build/index.js"]`.

CLI flags: `--init`/`-i`, `--help`/`-h`, `--version`/`-v`.
Dev: `npm run build` (tsc) · `npm start` / `node build/index.js`.

### The tools actually registered (from `src/main.ts`) ✅

| Tool | Function |
|---|---|
| `transferNativeToken` | Send BNB |
| `transferBEP20Token` | Transfer a BEP-20 by symbol/address |
| **`pancakeSwap`** | **Swap tokens through PancakeSwap** |
| `getWalletInfo` | Wallet info |
| `getBalance` | Native + token balances *(mentioned in the README)* |
| `buyMemeToken` | Buy a Four.Meme token |
| `sellMemeToken` | Sell a Four.Meme token |
| **`pancakeAddLiquidity`** | **Add PancakeSwap liquidity** |
| **`pancakeMyPosition`** | **View liquidity positions** |
| **`pancakeRemovePosition`** | **Withdraw liquidity** |
| `goplusSecurityCheck` | Check a BSC token's safety through GoPlus |
| `queryMemeTokenDetails` | Four.Meme token detail |

> ⚠️ The README also mentions `createBEP20Token`, `createFourMeme`, and `callContractFunction`, but **none of the three is registered in `src/main.ts`** on the `main` branch as inspected. Treat the README as more ambitious than the code. `UNVERIFIED`.

### The technical stack ✅ (from `package.json`)
- `viem ^2.23.11`
- **`@pancakeswap/sdk ^5.8.8`**, **`@pancakeswap/v3-sdk ^3.9.0`**, **`@pancakeswap/smart-router 6.1.6`**, **`@pancakeswap/tokens ^0.6.24`**
- `@modelcontextprotocol/sdk ^1.4.0`
- `@goplus/sdk-node ^1.0.12`, `moralis ^2.27.2`, `graphql-request ^7.1.2`
- `bcrypt ^5.1.1`, `dotenv`, `chalk`, `figlet`, `ora`, `prompts`, `fs-extra`
- Network: BNB Smart Chain Mainnet (chain ID 56), default RPC `https://bsc-dataseed.binance.org`

The contract addresses hardcoded in `src/addressConfig.ts` ✅ (Four.Meme only — PancakeSwap is reached through the SDK):
```ts
FourMemeTryBuyContract:        0xF251F83e40a78868FcfA3FA4599Dad6494E46034
FourMemeBuyTokenAMAPContract:  0x5c952063c7fc8610FFDB798152D69F0B9550762b
FourMemeSellTokenAMAPContract: 0x5c952063c7fc8610FFDB798152D69F0B9550762b
FourMemeCreateTokenContract:   0x5c952063c7fc8610FFDB798152D69F0B9550762b
```

> ⚠️ **A security warning for Fugugent:** this MCP stores a **raw private key** (encrypted locally) and executes transactions directly. That contradicts the "we never hold user funds" principle (see Part C). **Recommendation: use bsc-mcp only for (a) dev/testing with a burner wallet, and (b) running the Agent Advantage Report baseline experiments.** For the product, use a session-key/delegation pattern.

### The TermiX AACP skills (separate from the MCP)

Repo: https://github.com/TermiX-official/termix-agent-skills ✅ (MIT)

```
/plugin marketplace add TermiX-official/termix-agent-skills
/plugin install termix-agent-skills@termix-agent-skills
```
or `npx skills add TermiX-official/termix-agent-skills [-g]`, or `help me install http://termix.ai/skills`.

Env: `AACP_CHAIN` (`bsc` by default / `base`) · `WALLET_KEY` · `AACP_BASE_URL` · `A2A_RPC_URL` · `OPENROUTER_API_KEY`/`OPENAI_API_KEY` · `A2A_LLM_MODEL` (default `openai/gpt-4o-mini`).
Requires Node.js 18+; the `.mjs` scripts are dependency-free (they use the built-in `fetch`, no viem/ethers).
Verify the install: `node <skill-dir>/scripts/aacp-config.mjs`.

> ⚠️ The skills repo's README mentions the base URL `https://aacp-backend.termix.live` and the **BSC Testnet** chain, whereas the official docs give production as `https://platform-backend.prod.termix.live` on BSC mainnet. The repo README appears to be out of date. Treat `docs.termix.ai` as the source of truth.

## B.6 The TermiX judging criteria & the Agent Advantage Report design

**Prizes:** $6,000 (1st) / $3,000 (2nd) / $1,000 (3rd).

| Criterion | Weight | What is judged |
|---|---|---|
| **Value of the services** | **30%** | The agent beats the alternative on price/speed |
| **Proven agent advantage** | **30%** | Measured results, backed by the mandatory *Agent Advantage Report* |
| **High-stakes categories & track record** | **20%** | Trading/security are weighted higher |
| **Marketplace quality** | **20%** | Discoverability & usability |

**Mandatory Agent Advantage Report requirements:**
- At least **3 real tasks** run **twice** — with the agent and without it
- Metrics for **time, cost, and output quality**, with **the real outputs attached**
- At least **1 task** from the **trading / stock / security** categories

---

### B.6.1 Designing a convincing experiment

#### Methodology principles

1. **A paired design, not a separate A/B.** The **same** task with the **same** inputs, run twice. The only difference between conditions is the tooling. This removes task variation as a confounder.
2. **Pre-register.** Write the tasks, the metrics, and the "success" criteria **before** running anything. Save it as a file with a dated git commit — proof to the judges that the metrics were not picked after seeing the results.
3. **An honest baseline.** The "without an agent" condition has to be **a competent human with standard tools** (BscScan, the PancakeSwap UI, DefiLlama, a spreadsheet, a calculator) — **not** a straw man. Judges will spot a deliberately weakened baseline, and it destroys every claim.
4. **Repeat ≥3 times per condition** and report the **median + range**, not just one number. For trading, repeat far more (see B.6.4).
5. **Be as deterministic as possible.** Pin the block height for on-chain reads, record timestamps, pin the model version and seed, and keep the raw responses.
6. **Grade quality blind.** Anonymise the outputs from both conditions, shuffle the order, and have 2+ independent raters score them against a written rubric. Report the **inter-rater agreement** (Cohen's κ or a simple correlation).
7. **Report what failed.** If a task shows no advantage for the agent, **write it up as it is** and explain when the agent is the wrong tool. Credibility goes up, and the judges are definitely looking for signs of cherry-picking.

#### Core metrics (all tasks)

| Dimension | Metric | How to measure it |
|---|---|---|
| **Time** | Wall-clock time to the first useful output; time to complete; the number of manual steps | A stopwatch + a screen recording; record it per step |
| **Cost** | LLM token cost (USD, `input_tokens × price + output_tokens × price`); on-chain gas (BNB → USD, from the tx receipt); human time × a rate ($50/hour, state the assumption) | Token logs from the API; `gasUsed × effectiveGasPrice` |
| **Quality** | A 0–5 rubric score per dimension; correctness (facts right or wrong, verified on-chain); completeness (the required items covered); actionability | Blind grading by 2 raters |
| **Reliability** | The success rate across attempts; the number of errors/retries; the number of hallucinations (claims not verifiable on-chain) | Counted from the logs |

Present it as one table per task:

| Task | Condition | Time (median) | LLM cost | Gas | Human time | Quality (0–5) | Success rate | Artefacts |
|---|---|---|---|---|---|---|---|---|
| T1 | Without an agent | 42m | $0 | $0.41 | 42m ≈ $35.00 | 3.5 | 3/3 | `artifacts/T1-baseline/` |
| T1 | With an agent | 4m10s | $0.18 | $0.39 | 1m ≈ $0.83 | 4.2 | 3/3 | `artifacts/T1-agent/` |

Include the **delta and the ratio**: "9.9× faster, 96% cheaper in human cost, +0.7 quality points".

#### The report repo structure

```
agent-advantage-report/
├── README.md                  # executive summary + the results table
├── methodology.md             # pre-registration, the rubric, cost assumptions
├── tasks/
│   ├── T1-lp-rebalance/
│   │   ├── task.md            # the identical prompt/instructions for both conditions
│   │   ├── baseline/          # screen recording, notes, raw output
│   │   ├── agent/             # transcript, tool calls, raw output
│   │   └── results.json       # structured metrics
│   ├── T2-health-factor/
│   ├── T3-token-security/
│   └── T4-yield-routing/
├── grading/
│   ├── rubric.md
│   ├── rater-A.csv
│   └── rater-B.csv
└── evidence/
    ├── tx-hashes.md           # every BscScan tx
    └── agent-ids.md           # the ERC-8004 agentIds + TermiX orders
```

---

### B.6.2 The four recommended tasks

All of them use the stack we are building, and **T3 satisfies the "at least 1 trading/stock/security task" requirement** (in fact T1 and T3 both do).

#### **T1 — Rebalancing a PancakeSwap v3 LP position** *(category: trading — high stakes)*

*The task:* "Given a CAKE/BNB v3 position with a range [tickLower, tickUpper] that has gone out of range, determine the optimal new range for a 7-day horizon, compute the unclaimed fees, estimate the rebalance gas, and decide whether rebalancing is profitable after costs. Produce an execution plan."

- **Baseline:** open the PancakeSwap UI, read the position by hand, copy it into a spreadsheet, compute the fee APR from pool data, estimate gas through BscScan, decide.
- **Agent:** the Fugugent rebalancing agent + `pancakeMyPosition` (bsc-mcp) + subgraph data.
- **Extra metrics:** the accuracy of the break-even threshold (compare against a separately computed ground-truth calculation), and whether the proposed range actually contained the price over the following 7 days (a backtest).

#### **T2 — Health factor monitoring & remediation** *(category: risk)*

*The task:* "For wallet X with a borrow position on a BSC lending protocol, compute the current health factor, the liquidation price per collateral asset, the exact amount that must be repaid to reach HF 1.8, and the cost of doing so. Produce an actionable notification."

- **Baseline:** the protocol UI + a manual calculator + a price oracle.
- **Agent:** the Fugugent health-factor agent.
- **Extra metrics:** accuracy (compare the computed HF against the on-chain reading), and detection time when the price moves (simulate it with historical price scenarios).

#### **T3 — A token security audit before trading** *(category: security — high stakes)* ⭐ required

*The task:* "Given 10 BEP-20 token addresses (a mix: safe, honeypot, high-tax, upgradeable proxy, unverified), classify each token as SAFE / CAUTION / AVOID with written reasoning and on-chain evidence."

- **Baseline:** BscScan by hand + reading the code + checking holders.
- **Agent:** `goplusSecurityCheck` (bsc-mcp) + our analysis agent.
- **Extra metrics:** this one has **ground truth** — precision/recall/F1 against known labels. **The confusion matrix is the strongest evidence we can show the judges.** Emphasise the false negatives (a dangerous token labelled SAFE), because that is a real loss.

#### **T4 — Cross-pool yield routing research** *(category: yield)*

*The task:* "Find the best allocation for $10,000 of stablecoins across BSC pools over a 30-day horizon, subject to: a minimum TVL of $1M, no unaudited tokens, computing the net APR after gas and an estimate of impermanent loss. Rank the top 5 with reasoning."

- **Baseline:** DefiLlama + the PancakeSwap UI + a spreadsheet.
- **Agent:** the Fugugent yield-routing agent.
- **Extra metrics:** the realized APR after 7 days versus the predicted APR (absolute error).

---

### B.6.3 The quality rubric (0–5 per dimension)

| Dimension | 0 | 3 | 5 |
|---|---|---|---|
| **Correctness** | There is a material factual error | Mostly correct, minor errors | Every number matches on-chain ground truth |
| **Completeness** | Misses more than half the required items | Covers the core items | Every required item + the relevant risks |
| **Actionability** | No concrete steps | A general recommendation | Exact txs/parameters, ready to execute |
| **Evidence** | No sources | Partly cited | Every claim carries a tx hash / contract address / URL |
| **Risk awareness** | Never mentions the downside | Mentions the main risks | Quantifies the downside + gives abort conditions |

The final score = the average. Report it per rater plus their agreement.

---

### B.6.4 Measuring win rate & risk for a trading agent

This is the part other participants most often do carelessly. If we do it properly, it is our main differentiator.

**The basic rule: never report a win rate without the payoff distribution.** A 90% win rate with an average loss 10× the average win is a losing strategy. Always report them as a pair.

#### The minimum metrics you must report

| Metric | Formula | Why it matters |
|---|---|---|
| **Win rate** | `#winning trades / #total trades` | Necessary, but nowhere near sufficient |
| **Profit factor** | `Σ gross profit / \|Σ gross loss\|` | >1 = profitable; >1.5 is respectable |
| **Expectancy per trade** | `(WR × avgWin) − ((1−WR) × avgLoss)` | The real expected value per trade |
| **Payoff ratio** | `avgWin / avgLoss` | The mandatory partner to the win rate |
| **Max drawdown** | `max(peak − trough) / peak` on the equity curve | The risk that is actually felt |
| **Sharpe (annualized)** | `(mean(r) − r_f) / std(r) × √periods` | Return per unit of volatility |
| **Sortino** | Like Sharpe but using downside deviation only | Does not punish upside volatility |
| **Calmar** | `annualized return / max drawdown` | Return per unit of worst-case pain |
| **Turnover & fee drag** | total volume / equity; total fees+gas as a % of PnL | HFT-style strategies often lose here |
| **Realized slippage** | `(execution price − quoted price) / quoted price` | Proof the results are achievable in the real world |

#### Methodology controls specific to trading

- **Out-of-sample / walk-forward.** Split the period: in-sample for parameter tuning, out-of-sample for reporting. Report **only the out-of-sample numbers**. State the dates.
- **Include the costs.** PancakeSwap swap fees (0.01%/0.05%/0.25%/1% depending on the tier), BNB gas, and slippage. A backtest with no costs will not be believed.
- **Avoid lookahead bias.** Every decision at time *t* may only use data available at *t*. If you use subgraph data, pin the block and do not use the current day's `poolDayData`.
- **Avoid survivorship bias.** Include pools/tokens that died during the test period.
- **Sample size.** A win rate from 12 trades is meaningless. Aim for **≥100 trades** in a backtest, or if that is impossible, report a **confidence interval**: `WR ± 1.96 × √(WR(1−WR)/n)`. Say plainly when n is small.
- **A clear benchmark.** Compare against (a) buy & hold of the underlying asset, (b) a passive full-range LP, and (c) the human baseline. "Beat buy & hold by X%" means far more than "made X% profit".
- **Paper-trade in parallel.** Run the agent live on testnet/paper for the whole hackathon period, recording every decision with a timestamp. A running track record (the 20% criterion) carries a lot of weight with the judges.

#### How to present it to the judges

For the trading task (T1), show:
1. **An equity curve** for the agent versus the baseline versus buy & hold, in one chart
2. **A table of the metrics** above, side by side
3. **A histogram of the per-trade PnL distribution** — it shows the shape of the payoff, not just the average
4. **A trade log** (CSV) with tx hashes, so every row can be verified on BscScan
5. One paragraph on **"when this strategy fails"** — the market conditions that make it lose money

#### Meeting the "track record" criterion (20%)

- Register the Fugugent agents on **ERC-8004 BSC** → get an `agentId` and an on-chain history from day one
- Run real orders on **TermiX AACP** → `completedOrders`/`successfulOrders` in `TermixReputation` go up → `reputationScore` rises from 60
- Collect **ERC-8004 feedback** (`giveFeedback`) from beta users → it appears on 8004scan as `total_feedbacks` + `average_score`
- All of this is **publicly verifiable** by the judges through 8004scan and BscScan — far stronger than a screenshot

#### Meeting "marketplace quality" (20%)
Discoverability: search + filters for the 4 categories + ranking based on the 8004scan v5 score · trust badges (health, endpoint verified, publisher tier) · clear onboarding · agent profiles that show on-chain evidence (tx hashes, feedback, scores) · low latency through a local cache.

---

<!-- PANCAKESWAP_SECTION -->
