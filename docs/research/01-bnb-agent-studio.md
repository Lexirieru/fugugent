# BNB Agent Studio — Riset Teknis Mendalam

> **Tanggal riset:** 8 September 2026
> **Konteks:** Hackathon BNB Chain "The Smart Money Era: Build the Era" — membangun agent marketplace di BSC dengan 4 kategori (Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring).
> **Penulis:** riset agent (Claude Code)

## Legenda Status

| Tanda | Arti |
|---|---|
| ✅ **FAKTA TERVERIFIKASI** | Ada URL sumber, atau saya sendiri yang mengeksekusi (curl/RPC/tarball) dan melihat hasilnya |
| 🟡 **DUGAAN / BELUM DIVERIFIKASI** | Berasal dari ringkasan sekunder, blog pihak ketiga, atau inferensi saya |
| ❌ **TIDAK DITEMUKAN** | Sudah dicari, tidak ketemu — beserta apa yang sudah dicoba |

---

## 1. Ringkasan Eksekutif

**BNB Agent Studio** adalah toolkit BNB Chain untuk membangun, men-deploy, dan memonetisasi **"seller agent"** di BNB Smart Chain. Ia bukan framework strategi DeFi — ia adalah lapisan **identitas + komersial + deployment** untuk AI agent.

Tiga temuan terpenting untuk keputusan arsitektur kita:

1. **CLI-nya adalah paket npm, bukan Python.** `npm install --global @bnbagent/studio-cli` → binary bernama **`bag`**. Butuh **Node.js ≥ 22**. (Ada juga paket Python `bnbagent-studio` di PyPI tapi versinya jauh tertinggal — v0.0.5 vs v0.0.13 di npm. Gunakan npm.)

2. **Ada API discovery agent yang nyata dan publik — dua lapis:**
   - **On-chain (paling otoritatif):** kontrak ERC-8004 `AgentIdentity` di BSC mainnet `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` dan testnet `0x8004A818BFB912233c491871b3d84c89A494BD9e`. Saya sudah verifikasi keduanya live via RPC. Mainnet punya **340.785 agent** terdaftar per hari ini.
   - **API terindeks (paling praktis untuk UI):** **8004scan** di `https://api.8004scan.io/api/v1` — REST publik, punya OpenAPI spec, filter `chain_id=56`, semantic search, leaderboard, reputasi. Ini yang **secara eksplisit disebut sebagai required tech oleh panitia hackathon**, dengan free Pro tier untuk peserta.

3. **Agent dieksekusi sebagai container/zip di cloud (AWS Bedrock AgentCore, Azure AI Foundry, atau trial 48 jam milik BNB), dan agent memegang private key-nya sendiri.** Signing **tidak pernah** diekspos sebagai LLM tool — ia adalah kode tetap di `app/agent/src/signing.ts`. LLM hanya dapat read-only chain tools.

> ⚠️ **PERINGATAN JADWAL:** Halaman resmi hackathon menyebut periode build **5 Agustus – 9 September 2026**. Hari ini **8 September 2026**. Kalau tanggal itu akurat, kita punya waktu sangat sedikit. **Verifikasi ulang** di [halaman hackathon](https://www.bnbchain.org/en/hackathons/smart-money-era) sebelum merencanakan scope.

---

## 2. Apa Itu BNB Agent Studio — Arsitektur & Komponen

### 2.1 Posisi produk ✅

Dari [blog peluncuran resmi](https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt) dan deskripsi paket npm:

> "Skills-first toolkit and bag CLI for BNB Chain seller agents: ERC-8004 identity, ERC-8183 escrowed commerce, and x402 payments."
> — `package.json` dari `@bnbagent/studio-cli@0.0.13`

Studio menyelesaikan tiga masalah: **deployment**, **discoverability**, dan **continuity** agent.

### 2.2 Komponen ✅

Terverifikasi dari `package.json` dan README paket npm yang saya unduh & ekstrak:

| Paket | Peran | Versi (8 Sep 2026) |
|---|---|---|
| `@bnbagent/studio-cli` | CLI `bag` + IDE skills + recipes (scaffolding, wallet, diagnostics, deploy) | **0.0.13** (alpha: 0.0.14-alpha.1) |
| `@bnbagent/studio-runtime` | Library yang di-*import* oleh agent hasil generate | 0.0.13 |
| `@bnbagent/sdk` | Lapisan protokol BNB Chain (ERC-8004 / ERC-8183 / wallet / x402) | **0.5.5** |
| `@bnbagent/deploy-cli` | Lifecycle cloud deploy (di-pin oleh studio-cli) | 0.5.15 |
| `bnbagent` (PyPI) | SDK Python setara `@bnbagent/sdk` | 0.4.6 |
| `bnbagent-studio` (PyPI) | CLI `bag` versi Python — **tertinggal jauh** | 0.0.5 |

Sumber: `https://registry.npmjs.org/@bnbagent/studio-cli`, `https://registry.npmjs.org/@bnbagent/sdk`, `https://pypi.org/pypi/bnbagent/json`, `https://pypi.org/pypi/bnbagent-studio/json` — semua saya query langsung.

### 2.3 Lapisan arsitektur ✅

```
┌─ Development layer ──────────────────────────────────────┐
│ bag CLI  +  IDE skill /bnbagent-studio (Claude Code/Cursor)│
│ recipes/ → generate TypeScript project yang kita miliki   │
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

**Keterlibatan AWS** ✅: Blog resmi menyebut Studio "co-engineered with the AWS Generative AI Innovation Center". Runtime produksi default adalah **AWS Bedrock AgentCore**. `bag deploy prepare` bahkan melakukan read-only AgentCore quota check lewat AWS CLI (opsional, fail-open).

### 2.4 Standar yang dipakai ✅

- **ERC-8004** — identitas agent on-chain (ERC-721; token = agent).
- **ERC-8183** — "agentic commerce": job escrow bernegosiasi (kernel `AgenticCommerce` + `EvaluatorRouter` + `OptimisticPolicy`).
- **x402 / B402 / MPP** — pembayaran per-HTTP-request. B402 adalah rail settlement Binance; x402 dan MPP adalah dua adapter alternatif (tidak bisa dipilih bersamaan).
- **EIP-3009** (`TransferWithAuthorization`) — transfer gasless untuk pembayaran x402.
- **A2A** (agent-to-agent) & **MCP** — "public faces" agent.

---

## 3. Dokumentasi Resmi & Repositori

| Sumber | URL | Status |
|---|---|---|
| Landing page produk | https://www.bnbchain.org/en/bnb-agent-studio | ✅ |
| Blog peluncuran | https://www.bnbchain.org/en/blog/bnb-agent-studio-is-live-on-bnb-chain-ai-agents-from-one-prompt | ✅ |
| Docs Studio | https://docs.bnbchain.org/developer-kit/bnbchain-studio/ | ✅ |
| Docs CLI reference | https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/ | ✅ (⚠️ agak stale, lihat §4.3) |
| Docs SDK | https://docs.bnbchain.org/developer-kit/bnbagent-sdk/ | ✅ (sidebar terlihat) |
| GitHub SDK | https://github.com/bnb-chain/bnbagent-sdk | ✅ publik |
| GitHub Studio | https://github.com/bnb-chain/bnbagent-studio | ⚠️ **404 / private.** Dirujuk oleh `package.json` & README paket npm, tapi tidak dapat diakses publik saat riset ini (dicoba via API GitHub dan fetch langsung). Semua isi Studio yang saya dokumentasikan di bawah berasal dari **tarball npm**, bukan dari repo. |
| Contoh kode BNB Chain | https://github.com/bnb-chain/example-hub | ✅ publik |

**Struktur sidebar docs** ✅ (dari fetch `docs.bnbchain.org/developer-kit/bnbchain-studio/`):
`BNB Agent Studio` → Quickstart, Demo, Architecture, Configuration, CLI Reference, Deployment, Security, Troubleshooting.
`BNB Agent SDK` → Quickstart (TS), Quickstart (Python), Configuration, Architecture, **Networks & Contracts**, Examples, Security, Troubleshooting.

> ❌ URL persis halaman "Networks & Contracts" tidak berhasil saya tebak (`/developer-kit/bnbagent-sdk/networks-and-contracts/` → 404). Namun isinya sudah saya dapatkan langsung dari kode SDK — lihat §7.2, yang lebih otoritatif karena itulah yang benar-benar dipakai runtime.

---

## 4. CLI — Nama, Instalasi, Perintah

### 4.1 Nama paket & instalasi ✅

**Ini yang benar** (dari README `@bnbagent/studio-cli@0.0.13`):

```bash
npm install --global @bnbagent/studio-cli
bag skills install
```

- Nama paket npm: **`@bnbagent/studio-cli`**
- Nama binary: **`bag`** (dari `"bin": { "bag": "./dist/bag.js" }`)
- Lisensi: Apache-2.0
- `"engines": { "node": ">=22" }`
- Maintainer npm: `robotbnb <yolin@bnbchain.org>`, `jardenx <devin@bnbchain.org>`, `aiden-cao <aiden.c@nodereal.io>` — konsisten dengan kepemilikan BNB Chain ✅

> ⚠️ **Koreksi terhadap sumber sekunder.** Beberapa blog/ringkasan menyebut `pip install bnbagent-studio`. Paket PyPI itu **memang ada** (v0.0.5, deskripsi: "The `bag` CLI to scaffold and deploy a bnbagent-sdk seller agent on BNB Chain") tapi tertinggal 8 rilis dari npm. Blog resmi BNB Chain sendiri menyebut versi pip. **Rekomendasi: pakai npm.**

`bag skills install` mendeteksi Claude Code & Cursor dan memasang skill `/bnbagent-studio` + 14 reference playbook. Versi terskrip:

```bash
bag skills install --target both --scope user
```

### 4.2 Bahasa ✅

Proyek yang di-generate adalah **TypeScript murni**. README: *"Studio generates ordinary TypeScript under `app/agent/`"*. Python tersedia sebagai SDK protokol paralel (`pip install bnbagent`), bukan sebagai target scaffolding utama.

### 4.3 Grup perintah `bag` ✅

Dari README paket npm (sumber paling mutakhir):

| Area | Perintah |
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

⚠️ **Docs vs paket tidak sinkron.** Halaman CLI reference di docs.bnbchain.org masih mencantumkan `bag mcp serve`, `bag deploy agent`, `bag erc8183 publish` — sementara README paket 0.0.13 menyebut `deploy agent` sebagai *"deprecated compatibility alias"* dan menambahkan grup `mpp` + `platform` yang tidak ada di docs. **Source of truth = `bag --help` setelah install.**

### 4.4 Perintah scaffold ✅

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

**Aturan penamaan** ✅: harus diawali huruf, hanya ASCII huruf+angka, maksimal **23 karakter**. `-`, `_`, `.` **ditolak** (bukan di-rename). Ini aturan AgentCore.

**Default penting** ✅:
- network: `bsc-testnet`
- wallet: `evm-local`
- LLM: `pieverse-llm`, model `auto/free` ($0/token)
- protocols: `A2A,X402`
- rails: keduanya (8183 + B402)
- harga ERC-8183: `100000000000000000` (0.1 U)
- harga B402: `0.01` USD
- `--destination`: `platform` selama kampanye trial berjalan

### 4.5 Struktur proyek hasil generate ✅

```
<name>/
├── package.json                 workspace marker
├── pnpm-workspace.yaml          packages: ["app/agent"]
├── AGENTS.md                    safety rules untuk coding agent
├── agentcore/
│   ├── agentcore.json           deployment descriptor
│   └── aws-targets.json         AWS account + region
├── .studio/
│   ├── .env.local               secrets, gitignored, mode 0600
│   └── wallets/                 keystore terenkripsi (DI LUAR kode deployable)
└── app/agent/
    ├── studio.toml              ← file config utama
    ├── package.json             @bnbagent/studio-runtime + @bnbagent/sdk + ai
    ├── tsconfig.json
    ├── Dockerfile               hanya untuk container path (twak)
    └── src/
        ├── sellerCore.ts        ← LOGIKA BISNIS KITA (hook runWork)
        ├── signing.ts           quote/verify/submit — kode tetap, LLM tak pernah sentuh
        ├── tools.ts             read-only chain tools untuk LLM
        ├── model.ts             factory LanguageModel (AI SDK) + auto-topup
        ├── agentCard.ts         A2A agent card (/.well-known/agent-card.json)
        ├── executor.ts
        ├── unifiedMain.ts       entrypoint A2A + X402  (port 9000)
        ├── mcpMain.ts           entrypoint MCP-only    (port 8000/mcp)
        └── dualMain.ts          A2A + MCP gabungan
```

### 4.6 Format config: `app/agent/studio.toml` ✅

Section yang terverifikasi ada (di-grep dari bundle `dist/` CLI):

```
[network]                    default = "bsc-testnet" | "bsc-mainnet"
[wallet]                     kind = "evm-local" | "twak" | "altana"
[wallet.signing]             allowlist EIP-712 domain
[llm]                        provider, model
[llm.pieverse]
[llm.auto_renew]             enabled = true|false
[budget]                     max_per_day_usd
[payments.erc8183]           price (string desimal; "0" = FREE eksplisit)
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

Contoh merchant x402 (dari skill doc, format persis):
```toml
[payments.x402.merchants.cmc]
domain = "pro-api.coinmarketcap.com"
pay_to = "0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA"
per_call_cap_usd = 0.02
verified = true
```

---

## 5. Model Agent — Definisi, Eksekusi, Signing

### 5.1 Bagaimana agent didefinisikan ✅

Agent **bukan** file deklaratif YAML. Ia adalah **proyek TypeScript** dengan struktur tetap:

- **Kemampuan / skill** → diekspos lewat **A2A AgentCard** di `/.well-known/agent-card.json`. Scaffold default hanya punya **dua skill**: `negotiate` dan `notify_funded`. File `agentCard.ts` adalah milik kita — deskripsi skill di situlah tempat menaruh identitas kategori agent.
- **Tools LLM** → `app/agent/src/tools.ts`, dibungkus sebagai AI SDK `tool()`. Studio menyediakan **15 fungsi read-only** di `@bnbagent/studio-runtime/tools`:
  - Wallet/chain: `walletInfo`, `walletAddress`, `walletList`, `balanceNative`, `balanceU`, `networkInfo`, `txStatus`
  - LLM: `pieverseUsage`
  - ERC-8004: `agentInfo(agentId)`, `agentByAddress(address)`
  - ERC-8183: `jobStatus`, `jobList`, `jobCount`
  - Advanced (ditandai "footgun"): `blockInfo`, `contractCallView` (arbitrary `eth_call` — rawan prompt injection)
- **Pekerjaan yang dijual** → hook `runWork` di `app/agent/src/sellerCore.ts`.
- **Trigger / schedule** → ⚠️ **TIDAK ADA scheduler bawaan.** README eksplisit: *"There is **no** background poller."* Agent bersifat **reaktif**: dipicu oleh pesan A2A `notify_funded`, request HTTP `/x402` atau `/mpp`, atau tool call MCP. Ada "best-effort in-process sweep" job FUNDED lain saat `notify_funded` masuk, itu saja. **Implikasi besar untuk kita:** agent monitoring (health factor, grid) yang butuh polling periodik harus punya scheduler sendiri (EventBridge/cron), tidak disediakan Studio.

### 5.2 Bagaimana agent dieksekusi ✅

Satu runtime, satu signer, beberapa "public faces":

| Face | Surface lokal | Perilaku |
|---|---|---|
| A2A | agent card + JSON-RPC di port `9000` | `negotiate` + `notify_funded` (delivery di background) |
| MCP | Streamable HTTP `http://localhost:8000/mcp` | operasi seller yang sama, delivery sinkron |
| A2A + MCP | A2A-native `:9000`, `/mcp` di-tunnel | shared seller core/wallet |
| X402 | `/x402` | 1 request berbayar atau FREE |
| MPP | `/mpp` | alternatif X402 |

**Target deployment** ✅ (tiga, dan setiap `bag deploy` **wajib** memilih eksplisit — tidak ada default diam-diam):

1. **BNB managed trial** — `bag platform login && bag platform credit && bag deploy --provider bnb`. Sandbox **BSC testnet 48 jam** di cloud operator. Jam mulai dari deploy sukses pertama; redeploy tidak mereset. Resource direklamasi otomatis saat expired.
2. **AWS Bedrock AgentCore (akun sendiri)** — `bag deploy --provider aws`. Memvalidasi identitas AWS, build, provisioning runtime secrets + inbound Cognito OAuth, mencatat endpoint live.
3. **Azure AI Foundry** — `bag deploy --provider azure`. ⚠️ Azure **menolak MCP**.

Deploy default `evm-local` adalah **code-zip** (tidak butuh Docker). Path container (mis. `twak`) butuh Docker. Semua mutasi cloud didelegasikan ke `@bnbagent/deploy-cli` yang dijalankan via `bunx --bun` → **butuh Bun 1.3+**.

Lifecycle: `bag deploy status | logs --provider X | verify --provider X | destroy --provider X [--execute]`.

### 5.3 Bagaimana agent memegang dana & menandatangani ✅ (KRITIS)

**Prinsip inti (dari "5 core commitments" skill doc):**

> *"Signing is fixed handler code, never an LLM-callable tool."*
> *"ALL signing is fixed entrypoint code in `app/agent/src/signing.ts` or the runtime's bounded x402 payment handler, never an LLM-callable tool."*

Tiga pilihan custody:

| Wallet | Model custody | Packaging | Catatan |
|---|---|---|---|
| **`evm-local`** (default) | Keystore V3 terenkripsi di `.studio/wallets/` (workspace root, **di luar** codeLocation deploy) | code zip | Password lewat `WALLET_PASSWORD` di `.studio/.env.local`. Saat deploy, material key di-inject via secret channel provider (AWS Secrets Manager). |
| **`twak`** | Trust Wallet Agent Kit, self-custody, home terdedikasi `.studio/twak` | container | Butuh TWAK CLI ≥0.20.0 + Docker |
| **`altana`** | **Session key EIP-7702** — admin keystore tetap lokal, runtime hanya menerima `ALTANA_SESSION` yang dibatasi budget & waktu | zip | Tidak kompatibel dengan `pieverse-llm` atau paid B402 rail. Payout B402 mendarat di alamat admin. Bisa di-revoke/renew eksplisit. |

Provider wallet di level SDK ✅ (dari README `bnbagent-sdk`): `EVMWalletProvider` (keystore lokal), `TWAKProvider`, `AltanaWalletProvider` (EIP-7702 session keys, TS-only), `TurnkeyWalletProvider` (AWS Nitro enclaves), `MPCWalletProvider` (stub).

**⚠️ Peringatan keamanan penting** ✅: untuk **BNB managed trial**, material signing `evm-local`/`twak` **dikirim ke managed secret store operator**. Dokumen resmi: *"Use a fresh testnet-only wallet and never reuse it on mainnet."* Untuk track Altana hackathon, hanya bounded session yang dikirim — ini alasan teknis kenapa panitia mensyaratkan session keys.

**Batas pengeluaran berlapis** ✅: `per_call_cap_usd` (per merchant) → `[payments.x402].max_per_request_usd` → `[budget].max_per_day_usd` (ledger bersama di `.studio/spend-ledger.json`). LLM **tidak bisa** melebarkan cap maupun mengubah `pay_to`.

### 5.4 Model monetisasi ✅

- **ERC-8183 (job escrow):** buyer `negotiate` → dapat quote ber-tanda-tangan EIP-191 (harga di-clamp kode, **tanpa LLM**) → `createJob` → `registerJob` → `setBudget` → `fund` → buyer kirim `notify_funded` → seller verifikasi on-chain → kerjakan → `submit` deliverable → buyer `settle`. **Dispute window 24 jam** on-chain; `approve` sebelum itu revert dengan `0x17be5b7b`.
- **x402/MPP (bayar per request):** harga positif → payment challenge → settle via B402 sebelum kerja. `price_usd = "0"` → FREE passthrough anonim.

---

## 6. Discovery / Registry — Cara Marketplace Kita Mendapat Data Agent

**Ini bagian paling penting untuk kita.** Ada **dua jalur**, dan saya sarankan pakai keduanya.

### 6.1 Jalur A — 8004scan REST API (rekomendasi utama untuk UI) ✅

**Base URL:** `https://api.8004scan.io/api/v1`
**OpenAPI spec:** `https://api.8004scan.io/openapi.json` — ✅ saya unduh, HTTP 200, 426 KB, `"title": "8004scan Backend API", "version": "0.4.367"`.
**Dokumentasi:** https://8004scan.io/developers · https://docs.altlayer.io/altlayer-documentation/8004-scan/overview
**Dibuat oleh:** AltLayer (https://altlayer.io/8004scan)

**Auth:** header `X-API-Key: YOUR_API_KEY`. Tanpa key tetap bisa dipakai (anonymous tier).

**Rate limit** ✅ (dari halaman developers):

| Tier | Req/menit | Req/hari |
|---|---|---|
| Anonymous | 30 | 1.000 |
| Free API | 600 | 100.000 |
| **Pro (gratis untuk peserta hackathon)** | 500/min, 100.000/hari | via [form ini](https://forms.gle/jQevEPCAacBXaKG79) |

Header respons: `X-RateLimit-Tier`, `X-RateLimit-Limit-Minute`, `X-RateLimit-Remaining-Minute`, `X-RateLimit-Limit-Day`, `X-RateLimit-Remaining-Day`.

**Endpoint yang relevan untuk marketplace** ✅ (diambil dari OpenAPI spec yang saya parse):

```
GET /api/v1/agents                                  ← endpoint utama listing
GET /api/v1/agents/{chain_id}/{token_id}            ← detail 1 agent
GET /api/v1/agents/{chain_id}/{registry_address}/{token_id}
GET /api/v1/agents/search/semantic                  ← pencarian bahasa natural
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
GET /api/v1/stats/oasf/skills                       ← taksonomi skill!
GET /api/v1/stats/oasf/domains                      ← taksonomi domain!
GET /api/v1/feedbacks                               ← reputasi
GET /api/v1/wallets/{address}/agents
GET /api/v1/chains
POST /api/v1/agents/{chain_id}/{token_id}/health-check
POST /api/v1/agents/verify-endpoint/{chain_id}/{token_id}
POST /api/v1/webhooks/register                      ← webhook untuk update realtime
GET /api/v1/mcp/tools/search_agents                 ← ada MCP surface juga
```

**Parameter `GET /api/v1/agents`** ✅ (persis dari OpenAPI spec — inilah yang bikin 4 kategori kita bisa difilter):

```
limit (default 20), offset (default 0)
chain_id                → 56 (BSC mainnet) / 97 (BSC testnet)
is_testnet              → true|false
owner_address
owner_publisher_tier    → OFFICIAL | VERIFIED | COMMUNITY
supported_protocol      → MCP, A2A, ...
x402_supported          → bool
is_active               → default "true" (field `active` dari ERC-8004)
is_endpoint_verified    → bool   ← PENTING: saring agent yang endpoint-nya benar hidup
supported_trust         → reputation | crypto-economic | tee-attestation
has_mcp / has_a2a / has_oasf   → bool
is_registered           → default "true"
oasf_skill[]            → filter skill OASF (OR logic)
oasf_domain[]           → filter domain OASF (OR logic)
search, search_type (auto), search_fields
min_feedbacks, min_validations, min_score (0-100)
created_after, created_before (ISO 8601)
tags                    → comma-separated (OR)
categories              → comma-separated (OR)      ← relevan untuk 4 kategori kita
sort_by                 → created_at | stars | name | token_id | (score dimensions)
sort_order              → asc | desc
```

**`GET /api/v1/agents/search/semantic`**: `q`, `limit`, `offset`, `chain_id`, `is_active`, `semantic_weight` (0=pure text … 1=pure semantic, default 0.5), `similarity_threshold` (default 0.5).

**Bentuk respons** ✅ (saya lihat langsung): `{"items": [ {...agent...} ], "total": N, ...}`. Field agent mencakup antara lain `id`, `owner_id`, `token_id`, `chain_id`, `name`, `description`, `is_active`, `total_score`.

**Uji hidup yang saya lakukan** ✅:
- `GET /api/v1/chains` → HTTP 200. BSC ada: `{"chain_key":"bsc_mainnet","chain_id":56,"name":"BSC","is_testnet":false,"enabled":true}` dan `{"chain_key":"bsc_testnet","chain_id":97,"name":"BSC Testnet","is_testnet":true,"enabled":true}`.
- `GET /api/v1/stats/global` → HTTP 200: **`total_agents: 820100`**, `total_users: 458338`, `total_feedbacks: 3654749`, `daily_new_agents: 3589`, `average_feedback_score: 82.6`.
- `GET /api/v1/agents/search/semantic?q=grid trading&chain_id=56&limit=3` → HTTP 200, mengembalikan `{"items":[...]}` berisi agent nyata.

**⚠️ MASALAH RELIABILITAS — WAJIB DIPERHITUNGKAN DALAM ARSITEKTUR** ✅:
API ini **sering mengembalikan** `{"success":false,"error":{"code":"DATABASE_ERROR","message":"Database error occurred"}}` dengan HTTP 500 secara **intermiten**. Dalam pengujian saya, 4 dari 5 percobaan berturut-turut gagal sebelum satu berhasil. Setelah ±50 request saya juga kena **HTTP 403** (rate limit anonymous tier).

**Rekomendasi arsitektur:**
1. Ambil API key Pro gratis via form hackathon **sekarang**.
2. **Jangan panggil 8004scan langsung dari browser.** Dokumentasi mereka sendiri menyarankan "server-first authentication". Buat proxy/BFF di backend kita.
3. **Cache agresif + retry with backoff.** Kriteria juri "Data Quality" 35% — marketplace yang blank karena upstream 500 akan hancur nilainya.
4. Siapkan **fallback ke pembacaan on-chain langsung** (Jalur B) supaya demo tidak pernah kosong.

### 6.2 Jalur B — Baca langsung ERC-8004 on-chain (fallback & source of truth) ✅

**Alamat kontrak — SAYA VERIFIKASI SENDIRI VIA RPC:**

| Network | Chain ID | Alamat `AgentIdentity` registry | Bukti |
|---|---|---|---|
| **BSC Mainnet** | 56 | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `eth_getCode` non-kosong; `name()` → `"AgentIdentity"`; `symbol()` → `"AGENT"` |
| **BSC Testnet** | 97 | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | idem, `eth_chainId` → `0x61` (97) |

Sumber alamat: konstanta `NETWORKS` di dalam bundle `@bnbagent/sdk@0.5.5` (`dist/chunk-DSR5PNLX.js`), lalu saya konfirmasi live lewat `eth_call` ke RPC publik BSC.

**Registry ini adalah ERC-721.** Setiap agent = 1 token. `name()` = `AgentIdentity`, `symbol()` = `AGENT`.

**ABI penting** ✅ (diekstrak dari bundle SDK, 65 entri):

```solidity
// EVENTS — inilah yang kita index
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
event MetadataSet(uint256 indexed agentId, string indexed indexedMetadataKey,
                  string metadataKey, bytes metadataValue);
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId); // ganti kepemilikan
event MetadataUpdate(uint256 _tokenId);
event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

// READS — inilah yang kita panggil untuk render kartu agent
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

**Topic hash event (siap dipakai untuk `eth_getLogs`)** ✅ — saya hitung dengan `cast keccak`:

```
Registered(uint256,string,address)              → 0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a
URIUpdated(uint256,string,address)              → 0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb
MetadataSet(uint256,string,string,bytes)        → 0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b
keccak256("built_with")  (untuk topic2 MetadataSet) → 0xba3c72985a276b7df84ee744b387a3ebb5bc20fc15befa203130d9432939c115
```

`getMetadata(uint256,string)` selector = `0xcb4799f2`.

**Skala nyata** ✅ — saya lakukan binary search `ownerOf()` di mainnet:
> **agentId tertinggi yang ada di BSC mainnet = 340.785**

Token ID bersifat **sekuensial** mulai dari 1, jadi enumerasi mudah.

**Format metadata: `tokenURI` bervariasi — ini jebakan besar** ✅. Saya sampling langsung dan menemukan **lima bentuk berbeda**:

| agentId | Bentuk `tokenURI` |
|---|---|
| 340785 | `data:application/json;base64,...` ← format kanonik |
| 10 | `data:application/json;enc=gzip;level=6;base64,H4sI...` ← **gzip** |
| 50 | `ipfs://QmW79S38Xd3oda1qQ1DG8wYY1h3ue7hfsf6gryguh51q25` |
| 50000 | `https://build4.io/api/standards/erc8004/agent-card/7caf3b02-...` |
| 150000–340700 | `https://metadata.evoevo.ai/agents/4778808` |
| 2 | `0x6446ad9821021eeb9f85b8a18b0153d58166d161` ← bukan URI sama sekali |
| 5000 | `{"name":"babycaisubagent-99","description":"..."}` ← JSON telanjang, bukan data URI |
| 1000, 10000 | string kosong / spasi |

**Implikasi:** parser kita harus menangani `data:` (base64 + gzip), `ipfs://`, `https://`, JSON telanjang, dan string sampah — dengan graceful degradation. **Jangan asumsikan satu format.**

**Contoh registration file yang valid** ✅ (agentId 1, mainnet, hasil decode base64 oleh saya):

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

**Ini skema data marketplace kita.** Perhatikan:
- `services[].name == "OASF"` membawa **`skills[]` dan `domains[]` terstruktur** → **inilah kunci untuk mengklasifikasikan 4 kategori kita** (dan juga kenapa 8004scan punya filter `oasf_skill` / `oasf_domain`).
- `services[].name == "agentWallet"` memberi alamat wallet agent dalam format CAIP-10 → bisa dipakai untuk menampilkan aktivitas on-chain / P&L nyata.
- `active` dan `x402Support` adalah flag yang dideklarasikan pemilik.
- Endpoint A2A ditemukan di `services[].name == "A2A"`, dan kartu lengkapnya di `{endpoint}/.well-known/agent-card.json`.

**⚠️ Realita kualitas data** ✅: dari sampling saya, **mayoritas dari 340k agent adalah spam / bulk registration** (satu farm `metadata.evoevo.ai` mendominasi rentang 150.000–340.700; banyak entri lain kosong). Marketplace kita **harus** memfilter. Filter yang tersedia:
- `is_endpoint_verified=true` di 8004scan
- `owner_publisher_tier=OFFICIAL|VERIFIED`
- `min_score` / `min_feedbacks`
- `has_a2a=true` (agent yang benar-benar bisa "dipekerjakan")
- metadata `built_with` (lihat di bawah)

**Menandai agent buatan BNB Agent Studio** 🟡: SDK **otomatis meng-inject** metadata entry dengan key **`built_with`** bernilai `https://github.com/bnb-chain/bnbagent-sdk#v<version>` pada setiap registrasi (terverifikasi dari `ContractInterface.injectBuiltWith` + konstanta `BUILT_WITH_KEY = "built_with"` di `@bnbagent/sdk`). Artinya **`getMetadata(agentId, "built_with")` adalah cara membedakan agent Studio dari 340k agent lain** — dan `MetadataSet` dengan `topic2 = 0xba3c7298...` bisa di-`eth_getLogs` untuk menemukan semuanya.
Saya sempat memanggil `getMetadata` pada agent #1, #100000, #340785 → semuanya `0x` (kosong), artinya agent-agent itu bukan buatan Studio. Saya **belum sempat menyelesaikan** `eth_getLogs` bertopik `built_with` (query range besar di RPC publik terlalu lambat, job timeout 120s). **Ini item aksi prioritas tinggi** — lihat §11.

### 6.3 Jalur C — Katalog Binance Bazaar (B402) 🟡

Dari skill doc `bnbagent-studio-buying-from-bazaar.md` (isi paket npm, jadi teks-nya ✅ terverifikasi):

> "**Bazaar** (`https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/…`) — a public, auth-free **catalog** of x402 merchants."

Endpoint yang didokumentasikan:
```
GET .../bazaar/search?query=<keyword>&limit=10
GET .../bazaar/resources
GET .../bazaar/merchant?payTo=0x…
```
Tiap resource membawa `accepts[]` (siapa dibayar, aset apa, chain mana) dan sinyal kualitas 30 hari: `l30DaysTotalCalls`, `l30DaysUniquePayers`.

❌ **Saya TIDAK BISA memverifikasi endpoint ini.** `curl` ke `www.binance.com` gagal connect dari lingkungan riset ini — DNS resolve ke `202.169.44.80` lalu "Connection refused" (kemungkinan besar pemblokiran tingkat ISP di Indonesia). **Tim harus menguji sendiri dari jaringan lain / VPN sebelum bergantung padanya.** Perhatikan juga: ini katalog **merchant x402**, bukan katalog agent ERC-8004 — cakupannya berbeda dari kebutuhan utama kita.

### 6.4 Endpoint yang saya coba dan GAGAL ❌

Supaya tidak diulang:

| URL | Hasil |
|---|---|
| `https://8004scan.io/api/agents?chain=56` | HTTP 404 (HTML Next.js) |
| `https://api.8004scan.io/agents?chain=56` | HTTP 404 `{"detail":"Not Found"}` |
| `https://api.8004scan.io/v1/agents` | HTTP 404 |
| `https://api.8004scan.io/api/v1/openapi.json` | HTTP 404 (spec ada di root: `/openapi.json`) |
| `https://api.8004scan.io/docs` | HTTP 404 |
| `https://8004scan.io/api/v1/agents?chain=56` | HTTP 500 DATABASE_ERROR (path frontend proxy, bukan yang benar) |
| `https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks-and-contracts/` | HTTP 404 (nama slug tidak tertebak) |
| `https://github.com/bnb-chain/bnbagent-studio` | 404 / private |
| `https://www.binance.com/bapi/...` | Connection refused (network riset) |

❌ **Tidak ditemukan:** API discovery **resmi milik BNB Agent Studio sendiri** (mis. `studio.bnbchain.org/api/agents`) yang melist agent live. `https://bnbagent-api.bnbchain.world` muncul di bundle CLI, tapi itu adalah **API platform trial** (auth-gated, untuk hosting deliverable & lifecycle agent milik sendiri), **bukan** direktori publik. Jangan andalkan itu untuk marketplace.

**Kesimpulan §6:** Discovery agent = **8004scan API (primer) + ERC-8004 on-chain (fallback/verifikasi)**. Tidak ada API marketplace resmi selain itu.

---

## 7. Konfigurasi Jaringan & Kontrak

### 7.1 Network BSC ✅

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | **56** (`0x38`) | **97** (`0x61`) |
| RPC default SDK | `https://bsc-dataseed.binance.org` | `https://data-seed-prebsc-2-s2.binance.org:8545` |
| Paymaster (MegaFuel) | `https://bsc-megafuel.nodereal.io/` | `https://bsc-megafuel-testnet.nodereal.io` |
| Gas sponsorship | ❌ tidak pernah | ✅ default aktif untuk kontrak kanonik |
| Explorer | bscscan.com | testnet.bscscan.com |

⚠️ **RPC default SDK memakai domain `binance.org` yang tidak bisa saya jangkau** (diblokir jaringan). RPC publik yang **saya uji dan berhasil** (`eth_chainId` → `0x38`):
- ✅ `https://bsc-dataseed.bnbchain.org`
- ✅ `https://bsc-rpc.publicnode.com`
- ✅ `https://1rpc.io/bnb`
- ❌ `https://binance.llamarpc.com` (kosong)

Testnet yang berhasil: ✅ `https://data-seed-prebsc-1-s1.bnbchain.org:8545` (`eth_chainId` → `0x61`).

**Set `RPC_URL` di env** — recipe CLI sendiri memperingatkan: *"Set it to avoid the rate-limited public BSC RPC default."*

### 7.2 Alamat kontrak ✅ (dari konstanta `NETWORKS` & `BNB_CHAIN_ADDRESSES` di `@bnbagent/sdk@0.5.5`)

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
$U token (ERC-8183 testnet)   0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565   (18 desimal)
```
> README CLI mengonfirmasi alamat U testnet: *"The ERC-8183 testnet U contract is `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565`. Do not substitute the 6-decimal B402/x402 test token; it belongs to a different rail."*

EIP-712 domain token pembayaran: `name = "United Stables"`, `version = "1"` (diverifikasi tim SDK terhadap `DOMAIN_SEPARATOR()` on-chain).

Alamat lain yang terlihat: `0x3C5f3a6cE224BB89D72f5EB4232ecC27F67B3eeA` = `pay_to` merchant CoinMarketCap x402.

### 7.3 Faucet ✅

- **tBNB & U via Telegram bot resmi:** https://t.me/bnbchain_official_bot
  - `I would like to get tBNB to my wallet <address>` (maks 0,3 tBNB/hari)
  - `I would like to get U to my wallet <address>`
- Faucet web: https://testnet.bnbchain.org/faucet-smart
- Faucet U alternatif: https://united-coin-u.github.io/u-faucet/
- Docs faucet: https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/

---

## 8. Template Agent untuk 4 Kategori Kita

### 8.1 Temuan negatif penting ✅

**Tidak ada template siap pakai untuk keempat kategori.** Saya mengunduh dan mengekstrak seluruh tarball `@bnbagent/studio-cli@0.0.13` (60 file). Isi lengkap `recipes/` dan `skills/`:

**Recipes (template kode):**
```
recipes/agent/              signing.ts (quote/verify/submit)
recipes/wallet/
recipes/tools-chain/        chainTools.ts (15 fungsi read-only)
recipes/x402-buyer/         x402Buyer.ts
recipes/mpp-buyer/          mppBuyer.ts
recipes/providers/pieverse-llm/
recipes/runtimes/agentcore/       executor, model, Dockerfile, sellerCore,
                                  tools, agentCard, unifiedMain, mcpMain, dualMain
recipes/runtimes/azure-foundry/   (idem)
```

**Skills (14 playbook):** scaffolding-agent, adding-to-project, operating, selling-via-8183, selling-via-b402, buying-via-8183, buying-from-bazaar, buying-via-mpp, extending-signing, use-bnb-trial, use-aws-agentcore, use-azure-foundry, using-twak-wallet, using-altana-wallet, wiring-llm-tools.

**Semuanya tentang plumbing komersial agent** (identitas, pembayaran, deployment). **Nol** yang menyentuh rebalancing, grid trading, yield optimization, atau health factor. Hal yang sama berlaku untuk `bnb-chain/bnbagent-sdk` (isinya `abis/`: AgenticCommerce.json, ERC20.json, EvaluatorRouter.json, IdentityRegistry.json, OptimisticPolicy.json) dan `bnb-chain/example-hub`.

🟡 Beberapa sumber pers menyebut BNB Chain akan "share reference agents and skills spanning four categories: monitoring, grid trading, health factor, yield". ❌ Saya **tidak menemukan** halaman docs yang memuatnya. Perlu dicek ulang: jalankan `bag skills install` versi terbaru (ada `0.0.14-alpha.1` yang belum saya periksa) dan lihat halaman hackathon untuk "reference agents".

**Implikasi arsitektur:** logika strategi keempat kategori **harus kita bangun sendiri**, lalu di-wire lewat `sellerCore.ts` (`runWork`) dan `tools.ts`. Studio memberi kita identitas + monetisasi + hosting, bukan alpha.

### 8.2 Protokol DeFi di BSC yang relevan

Diverifikasi oleh sub-agent riset; tingkat keyakinan bervariasi — **cek ulang sebelum hardcode**.

**PancakeSwap v3** ✅
- `NonfungiblePositionManager` (BSC 56): `0x46A15B0b27311cedF172ab29E4f4766fbE7F4364`
- Panduan resmi khusus agent: https://docs.pancakeswap.finance/trading-tools/building-trading-agents-on-pancakeswap-v3
- Developer portal: https://developer.pancakeswap.finance/
- 🟡 Endpoint subgraph: **konflik antar sumber** (dua ID subgraph berbeda ditemukan). Untuk hackathon lebih aman baca posisi LP langsung on-chain via `positions(tokenId)`.
- Relevan untuk: **Rebalancing (LP range)**, **Grid Trading**.

**Venus Protocol** ✅ (sumber: `https://raw.githubusercontent.com/VenusProtocol/venus-protocol/master/deployments/bscmainnet_addresses.json`)
- Comptroller (Unitroller): `0xfD36E2c2a6789Db23113685031d7F16329158384`
- vBNB `0xA07c5b74C9B40447a954e1466938b865b6BBea36`, vUSDC `0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8`, vUSDT `0xfD5840Cd36d94D7229439859C0112a4185BC0255`
- Health read: `getAccountLiquidity(address) → (error, liquidity, shortfall)`; `shortfall > 0` = liquidatable.
- API: `https://api.venus.io` / `https://testnetapi.venus.io`
- ⚠️ **Docs Venus eksplisit melarang** memakai API-nya untuk balance/harga/keamanan likuidasi (data terindeks, bisa lag). **Untuk agent Health Factor, baca `getAccountLiquidity` live via RPC.**
- Relevan untuk: **Health Factor Monitoring**, **Yield Optimisation**.

**Aave v3 di BNB Chain** ✅ (sumber: `https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3BNB.sol`)
- PoolAddressesProvider `0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D`
- **Pool** `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`
- AaveOracle `0x39bc1bfDa2130d6Bb6DBEfd366939b4c7aa7C697`
- AaveProtocolDataProvider `0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328`
- Health read: `Pool.getUserAccountData(address) → (..., healthFactor)`
- Relevan untuk: **Health Factor Monitoring**.

**Lista DAO** 🟡 — semua alamat di bawah **BELUM terverifikasi dari sumber primer**, hanya dari ringkasan halaman docs:
- Interaction (CDP) `0xB68443Ee3e828baD1526b3e0Bdf2Dfc6b1975ec4`, lisUSD `0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5`, slisBNB `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B`
- Docs: https://docs.bsc.lista.org/
- ❌ Cara baca health/collateral-ratio CDP **tidak ditemukan**. Perlu baca ABI `Interaction` di BscScan.

---

## 9. Requirement Environment

✅ Dari README `@bnbagent/studio-cli@0.0.13`:

| Kebutuhan | Detail | Kapan |
|---|---|---|
| **Node.js ≥ 22** | `"engines": {"node": ">=22"}` | selalu |
| **Claude Code atau Cursor** | untuk skill `/bnbagent-studio` | alur yang direkomendasikan |
| **Corepack + pnpm 10** | workspace hasil generate | setelah `bag init` |
| **Bun ≥ 1.3** | `bag deploy` menjalankan `@bnbagent/deploy-cli` via `bunx --bun` | hanya saat deploy |
| **Docker** | hanya container path (`twak`) | opsional |
| **AWS CLI** | hanya read-only AgentCore quota check | opsional, fail-open |
| **npm `@aws/agentcore` CLI** | hanya untuk `bag dev --container` | opsional |

**Kredensial / akun:**
- LLM: default **Pieverse** dengan model `auto/free` = **$0/token, tanpa API key sendiri**. Alternatif (OpenRouter/OpenAI/Anthropic/Bedrock) pakai kredensial kita.
- Wallet: dibuat lokal oleh `bag wallet new`; `WALLET_PASSWORD` di `.studio/.env.local`.
- BNB trial: `bag platform login` (GitHub device flow).
- AWS/Azure: akun sendiri kalau self-deploy.
- **8004scan API key**: via form Pro tier hackathon.

**Env vars penting:** `WALLET_PASSWORD`, `PIEVERSE_LLM_API_KEY`, `RPC_URL`, `STORAGE_API_URL`, `STORAGE_API_KEY`, `MPP_SECRET_KEY` (≥32 byte, mode MPP berbayar), `MPP_REALM`, `ERC8004_REGISTRY_ADDRESS` (override), `ERC8183_COMMERCE_ADDRESS` / `_ROUTER_ADDRESS` / `_POLICY_ADDRESS`, `BNBAGENT_USE_PAYMASTER=0`, `ALTANA_SESSION`, `BNBAGENT_DEPLOY_COMMAND`.

---

## 10. Langkah Instalasi di macOS (Darwin arm64)

🟡 **Belum saya eksekusi** — disusun dari README resmi. Beri waktu untuk troubleshooting.

```bash
# 0. Cek Node ≥ 22 (WAJIB)
node -v
# kalau < 22:
#   brew install node@22   ATAU   nvm install 22 && nvm use 22

# 1. Install CLI global
npm install --global @bnbagent/studio-cli
bag --version                      # sanity check

# 2. Install IDE skill (deteksi Claude Code / Cursor)
bag skills install --target both --scope user
#    → RESTART / reload IDE setelah ini

# 3. Prasyarat workspace
corepack enable && corepack prepare pnpm@10 --activate

# 4. Bun (hanya dibutuhkan saat deploy) — Apple Silicon didukung native
curl -fsSL https://bun.sh/install | bash
bun --version                      # butuh ≥ 1.3

# 5. Scaffold agent pertama (testnet, non-interaktif)
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
bag wallet new                     # password lewat prompt tersembunyi, JANGAN di argumen
bag wallet show                    # copy alamat
#    → minta tBNB & U ke https://t.me/bnbchain_official_bot
bag wallet balance --all

# 7. Diagnostik + jalankan lokal
bag doctor
bag dev
#    A2A card: http://localhost:9000/.well-known/agent-card.json
#    MCP:      http://localhost:8000/mcp

# 8. Deploy (pilih provider EKSPLISIT)
bag deploy prepare
bag deploy --provider bnb          # trial testnet 48 jam
#   atau: bag platform login && bag platform credit && bag deploy --provider bnb
bag deploy verify --provider bnb   # ← mendaftarkan/meng-update endpoint ERC-8004

# 9. Registrasi identitas manual (kalau perlu di luar alur verify)
bag erc8004 register --endpoint https://<url-agent-kita>
bag erc8004 show
bag erc8004 resolve <agent_id>
```

### Kemungkinan kendala di macOS arm64

| Kendala | Mitigasi |
|---|---|
| **Node < 22** | Paling sering. `nvm use 22`. Perhatikan `npm -g` terikat ke versi Node aktif. |
| **`npm install -g` butuh sudo** | Pakai nvm/fnm, jangan Node bawaan sistem. |
| **`bunx` tidak ada saat deploy** | `bag deploy prepare` gagal CRITICAL. Install Bun ≥1.3 dulu. |
| **Konflik CLI `agentcore`** | Kalau `bedrock-agentcore-starter-toolkit` (Python) menang di PATH, `bag dev --container` rusak. Pastikan npm `@aws/agentcore` yang duluan. |
| **RPC publik ter-rate-limit** | Set `RPC_URL` ke RPC berdedikasi. |
| **RPC default `binance.org` diblokir ISP** ✅ terkonfirmasi di lingkungan riset ini | Override ke `https://bsc-dataseed.bnbchain.org` atau `https://bsc-rpc.publicnode.com`. **Kemungkinan besar kita kena juga di Indonesia.** |
| **`www.binance.com` diblokir** ✅ terkonfirmasi | Bazaar/B402 discovery tidak akan jalan tanpa VPN. |
| **Nama proyek ditolak** | ≤23 char, alfanumerik, awali huruf, tanpa `-`/`_`/`.` |
| **Prompt permission `bag` di IDE** | Normal dan disengaja. Skill doc **melarang** memberi blanket `bag:*` karena mencakup perintah yang membelanjakan uang. |
| **Docker** | Hanya perlu untuk `twak`. Default `evm-local` = zip, tanpa Docker. |

---

## 11. Konteks Hackathon (berdampak langsung ke arsitektur)

Sumber: [halaman hackathon](https://www.bnbchain.org/en/hackathons/smart-money-era) dan [blog track utama](https://www.bnbchain.org/en/blog/build-the-era-build-the-official-bnb-agent-studio-marketplace).

- **Track utama:** bangun marketplace agent di BSC — hadiah **$30.000** + adopsi sebagai marketplace agent kanonik BSC.
- **Timeline** 🟡: build 5 Agu – **9 Sep 2026**; judging 9–23 Sep; pengumuman 5 Nov. **VERIFIKASI ULANG — hari ini 8 Sep.**
- **Empat kategori** (blog memakai penamaan sedikit berbeda dari brief kita): Monitoring / Grid trading / Health factor / Yield. Halaman hackathon memakai: Rebalancing (LP range management), Grid Trading, Yield Optimization (highest APR routing), Health Factor Monitoring (liquidation protection).
- **Kriteria juri** 🟡: Functionality, Data Quality, Agent Diversity. Satu sumber menyebut 35/35/30, sumber lain menyebut "bobot setara". Yang konsisten: **keempat kategori harus tersurface dengan kedalaman yang setara**.
- Ukuran inti menurut blog: *"how easily someone can find an agent and hire it."*
- **Required/recommended tech:** BNB Agent Studio CLI, **8004scan API (Pro tier gratis untuk peserta)**, BSC Testnet Faucet, PancakeSwap Developer Portal, TermiX BSC MCP server, Altana SDK/skills.
- **Syarat submission:** marketplace harus **publicly accessible & functional selama judging**; agent harus **live di BSC**; sertakan alamat wallet.
- **Partner track (bisa ditumpuk):** Altana 50.000 XP (butuh session key dengan spend cap + expiry terdaftar on-chain dan revocation yang terlihat user), TermiX $6k/$3k/$1k (butuh "Agent Advantage Report": ≥3 task nyata dijalankan dengan & tanpa agent), PancakeSwap 1.000 CAKE.

---

## 12. Rekomendasi Arsitektur

1. **Discovery = 8004scan API sebagai primer, on-chain sebagai fallback.** Ambil API key Pro sekarang. Bangun BFF/proxy di backend (bukan panggilan dari browser) dengan cache + retry/backoff. Upstream terbukti flaky (DATABASE_ERROR intermiten) dan "Data Quality" adalah kriteria juri utama.
2. **Bangun indexer ERC-8004 tipis sendiri** sebagai jaring pengaman: `eth_getLogs` untuk `Registered` + `URIUpdated` di `0x8004A169…` (56) dan `0x8004A818…` (97), simpan `agentId → owner → agentURI`, resolve URI (tangani base64/gzip/ipfs/https/JSON telanjang), cache. Ini juga membuktikan "data real-time" ke juri.
3. **Klasifikasi 4 kategori** paling kuat lewat **OASF `skills[]` / `domains[]`** dari registration file, dilengkapi semantic search 8004scan dan pencocokan kata kunci pada `name`/`description`. Sediakan mapping kategori yang di-curate manual sebagai penjamin agar keempat kategori tidak pernah kosong.
4. **Wajib memfilter spam.** 340k agent mainnet mayoritas bulk registration. Gunakan `is_endpoint_verified`, `owner_publisher_tier`, `min_score`, `has_a2a`, dan metadata `built_with`.
5. **Publikasikan agent kita sendiri** untuk keempat kategori (Studio memberi identitas + hosting; strategi kita tulis sendiri). Ini sekaligus menjamin cakupan kategori merata — 30% dari nilai.
6. **Health Factor: baca on-chain langsung** (`Venus.getAccountLiquidity`, `AaveV3Pool.getUserAccountData`), jangan API terindeks.
7. **Jangan andalkan scheduler Studio — tidak ada.** Sediakan cron/EventBridge sendiri untuk agent monitoring.
8. **Untuk track Altana**, pakai `--wallet-kind altana` sejak awal; ia satu-satunya yang memberi session key berbatas budget+waktu yang bisa di-revoke — persis yang disyaratkan.

---

## 13. Open Questions / Unverified

### Belum terverifikasi — perlu dicek tim

1. 🟡 **Tanggal deadline hackathon.** Dua sumber menyebut build berakhir 9 Sep 2026 (besok). Konfirmasi di halaman resmi sebelum menetapkan scope.
2. 🟡 **Bobot kriteria juri.** 35/35/30 vs "setara" — sumber berbeda. Cari rubrik resmi.
3. ❌ **"Reference agents" untuk 4 kategori.** Disebut pers, tidak ada di paket CLI 0.0.13 maupun docs. Cek `@bnbagent/studio-cli@0.0.14-alpha.1` dan halaman hackathon.
4. ❌ **`eth_getLogs` `MetadataSet` bertopik `built_with`** belum selesai (query range besar di RPC publik timeout). **Ini menentukan berapa banyak agent Studio yang benar-benar live di BSC** — pertanyaan yang sangat penting untuk marketplace "agent BNB Agent Studio". Jalankan dengan RPC berdedikasi (QuickNode/NodeReal) dan chunk block range.
5. ❌ **Skema respons lengkap `GET /api/v1/agents`.** Saya kena HTTP 403 (rate limit anonymous) sebelum sempat men-dump satu record penuh. Setelah punya API key, dump `https://api.8004scan.io/openapi.json` → `components.schemas` untuk field persisnya (rating, kategori, performa, harga).
6. ❌ **Apakah 8004scan mengekspos "harga" dan "performa/return" agent.** Ada `total_score`, `quality`, `scores/v5`, `feedbacks`, `analytics` — tapi saya belum verifikasi apakah ada harga layanan atau metrik P&L. Kalau tidak ada, harga harus diambil dari ERC-8183 `negotiate` / challenge x402 per agent.
7. 🟡 **Endpoint Binance Bazaar.** Terdokumentasi di skill file resmi, tapi tidak bisa saya jangkau (diblokir jaringan). Uji dari jaringan lain.
8. 🟡 **Alamat Lista DAO** dan cara membaca health CDP-nya — belum dari sumber primer.
9. 🟡 **Endpoint subgraph PancakeSwap v3** — ID subgraph konflik antar sumber.
10. ❌ **Repo `bnb-chain/bnbagent-studio` (404/private).** Semua isi Studio di dokumen ini berasal dari tarball npm. Kalau repo dibuka, `docs/design/*` dan `docs/guides/*` yang dirujuk skill akan sangat berguna.
11. ❌ **ERC-8183 sebagai sumber discovery.** `bag erc8183 list` ada, tapi saya belum memetakan apakah kontrak commerce mengekspos daftar provider/seller yang bisa diindeks untuk menemukan agent yang benar-benar bertransaksi. Event `JobCreated` / `ProviderSet` / `JobCompleted` di `0xea4daa31…` (56) berpotensi jadi sumber **track record nyata** — sangat bernilai untuk kriteria "Data Quality".
12. 🟡 **Kompatibilitas macOS arm64.** Belum dieksekusi. Risiko utama: Node <22, Bun, konflik CLI `agentcore`.
13. 🟡 **BASCAN** — diumumkan lewat X sebagai "first ERC-8004 Public Agent Registry Scan on BNB Chain". Tidak ada docs/URL produk yang ditemukan. Perlakukan sebagai belum ada.

### Yang secara eksplisit TIDAK saya temukan ❌

- API discovery agent **resmi milik BNB Agent Studio** (`studio.bnbchain.org/api/...` atau sejenis). Yang ada hanya `bnbagent-api.bnbchain.world` (auth-gated, platform trial, bukan direktori publik).
- Subgraph resmi (The Graph / Goldsky / Envio) untuk ERC-8004 di BSC.
- Endpoint API yang mengembalikan "performa"/return terkualifikasi per agent DeFi.
- Template/skill resmi untuk rebalancing, grid trading, yield optimization, atau health factor monitoring.

---

## Lampiran A — Perintah yang saya jalankan & bisa direproduksi

```bash
# Verifikasi paket
curl -s https://registry.npmjs.org/@bnbagent/studio-cli | jq '.["dist-tags"], .versions|keys'
curl -s https://pypi.org/pypi/bnbagent/json | jq .info.version

# Unduh & inspeksi CLI (tanpa install)
URL=$(curl -s https://registry.npmjs.org/@bnbagent/studio-cli \
      | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['versions'][d['dist-tags']['latest']]['dist']['tarball'])")
curl -sL "$URL" | tar -xz && ls package/skills package/recipes

# Verifikasi registry ERC-8004 live
cast call --rpc-url https://bsc-dataseed.bnbchain.org \
  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "name()(string)"      # → AgentIdentity
cast call --rpc-url https://bsc-dataseed.bnbchain.org \
  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "tokenURI(uint256)(string)" 1

# Topic hash untuk indexing
cast keccak "Registered(uint256,string,address)"
cast keccak "built_with"

# 8004scan
curl -s https://api.8004scan.io/openapi.json | jq '.paths|keys'
curl -s "https://api.8004scan.io/api/v1/stats/global" | jq .total_agents
curl -s "https://api.8004scan.io/api/v1/agents?chain_id=56&limit=5" -H "X-API-Key: $KEY"
```

## Lampiran B — Snapshot angka (8 Sep 2026)

| Metrik | Nilai | Sumber |
|---|---|---|
| Agent ERC-8004 di BSC mainnet | **340.785** (agentId tertinggi) | binary search `ownerOf()` saya ✅ |
| Total agent semua chain (8004scan) | **820.100** | `GET /stats/global` ✅ |
| Total user (8004scan) | 458.338 | idem ✅ |
| Total feedback | 3.654.749 | idem ✅ |
| Agent baru per hari | 3.589 | idem ✅ |
| Skor feedback rata-rata | 82,6 | idem ✅ |
| Klaim "BNB Chain >200k agent ERC-8004" | **Terkonfirmasi dan sudah terlampaui** — 340k+ | pengukuran on-chain saya ✅ |
