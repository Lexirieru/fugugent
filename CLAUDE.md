# Fugugent

Marketplace agent DeFi di BNB Chain untuk hackathon BNB Chain "The Smart Money Era".
Setiap agent adalah karakter kartun ikan fugu; **fugu mengembang seiring beban risiko**
— metrik risiko nyata divisualisasikan sebagai tingkat kembung.

Domain: `fugugent.xyz` (landing) · `app.fugugent.xyz` (marketplace) · `api.fugugent.xyz`

## Dokumen wajib baca sebelum mengubah apa pun

| File | Isi |
|---|---|
| `docs/specs/2026-09-08-fugugent-design.md` | Spec arsitektur — **otoritas yang mengikat** |
| `docs/research/00-decisions.md` | 13 keputusan terkunci + hasil uji dGrid |
| `docs/setup/ENVIRONMENT.md` | Kredensial, alamat kontrak terverifikasi, konstanta jaringan |
| `docs/plans/` | Rencana implementasi per subsistem |
| `docs/research/01`–`06` | Riset terverifikasi (Agent Studio, HelloMinds, Altana, 8004scan, kompetitor, strategi) |

## Struktur

| Folder | Isi | Status |
|---|---|---|
| `contracts/` | 4 kontrak UUPS (Foundry) | dikerjakan |
| `ai/` | 4 agent Fugu (BNB Agent Studio, wallet Altana) | Guardian: lapisan strategi + eksekusi terbukti on-chain; 3 agent lain baru scaffold + session key |
| `backend/` | Hono + Postgres + Redis: BFF, indexer, classifier, scheduler | belum |
| `frontend/` | Next.js 16 marketplace | scaffold |
| `landingpage/` | Next.js 16 landing | scaffold |

## Aturan yang tidak boleh dilanggar

1. **Keputusan finansial tidak pernah melewati LLM.** Strategi = kode deterministik yang
   bisa di-backtest. dGrid (`openai/gpt-5.6-luna`) latensinya 30–46 detik — hanya untuk
   penjelasan asinkron dan agent riset, tidak pernah di jalur kritis.
2. **Semua token di BSC 18 desimal, termasuk USDT.** Bukan 6.
3. **`RPC_URL` wajib di-override.** Default SDK memakai domain `binance.org` yang
   diblokir dari Indonesia. Pakai `https://data-seed-prebsc-1-s1.bnbchain.org:8545`.
4. **Panggilan ke 8004scan wajib menyertakan `User-Agent` browser** — tanpa itu API
   membalas HTTP 500, bukan 429. Selalu lewat backend, tidak pernah dari browser.
5. **Session Altana: `calls: []` kosong = izin tanpa batas.** Selalu isi allowlist eksplisit.
6. **Jangan pernah commit `.env`.** Semua sudah di-gitignore; jangan longgarkan.
7. **Testnet only** (chainId 97). Jangan pernah pakai private key yang menyentuh mainnet.

## Perintah

```bash
cd contracts && forge test          # test kontrak
cd contracts && forge build         # build
bun --cwd frontend dev              # marketplace
bun --cwd landingpage dev           # landing page
bag --help                          # BNB Agent Studio CLI
```

## Gaya

- Bahasa Indonesia untuk komunikasi dan dokumentasi; identifier kode tetap bahasa Inggris.
- Commit message bahasa Indonesia, format conventional (`feat:`, `fix:`, `docs:`, `chore:`).
