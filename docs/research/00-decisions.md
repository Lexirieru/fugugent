# Fugugent — Keputusan Brainstorming (Locked)

Tanggal: 2026-09-08
Status: keputusan awal dari sesi brainstorming, sebelum design doc final.

## Produk
- **Nama**: Fugugent. Domain: `fugugent.xyz`
- **Benchmark UX**: hellominds.ai
- **Identitas visual**: tiap agent adalah karakter kartun ikan fugu, dengan beberapa
  state ekspresi (idle, working, alert, profit). Aset digenerate.

## Keputusan terkunci
| # | Topik | Keputusan |
|---|-------|-----------|
| 1 | 4 agent prioritas | Persis 4 kategori wajib main track, di-skin sebagai karakter fugu: Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring |
| 2 | Scope track | Kejar semua: Main + Altana + TermiX + PancakeSwap |
| 3 | Isi marketplace | Hybrid — index agent live (8004scan / Agent Studio) + 4 agent Fugu first-party sebagai flagship yang benar-benar bisa dihire |
| 4 | Custody / eksekusi | Altana session key, non-custodial. Wallet per agent, session ber-limit (call allowlist + spend cap + expiry), terdaftar di Keystore on-chain, revoke 1-klik dari UI |
| 5 | Network | BSC **testnet** (chainId 97) untuk agent DeFi & smart contract |
| 6 | Monetisasi | Dua jalur: subscription + escrow on-chain untuk 4 agent DeFi; x402/b402 pay-per-call untuk layanan data/riset agent-ke-agent |
| 7 | Stack | TypeScript penuh — Hono/Fastify + Postgres + Redis + BullMQ; viem untuk chain |
| 8 | Infra | VPS, Docker Compose + Caddy (TLS otomatis), domain sudah ada |
| 9 | Smart contract | Upgradeable (proxy). Foundry + OpenZeppelin upgradeable (sudah ada di `contracts/lib`) |
| 10 | LLM | **dGrid** — `https://api.dgrid.ai/v1`, OpenAI-compatible gateway ke 200+ model |

## Prioritas urutan kerja
1. Smart contract (upgradeable, proxy)
2. AI / agent runtime
3. Backend (indexer, API, scheduler)
4. Frontend marketplace
5. Landing page

## Temuan awal dGrid (terverifikasi)
- Gateway OpenAI-compatible, 200+ model, endpoint `POST /v1/chat/completions`
  (docs: https://docs.dgrid.ai/)
- Free router: model id `dgridai/free` — 10 req/menit, 100 req/hari (naik ke 20/menit,
  1000/hari setelah top-up ≥ $5). Underlying model berubah-ubah per request, jangan
  diandalkan untuk perilaku model spesifik.
  (docs: https://docs.dgrid.ai/ai-gateway/free-models-router.md)
- Mendukung tool calling, streaming, embeddings, image gen, TTS/transkripsi, moderation.
- **x402 native di BSC**: network `eip155:56`, token pembayaran **USD1**
  `0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d`. Flow: request tanpa header `x-payment`
  → `402 Payment Required` + payment requirements → client tanda tangan → retry dengan
  header `x-payment`. (docs: https://docs.dgrid.ai/x402/overview.md)
  → Implikasi besar: **agent Fugu bisa membayar biaya inference-nya sendiri** dari wallet
  Altana miliknya. Ini memenuhi bonus track Altana (x402) dan memperkuat narasi
  "sovereign agent". Catatan: jalur x402 ini di **mainnet BSC**, sementara agent DeFi
  kita di testnet — perlu diputuskan apakah jalur pembayaran inference dijalankan di
  mainnet dengan nominal kecil.

## Toolchain terverifikasi di mesin
node v24.10.0 · bun 1.3.9 · forge/cast 1.7.1 · Python 3.14.4 · Docker 29.4.0 · darwin arm64
Sudah ada: `contracts/lib/{forge-std, openzeppelin-contracts, openzeppelin-contracts-upgradeable}`,
`frontend/` & `landingpage/` = Next.js 16.3.4 + React 19.2.8 + Tailwind v4 (bun).
`backend/` dan `ai/` masih kosong.

## Open questions (dijawab setelah riset selesai)
- Apakah BNB Agent Studio punya API discovery publik untuk melist agent live di BSC?
- Apakah agent Fugu harus dibangun DI ATAS Agent Studio CLI (syarat main track:
  "agents surfaced on your marketplace must be live on BSC")?
- Alamat kontrak Altana Keystore di BSC testnet.
- Apakah x402 dGrid tersedia di BSC testnet atau hanya mainnet.

## Hasil uji dGrid (2026-09-08)
Model dipilih: **`openai/gpt-5.6-luna`** (murah).
- Tool calling: **didukung**, argumen dihasilkan benar.
- Latency: **30–46 detik** untuk prompt pendek, konsisten lintas percobaan
  (bukan cold start).

**Implikasi:** model ini TIDAK boleh berada di jalur kritis agent. Ini
memvalidasi keputusan #13 (keputusan finansial deterministik, LLM hanya untuk
penjelasan & riset): penjelasan dihasilkan asinkron setelah aksi dieksekusi,
sehingga latency 45 detik tidak pernah menunda perlindungan posisi user.
