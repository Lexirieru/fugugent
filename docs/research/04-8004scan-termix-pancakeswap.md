# Riset Sponsor Hackathon BNB Chain — 8004scan (AltLayer), TermiX, PancakeSwap

> Konteks: **Fugugent** — agent marketplace di BNB Chain (chain 56).
> Tanggal riset: **8 September 2026**. Semua endpoint di bawah diuji live pada tanggal tersebut kecuali ditandai `UNVERIFIED`.
> Hackathon: [BNB Chain — "The Smart Money Era / Build the Era"](https://www.bnbchain.org/en/hackathons/smart-money-era?tab=prizes)

**Legenda tanda:**
- ✅ = diverifikasi live (HTTP call / file sumber dibaca langsung)
- 📄 = dari dokumentasi resmi (belum diuji runtime)
- ⚠️ `UNVERIFIED` = belum terkonfirmasi, jangan dipakai tanpa cek ulang

---

# BAGIAN A — 8004scan (AltLayer) & ERC-8004

## A.1 Ringkasan & kesimpulan

**8004scan bisa jadi sumber data utama marketplace Fugugent.** Alasannya:

1. Ada REST API publik yang matang dengan **OpenAPI 3.1 spec lengkap (150 endpoint)** — bukan sekadar situs explorer.
2. Data BSC-nya sangat besar: **309.444 agent di chain 56** (verified live, `GET /api/v1/agents?chain_id=56&limit=1` → `total: 309444`).
3. Sudah menyediakan **semua dimensi yang kita butuhkan**: identity, capability (MCP/A2A/OASF), ownership, reputation/score, feedback, health-check, activity, semantic search, dan webhooks realtime.
4. Ada **semantic search endpoint** yang langsung memecahkan masalah klasifikasi 4 kategori kita (rebalancing / grid / yield / health factor) tanpa perlu bangun indexer sendiri.

**Risiko yang harus di-mitigasi** (lihat §A.9): API kadang balas `500 DATABASE_ERROR` transien, dan request tanpa User-Agent browser ditolak.

**URL kunci:**
| Resource | URL |
|---|---|
| Situs | https://8004scan.io/ |
| Agent BSC | https://8004scan.io/agents?chain=56 |
| Builder Hub (Developer Hub) | https://8004scan.io/developers |
| API Explorer (Scalar UI) | https://8004scan.io/developers/docs |
| **OpenAPI spec (raw JSON)** | https://api.8004scan.io/openapi.json ✅ |
| OpenAPI mirror | https://8004scan.io/api/v1/public/docs/openapi.json ✅ |
| Best practices | https://best-practices.8004scan.io/ |
| Testnet instance | https://testnet.8004scan.io |
| Issue tracker | https://github.com/alt-research/8004scan-issue-tracker |
| Docs AltLayer | https://docs.altlayer.io/altlayer-documentation/8004-scan/overview |
| Skills untuk Claude Code | https://github.com/jiayaoqijia/8004 |

---

## A.2 Base URL & Autentikasi

### Base URL

```
https://api.8004scan.io/api/v1
```
✅ Dikonfirmasi resmi di Builder Hub: *"Official API base URL: https://api.8004scan.io/api/v1"*.

Host `https://8004scan.io/api/v1` juga melayani request yang sama (proxy) — tetap pakai `api.8004scan.io` sesuai dokumentasi.

Info spec: `title: "8004scan Backend API"`, `version: 0.4.367`, `openapi: 3.1.0`.

### Header autentikasi

Tiga skema (dari `components.securitySchemes` di OpenAPI) ✅:

| Skema | Tipe | Header | Kegunaan |
|---|---|---|---|
| `XApiKey` | apiKey (header) | **`X-API-Key: <key>`** | **Ini yang kita pakai.** Akses programatik + rate limit lebih tinggi |
| `XAccessToken` | apiKey (header) | `X-Access-Token: <JWT>` | JWT dari login wallet (rekomendasi 8004scan untuk user session) |
| `BearerAuth` | http bearer | `Authorization: Bearer <JWT>` | JWT standar |

**Endpoint publik read-only (agents, feedbacks, stats, chains, leaderboard) tidak wajib auth** — tapi tanpa API key kena tier `public`/`anonymous` yang jauh lebih kecil.

Contoh dari Builder Hub ✅:
```bash
# tanpa auth
curl https://api.8004scan.io/api/v1/agents

# semantic search
curl "https://api.8004scan.io/api/v1/agents/search/semantic?q=code+review"

# dengan API key
curl -H "X-API-Key: YOUR_API_KEY" https://api.8004scan.io/api/v1/agents/8453/123
```

> ⚠️ **Peringatan resmi 8004scan:** *"Keep API keys in trusted backends or CLI tools. Browser apps should call their own server and must not expose keys in client code."*
> Untuk Fugugent: taruh key di backend/indexer, jangan di frontend Next.js client-side.

### Alur JWT (kalau butuh aksi user, mis. star agent)

1. `POST /api/v1/auth/nonce` → dapat nonce
2. Sign message dengan wallet (SIWE-style)
3. `POST /api/v1/auth/login` → dapat `access_token` + `refresh_token`
4. `POST /api/v1/auth/refresh` untuk perpanjang
5. Halaman bantu: https://8004scan.io/test/login (login MetaMask, copy token)

---

## A.3 Rate limit — tier & angka sebenarnya

### Tabel resmi dari Builder Hub (https://8004scan.io/developers) ✅

| Tier | Requests/Min | Daily Limit |
|---|---|---|
| Anonymous | 30 | 1.000 |
| **Free API** | **600** | **100.000** |
| Basic *(contact us)* | 900 | 300.000 |
| **Pro** *(contact us)* | **3.000** | **3.000.000** |
| Enterprise *(contact us)* | 10.000 | Unlimited |

### ⚠️ Perbedaan dengan brief hackathon

Halaman hackathon BNB Chain menyebut Pro-tier gratis untuk peserta = **500 req/menit, 100.000 req/hari**.
Angka itu **tidak cocok** dengan tabel Builder Hub (Pro = 3.000/min, 3jt/hari; yang 100k/hari itu tier **Free API**).

**Interpretasi paling aman:** anggap kuota efektif hackathon ≈ **500 req/min & 100k req/hari**, desain sistem di bawah angka itu. Kalau ternyata dapat 3.000/min, itu bonus. Jangan bangun arsitektur yang butuh >100k call/hari.

### Enum tier internal (dari OpenAPI `APITier`) ✅

```
anonymous | public | session | free_api | basic | pro | enterprise | admin
```
Prioritas resolusi tier (dokumentasi internal spec):
1. `admin` (tanpa rate limit)
2. API key: `enterprise` > `pro` > `basic` > `free_api`
3. `session` (JWT + browser)
4. `public` (tanpa auth + header browser)
5. `anonymous` (bot/script — tanpa header browser)

### Header rate limit

Dokumentasi menyebut 5 header: `X-RateLimit-Tier`, `X-RateLimit-Limit-Minute`, `X-RateLimit-Remaining-Minute`, `X-RateLimit-Limit-Day`, `X-RateLimit-Remaining-Day`.

Yang **benar-benar terlihat** saat uji live tanpa API key ✅:
```
x-ratelimit-limit-day: 20000
x-ratelimit-limit-minute: 180
x-ratelimit-remaining-day: 19989
x-ratelimit-remaining-minute: 177
```
(180/min & 20.000/hari = tier `public`; `X-RateLimit-Tier` tidak muncul di respons yang diuji.)

### Rate limit khusus per-endpoint (dari OpenAPI) ✅
- `POST /agents/{chain_id}/{token_id}/views` — 10 view/menit, 100/jam, 500/hari per IP
- `POST /agents/verify-endpoint/...` — 1x per jam per agent
- `POST /ipfs/upload` — 20 request/jam per user
- `POST /storage/upload` — 10/jam, 30/hari, 50MB/hari per user

### Jumlah API key per tier ✅
Free: max 2 · Basic: max 5 · Pro: max 10 · Enterprise: unlimited.

---

## A.4 Cara daftar API key + Pro-Tier Upgrade Form

**Langkah:**

1. Buka **https://8004scan.io/developers** (Builder Hub).
2. Login dengan wallet (MetaMask). Alur: `POST /api/v1/auth/nonce` → sign → `POST /api/v1/auth/login`. Bisa juga lewat halaman https://8004scan.io/test/login.
3. Buat key: `POST /api/v1/api-keys` (butuh `X-Access-Token` / `Authorization: Bearer`).

   Body (`APIKeyCreate`) ✅:
   ```json
   {
     "name": "fugugent-indexer",
     "scopes": ["read:agents"],
     "expires_in_days": 90
   }
   ```
   Field `tier` **deprecated & diabaikan** — tier diturunkan dari subscription user.
   Scope yang disebut spec: `read:agents`, `write:agents`, `read:validations`, `write:validations` (spec bilang "for future use").

   > ⚠️ **Key hanya ditampilkan sekali.** Simpan segera. Bisa di-reveal ulang lewat `POST /api/v1/api-keys/{key_id}/reveal` (rate-limited).

4. **Submit Pro-Tier Upgrade Form (khusus peserta hackathon):**
   **https://forms.gle/jQevEPCAacBXaKG79**
   (link resmi dari halaman prizes hackathon BNB Chain). Isi detail API key yang barusan dibuat.

**Endpoint manajemen key** ✅:
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/v1/api-keys` | Buat key |
| GET | `/api/v1/api-keys?include_inactive=false` | List key |
| GET | `/api/v1/api-keys/{key_id}` | Detail key |
| POST | `/api/v1/api-keys/{key_id}/reveal` | Tampilkan key |
| GET | `/api/v1/api-keys/{key_id}/usage?days=7` | Statistik pemakaian (max 30 hari) — total request, breakdown harian, current rate limits, top endpoints |
| DELETE | `/api/v1/api-keys/{key_id}` | Revoke |

---

## A.5 Endpoint lengkap 8004scan API

Total **150 path** di OpenAPI. Di bawah dikelompokkan; yang **bold** = relevan langsung untuk Fugugent.

### A.5.1 Agents — identity, capability, ownership ⭐

| Method | Path | Keterangan |
|---|---|---|
| **GET** | **`/api/v1/agents`** | **List + filter + sort + search. Endpoint utama katalog kita.** |
| **GET** | **`/api/v1/agents/search/semantic`** | **Hybrid full-text + pgvector semantic search** |
| **GET** | **`/api/v1/agents/{chain_id}/{token_id}`** | **Detail agent (cache 60 detik)** |
| GET | `/api/v1/agents/{chain_id}/{registry_address}/{token_id}` | Detail untuk custom registry contract |
| GET | `/api/v1/agents/leaderboard` | Leaderboard (cache 5 menit) |
| GET | `/api/v1/agents/trending` | Trending (cache 1 menit) |
| GET | `/api/v1/agents/featured` | Featured agents |
| GET | `/api/v1/agents/latest` | Terbaru |
| GET | `/api/v1/agents/most-starred` | Paling banyak di-star |
| GET | `/api/v1/agents/best-wallet` | Ranking berbasis kredibilitas wallet |
| **GET** | **`/api/v1/agents/scores/v5/{chain_id}/{token_id}`** | **Breakdown skor v5 (5 dimensi)** |
| GET | `/api/v1/agents/score-history/{chain_id}/{token_id}` | Riwayat skor |
| **GET** | **`/api/v1/agents/{chain_id}/{token_id}/quality`** | **Quality Center (`history_days` ≤365, `history_limit` ≤100)** |
| GET | `/api/v1/agents/{chain_id}/{token_id}/views` | Page views |
| GET | `/api/v1/agents/{chain_id}/{token_id}/views/history` | Riwayat views |
| POST | `/api/v1/agents/{chain_id}/{token_id}/views` | Rekam view (auth) |
| POST | `/api/v1/agents/{chain_id}/{token_id}/health-check` | Minta health-check (owner, auth) |
| POST | `/api/v1/agents/{chain_id}/{token_id}/metadata-refresh` | Refresh metadata (owner, auth) |
| POST | `/api/v1/agents/verify-endpoint/{chain_id}/{token_id}` | Verifikasi domain endpoint (1x/jam) |
| POST/DELETE | `/api/v1/agents/stars/{chain_id}/{token_id}` | Star / unstar (auth) |
| GET | `/api/v1/agents/stars/{chain_id}/{token_id}/is-starred` | Cek star (auth) |
| GET | `/api/v1/agents/user/me/starred` · `/api/v1/agents/user/{user_id}/starred` | Agent yang di-star |
| GET | `/api/v1/media/agents/{chain_id}/{token_id}/image` | Gambar agent (safe proxy) |

#### Parameter `GET /api/v1/agents` (lengkap) ✅

**Pagination:** `limit` (1–100, default 20), `offset` (≥0, default 0).

**Filter dasar:**
| Param | Tipe | Catatan |
|---|---|---|
| `chain_id` | int | 56 = BSC mainnet, 97 = BSC testnet |
| `is_testnet` | bool | true = testnet saja, false = mainnet saja |
| `owner_address` | string | alamat owner |
| `owner_publisher_tier` | `OFFICIAL\|VERIFIED\|COMMUNITY` | tier sertifikasi publisher |
| `supported_protocol` | string | `MCP`, `A2A`, dst. |
| `x402_supported` | bool | dukungan pembayaran x402 |
| `has_mcp` / `has_a2a` / `has_oasf` | bool | punya endpoint MCP / A2A / OASF |
| `is_registered` | `true\|false\|any` | default `true` — buang placeholder & domain test (`localhost`, `example.com`) |
| `is_active` | `true\|false\|any` | default `true` — field `active` ERC-8004 |
| `is_endpoint_verified` | bool | domain endpoint terverifikasi |
| `supported_trust` | string | `reputation`, `crypto-economic`, `tee-attestation` |

**Filter OASF (multi-value, OR logic):**
- `oasf_skill` — ulangi parameter: `?oasf_skill=NLP&oasf_skill=Data%20Analysis`
- `oasf_domain` — `?oasf_domain=finance&oasf_domain=healthcare`

**Filter lanjutan:**
`min_feedbacks` · `min_validations` · `min_score` (0–100) · `created_after` / `created_before` (ISO 8601) · `tags` (comma-separated, OR) · `categories` (comma-separated, OR)

**Search:**
- `search` (1–200 char) dengan auto-deteksi: angka → `token_id`; `0x...`/base58 → owner address; `56:0x8004...:49637` → composite agent ID; `vitalik.eth` → ENS; selain itu full-text
- `search_type`: `auto|text|token_id|agent_id|address|ens|did`
- `search_fields`: comma-separated dari `name,description,tags,categories,capabilities,endpoints,supported_protocols`

**Sorting:**
- `sort_by`: `created_at` (default), `stars`, `name`, `token_id`, `total_score`, `quality_score`, `popularity_score`, `activity_score`, `validation_score`, `wallet_score`, `freshness_score`, `metadata_completeness_score`, `total_feedbacks`, `average_score`, `total_validations`
- `sort_order`: `desc` (default) / `asc`

#### Contoh response `GET /api/v1/agents?chain_id=56&limit=1&sort_by=total_score&sort_order=desc` ✅ (live)

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

> **Catatan penting:** wrapper respons **tidak konsisten**. `/agents` mengembalikan objek datar `{items,total,limit,offset}`, sedangkan `/chains` mengembalikan `{"success":true,"data":{...}}`, dan error mengembalikan `{"success":false,"error":{"code":...,"message":...}}`. Buat parser yang toleran terhadap kedua bentuk.

#### Contoh response `GET /api/v1/agents/56/49637` (detail) ✅ (live, struktur diringkas)

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

> `field_sources` sangat berguna: memberi tahu apakah tiap field berasal `onchain`, `offchain`, atau `hardcoded`. Untuk trust-scoring Fugugent, field `onchain` lebih dipercaya.

#### `GET /api/v1/agents/search/semantic` ✅

Hybrid **full-text (PostgreSQL tsvector) + semantic (pgvector)**.

| Param | Default | Keterangan |
|---|---|---|
| `q` (**required**) | — | 1–500 char |
| `limit` / `offset` | 20 / 0 | max 100 |
| `chain_id` | — | 56 untuk BSC |
| `is_active` | `true` | `true\|false\|any` |
| `semantic_weight` | 0.5 | 0.0 = murni full-text, 1.0 = murni semantic |
| `similarity_threshold` | 0.5 | ambang minimal similarity |

Response: item agent + field tambahan `similarity_score`.

Uji live pada chain 56 ✅:
```
q=health factor liquidation  → 340458 "LingoAI Health Factor Sentinel" (sim 0.8043)
                                292058 "bnb-lending-guardian.agent"    (sim 0.8034)
q=grid trading bot           → 62924  "tradingbot"
q=yield farming              → 50036  "Yield-Farmer - Goo"             (sim 0.7276)
q=rebalancing                → total 11 hasil
```

### A.5.2 Feedback / Reputation ⭐

| Method | Path |
|---|---|
| **GET** | **`/api/v1/feedbacks`** |
| GET | `/api/v1/feedbacks/{feedback_id}` |
| GET | `/api/v1/feedbacks/{feedback_id}/replies` |

Parameter `GET /api/v1/feedbacks` ✅:
`limit` (≤100) · `offset` · `agent_id` (UUID internal) · `agent_token_id` (+ `chain_id`) · `user_address` · `min_score` / `max_score` (0–100) · `include_revoked` (default false) · `tag1` / `tag2` (partial match, case-insensitive, ≤255 char — ini tag ERC-8004) · `chain_id` · `is_testnet` · `oasf_skill[]` / `oasf_domain[]` (max 20, OR) · `sort_by` = `submitted_at|score|created_at` · `sort_order` · `include_replies` (embed ≤10 reply)

Contoh dari dokumentasi:
```
GET /feedbacks?chain_id=11155111&agent_token_id=1675
GET /feedbacks?user_address=0x7a1591...
GET /feedbacks?min_score=90&sort_by=score&sort_order=desc
GET /feedbacks?oasf_domain=finance&oasf_domain=business
```

### A.5.3 Stats / Network data ⭐

| Method | Path | Cache | Keterangan |
|---|---|---|---|
| **GET** | **`/api/v1/stats/global`** | 60s | Statistik platform; param `is_testnet`, `is_registered` |
| GET | `/api/v1/stats/daily` | — | Statistik harian |
| GET | `/api/v1/stats/growth` · `/api/v1/stats/growth/chains` | — | Analisis pertumbuhan |
| GET | `/api/v1/stats/feedbacks` · `/api/v1/stats/feedbacks/tags` | — | Statistik + tag feedback |
| **GET** | **`/api/v1/stats/oasf/skills`** | 300s | Distribusi skill (limit ≤500) |
| **GET** | **`/api/v1/stats/oasf/domains`** | 300s | Distribusi domain (limit ≤500) |
| **GET** | **`/api/v1/stats/agents/{chain_id}/{token_id}`** | real-time | Statistik per agent |
| GET | `/api/v1/stats/agents/{chain_id}/{token_id}/analytics` | — | Analytics per agent |
| **GET** | **`/api/v1/chains`** · `/api/v1/chains/{chain_id}` | — | Daftar chain |

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
> Catat: `total_validations = 0` dan `total_validators = 0` di seluruh mainnet. **Validation Registry praktis belum terpakai** — jangan bangun fitur yang bergantung padanya.

`GET /api/v1/chains` ✅ — chain BSC:
```json
{"chain_key":"bsc_mainnet","chain_id":56,"name":"BSC","is_testnet":false,"enabled":true,
 "blockscout_configured":false,"etherscan_supported":true,"etherscan_keys_present":true,
 "effective_provider":null,"provider_status":"rpc_only",
 "provider_reason":"etherscan_disabled_for_chain"}
{"chain_key":"bsc_testnet","chain_id":97,"name":"BSC Testnet","is_testnet":true,"enabled":true,
 "effective_provider":"etherscan","provider_status":"available"}
```

### A.5.4 Wallets / Users — ownership & activity ⭐

| Method | Path | Keterangan |
|---|---|---|
| **GET** | **`/api/v1/wallets/{address}/agents`** | Semua agent milik wallet |
| GET | `/api/v1/wallets/{address}` · `/metrics` · `/stats` | Profil & metrik wallet |
| **GET** | **`/api/v1/users/{identifier}/activity`** | **Feed aktivitas user** |
| GET | `/api/v1/users/{identifier}` · `/stats` · `/feedbacks` · `/card` | Profil user |
| GET | `/api/v1/users/{identifier}/validations/requested` · `/responded` | Validasi |
| GET | `/api/v1/users/{identifier}/followers` · `/following` · `/follow-status` | Social graph |
| POST/DELETE | `/api/v1/users/{identifier}/follow` | Follow/unfollow (auth) |

### A.5.5 Leaderboards & rankings

`/api/v1/agents/leaderboard` params ✅: `period` = `7d|30d|90d|all` · `sort_by` = `total_score|quality_score|popularity_score|activity_score|validation_score|wallet_score|freshness_score` · `limit` (≤100) · `offset` · `chain_id` · `is_testnet` · `group_cross_chain` (default `true`).

`/api/v1/agents/trending` ✅: `period` = `24h|7d|30d`, `limit` ≤50.
Algoritma trending (dari docs): `trending_score = view_count / (hours_since_last_activity + 2)^1.5`.

Lainnya: `/api/v1/leaderboards/publishers`, `/api/v1/leaderboards/validators`.

### A.5.6 MCP tools endpoints (menerima `X-API-Key`) ⭐

Ini jalur khusus yang **secara eksplisit mengizinkan `XApiKey`** (endpoint lain default JWT):

| Method | Path | Params |
|---|---|---|
| GET | `/api/v1/mcp/tools/search_agents` | `query` (req, 1–200), `chain_id`, `limit` (1–50, def 10), `search_type` = `keyword\|semantic`, `api_key` (untuk klien SSE) |
| GET | `/api/v1/mcp/tools/get_agent` | `chain_id` (req), `token_id` (req, int), `api_key` |
| GET | `/api/v1/mcp/tools/get_agent_feedbacks` | `chain_id` (req), `token_id` (req), `limit` (1–50, def 20), `api_key` |
| GET | `/api/v1/mcp/tools/get_starred_agents` | `api_key` |
| POST | `/api/v1/mcp/tools/star_agent` · `unstar_agent` | — |

> Untuk backend Fugugent, endpoint REST biasa (`/agents`, `/agents/search/semantic`) lebih kaya. Jalur `/mcp/tools/*` berguna kalau kita mau expose 8004scan sebagai tool ke agent kita sendiri.

### A.5.7 Webhooks — data realtime ⭐⭐

| Method | Path |
|---|---|
| **POST** | **`/api/v1/webhooks/register`** |
| GET | `/api/v1/webhooks` · `/api/v1/webhooks/{webhook_id}` |
| PATCH / DELETE | `/api/v1/webhooks/{webhook_id}` |
| GET | `/api/v1/webhooks/{webhook_id}/deliveries` |

Body register ✅:
```json
{
  "webhook_url": "https://api.fugugent.xyz/hooks/8004scan",
  "events": ["validation.requested", "validation.completed"]
}
```
`events` default `["validation.requested","validation.completed"]`. Builder Hub menyebut **6 event type: validation, feedback, dan star events**; nama persis event feedback/star **tidak tercantum di OpenAPI** ⚠️ `UNVERIFIED` — cek lewat skill `8004scan-webhooks` (repo `jiayaoqijia/8004`) atau eksperimen.

Fitur: **HMAC-SHA256 signature verification**, delivery monitoring + retry history, exponential backoff hingga 5 percobaan, filter by event type & agent. Response register mengembalikan `webhook_id` + `secret` (simpan!).

**Ini kunci untuk marketplace realtime:** register webhook → dapat push saat agent menerima feedback/validation/star, tanpa polling.

### A.5.8 Lain-lain
- Status/health: `/api/v1/status/summary`, `/components`, `/freshness`, `/indexers`, `/indexers/direct`, `/taskqueue`, plus `/health` & `/ready`
- Storage: `/api/v1/storage/upload|file/{key}|hash/{hash}|info/{key}|status`
- IPFS: `/api/v1/ipfs/upload`, `/api/v1/ipfs/fetch`
- Inbox: `/api/v1/inbox*`
- Donations: `/api/v1/donations/*`
- Certifications: `/api/v1/users/me/certifications/publisher/apply` (untuk dapat badge `OFFICIAL/VERIFIED/COMMUNITY`)
- Admin: `/api/v1/admin/*` (tidak relevan)

### A.5.9 Pagination

Semua list endpoint pakai **offset-based**: `limit` (1–100) + `offset` (≥0). Respons list `/agents` mengembalikan `{items, total, limit, offset}` → jumlah halaman = `ceil(total/limit)`.

⚠️ Dengan `total = 309.444` di BSC, **jangan pernah full-scan**. Selalu pakai filter (`oasf_domain`, `min_score`, `min_feedbacks`, `has_mcp`) atau semantic search.

---

## A.6 Skills 8004scan untuk Claude Code

Dari https://8004scan.io/developers?tab=skills ✅. Repo: **https://github.com/jiayaoqijia/8004** (AGPL-3.0).

```
/plugin marketplace add jiayaoqijia/8004
/plugin install 8004scan-skill@8004scan
```

3 skill:
1. **`8004`** — referensi protokol ERC-8004: arsitektur 3 registry, ABI & alamat kontrak untuk 45+ chain EVM, schema registrasi agent, trust label & scoring, contoh SDK TypeScript/Python, pola integrasi (MCP, A2A, OASF, ENS, x402)
2. **`8004scan`** — integrasi API: list/filter agent, semantic & keyword search, detail agent, query per wallet, statistik platform, feedback
3. **`8004scan-webhooks`** — event realtime: 6 event type, registrasi & manajemen webhook, verifikasi HMAC-SHA256, monitoring delivery, retry exponential backoff

> Untuk tim Fugugent: install skill ini di Claude Code saat development — mempercepat integrasi dan bagus untuk demo "kami memakai tooling sponsor".

---

## A.7 ERC-8004 — spesifikasi ringkas

Sumber: [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004) · [github.com/erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) (README + `ERC8004SPEC.md`, lisensi CC0) · https://8004.org

### Konsep inti

**Identifier agent:**
- `agentRegistry` = `{namespace}:{chainId}:{identityRegistry}` — mis. `eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- `agentId` = ERC-721 `tokenId` hasil mint di Identity Registry

Di 8004scan, composite ID muncul sebagai `56:0x8004a169...:49637`.

**Apa yang dilakukan (dan tidak):**
- ✅ Discovery: identitas ERC-721 dengan `tokenURI` menunjuk registration file
- ✅ Trust signals: reputation & validation on-chain terstandar
- ❌ **Bukan payment rail** — pembayaran sengaja out-of-scope

### A.7.1 Identity Registry

ERC-721 upgradeable (`ERC721URIStorage`).

**Fungsi utama** ✅ (dari ABI resmi):
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

**Key khusus `agentWallet`:** otomatis di-set saat registrasi (= owner), hanya bisa diubah dengan bukti kontrol wallet baru via **EIP-712 / ERC-1271**, dan **di-clear saat transfer** (owner baru wajib verifikasi ulang).

**Events (bisa diindeks)** ✅:
```solidity
Registered(uint256 indexed agentId, string agentURI, address indexed owner)
URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)
MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey, string metadataKey, bytes metadataValue)
Transfer(address indexed from, address indexed to, uint256 indexed tokenId)   // ERC-721 → perubahan ownership
Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)
ApprovalForAll(address indexed owner, address indexed operator, bool approved)
MetadataUpdate(uint256 _tokenId)
BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId)
Upgraded(address indexed implementation)
Initialized(uint64 version)
EIP712DomainChanged()
OwnershipTransferred(address indexed previousOwner, address indexed newOwner)
```

### A.7.2 Reputation Registry

Menyimpan sinyal feedback sebagai **signed fixed-point**:
- `value`: `int128` (bertanda)
- `valueDecimals`: `uint8` (0–18)
- Contoh: `value=9977, valueDecimals=2` → `99.77`; `value=560, valueDecimals=0` → `560`

Sisanya metadata opsional (tag, endpoint URI, URI + hash payload off-chain). **Self-feedback dicegah** (owner/operator agent dicek lewat Identity Registry).

**Fungsi** ✅:
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
> ⚠️ `getSummary` **mewajibkan `clientAddresses` non-empty** (anti-Sybil). Untuk agregasi global, pakai API 8004scan (`average_score`, `total_feedbacks`) — jauh lebih praktis.

**Events** ✅:
```solidity
NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex,
            int128 value, uint8 valueDecimals, string indexed indexedTag1,
            string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)
FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex)
ResponseAppended(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex,
                 address indexed responder, string responseURI, bytes32 responseHash)
```

### A.7.3 Validation Registry

> ⚠️ **Peringatan dari repo resmi:** bagian Validation Registry *"masih dalam pembaruan aktif dan diskusi dengan komunitas TEE"* dan akan direvisi di update spec berikutnya. Ditambah data live: **0 validator & 0 validation di seluruh mainnet**. **Jangan jadikan dependensi.**

```solidity
validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)
validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)
getValidationStatus(bytes32 requestHash) returns (address, uint256, uint8, bytes32, string, uint256)
getSummary(uint256 agentId, address[] validatorAddresses, string tag) returns (uint64, uint8)
getAgentValidations(uint256 agentId) returns (bytes32[])
getValidatorRequests(address validatorAddress) returns (bytes32[])
```
Events: `ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)` · `ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)`

### A.7.4 Alamat kontrak — BSC ✅

Sumber: [README erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts) — **dikonfirmasi silang** dengan (a) field `contract_address` pada data live 8004scan BSC dan (b) `GET /api/v1/config/contracts` TermiX di chain 56.

#### BSC Mainnet (chain 56)
| Kontrak | Alamat |
|---|---|
| **IdentityRegistry** | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| **ReputationRegistry** | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ValidationRegistry | ⚠️ **tidak tercantum di README resmi** — `UNVERIFIED`, jangan pakai |

Explorer: https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

#### BSC Testnet (chain 97)
| Kontrak | Alamat |
|---|---|
| **IdentityRegistry** | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| **ReputationRegistry** | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ValidationRegistry | ⚠️ `UNVERIFIED` |

Explorer: https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e

> **Pola penting:** alamatnya **identik di semua mainnet EVM** (`0x8004A169...` untuk Identity, `0x8004BAa1...` untuk Reputation) dan **identik di semua testnet** (`0x8004A818...` / `0x8004B663...`) — hasil vanity/deterministic deployment. Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Celo, Gnosis, Linea, Mantle, Monad, Metis, MegaETH, LUKSO, Abstract, GOAT, Taiko dst. semuanya sama.
> Konsekuensi buat Fugugent: **kode kontrak/indexer cukup satu set alamat + variabel chainId.**

ABI resmi: `https://raw.githubusercontent.com/erc-8004/erc-8004-contracts/main/abis/{IdentityRegistry|ReputationRegistry|ValidationRegistry}.json` ✅

### A.7.5 Struktur AgentCard / registration file

`agentURI` (= `tokenURI`) menunjuk JSON. Field per spec:

| Field | Isi |
|---|---|
| `type` | `"https://eips.ethereum.org/EIPS/eip-8004#registration-v1"` |
| `name`, `description`, `image` | Metadata NFT-friendly |
| `services` | Daftar endpoint: A2A agent card URL, MCP endpoint, OASF manifest, ENS, email |
| `registrations` | Array `{ agentRegistry, agentId }` — mengikat file ke identitas on-chain, juga dipakai untuk **cross-chain linking** |
| `supportedTrust` | `reputation`, `crypto-economic`, `tee-attestation` |
| `active` | boolean — ketersediaan yang dideklarasi owner |

Field tambahan yang dipakai di dunia nyata (terlihat pada agent BSC live) ✅: `url`, `version`, `protocol`, `agent_type`, `categories`, `tags`, `skills`, `capabilities`, `models`, `provider`, `license`, `documentation`, `termsOfService`, `privacyPolicy`, `securityPolicy`, `defaultInputModes`, `defaultOutputModes`, `supportedNetworks`, `x402Support`, `limitations`, `disclaimer`, `updatedAt`, `verification`, `externalLink`, `contact`, `erc8004`.

**Contoh nyata dari BSC** — tokenURI bisa berupa `data:application/json;base64,...` (inline, dilihat pada agent TermiX `340793`) atau `ipfs://Qm...` (agent `49637`) atau HTTPS.

Minimal registration inline (decoded dari agent BSC live) ✅:
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

**Verifikasi domain endpoint (opsional):** host file `.well-known/agent-registration.json` di domain endpoint yang berisi info registrasi yang cocok. 8004scan mengeksposnya via `is_endpoint_verified` dan `POST /api/v1/agents/verify-endpoint/{chain_id}/{token_id}` (1x/jam).

### A.7.6 Alur end-to-end mendaftarkan agent Fugugent

1. `register(agentURI)` di IdentityRegistry BSC → dapat `agentId`
2. Publish registration file (IPFS/HTTPS), set via `setAgentURI(agentId, uri)`
3. (Opsional) `setAgentWallet(...)` dengan bukti EIP-712/1271
4. Kumpulkan feedback dari klien via `giveFeedback(...)` di ReputationRegistry
5. Agregasi trust: `getSummary(...)` on-chain, atau tarik dari API 8004scan
6. Trigger `POST /api/v1/agents/{chain_id}/{token_id}/metadata-refresh` agar 8004scan meng-index cepat

---

## A.8 Klasifikasi agent ke 4 kategori Fugugent

Target kategori: **(1) rebalancing · (2) grid trading · (3) yield · (4) health factor**.

Tidak ada field kategori kanonik di ERC-8004 (isi `tags`/`categories` bebas diisi publisher). Rekomendasi: **pipeline klasifikasi 4 lapis, hasilnya dicache di DB kita sendiri.**

### Lapis 1 — Semantic search sebagai kandidat generator (paling kuat) ✅

Terbukti bekerja di BSC:
```bash
GET /api/v1/agents/search/semantic
    ?q=<query>&chain_id=56&limit=100&semantic_weight=0.7&similarity_threshold=0.55
```

Query per kategori (multi-query, gabungkan hasil, dedupe by `agent_id`):

| Kategori | Query yang disarankan |
|---|---|
| **Rebalancing** | `portfolio rebalancing agent`, `liquidity position rebalancing`, `auto rebalance LP range`, `concentrated liquidity manager` |
| **Grid trading** | `grid trading bot`, `automated grid strategy`, `range order trading bot`, `DCA grid strategy` |
| **Yield** | `yield farming optimizer`, `APY routing agent`, `auto-compounding vault`, `yield aggregator` |
| **Health factor** | `health factor monitor`, `liquidation protection agent`, `lending position guardian`, `collateral ratio alert` |

Hasil live yang membuktikan sinyalnya kuat ✅:
- `health factor liquidation` → **"LingoAI Health Factor Sentinel"** (sim 0.804), **"bnb-lending-guardian.agent"** (sim 0.803)
- `yield farming` → **"Yield-Farmer - Goo"** (sim 0.728)
- `grid trading bot` → **"tradingbot"**
- Filter `oasf_domain=technology/blockchain/defi&chain_id=56` → **"Sentinels Grid Trader"**, "Sentinels Health Guard", "Sentinels Security Scout"

Simpan `similarity_score` sebagai confidence awal.

### Lapis 2 — Pre-filter untuk mempersempit populasi

Sebelum/berbarengan dengan semantic search, potong 309k agent jadi ribuan:
```
GET /api/v1/agents?chain_id=56
    &is_registered=true          # buang placeholder & domain test
    &is_active=true              # hanya yang owner deklarasikan aktif
    &has_mcp=true                # atau has_a2a=true — harus punya endpoint nyata
    &min_score=20                # skor v5 minimum
    &oasf_domain=technology/blockchain/defi
    &oasf_domain=finance/markets/crypto
    &oasf_domain=finance_and_business/investment_services
    &limit=100&offset=0
```

**Taksonomi OASF nyata di mainnet** ✅ (`GET /api/v1/stats/oasf/domains?is_testnet=false`) — domain relevan DeFi:

| Domain | Jumlah agent |
|---|---|
| `technology/blockchain/cryptocurrency` | 5.530 |
| `finance/markets/crypto` | 4.940 |
| `finance/global_economics` | 3.546 |
| `technology/security/cybersecurity` | 1.872 |
| `technology/blockchain` | 752 |
| `finance_and_business/finance` | 469 |
| `trust_and_safety/risk_management` | 463 |
| `technology/blockchain/smart_contracts` | 448 |
| **`technology/blockchain/defi`** | **442** |
| `finance_and_business/investment_services` | 380 |
| `trust_and_safety/fraud_prevention` | 292 |

Skill relevan ✅ (`GET /api/v1/stats/oasf/skills?is_testnet=false`):

| Skill | Jumlah |
|---|---|
| `analytical_skills/market_insights` | 4.940 |
| `analytical_skills/data_analysis/crypto_analysis` | 4.940 |
| `evaluation_monitoring/anomaly_detection` | 1.373 |
| `advanced_reasoning_planning/strategic_planning` | 810 |
| `security_privacy/threat_detection` | 1.586 |

> Catatan: semua `is_standard: false` dan `category_id: null` — taksonomi ini **de-facto dari publisher**, bukan enum resmi OASF. Jangan hardcode; tarik daftarnya tiap 5 menit (cache 300s) dan cocokkan dengan prefix.

### Lapis 3 — Keyword search terarah

```
GET /api/v1/agents?chain_id=56&search=rebalanc&search_type=text
    &search_fields=name,description,tags,capabilities&limit=100
```
Kata kunci: `rebalanc`, `grid`, `yield`, `APY`, `APR`, `health factor`, `liquidation`, `collateral`, `LP`, `liquidity`, `vault`, `compound`, `pancakeswap`, `venus`, `aave`.
Juga filter langsung: `tags=defi,trading,yield` dan `categories=...`.

### Lapis 4 — Klasifikasi LLM atas `raw_metadata.offchain_content`

Untuk tiap kandidat, ambil detail (`GET /api/v1/agents/56/{token_id}`) dan feed ke LLM:
- `raw_metadata.offchain_content.description`, `.skills`, `.capabilities`, `.categories`, `.tags`, `.agent_type`
- `services.mcp.tools[]` — **nama tool MCP adalah sinyal terkuat** (mis. tool `rebalancePosition`, `openGridOrder`, `getHealthFactor`)
- `services.a2a.skills[]`

Output: `{category, confidence, evidence}`. Simpan ke DB Fugugent, refresh mingguan atau saat webhook memberi tahu ada perubahan.

### Sinyal kualitas untuk ranking dalam kategori

Setelah dikategorikan, urutkan pakai field yang sudah disediakan 8004scan:
| Sinyal | Field |
|---|---|
| Skor keseluruhan | `total_score` (5–95), `scores.breakdown` (v5, 5 dimensi) |
| Liveness | `health_score`, `health_status.overall_status`, `health_checked_at` |
| Reputasi | `average_score`, `total_feedbacks` (pakai `min_feedbacks=1`) |
| Kredibilitas publisher | `owner_publisher_tier` (`OFFICIAL`/`VERIFIED`/`COMMUNITY`), `scores.wallet` |
| Keaslian endpoint | `is_endpoint_verified`, `endpoint_verified_domain` |
| Kelengkapan | `scores.metadata_completeness`, `parse_status.status` |
| Traksi | `star_count`, views (`/views`, `/views/history`) |
| Kesegaran | `scores.freshness`, `updated_at` |
| Model bayar | `x402_supported` |

Bobot skor v5 (dari dokumentasi leaderboard) ✅: Engagement 30% · Service 25% · Publisher 20% · Compliance 15% · Momentum 10%.

### Rekomendasi arsitektur data Fugugent

```
8004scan API (X-API-Key)                      ERC-8004 di BSC (fallback)
   │                                                │
   ├─ cron sync (semantic + filtered list)          ├─ event Registered / URIUpdated
   ├─ webhook push (feedback/star/validation)       ├─ event NewFeedback
   ▼                                                ▼
        Postgres Fugugent  ──►  classifier (rule + LLM)  ──►  4 kategori
                           ──►  cache TTL 60s untuk detail, 5m untuk leaderboard
                           ▼
                     Marketplace API/UI Fugugent
```
Sinkronkan TTL dengan cache upstream: detail agent 60s, leaderboard 5 menit, trending 1 menit, OASF stats 5 menit, global stats 60s.

---

## A.9 ⚠️ Masalah operasional yang ditemukan saat uji live (8 Sep 2026)

1. **Request tanpa User-Agent browser dikembalikan `HTTP 500`.**
   ```
   curl "https://api.8004scan.io/api/v1/agents?limit=1"                    → 500
   curl -H "User-Agent: curl/8.0" ".../agents?limit=1"                     → 500
   curl -A "Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36" ".../agents"   → 200 ✅
   ```
   Ini konsisten dengan tier `ANONYMOUS` ("Bot/script — tanpa header browser"), tapi seharusnya 429 bukan 500.
   **Mitigasi:** selalu kirim `User-Agent` yang wajar **dan** `X-API-Key` dari backend.

2. **`500 {"success":false,"error":{"code":"DATABASE_ERROR"}}` bersifat transien.**
   `has_mcp=true` gagal sekali lalu berhasil saat diulang. `tags=`, `search_type=text` juga sempat gagal.
   **Mitigasi wajib:** retry dengan exponential backoff (3–5x), circuit breaker, dan **selalu punya cache lokal** agar UI tidak kosong.

3. **Bentuk respons tidak seragam** — `{items,...}` vs `{success,data}` vs `{success,error}`. Buat wrapper parser.

4. **Validation Registry kosong** (0 validator, 0 validation di semua mainnet). Fitur trust harus bertumpu pada reputation + health, bukan validation.

5. **Volume besar:** 309k agent di BSC, 3.197 agent baru/hari platform-wide. Banyak yang placeholder/spam (`"Agent #340784"` tanpa deskripsi, `total_score: 0`). **Wajib** pakai `is_registered=true`, `min_score`, `min_feedbacks`, atau `has_mcp=true`.

---

# BAGIAN B — TermiX

## B.1 Produk & rebranding penting ⚠️

**`https://app.termix.ai/` sekarang 301-redirect ke `https://www.agent.family/`** ✅ (diverifikasi live 8 Sep 2026). Produknya tetap TermiX/AACP; brand front-end-nya berubah. Dokumentasi tetap di `docs.termix.ai`.

**Tagline:** *"The marketplace where AI agents hire agents."*

**AACP = Agent Autonomous Commerce Protocol** — *"trustless economic infrastructure for autonomous AI agent commerce"*. TermiX Platform adalah implementasi marketplace dari AACP.

Berdiri di atas:
- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** untuk identitas & reputasi agent
- **ERC-8183** untuk job escrow
- Settlement **USDC/USDT** di BNB Chain & Base

> 🔑 **Insight strategis untuk Fugugent:** TermiX memakai **IdentityRegistry ERC-8004 yang sama persis** di BSC (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) — terkonfirmasi dari `GET /api/v1/config/contracts` live. Artinya **agent yang kita daftarkan di ERC-8004 BSC otomatis punya identitas yang sama di TermiX dan terlihat di 8004scan.** Satu registrasi → tiga permukaan. Ini poin naratif yang sangat kuat untuk juri.

### URL

| Resource | URL |
|---|---|
| Aplikasi | https://www.agent.family/ (ex-https://app.termix.ai/) |
| Docs | https://docs.termix.ai/ |
| Docs index (llms.txt) | https://docs.termix.ai/llms.txt |
| OpenAPI | https://docs.termix.ai/api-reference/openapi.json |
| **BSC MCP server** | **https://github.com/TermiX-official/bsc-mcp** |
| Agent Skills (AACP) | https://github.com/TermiX-official/termix-agent-skills |
| Whitepaper | https://github.com/TermiX-official/aacp-whitepaper |
| Testnet AACP frontend | https://aacp.termix.live |
| Testnet AACP backend | https://aacp-backend.termix.live |
| Org GitHub | https://github.com/TermiX-official |
| X/Twitter | https://x.com/termix_ai |

## B.2 Model hiring & pricing

### Identitas terpadu, peran per-transaksi

Setiap peserta punya **Agent NFT** yang di-mint lewat ERC-8004 Identity Registry. Identitas **tidak** dibedakan "client" vs "provider" — agent yang sama bisa jadi pembeli di satu order dan penjual di order lain.

Dua peran tambahan **diberikan operator** (muncul di array `roles[]`):
- **Evaluator** — duduk di panel 3 kursi yang memvoting delivery yang di-challenge; dapat evaluator fee
- **Arbitrator** — memutus sengketa yang dieskalasi; dapat arbitrator fee

`roles[]` kosong itu normal, tidak menghalangi jual/beli.

### Dua jalur memulai kerja

| Jalur | Cara mulai | Cocok untuk |
|---|---|---|
| **Listing** | Provider publish layanan berharga tetap. Buyer beli langsung, atau buka percakapan dan terima custom offer | Layanan produk, berulang |
| **Request** | Buyer publish request ("prepayment order") dengan rentang budget. Provider menemukan lalu submit offer | Kerja bespoke, quoting kompetitif |
| **Bounty** | Brand mendanai kolam reward slot identik; provider mana pun yang memenuhi syarat bisa claim, fulfil dengan bukti, lalu dibayar (via `CampaignVault`, mengunci `providerBond`) | Kampanye massal |

### Siklus hidup order

```
PENDING_ACCEPT → FUNDED / IN_PROGRESS → DELIVERED → SETTLED
                                            │
                                            ├─ redo (sekali) → IN_PROGRESS
                                            └─ challenge → IN_DISPUTE → SETTLED
```
Uang **hanya** bergerak lewat kontrak escrow, dan state database diproyeksikan dari event on-chain oleh indexer — bukan dari fakta bahwa kita broadcast transaksi.

**Backend tidak pernah memegang key dan tidak pernah broadcast untuk kita.** Endpoint yang mengubah state on-chain mengembalikan **unsigned tx-intent**:
```json
{ "action": "submitDelivery", "chainId": 56, "contract": "0x…",
  "callData": "0x…", "value": "0", "status": "PREPARED", "nonceKey": "…" }
```

### Fee & settlement

| Parameter | Berlaku untuk | Dibaca dari |
|---|---|---|
| `protocolFeeBps` | Bagian protokol dari amount yang di-settle | `GET /api/v1/config/contracts`, per currency |
| `campaignProtocolFeeBps` | Bagian protokol dari reward bounty | `GET /api/v1/config/contracts` |
| `evaluatorFeeBps` | Panel evaluator (hanya order yang disengketakan) | Kontrak escrow → `evaluatorFeeAmount` |
| `arbitratorFeeBps` | Arbitrator (hanya jika eskalasi) | Kontrak escrow → `arbitratorFeeAmount` |
| `challengeBondAmount` | Dipasang oleh yang membuka challenge | Kontrak escrow |

**Nilai live di BSC (8 Sep 2026)** ✅: `protocolFeeBps: 200` dan `campaignProtocolFeeBps: 200` → **2%**. Situs memasarkannya sebagai "1–3%" vs "~20%" platform konvensional.

**Settlement tanpa sengketa:** Provider dapat `budget − protocol fee`; protocol fee recipient dapat `budget × protocolFeeBps / 10_000`. Locked stake provider dilepas, hasil dicatat ke reputasi sebagai sukses. `claimAfterTimeout` membayar identik dengan accept eksplisit.

**Settlement dengan sengketa:**
```
budget
  ├─ protocol fee   budget × protocolFeeBps
  ├─ evaluator fee  budget × evaluatorFeeBps   (dibagi rata 3 kursi, dust ke kursi pertama)
  ├─ arbitrator fee budget × arbitratorFeeBps  (hanya jika eskalasi)
  └─ sisanya ──────► pihak yang dimenangkan
```
Kalau provider kalah, locked stake-nya di-slash ke buyer. Challenge bond pindah ke pihak yang menang.

**Pembatalan:** `cancelPending` (buyer, sebelum provider accept) → refund penuh. `cancelExpired` (siapa pun, setelah `deliveryDueAt` lewat tanpa delivery) → refund penuh, **tanpa protocol fee**.

**Tidak ada yang menggantung** — semua jalur punya exit permissionless: `claimAfterTimeout`, `cancelExpired`, `finalizeAfterTimeout`, `reclaimExpired`. *"There is no auto-settle worker anywhere in the system."*

### Staking

Stake per agent, per currency, di kontrak `TermixStaking`. Tiga saldo: `available`, `locked`, `slashed`.

**Threshold ≠ Lock** (kesalahan integrasi paling umum):
- **Threshold** = stake total minimum untuk memenuhi syarat; tidak mengunci apa pun. Sumbernya: `minStake` request, `desiredStake` order, `bondAmount` listing, `providerBond` bounty
- **Lock** = dipindah dari available ke locked saat kerja diambil; `providerLockBps × budget` untuk order, **full `providerBond`** untuk bounty slot

Live di BSC ✅: `providerLockBps: 0` untuk USDC dan USDT → **order reguler tidak mengunci stake**; angka stake buyer murni threshold kualifikasi.

Gate error: `STAKE_GATE_NOT_MET`, `STAKE_FREE_INSUFFICIENT` (HTTP 403 dengan pesan kekurangan persis).

**Slashing** terjadi saat: kalah sengketa order (→ buyer), kalah sengketa bounty slot / lewat `maxSubmitSeconds` / rejection tak dilawan / dihapus sebagai claim terbengkalai (→ brand). Slashing dibatasi jumlah yang benar-benar di-lock untuk order/slot itu. **Provider yang sekadar telat delivery tidak di-slash** — `cancelExpired` refund penuh tanpa fee; biayanya adalah kehilangan bayaran + hit reputasi.

### Reputasi (kontrak `TermixReputation`)

Skor **1–100**, tidak self-reported, tidak editable. Hanya recorder terotorisasi (escrow & bounty vault) yang boleh menulis, saat settlement.

Empat angka per agent: `completedOrders`, `successfulOrders`, `disputedOrders`, `lastUpdatedAt`.
Fungsi penulis: `recordOrderResult(agentId, success, disputed)` dan `recordChallengeResult(agentId, providerUpheld)`.

**Formula** (success rate dengan Bayesian prior, dikurangi dispute rate):
```
total        = completedOrders + priorTotal
successScore = (successfulOrders + priorSuccess) × 100 / total
disputeRate  = disputedOrders × 100 / total
score        = successScore − disputeRate      (lantai 1)
```
Default prior: 5 virtual order, 3 sukses → agent baru mulai di **60**.

| Completed orders (semua sukses, tanpa dispute) | Skor |
|---|---|
| 0 | 60 |
| 5 | 80 |
| 20 | 92 |
| 50 | 96 |

Konvensi tampilan: ≥80 tinggi, 50–79 sedang, <50 rendah.
Baca dari: `GET /api/v1/explorer/agents` (`reputationScore`, `completedJobs`, `passRate`, `stake`) · `GET /api/v1/agents/:handle` · `GET /api/v1/explorer/leaderboard` (window `24h|7d|30d|all`) · on-chain `TermixReputation.getScore(agentId)`.

Reputasi **portabel** (hidup di kontrak, bukan DB platform) tapi **per-chain** — agent di BNB Chain dan Base adalah identitas terpisah.

### Kategori layanan di marketplace
Code & Smart Contracts (audit, integrasi, script) · Security & Verification (review, threat model, analisis eksploit) · Data & Research (labeling, ekstraksi, analisis, dataset) · Design & Brand · Market & Protocol Research · AI Automation.
(Kategori terakhir dua terlihat pada data live `GET /api/v1/listings`.)

## B.3 Network & kontrak TermiX ✅

| | BNB Chain (default) | Base |
|---|---|---|
| Chain ID | `56` | `8453` |
| API base | `https://platform-backend.prod.termix.live` | `https://platform-backend-base.prod.termix.live` |
| RPC | `https://bsc-rpc.publicnode.com` | `https://base-rpc.publicnode.com` |
| Explorer | `https://bscscan.com` | `https://basescan.org` |
| Gas token | BNB | ETH |
| Settlement | USDC, USDT | USDC, USDT |

> ⚠️ Tiap chain adalah dunia terpisah: account, agent, listing, order, stake, settlement sendiri. `404` pada ID yang kita yakin benar biasanya berarti base URL chain yang salah.

**Alamat kontrak live BSC** — hasil `GET https://platform-backend.prod.termix.live/api/v1/config/contracts` ✅ (8 Sep 2026):

| Kontrak | Alamat |
|---|---|
| IdentityRegistry / agentNft | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` *(= ERC-8004 kanonik)* |
| TermixReputation | `0xFf3f7038c4919A420B30D7B3533cb386D5898189` |
| **USDC** (token) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (18 desimal) |
| USDC — TermixEscrow | `0x6A52ba4C84b348FaEAe13dDC7A97b4F6af23913C` |
| USDC — TermixStaking | `0x0Bd066f5113e6B8336b06F8Aa3EF90D37F7e65FC` |
| USDC — CampaignVault | `0x5BaE7834B32a4b357F65dd20248068993466D294` |
| **USDT** (token) | `0x55d398326f99059fF775485246999027B3197955` (18 desimal) |
| USDT — TermixEscrow | `0xCE02f987D8b8AF694E13C8a843Db9c77caBF544c` |
| USDT — TermixStaking | `0x1DcafFB7275fa2650d480a4F939A0C0D5874750B` |
| USDT — CampaignVault | `0x16261F2BCbE8Ee47065C5ecB4be32c1571289809` |

> 📌 **Jangan hardcode.** Dokumentasi tegas: fetch `/api/v1/config/contracts` saat startup dan cache per sesi. Tiap settlement currency punya set kontrak sendiri. `settlementCurrency` (tunggal) adalah field legacy USDC-only — jangan dipakai untuk alur USDT.

## B.4 REST API TermiX

Base: `https://platform-backend.prod.termix.live`, semua di-prefix `/api/v1/`.

**Autentikasi:**
| Mode | Header | Cakupan |
|---|---|---|
| None | — | Public reads: config, stats, explorer, listings, bounties, request discovery |
| Session JWT | `Authorization: Bearer <accessToken>` | Semua yang dilakukan wallet owner |
| API key | `Authorization: Bearer <apiKey>` | M2M, scope `acn:rpc` / `a2a:rpc` |
| A2A runtime token | `Authorization: Bearer <runtimeToken>` | Inbox & reply satu agent |

```bash
curl -X POST "$AACP_API/api/v1/auth/nonce" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress":"0xYourAddress"}'
```

**Konvensi:** uang = decimal display string (`"15"`, `"33.5"`), skala pakai `settlementCurrencies[].decimals` · timestamp ISO-8601 UTC · ID = cuid database (beberapa endpoint terima `agentTokenId` on-chain) · paging `page` + `pageSize` (max 100) → `{items, page, pageSize, total, totalPages}` · **schema strict**: field tak dikenal → HTTP 400.

**Grup endpoint** (docs: https://docs.termix.ai/api-reference/overview):
`/config` · `/agents` (mint, storefront, explorer, stake, A2A) · `/listings` · `/requests` · `/offers` (quote, revisi, acceptance, funding) · `/orders` · `/disputes` · `/bounties` · `/explorer` + `/metrics` (stats, leaderboard, dashboard) · `/realtime` (SSE)

**Diuji live** ✅:
- `GET /api/v1/config/contracts` → 200, config lengkap
- `GET /api/v1/listings?pageSize=2` → 200, listing nyata dengan `title`, `category`, `skillTag`, `tags[]`, `description`
- `GET /api/v1/explorer/agents?pageSize=2` → 200; item berisi `completedJobs`, `stake`, `reputationScore`, `passRate`, `onTimeRate`, dan nested `agent{agentTokenId, name, description, tokenUri, a2aEndpoint, a2aStatus, presence, verified, topRated, pro, metrics{...}}`
- `GET /api/v1/metrics/network` → **401 UNAUTHORIZED** (butuh auth)
- `GET /api/v1/explorer/leaderboard?window=7d&pageSize=2` → **400** `Unrecognized key(s) in object: 'pageSize'` (bukti schema strict — pakai `page`/nama param yang benar per docs)

Endpoint stake: `POST /api/v1/agents/:id/stake/deposit-intent` (approveStake lalu depositStake) · `POST /api/v1/agents/:id/stake/withdraw-intent` · `GET /api/v1/metrics/provider/treasury`.

## B.5 BSC MCP server open-source TermiX ⭐

**Repo:** https://github.com/TermiX-official/bsc-mcp (public, MIT, org `TermiX-official`) ✅

**⚠️ Nama paket npm ≠ nama repo.** Repo `bsc-mcp`, tapi `package.json` mendeklarasikan:
```json
{ "name": "bnbchain-mcp", "version": "1.0.12", "bin": { "bnbchain-mcp": "build/index.js" } }
```
Nama MCP server yang di-expose ke klien: `"bsc-mcp"` (dari `src/main.ts`).

### Install & konfigurasi ✅

```bash
# 1. Install global
npm install -g bnbchain-mcp

# 2. Wizard setup
bnbchain-mcp --init
```
Wizard menanyakan:
- **BSC Wallet Private Key** (wajib)
- **Wallet Password** (wajib, min 6 karakter) — private key disimpan terenkripsi **AES-256 + bcrypt**
- **Custom RPC URL** (opsional, default `https://bsc-dataseed.binance.org`)

Setelah setup, tool **auto-configure ke Claude Desktop** dengan memodifikasi:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Konfigurasi manual (Claude Desktop / Claude Code / Cursor — bentuk standar MCP):
```json
{
  "mcpServers": {
    "bsc-mcp": {
      "command": "bnbchain-mcp"
    }
  }
}
```
> ⚠️ Repo tidak mendokumentasikan blok JSON eksplisit ini; bentuk di atas diturunkan dari `bin` di `package.json` + `StdioServerTransport` di `src/main.ts`. Tandai `UNVERIFIED` sampai dites. Alternatif yang pasti jalan: `"command": "node", "args": ["<path>/build/index.js"]`.

CLI flags: `--init`/`-i`, `--help`/`-h`, `--version`/`-v`.
Dev: `npm run build` (tsc) · `npm start` / `node build/index.js`.

### Tools yang benar-benar terdaftar (dari `src/main.ts`) ✅

| Tool | Fungsi |
|---|---|
| `transferNativeToken` | Kirim BNB |
| `transferBEP20Token` | Transfer BEP-20 via symbol/address |
| **`pancakeSwap`** | **Swap token via PancakeSwap** |
| `getWalletInfo` | Info wallet |
| `getBalance` | Saldo native + token *(disebut README)* |
| `buyMemeToken` | Beli token Four.Meme |
| `sellMemeToken` | Jual token Four.Meme |
| **`pancakeAddLiquidity`** | **Tambah likuiditas PancakeSwap** |
| **`pancakeMyPosition`** | **Lihat posisi likuiditas** |
| **`pancakeRemovePosition`** | **Tarik likuiditas** |
| `goplusSecurityCheck` | Cek keamanan token BSC via GoPlus |
| `queryMemeTokenDetails` | Detail token Four.Meme |

> ⚠️ README juga menyebut `createBEP20Token`, `createFourMeme`, dan `callContractFunction`, tetapi **ketiganya tidak ter-register di `src/main.ts`** pada branch `main` saat diperiksa. Anggap README lebih ambisius dari kode. `UNVERIFIED`.

### Stack teknis ✅ (dari `package.json`)
- `viem ^2.23.11`
- **`@pancakeswap/sdk ^5.8.8`**, **`@pancakeswap/v3-sdk ^3.9.0`**, **`@pancakeswap/smart-router 6.1.6`**, **`@pancakeswap/tokens ^0.6.24`**
- `@modelcontextprotocol/sdk ^1.4.0`
- `@goplus/sdk-node ^1.0.12`, `moralis ^2.27.2`, `graphql-request ^7.1.2`
- `bcrypt ^5.1.1`, `dotenv`, `chalk`, `figlet`, `ora`, `prompts`, `fs-extra`
- Network: BNB Smart Chain Mainnet (chain ID 56), RPC default `https://bsc-dataseed.binance.org`

Alamat kontrak yang di-hardcode di `src/addressConfig.ts` ✅ (hanya Four.Meme — PancakeSwap diakses via SDK):
```ts
FourMemeTryBuyContract:        0xF251F83e40a78868FcfA3FA4599Dad6494E46034
FourMemeBuyTokenAMAPContract:  0x5c952063c7fc8610FFDB798152D69F0B9550762b
FourMemeSellTokenAMAPContract: 0x5c952063c7fc8610FFDB798152D69F0B9550762b
FourMemeCreateTokenContract:   0x5c952063c7fc8610FFDB798152D69F0B9550762b
```

> ⚠️ **Peringatan keamanan untuk Fugugent:** MCP ini menyimpan **private key mentah** (terenkripsi lokal) dan mengeksekusi transaksi langsung. Ini bertentangan dengan prinsip "tidak memegang dana user" (lihat Bagian C). **Rekomendasi: pakai bsc-mcp hanya untuk (a) dev/testing dengan wallet burner, dan (b) menjalankan baseline eksperimen Agent Advantage Report.** Untuk produk, pakai pola session-key/delegation.

### Skill AACP TermiX (terpisah dari MCP)

Repo: https://github.com/TermiX-official/termix-agent-skills ✅ (MIT)

```
/plugin marketplace add TermiX-official/termix-agent-skills
/plugin install termix-agent-skills@termix-agent-skills
```
atau `npx skills add TermiX-official/termix-agent-skills [-g]`, atau `help me install http://termix.ai/skills`.

Env: `AACP_CHAIN` (`bsc` default / `base`) · `WALLET_KEY` · `AACP_BASE_URL` · `A2A_RPC_URL` · `OPENROUTER_API_KEY`/`OPENAI_API_KEY` · `A2A_LLM_MODEL` (default `openai/gpt-4o-mini`).
Butuh Node.js 18+, script `.mjs` dependency-free (pakai `fetch` bawaan, tanpa viem/ethers).
Verifikasi install: `node <skill-dir>/scripts/aacp-config.mjs`.

> ⚠️ README repo skill menyebut base URL `https://aacp-backend.termix.live` dan chain **BSC Testnet**, sedangkan docs resmi menyebut produksi `https://platform-backend.prod.termix.live` di BSC mainnet. README repo tampaknya tertinggal. Pakai `docs.termix.ai` sebagai sumber kebenaran.

## B.6 Kriteria juri TermiX & rancangan Agent Advantage Report

**Hadiah:** $6.000 (1) / $3.000 (2) / $1.000 (3).

| Kriteria | Bobot | Yang dinilai |
|---|---|---|
| **Value of the services** | **30%** | Agent mengalahkan alternatif dalam harga/kecepatan |
| **Proven agent advantage** | **30%** | Hasil terukur, didukung *Agent Advantage Report* wajib |
| **High-stakes categories & track record** | **20%** | Trading/security diberi bobot lebih tinggi |
| **Marketplace quality** | **20%** | Discoverability & usability |

**Syarat wajib Agent Advantage Report:**
- Minimal **3 task nyata** dijalankan **dua kali** — dengan agent dan tanpa agent
- Metrik **waktu, biaya, dan kualitas output**, dengan **output nyata dilampirkan**
- Minimal **1 task** dari kategori **trading / stock / security**

---

### B.6.1 Rancangan eksperimen yang meyakinkan

#### Prinsip metodologi

1. **Paired design, bukan A/B terpisah.** Task yang **identik**, input yang **identik**, dijalankan dua kali. Kondisi berbeda hanya pada tooling. Ini menghilangkan variasi task sebagai perancu.
2. **Pre-register.** Tulis task, metrik, dan kriteria "berhasil" **sebelum** menjalankan. Simpan sebagai file dengan git commit bertanggal — bukti kepada juri bahwa metrik tidak dipilih setelah melihat hasil.
3. **Baseline yang jujur.** Kondisi "tanpa agent" harus **manusia kompeten dengan tool standar** (BscScan, UI PancakeSwap, DefiLlama, spreadsheet, kalkulator) — **bukan** straw man. Juri akan mendeteksi baseline yang sengaja dilemahkan, dan itu merusak semua klaim.
4. **Ulangi ≥3x per kondisi** dan laporkan **median + rentang**, bukan hanya satu angka. Untuk trading, ulangi jauh lebih banyak (lihat B.6.4).
5. **Deterministik semaksimal mungkin.** Pin block height untuk pembacaan on-chain, catat timestamp, pin versi model & seed, simpan raw response.
6. **Blind grading kualitas.** Output dari kedua kondisi dianonimkan, diacak urutannya, dinilai 2+ rater independen dengan rubrik tertulis. Laporkan **inter-rater agreement** (Cohen's κ atau korelasi sederhana).
7. **Laporkan yang gagal.** Kalau satu task tidak menunjukkan keunggulan agent, **tulis apa adanya** dan jelaskan kapan agent tidak cocok. Kredibilitas naik, dan juri sudah pasti mencari tanda cherry-picking.

#### Metrik inti (semua task)

| Dimensi | Metrik | Cara ukur |
|---|---|---|
| **Waktu** | Wall-clock time to first useful output; time to complete; jumlah langkah manual | Stopwatch + screen recording; catat per-langkah |
| **Biaya** | Biaya LLM token (USD, `input_tokens × harga + output_tokens × harga`); gas on-chain (BNB → USD, dari receipt tx); waktu manusia × tarif ($50/jam, sebutkan asumsinya) | Log token dari API; `gasUsed × effectiveGasPrice` |
| **Kualitas** | Skor rubrik 0–5 per dimensi; correctness (fakta benar/salah, diverifikasi on-chain); completeness (butir wajib tercakup); actionability | Blind grading 2 rater |
| **Keandalan** | Success rate lintas percobaan; jumlah error/retry; jumlah halusinasi (klaim yang tidak terverifikasi on-chain) | Hitung dari log |

Sajikan sebagai satu tabel per task:

| Task | Kondisi | Waktu (median) | Biaya LLM | Gas | Waktu manusia | Kualitas (0–5) | Success rate | Artefak |
|---|---|---|---|---|---|---|---|---|
| T1 | Tanpa agent | 42m | $0 | $0.41 | 42m ≈ $35.00 | 3.5 | 3/3 | `artifacts/T1-baseline/` |
| T1 | Dengan agent | 4m10s | $0.18 | $0.39 | 1m ≈ $0.83 | 4.2 | 3/3 | `artifacts/T1-agent/` |

Sertakan **delta dan rasio**: "9,9× lebih cepat, 96% lebih murah dalam biaya manusia, +0,7 poin kualitas".

#### Struktur repo laporan

```
agent-advantage-report/
├── README.md                  # ringkasan eksekutif + tabel hasil
├── methodology.md             # pre-registration, rubrik, asumsi biaya
├── tasks/
│   ├── T1-lp-rebalance/
│   │   ├── task.md            # prompt/instruksi identik untuk kedua kondisi
│   │   ├── baseline/          # screen recording, catatan, output mentah
│   │   ├── agent/             # transcript, tool calls, output mentah
│   │   └── results.json       # metrik terstruktur
│   ├── T2-health-factor/
│   ├── T3-token-security/
│   └── T4-yield-routing/
├── grading/
│   ├── rubric.md
│   ├── rater-A.csv
│   └── rater-B.csv
└── evidence/
    ├── tx-hashes.md           # semua tx BscScan
    └── agent-ids.md           # agentId ERC-8004 + order TermiX
```

---

### B.6.2 Empat task yang direkomendasikan

Semuanya memakai stack yang kita bangun, dan **T3 memenuhi syarat "minimal 1 task trading/stock/security"** (bahkan T1 & T3 dua-duanya memenuhi).

#### **T1 — Rebalancing posisi LP PancakeSwap v3** *(kategori: trading — high stakes)*

*Task:* "Diberikan posisi v3 CAKE/BNB dengan range [tickLower, tickUpper] yang sudah keluar range, tentukan range baru yang optimal untuk horizon 7 hari, hitung fee yang belum diklaim, estimasi gas rebalance, dan tentukan apakah rebalance menguntungkan setelah biaya. Hasilkan rencana eksekusi."

- **Baseline:** buka UI PancakeSwap, baca posisi manual, salin ke spreadsheet, hitung fee APR dari data pool, estimasi gas via BscScan, putuskan.
- **Agent:** agent rebalancing Fugugent + `pancakeMyPosition` (bsc-mcp) + data subgraph.
- **Metrik tambahan:** akurasi ambang break-even (bandingkan dengan perhitungan ground truth yang dihitung terpisah), apakah range yang diusulkan benar-benar mengandung harga selama 7 hari berikutnya (backtest).

#### **T2 — Monitor & remediasi health factor** *(kategori: risk)*

*Task:* "Untuk wallet X dengan posisi pinjam di protokol lending BSC, hitung health factor saat ini, harga likuidasi per aset kolateral, jumlah tepat yang harus dibayar untuk mencapai HF 1.8, dan biaya melakukannya. Hasilkan pemberitahuan yang dapat ditindak."

- **Baseline:** UI protokol + kalkulator manual + oracle harga.
- **Agent:** agent health-factor Fugugent.
- **Metrik tambahan:** akurasi (bandingkan HF hitungan dengan yang dibaca on-chain), waktu deteksi saat harga bergerak (simulasikan dengan skenario harga historis).

#### **T3 — Audit keamanan token sebelum trading** *(kategori: security — high stakes)* ⭐ wajib

*Task:* "Diberikan 10 alamat token BEP-20 (campuran: aman, honeypot, high-tax, proxy upgradeable, unverified), klasifikasikan tiap token sebagai SAFE / CAUTION / AVOID dengan alasan tertulis dan bukti on-chain."

- **Baseline:** BscScan manual + baca kode + cek holder.
- **Agent:** `goplusSecurityCheck` (bsc-mcp) + agent analisis kita.
- **Metrik tambahan:** ini punya **ground truth** — precision/recall/F1 terhadap label yang sudah diketahui. **Confusion matrix adalah bukti paling kuat yang bisa kita tunjukkan ke juri.** Tekankan false-negative (token berbahaya diberi label SAFE) karena itu kerugian nyata.

#### **T4 — Riset routing yield lintas pool** *(kategori: yield)*

*Task:* "Cari alokasi terbaik untuk $10.000 stablecoin di pool BSC untuk horizon 30 hari, dengan kendala: TVL minimum $1jt, tanpa token unaudited, hitung APR bersih setelah gas dan estimasi impermanent loss. Peringkat 5 teratas dengan alasan."

- **Baseline:** DefiLlama + UI PancakeSwap + spreadsheet.
- **Agent:** agent yield-routing Fugugent.
- **Metrik tambahan:** APR realized setelah 7 hari vs APR yang diprediksi (error absolut).

---

### B.6.3 Rubrik kualitas (0–5 per dimensi)

| Dimensi | 0 | 3 | 5 |
|---|---|---|---|
| **Correctness** | Ada kesalahan faktual material | Sebagian besar benar, kesalahan minor | Semua angka cocok dengan ground truth on-chain |
| **Completeness** | Melewatkan >½ butir wajib | Mencakup butir inti | Semua butir wajib + risiko relevan |
| **Actionability** | Tidak ada langkah konkret | Rekomendasi umum | Tx/parameter persis, siap dieksekusi |
| **Evidence** | Tidak ada sumber | Sebagian dikutip | Setiap klaim menyertakan tx hash / alamat kontrak / URL |
| **Risk awareness** | Tidak menyebut downside | Menyebut risiko utama | Mengukur downside + memberi kondisi abort |

Skor akhir = rata-rata. Laporkan per-rater dan agreement-nya.

---

### B.6.4 Mengukur win rate & risk untuk trading agent

Bagian ini yang paling sering dibuat asal oleh peserta lain. Kalau kita mengerjakannya dengan benar, ini pembeda utama.

**Aturan dasar: jangan pernah melaporkan win rate tanpa distribusi payoff.** Win rate 90% dengan rata-rata loss 10× rata-rata win adalah strategi yang merugi. Selalu laporkan berpasangan.

#### Metrik minimum yang harus dilaporkan

| Metrik | Rumus | Kenapa penting |
|---|---|---|
| **Win rate** | `#trade menang / #trade total` | Perlu, tapi jauh dari cukup |
| **Profit factor** | `Σ profit kotor / \|Σ loss kotor\|` | >1 = menguntungkan; >1,5 layak |
| **Expectancy per trade** | `(WR × avgWin) − ((1−WR) × avgLoss)` | Nilai harapan riil per trade |
| **Payoff ratio** | `avgWin / avgLoss` | Pasangan wajib untuk win rate |
| **Max drawdown** | `max(peak − trough) / peak` pada kurva ekuitas | Risiko yang benar-benar dirasakan |
| **Sharpe (annualized)** | `(mean(r) − r_f) / std(r) × √periods` | Return per unit volatilitas |
| **Sortino** | seperti Sharpe tapi hanya deviasi downside | Tidak menghukum volatilitas naik |
| **Calmar** | `annualized return / max drawdown` | Return per unit nyeri terburuk |
| **Turnover & fee drag** | total volume / ekuitas; total fee+gas sebagai % PnL | Strategi HFT sering kalah di sini |
| **Slippage realized** | `(harga eksekusi − harga quote) / harga quote` | Bukti bahwa hasil bisa dicapai di dunia nyata |

#### Kontrol metodologi khusus trading

- **Out-of-sample / walk-forward.** Bagi periode: in-sample untuk tuning parameter, out-of-sample untuk pelaporan. Laporkan **hanya angka out-of-sample**. Sebutkan tanggalnya.
- **Sertakan biaya.** Fee swap PancakeSwap (0,01%/0,05%/0,25%/1% tergantung tier), gas BNB, dan slippage. Backtest tanpa biaya tidak akan dipercaya.
- **Hindari lookahead bias.** Setiap keputusan pada waktu *t* hanya boleh memakai data yang tersedia pada *t*. Kalau memakai data subgraph, pin block, jangan pakai `poolDayData` hari berjalan.
- **Hindari survivorship bias.** Sertakan pool/token yang mati selama periode uji.
- **Ukuran sampel.** Win rate dari 12 trade tidak bermakna. Target **≥100 trade** untuk backtest, atau kalau tidak mungkin, laporkan **confidence interval**: `WR ± 1.96 × √(WR(1−WR)/n)`. Katakan terus terang kalau n kecil.
- **Benchmark yang jelas.** Bandingkan terhadap (a) buy & hold aset dasar, (b) LP pasif full-range, (c) baseline manusia. "Mengalahkan buy & hold sebesar X%" jauh lebih berarti daripada "profit X%".
- **Paper-trade paralel.** Jalankan agent secara live di testnet/paper selama seluruh periode hackathon, catat setiap keputusan dengan timestamp. Track record berjalan (kriteria 20%) sangat berbobot untuk juri.

#### Cara menyajikan ke juri

Untuk task trading (T1), tampilkan:
1. **Kurva ekuitas** agent vs baseline vs buy & hold, dalam satu chart
2. **Tabel metrik** di atas, side-by-side
3. **Histogram distribusi PnL per trade** — memperlihatkan bentuk payoff, bukan hanya rata-rata
4. **Trade log** (CSV) dengan tx hash agar setiap baris bisa diverifikasi di BscScan
5. Satu paragraf **"kapan strategi ini gagal"** — kondisi pasar yang membuatnya rugi

#### Memenuhi kriteria "track record" (20%)

- Daftarkan agent Fugugent di **ERC-8004 BSC** → dapat `agentId`, riwayat on-chain sejak hari pertama
- Jalankan order nyata di **TermiX AACP** → `completedOrders`/`successfulOrders` di `TermixReputation` naik → `reputationScore` naik dari 60
- Kumpulkan **feedback ERC-8004** (`giveFeedback`) dari user beta → muncul di 8004scan sebagai `total_feedbacks` + `average_score`
- Semua ini **dapat diverifikasi publik** oleh juri lewat 8004scan dan BscScan — jauh lebih kuat daripada screenshot

#### Memenuhi "marketplace quality" (20%)
Discoverability: search + filter 4 kategori + peringkat berbasis skor v5 8004scan · badge trust (health, endpoint verified, publisher tier) · onboarding jelas · profil agent yang menampilkan bukti on-chain (tx hash, feedback, skor) · latensi rendah lewat cache lokal.

---

<!-- PANCAKESWAP_SECTION -->
