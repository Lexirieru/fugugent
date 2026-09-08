# Fugugent — Kredensial & Environment

Dibagi jadi tiga: **kamu sediakan**, **aku generate**, dan **dihasilkan tooling**.

> ⚠️ **JANGAN PERNAH memakai private key yang pernah menyentuh mainnet.**
> Semua wallet di proyek ini adalah wallet baru khusus testnet, sekali pakai.

---

## A. Kamu sediakan — memblokir pekerjaan

| # | Variabel | Dari mana | Dipakai untuk | Prioritas |
|---|---|---|---|---|
| A1 | `DEPLOYER_PRIVATE_KEY` | **wallet BARU**, buat khusus testnet | deploy 4 kontrak UUPS ke BSC testnet | 🔴 sekarang |
| A2 | `DGRID_API_KEY` | https://dgrid.ai (kamu sudah punya akun) | otak LLM agent + classifier kategori | 🔴 sekarang |
| A3 | `SCAN8004_API_KEY` | https://8004scan.io/developers → lalu ajukan Pro tier lewat form hackathon https://forms.gle/jQevEPCAacBXaKG79 | sumber data utama marketplace | 🔴 sekarang |
| A4 | `BSCSCAN_API_KEY` | https://bscscan.com/myapikey (gratis) | verifikasi kontrak di testnet.bscscan.com | 🟠 saat deploy |
| A5 | `BSC_TESTNET_RPC_URL` | NodeReal / QuickNode / Ankr (free tier cukup) | indexer `eth_getLogs` berat — RPC publik akan kena rate limit | 🟠 saat indexer |
| A6 | Akses VPS | punyamu | deploy | 🟡 saat deploy |
| A7 | DNS `fugugent.xyz` | registrar kamu | `@`, `app`, `api` → IP VPS | 🟡 saat deploy |

### Catatan per item

**A1 — Deployer wallet.** Buat baru:
```bash
cast wallet new
```
Danai dengan tBNB: https://testnet.bnbchain.org/faucet-smart
atau bot Telegram resmi https://t.me/bnbchain_official_bot
(kirim: `I would like to get tBNB to my wallet <address>`, maks 0,3 tBNB/hari).
Butuh ~0,5 tBNB total untuk deploy + testing.

**A5 — Kenapa RPC berdedikasi.** Indexer kita membaca event `Registered`/`URIUpdated`
dari registry ERC-8004 yang punya 340k+ agent. RPC publik akan menolak query range
besar. Default publik (`data-seed-prebsc-1-s1.bnbchain.org`) sudah diverifikasi jalan
untuk pemakaian ringan dan cukup untuk memulai.

> ⚠️ RPC default bawaan SDK memakai domain `binance.org` yang **terbukti diblokir
> dari jaringan Indonesia**. `RPC_URL` **wajib** di-override di setiap service.

---

## B. Aku generate sendiri — tidak perlu kamu urus

| Variabel | Cara dihasilkan |
|---|---|
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | `openssl rand -base64 32` |
| `JWT_SECRET` / `SESSION_SECRET` | `openssl rand -hex 32` |
| `WALLET_PASSWORD` (keystore admin agent) | dihasilkan acak, disimpan di `.studio/.env.local` mode 0600 |
| Alamat kontrak hasil deploy | dicatat ke `contracts/deployments/bsc-testnet.json` |
| Wallet admin tiap agent | `bag wallet new` per agent |

---

## C. Dihasilkan tooling — jangan diisi manual

| Variabel | Dihasilkan oleh | Catatan |
|---|---|---|
| `ALTANA_SESSION` | `bag wallet session grant` | serialized session ber-batas. **Jangan pernah print, parse, atau salin bagian `signer`-nya.** |
| Alamat wallet agent | `bag wallet new` | 4 agent = 4 wallet admin |
| `agentId` ERC-8004 | `bag erc8004 register` | identitas on-chain tiap agent |

**Setiap wallet admin agent perlu didanai** ~0,05 tBNB + U.
Faucet U testnet: kontrak `0x86e9197CC0F76E4e4aaa7082180945196bBAb5D3`,
panggil `requestTokens()` — 10 U per 30 menit.
Alternatif: bot Telegram, kirim `I would like to get U to my wallet <address>`.

Total kebutuhan funding: **4 wallet agent × (0,05 tBNB + 10 U)** + **deployer 0,5 tBNB**.

---

## D. LLM provider untuk Agent Studio — perlu diuji

Agent Studio **menolak** kombinasi `--wallet-kind altana` + `--llm-provider pieverse-llm`
(Altana menolak generic message signing, sehingga SIWE Pieverse gagal). Provider yang
diterima: `openrouter`, `openai`, `anthropic`.

Rencana: pakai `--llm-provider openai` dengan base URL diarahkan ke dGrid
(`https://api.dgrid.ai/v1`), karena dGrid OpenAI-compatible.

```
OPENAI_API_KEY=<DGRID_API_KEY>
OPENAI_BASE_URL=https://api.dgrid.ai/v1
```

**Belum terverifikasi** apakah `studio.toml` menghormati override base URL. Ini
salah satu dari dua gate teknis yang diuji sebelum menulis kode agent. Kalau ditolak,
fallback: agent memanggil dGrid dari backend kita, bukan dari dalam runtime Studio.

---

## E. Konstanta jaringan (sudah terverifikasi live, tidak perlu dicari lagi)

```bash
CHAIN_ID=97
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545   # cadangan: https://bsc-testnet-rpc.publicnode.com
EXPLORER=https://testnet.bscscan.com

# Registry & infrastruktur agent
ERC8004_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8183_COMMERCE=0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de
ALTANA_KEYSTORE=0x6b8361C29d05D498b1a12B54A37310f94171E94A
ALTANA_CONTROLLER=0xb530D1971f5453F3359518343F05D0AedFfF7e12
ALTANA_RELAY=https://testnet-relay.altana.network
ALTANA_EXPLORER=https://testnet.altana.network

# Token (SEMUA 18 desimal — USDT di BSC BUKAN 6 desimal)
TOKEN_U=0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565
TOKEN_USDT=0x337610d27c682E347C9cD60BD4b3b107C9d34dDd
TOKEN_BUSD=0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee
TOKEN_WBNB=0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd

# Chainlink price feeds (8 desimal, terverifikasi hidup 2026-09-08)
FEED_BNB_USD=0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526
FEED_USDT_USD=0xEca2605f0BCF2BA5966372C99837b1F182d3D620
FEED_BUSD_USD=0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa
FEED_ETH_USD=0x143db3CEEfbdfe5631aDD3E50f7614B6ba708BA7

# API
DGRID_BASE_URL=https://api.dgrid.ai/v1
SCAN8004_BASE_URL=https://api.8004scan.io/api/v1
DEFILLAMA_YIELDS=https://yields.llama.fi/pools
```

> Panggilan ke 8004scan **wajib** menyertakan `User-Agent` browser — tanpa itu API
> membalas HTTP 500, bukan 429.

---

## F. Yang TIDAK dibutuhkan

- **Akun AWS / Azure** — kita host sendiri di VPS, tidak pakai AgentCore/Foundry.
- **Private key mainnet** — semuanya testnet.
- **Akun Pieverse** — tidak kompatibel dengan wallet Altana.
- **VPN** — kecuali kalau nanti mau menguji Binance Bazaar/B402, yang diblokir dari
  Indonesia. Bukan jalur kritis.
