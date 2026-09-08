# Fugugent — Design Spec

**Tanggal:** 2026-09-08
**Status:** menunggu review
**Konteks:** BNB Chain Hackathon "The Smart Money Era: Build the Era"
**Riset pendukung:** `docs/research/01`–`06`

---

## 1. Posisi Produk

**Fugugent adalah pintu depan agent ekonomi BNB Chain — tempat kamu bisa melihat apa
yang boleh dilakukan sebuah agent terhadap uangmu, sebelum kamu menyewanya.**

Marketplace lain menampilkan agent sebagai daftar. Fugugent menampilkan agent sebagai
**makhluk hidup dengan izin yang terlihat dan bisa dicabut**. Setiap agent adalah ikan
fugu; ketika beban risikonya naik, fugunya mengembang. Metrik abstrak menjadi umpan
balik yang langsung terbaca.

Kalimat positioning (di atas fold): *"Kamu tidak menanyakan sesuatu ke agent. Kamu
memberinya pekerjaan — dan batas yang tidak bisa ia lewati."*

### Mengapa ini menang

| Kriteria juri | Bobot | Cara kami menang |
|---|---|---|
| Functionality | tinggi | Journey 4 langkah tanpa dead end: land → kategori → detail ber-URL → hire 1 tanda tangan. Setiap empty state preskriptif. |
| Data Quality | tinggi | Metrik keputusan real-time yang bisa diverifikasi on-chain, bukan sekadar hitungan. Setiap angka punya tx hash. |
| Agent Diversity | tinggi | 4 kategori dengan paritas yang ditegakkan checklist, plus 4 agent first-party kami sendiri sebagai lantai kualitas. |

---

## 2. Keputusan Terkunci

Lihat `docs/research/00-decisions.md` untuk 10 keputusan pertama. Tambahan dari sesi
desain:

| # | Topik | Keputusan | Alasan |
|---|---|---|---|
| 11 | Runtime agent | Scaffold `bag init --wallet-kind altana`, host sendiri di VPS | Studio tidak punya scheduler; trial cloud hanya 48 jam |
| 12 | Smart contract | 3 kontrak UUPS: `FuguRegistry`, `FuguSubscription`, `FuguReputation` | Mengisi celah yang tidak ditutup ERC-8183 (job sekali jalan) maupun Altana (izin) |
| 13 | Peran LLM | Deterministik untuk keputusan uang; LLM untuk penjelasan & riset | Bisa di-backtest jujur; sejalan dengan prinsip Studio "signing is fixed code" |

---

## 3. Arsitektur Sistem

```
                    fugugent.xyz              app.fugugent.xyz
                   ┌────────────┐            ┌──────────────────┐
                   │ landingpage│            │ frontend (Next 16)│
                   │  (Next 16) │            │ SSR discovery     │
                   └────────────┘            │ detail ber-URL    │
                                             │ panel izin+revoke │
                                             └─────────┬─────────┘
                                                       │ REST + WS
                                             api.fugugent.xyz
                   ┌───────────────────────────────────▼─────────────────────┐
                   │ backend (Hono)                                          │
                   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
                   │  │ BFF/     │ │ indexer  │ │classifier│ │ scheduler  │  │
                   │  │ proxy    │ │ ERC-8004 │ │ 4 kat.   │ │ BullMQ     │  │
                   │  │ 8004scan │ │ + Fugu*  │ │          │ │            │  │
                   │  └──────────┘ └──────────┘ └──────────┘ └─────┬──────┘  │
                   │       Postgres (Drizzle)  ·  Redis                │      │
                   └───────────────────────────────────────────────────┼──────┘
                                                                       │ trigger
                   ┌───────────────────────────────────────────────────▼──────┐
                   │ ai/ — 4 agent Fugu (scaffold Studio, wallet altana)       │
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

### Prinsip pemisahan

- **Frontend tidak pernah memanggil 8004scan langsung.** Semua lewat BFF. Alasan:
  upstream terbukti balas `500 DATABASE_ERROR` intermiten (4 dari 5 percobaan gagal
  saat riset), menolak request tanpa User-Agent browser, dan API key tidak boleh
  bocor ke browser.
- **Setiap sumber data punya fallback.** 8004scan → indexer on-chain kami sendiri →
  cache Postgres. Marketplace tidak boleh pernah kosong saat juri membukanya.
- **Keputusan finansial tidak pernah melewati LLM.** Strategi = kode murni yang
  di-backtest. LLM hanya menjelaskan keputusan yang sudah diambil.

---

## 4. Smart Contracts

Semua UUPS upgradeable (OpenZeppelin `UUPSUpgradeable` + `Initializable`), Foundry,
BSC testnet. Library sudah ada di `contracts/lib/`.

### 4.1 `FuguRegistry`

Katalog kurasi. Menjembatani ERC-8004 (identitas mentah, 309k agent kebanyakan spam)
dengan marketplace yang layak ditampilkan.

```solidity
struct Listing {
    uint256 erc8004AgentId;   // identitas kanonik di 0x8004A818…
    address owner;            // creator, penerima revenue share
    Category category;        // REBALANCING | GRID | YIELD | HEALTH_FACTOR
    address agentWallet;      // wallet Altana milik agent
    string  metadataURI;      // detail diperpanjang di luar ERC-8004
    uint96  pricePerPeriod;   // harga langganan
    uint32  periodSeconds;
    bool    active;
}
```

- `list()`, `updateListing()`, `deactivate()` — hanya owner listing.
- `setCurator()` — role untuk menandai listing terkurasi (badge di UI).
- Event `Listed`, `Updated`, `Deactivated` → diindeks backend.
- **Enum `Category` menjamin paritas 4 kategori** dapat dihitung on-chain, bukan
  sekadar klaim di UI.

### 4.2 `FuguSubscription`

Escrow langganan periodik + revenue share. Inilah yang tidak dipunyai ERC-8183
(escrow per-job sekali jalan) maupun Altana (hanya izin).

```solidity
struct Sub {
    uint256 listingId;
    address subscriber;
    uint96  deposited;      // total masuk escrow
    uint96  claimed;        // sudah ditarik agent
    uint64  startedAt;
    uint64  expiresAt;
    bool    cancelled;
}
```

- `subscribe(listingId, periods)` — user deposit; dana **tetap di escrow**.
- `claim(subId)` — agent hanya bisa menarik **pro-rata terhadap waktu yang sudah
  berjalan**. Tidak ada pembayaran di muka penuh; agent yang mati tidak dibayar.
- `cancel(subId)` — user menarik sisa yang belum di-klaim, kapan saja. Ini
  memenuhi prinsip "semua aksi reversibel".
- `_splitRevenue()` — potong `protocolFeeBps` ke treasury, sisanya ke owner listing.
  **Payout terlihat di explorer** — janji yang HelloMinds gagal tepati.
- **Pembayaran multi-token dengan harga berbasis USD** — lihat §4.3.

### 4.3 `FuguPriceOracle` — user memilih token pembayaran

**Keputusan:** harga langganan dinyatakan dalam **USD (8 desimal)**, dan user memilih
token mana yang dipakai membayar. Kontrak mengonversi USD → jumlah token saat
transaksi, memakai Chainlink price feed.

Kenapa begini, bukan harga per-token: creator menetapkan harga sekali ("$5/bulan")
dan tidak perlu memperbarui harga tiap kali BNB bergerak. User bayar dengan apa pun
yang ada di dompetnya. Ini juga membuat perbandingan harga antar agent di
marketplace jadi apple-to-apple — yang langsung melayani kriteria Data Quality.

```solidity
enum PriceSourceKind { CHAINLINK, FIXED_USD }

struct TokenConfig {
    PriceSourceKind kind;
    address feed;          // AggregatorV3Interface, kosong bila FIXED_USD
    uint32  maxStaleness;  // PER TOKEN — heartbeat tiap feed berbeda
    uint8   tokenDecimals;
    uint64  fixedPriceUsd; // 8 desimal, dipakai bila FIXED_USD
    bool    enabled;
}
mapping(address => TokenConfig) public tokens;   // address(0) = native tBNB
```

`quote(token, usdAmount8) → tokenAmount` melakukan:
1. baca `latestRoundData()`
2. **tolak bila `answer <= 0`** atau `block.timestamp - updatedAt > maxStaleness`
3. konversi dengan memperhatikan desimal token dan desimal feed

**Ambang staleness harus per-token.** Terverifikasi live di testnet hari ini:
BNB/USD baru saja update, sementara USDT/USD terakhir update ~8 jam lalu. Satu
ambang seragam akan menolak semua pembayaran USDT. Rencana awal: BNB 1 jam,
stablecoin 26 jam.

**Token yang didukung saat peluncuran** (semua terverifikasi live di BSC testnet 97):

| Token | Alamat | Desimal | Sumber harga |
|---|---|---|---|
| tBNB (native) | `address(0)` | 18 | Chainlink BNB/USD `0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526` |
| USDT | `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd` | **18** | Chainlink USDT/USD `0xEca2605f0BCF2BA5966372C99837b1F182d3D620` |
| BUSD | `0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee` | 18 | Chainlink BUSD/USD `0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa` |
| U | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` | 18 | `FIXED_USD` = $1,00 (tidak ada feed Chainlink; U = United Stables) |

> ⚠️ **USDT di BSC 18 desimal, bukan 6.** Ini jebakan yang sudah memakan korban dan
> harus dites eksplisit. Alamat USDT testnet alternatif yang juga hidup:
> `0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684`.

**Konsekuensi desain di `FuguSubscription`:** jumlah token dikunci pada saat
`subscribe()` (bukan dihitung ulang saat `claim`), sehingga pergerakan harga setelah
berlangganan tidak mengubah hak siapa pun. Refund saat `cancel()` dibayarkan dalam
token yang sama dengan yang disetor. Setiap langganan menyimpan `payToken`.

**Yang bisa diubah owner:** menambah/menonaktifkan token, mengganti feed, mengubah
staleness. Owner **tidak bisa** menyentuh dana yang sudah di escrow.

### 4.4 `FuguReputation`

Review anti-sybil.

- `review(listingId, score, uri)` — **hanya bisa dipanggil wallet yang punya
  langganan berakhir/aktif terbukti di `FuguSubscription`.** Satu review per
  langganan, bisa di-update sekali.
- Menyimpan agregat `sum/count` per listing untuk pembacaan murah.
- Ini rating yang **hanya mungkin di Web3** — tidak bisa dipalsukan tanpa membayar.

### 4.5 Pola upgrade

- Proxy: ERC1967 via `UUPSUpgradeable`. `_authorizeUpgrade` dijaga `onlyOwner`.
- Owner awal = deployer EOA; catat rencana pindah ke multisig setelah hackathon.
- **Storage gap `uint256[45] __gap`** di setiap kontrak.
- Script `contracts/script/`: `Deploy.s.sol` (deploy proxy + impl), `Upgrade.s.sol`.
- Test wajib: initializer tidak bisa dipanggil dua kali; upgrade mempertahankan
  storage; non-owner tidak bisa upgrade; klaim pro-rata benar di batas periode;
  review ditolak tanpa langganan.

---

## 5. Empat Agent Fugu

### 5.1 Pola bersama

Setiap agent adalah project hasil `bag init <nama> --wallet-kind altana
--destination self --no-onboard`, dengan:

- **Strategi** di `app/agent/src/strategy/` — kode deterministik murni, tanpa I/O,
  bisa di-unit-test dan di-backtest.
- **`sellerCore.ts` `runWork`** — menjembatani strategi ke eksekusi.
- **Eksekusi** lewat session key Altana: `execute({ session, calls })`.
- **Scheduler eksternal** (BullMQ di backend) yang memanggil endpoint agent, karena
  Studio tidak punya background poller.
- **Penjelasan** dihasilkan dGrid: "kenapa aku melakukan ini" dalam bahasa manusia,
  dilampirkan ke setiap run.

Nama project harus ≤23 char, alfanumerik, diawali huruf (aturan AgentCore):
`fugurebalancer`, `fugugrid`, `fuguyield`, `fuguguardian`.

### 5.2 Agent

| Agent | Kategori | Protokol | Trigger | Aksi |
|---|---|---|---|---|
| **Fugu Rebalancer** | Rebalancing | PancakeSwap v3 | harga keluar range / deviasi / interval | hitung range baru, cek profitabilitas setelah gas+slippage+IL, `decreaseLiquidity`→`mint` |
| **Fugu Grid** | Grid Trading | PancakeSwap v3 swap | keeper memantau `slot0()`; harga melintasi level grid | eksekusi swap pada level, catat fill |
| **Fugu Yield** | Yield Optimisation | Venus, Aave v3, Lista | selisih APR melebihi ambang biaya migrasi | pindahkan posisi ke pool ber-APR-tertimbang-risiko tertinggi |
| **Fugu Guardian** | Health Factor | Venus, Aave v3 | HF turun di bawah ambang | partial repay / top-up collateral / alert |

Detail parameter, rumus, dan sumber data ada di `docs/research/06-agent-strategies.md`.

### 5.3 Batas keras (non-negosiabel)

Setiap agent berjalan di bawah session Altana dengan:
- **call allowlist** — hanya selector dan alamat kontrak yang dibutuhkan strateginya
- **spend cap** — rekomendasi awal 10 U/hari
- **expiry** — 30 hari, ditampilkan sebagai hitung mundur di UI
- terdaftar di **Keystore** `0x6b8361C29d05D498b1a12B54A37310f94171E94A`

Tiga jebakan yang sudah diketahui dan harus dihindari (dari riset Altana):
1. `calls: []` kosong = izin **tanpa batas**. Selalu isi eksplisit.
2. USDT/USDC di BNB Chain **18 desimal**, bukan 6.
3. Native spend cap juga membayar relay fee — cap terlalu kecil membuat semua
   eksekusi `FAILED` code 300.


### 5.4 Catatan implementasi dari riset strategi

Dari `docs/research/06-agent-strategies.md` — semua ditandai terverifikasi live:

- **Grid butuh keeper sendiri.** PancakeSwap **tidak punya order-book on-chain**;
  "limit order"-nya bergantung pada taker off-chain. Agent Grid harus memantau
  `slot0()` pool dan mengeksekusi swap langsung. Strategi ini secara struktural
  mean-reversion — **rugi di pasar trending, dan itu harus dinyatakan terbuka**
  di halaman agent. Kejujuran ini menaikkan kredibilitas, bukan menurunkannya.
- **Rebalance hanya dieksekusi bila `ΔFee − Gas − Slippage − ΔIL > 0`.** Lebar range
  adalah fungsi realized volatility (±k·σ), bukan persen tetap. Trigger gabungan:
  keluar-range + deviasi >70–80% dari pusat + cooldown agar tidak churn.
- **Health factor punya ground truth.** `Venus.getAccountLiquidity()` di Comptroller
  `0xfD36E2c2a6789Db23113685031d7F16329158384` dan `AaveV3Pool.getUserAccountData()`
  di `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` keduanya terverifikasi live.
  Harga dari Chainlink BNB/USD `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE`
  (decimals 8, terverifikasi). Ini sebabnya Guardian dibangun pertama — kebenarannya
  bisa dibuktikan terhadap angka on-chain.
- **APR yield** dari DefiLlama Yields API `https://yields.llama.fi/pools`
  (chain `"BSC"`, slug `venus-core-pool`, `aave-v3`, `lista-lending` — semua ada).
  **Tapi `pancakeswap-amm-v3` tidak mencakup BSC di DefiLlama** — fee APR PancakeSwap
  v3 harus dihitung sendiri dari event on-chain.

**Alamat yang TERBUKTI SALAH — jangan dipakai:** Aave PoolAddressesProvider
`0xA97684ea...` tidak punya kode di BSC.

**Masih perlu verifikasi:** alamat oracle internal Venus/Aave (berbeda dari feed
Chainlink umum), endpoint subgraph PancakeSwap v3 BSC yang aktif (hosted service
The Graph sudah deprecated).

---

## 6. Backend & Pipeline Data

### 6.1 Sinkronisasi agent

```
8004scan API ──cron──┐
  semantic search     ├──► normalizer ──► Postgres ──► classifier ──► kategori
  filtered list       │                                (rule + LLM dGrid)
webhook realtime  ────┘
ERC-8004 on-chain ────► indexer (eth_getLogs) ──► fallback + verifikasi
FuguRegistry     ─────► indexer ──► listing first-party
```

**Klasifikasi 4 kategori — 4 lapis** (dari riset 8004scan, terbukti bekerja live):
1. Semantic search per kategori (`semantic_weight=0.7`, `threshold=0.55`)
2. Pre-filter populasi (`is_registered`, `min_score`, `has_a2a`, `is_endpoint_verified`)
3. Keyword search terarah
4. Klasifikasi LLM atas metadata mentah, hasilnya di-cache

Skor kepercayaan disimpan; agent yang tidak lolos ambang tidak ditampilkan.

**Anti-spam wajib**: dari 309k agent BSC mayoritas bulk registration. Filter dengan
`is_registered=true` + `min_score` + `has_a2a=true` + `owner_publisher_tier`.

### 6.2 Ketahanan (langsung menjawab kriteria Data Quality)

- `User-Agent` browser + `X-API-Key` pada setiap panggilan 8004scan
- Retry exponential backoff 3–5×, circuit breaker
- Cache TTL: detail agent 60s · leaderboard 5m · trending 1m · global 60s
- **Fallback berjenjang**: API → cache → on-chain → seed terkurasi
- Health endpoint yang menampilkan status tiap sumber data (jujur ke juri)

### 6.3 Metrik yang dihitung sendiri (pembeda utama)

Tidak diambil dari mana pun — kami hitung dari data on-chain:

| Metrik | Sumber perhitungan |
|---|---|
| Realized APR 7d/30d | perubahan nilai posisi + fee terklaim, dari event |
| Time-in-range % (LP) | tick posisi vs tick pool sepanjang waktu |
| Biaya per rebalance | `gasUsed × effectiveGasPrice` dari receipt |
| Fee vs profit ratio | fee terklaim ÷ PnL bersih |
| Max drawdown | kurva ekuitas per langganan |
| Jarak ke likuidasi (%) | HF on-chain + harga oracle |
| Uptime agent | keberhasilan run terjadwal |
| Median latency run | timestamp mulai→selesai |
| Biaya rata-rata per run | agregat gas + LLM |

**Setiap angka menyertakan tx hash yang bisa diklik ke BscScan.**

---

## 7. Frontend

### 7.1 Journey (dirancang untuk "tanpa dead end")

```
landing → [Lihat agent] → discovery (4 tab kategori, SSR)
   → kartu fugu (metrik + level + badge) → detail ber-URL /agent/[id]
   → panel "agent ini boleh apa" → Hire → 1 tanda tangan → dashboard live
```

### 7.2 Anatomi kartu agent

Karakter fugu · nama · kategori · **success rate 7d** · jumlah run · median latency ·
biaya rata-rata/run · terakhir aktif · jumlah hirer aktif · badge trust
(endpoint verified / publisher tier / health) · harga langganan.

### 7.3 Halaman detail — bagian yang membedakan

- **Panel izin, ditampilkan ke calon pembeli sebelum hire**: "agent ini bisa memanggil
  X, pada kontrak Y, maksimal Z per hari, kedaluwarsa dalam N hari" — dibaca langsung
  dari Keystore on-chain, bukan dari klaim kami.
- **Tombol Revoke** yang benar-benar mengirim transaksi revoke.
- **Live run feed** via WebSocket: langkah demi langkah + tx hash.
- Grafik ekuitas, distribusi PnL, riwayat run.
- Review terverifikasi (hanya dari wallet yang terbukti pernah hire).

### 7.4 Aturan UI yang ditegakkan

- Setiap empty state menyebut aksi + menyediakan tombolnya
- Estimasi biaya sebelum hire, bukan sekadar peringatan
- Badge `Hired` untuk mencegah bayar dua kali
- Detail = halaman ber-URL dengan OG image fugu, bukan modal
- **Jangan pernah mengirim kontrol setengah jadi** — lebih baik hilangkan elemennya

---

### 7.5 Pembeda terhadap lanskap kompetitif

Dari `docs/research/05-competitive-landscape.md`:

1. **Badge "verified on-chain" pada setiap angka.** Setiap AUM/PnL/APR bisa diklik
   ke tx hash. Ini menyerang kegagalan nyata pasar: **Giza/ARMA ditutup Feb 2026**
   setelah dashboard-nya menampilkan AUM besar sementara pengukuran on-chain
   independen menunjukkan posisi nyaris nol. Kepercayaan pada angka marketplace
   agent sedang rusak — kami memperbaikinya dengan bukti, bukan klaim.
2. **Leaderboard per kategori** dengan metrik seragam, bukan satu daftar global.
3. **Perbandingan head-to-head** antar agent dalam kategori yang sama —
   tidak ditemukan di satu pun kompetitor yang diriset.
4. **Mode simulasi / dry-run gratis** sebelum menaruh dana nyata.
5. **Breakdown fee vs profit** — "net setelah gas $Y + fee $Z", bukan APR headline.
6. **Uptime & latensi sebagai metrik kepercayaan kelas satu** — untuk health factor
   monitoring, keterlambatan adalah risiko likuidasi nyata.
7. **Kurasi sebelum tayang** untuk agent DeFi — menghindari masalah kuantitas-tanpa-
   kualitas (Virtuals: 18.000+ agent mayoritas tanpa produk nyata; GPT Store: spam).
8. **Metrik yang setara-dalam per kategori** — health factor dinilai dengan
   "jarak ke likuidasi %", bukan dipaksa memakai APR. Ini yang membuat Agent
   Diversity benar-benar setara, bukan sekadar empat tab.

---

## 8. Identitas Visual

4 karakter fugu, masing-masing dengan state: `idle`, `working`, `alert`, `profit`.

**Mekanik inti: fugu mengembang seiring beban risiko.** Tingkat kembung dipetakan dari
metrik risiko nyata agent (jarak ke likuidasi untuk Guardian, drawdown untuk Grid,
waktu di luar range untuk Rebalancer). Ini mengubah angka menjadi perasaan.

Fugu fallback ber-warna deterministik dari ID agent untuk agent pihak ketiga —
tidak pernah ada kartu kosong, dan identitas visual gratis untuk 309k agent.

---

## 9. Deployment

VPS, Docker Compose + Caddy:

| Service | Isi |
|---|---|
| `caddy` | TLS otomatis, reverse proxy |
| `frontend` | Next.js → `app.fugugent.xyz` |
| `landing` | Next.js → `fugugent.xyz` |
| `api` | Hono → `api.fugugent.xyz` |
| `worker` | BullMQ scheduler + indexer |
| `agent-*` | 4 agent Fugu (A2A/MCP/x402) |
| `postgres`, `redis` | data |

`RPC_URL` **wajib** di-override — default SDK `binance.org` terbukti diblokir dari
jaringan Indonesia. Pakai `https://data-seed-prebsc-1-s1.bnbchain.org:8545` atau
`https://bsc-testnet-rpc.publicnode.com`.

---

## 10. Risiko & Mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | 8004scan `500 DATABASE_ERROR` intermiten | Marketplace kosong saat dinilai | BFF + cache + fallback on-chain + seed terkurasi |
| R2 | **Konflik versi Altana SDK**: Studio pin 0.7.1 & tolak drift; riset Altana bilang butuh 0.9.0 untuk ERC-8183 testnet | Bisa memblokir jalur bonus ERC-8183 | **Uji lebih dulu** sebelum menulis kode. Kalau konflik nyata: pakai jalur Altana SDK terpisah di backend, bukan di dalam project Studio |
| R3 | dGrid tidak bisa dipasang sebagai provider Studio (altana menolak pieverse) | Agent tanpa lapisan penjelasan | Pakai `--llm-provider openai` + override base URL ke dGrid; kalau ditolak, panggil dGrid dari backend, bukan dari dalam agent |
| R4 | Session Altana kedaluwarsa saat judging | Demo mati | Expiry 30 hari + hitung mundur di UI + alert |
| R5 | Spend cap native terlalu kecil → semua tx `FAILED` | Agent tidak pernah jalan | Cap awal longgar, uji end-to-end di testnet dulu |
| R6 | Binance Bazaar/B402 diblokir dari Indonesia | Jalur discovery merchant mati | Bukan jalur kritis; lewati atau uji lewat VPS (VPS di luar ID) |
| R7 | Waktu | Scope tidak selesai | Urutan: SC → agent → backend → frontend → landing (sesuai prioritas) |

---

## 11. Open Questions

1. **R2 & R3 di atas harus diuji sebelum menulis kode agent** — ini gate teknis pertama.
2. ~~dGrid x402 mainnet vs testnet~~ → **DIPUTUSKAN: konsisten testnet.** Agent
   membayar inference lewat API key dGrid biasa. Jalur x402 mainnet tidak dipakai
   untuk sekarang.
3. API key 8004scan Pro — harus diajukan lewat form hackathon.
4. ~~Token pembayaran langganan~~ → **DIPUTUSKAN: user memilih**, harga dalam USD,
   dikonversi lewat Chainlink. Lihat §4.3.
5. Bagian PancakeSwap di `docs/research/04` belum selesai ditulis (agen riset terputus);
   sebagian tercakup di `06-agent-strategies.md`.

---

## 12. Urutan Kerja

1. **Gate teknis**: uji R2 (versi SDK Altana) & R3 (dGrid sebagai provider) — sebelum apa pun
2. **Smart contracts**: 3 kontrak UUPS + test + deploy testnet
3. **Satu agent utuh** (Fugu Guardian — paling mudah diverifikasi kebenarannya:
   HF on-chain punya ground truth) sebagai pola untuk 3 sisanya
4. **Tiga agent sisanya**
5. **Backend**: indexer, BFF, classifier, scheduler
6. **Frontend**: discovery → detail → hire → dashboard
7. **Landing page**
8. **Agent Advantage Report** (dijalankan paralel sejak agent pertama hidup)
