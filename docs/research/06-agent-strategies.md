# Riset Spesifikasi Strategi — 4 Agent DeFi Otonom (BNB Smart Chain)

> Konteks: **Fugugent** — marketplace agent DeFi otonom berlangganan di BNB Smart Chain. Eksekusi di **testnet (chain 97)**, data/harga dibaca dari **mainnet (chain 56)**.
> Tanggal riset: **8 September 2026**.
> Tujuan: juri hackathon minta bukti kuantitatif (win rate, window waktu, risiko) bahwa agent > manual. Dokumen ini adalah spesifikasi yang bisa langsung diimplementasikan, bukan sekadar teori.

**Legenda tanda:**
- ✅ = diverifikasi live hari ini (RPC call via `cast` ke `https://bsc-dataseed.bnbchain.org`, atau HTTP call ke API publik)
- 📄 = dari dokumentasi resmi / paper, belum dieksekusi live oleh saya
- ⚠️ **PERLU VERIFIKASI** = tidak saya konfirmasi langsung — jangan hardcode ke kontrak tanpa cek ulang sebelum deploy

RPC yang dipakai untuk semua `cast call` di dokumen ini: `https://bsc-dataseed.bnbchain.org` (chain 56). RPC `binance.org` **tidak dipakai** (diblokir dari jaringan eksekusi ini, sesuai instruksi).

---

## 0. Kerangka pembuktian "agent > manual" (berlaku untuk semua 4 agent)

Juri akan minta tiga angka spesifik per agent — desain metrik ini di awal supaya konsisten:

1. **Win rate**: persentase episode backtest (mis. rolling 30 hari, digeser tiap 1 hari, N ≥ 90 window) di mana net return agent > net return baseline manual (baseline = "set & forget" tanpa aksi, dengan asumsi realistis: manusia cek & rebalance manual maks 1x/minggu, delay reaksi 12–24 jam).
2. **Window waktu**: rentang backtest minimum yang jujur secara statistik. Untuk strategi crypto volatile, minimum **90 hari** data harga 1-jam, idealnya **180–365 hari** yang mencakup rezim uptrend, downtrend, dan sideways — supaya klaim tidak "curve-fit" ke satu rezim pasar (lihat §1 riset Uniswap v3: strategi rebalancing yang menang di sideways market bisa kalah telak saat trending).
3. **Risiko**: minimal laporkan **max drawdown**, **volatility of returns**, **worst single episode**, dan **downside deviation** — bukan cuma APR rata-rata. Agent yang "menang" di APR tapi drawdown 3x lebih besar dari manual bukan agent yang lebih baik.

Metodologi backtest wajib: **walk-forward, bukan in-sample single-run**. Simulasikan gas fee, slippage, dan swap fee riil (jangan asumsi eksekusi gratis) — semua empat agent kena biaya on-chain nyata di BSC (~$0.05–$0.30/tx di gas price 1–3 gwei BSC, ⚠️ **PERLU VERIFIKASI** angka gas price real-time saat implementasi karena gas price BSC berfluktuasi).

Sumber data historis gratis untuk BSC (dipakai di semua 4 agent, detail per-agent di bawah):
- **DefiLlama** — TVL & yield historis, gratis, tanpa API key. ✅ Diverifikasi live (lihat §3).
- **Binance public API `/api/v3/klines`** — OHLCV harga BNB & token major, gratis, granularitas hingga 1 menit, histori sejak 2017. 📄 Baik untuk simulasi price-driven strategy (grid, health factor) karena BNB/BUSD di CEX sangat berkorelasi dengan harga on-chain BSC.
- **On-chain event logs BSC** (`eth_getLogs` via RPC publik atau explorer) — `Swap`, `Mint`, `Burn`, `Collect` dari kontrak PancakeSwap v3 pool untuk merekonstruksi price path & volume riil on-chain. 📄 Butuh indexer (mis. self-hosted, atau BscScan API gratis dengan rate limit) karena RPC publik biasanya membatasi range block untuk `eth_getLogs`.
- **CryptoDataDownload.com** — CSV OHLCV gratis harian/jam/menit untuk Binance spot. 📄

---

## 1. Agent LP Rebalancing (PancakeSwap v3)

### 1.1 Kontrak yang relevan (BSC mainnet, chain 56)

| Kontrak | Alamat | Status |
|---|---|---|
| PancakeSwap V3 Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | ✅ Kode kontrak ada, cek via `cast code` |
| PancakeSwap V3 NonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | ✅ Diverifikasi silang: `cast call ... "factory()(address)"` mengembalikan alamat Factory di atas — cocok |

Dokumentasi resmi alamat: https://developer.pancakeswap.finance/contracts/v3/addresses

### 1.2 Cara memilih lebar range

Riset akademik (arXiv 2309.08431 "Predictable Loss and Optimal Liquidity Provision", arXiv 2410.09983 "Backtesting Framework for CLMM on Uniswap V3", arXiv 2309.10129 "Adaptive LP with Deep RL") sepakat pada beberapa prinsip yang bisa langsung dijadikan aturan:

- **Range lebih sempit → fee APR lebih tinggi per unit modal, tapi frekuensi keluar-range (dan karenanya kebutuhan rebalance) meningkat tajam.** Trade-off ini harus dihitung eksplisit, bukan dipilih intuitif.
- Lebar range optimal adalah fungsi dari **volatilitas realized pair** dan **rasio fee pool terhadap biaya gas rebalance** — bukan angka tetap. Pool volatile (mis. altcoin-BNB) butuh range lebih lebar dari pool stabil (mis. USDT-USDC).
- Studi RL (arXiv 2309.10129) menunjukkan strategi adaptif (lebar & timing rebalance disesuaikan kondisi) mengungguli baseline statis **9%–69%** tergantung pool — rentang ini lebar sekali sehingga **jangan dijanjikan sebagai angka pasti ke juri**; laporkan sebagai referensi riset pihak ketiga, verifikasi ulang dengan backtest sendiri pada pool BSC yang relevan.
- Vault otomatis nyata (bukan riset akademik) memakai pendekatan berikut — dirangkum dari dokumentasi masing-masing (📄, belum saya baca full source code):
  - **Gamma Strategies** (docs.gamma.xyz/gamma/features/strategies): rebalance dipicu **trigger otomatis** ketika harga bergerak keluar dari band tertentu di sekitar band aktif, lalu vault menghitung ulang base+limit position. Gamma menjalankan beberapa "strategy types" berbeda (narrow/wide/stable) per pool sesuai volatilitas pool tsb — bukan satu lebar untuk semua pool.
  - **Arrakis**: fokus pada pasangan **low-volatility/stable** karena IL lebih kecil dan rebalance lebih jarang dibutuhkan — strategi mereka secara eksplisit menghindari pool volatile tinggi untuk vault pasif.
  - **Steer Protocol**: berbeda dari Gamma/Arrakis (managed), Steer memberi **logic-based custom vault** yang dikonfigurasi per pool — menunjukkan tidak ada satu formula range universal yang dipakai industri; parametrisasi per-pool adalah norma industri.
  - **Ichi**: dikenal untuk **single-sided liquidity** (deposit 1 token, auto rebalance ke posisi 1-sisi) — relevan kalau agent Fugugent ingin menawarkan LP tanpa perlu user pegang 2 token.
  - **Bunni**: mengimplementasikan "Liquidity Density Functions" (lebih canggih, generalisasi range jadi kurva distribusi) — untuk v4/hooks, ⚠️ **PERLU VERIFIKASI** kompatibilitas dengan PancakeSwap v3 (bukan v4) di BSC sebelum mengadopsi ide ini.

**Rekomendasi implementasi untuk MVP hackathon:** pakai band lebar berbasis **realized volatility N-hari** (mis. σ 14-hari harga pair, band = ±k·σ dengan k dikalibrasi lewat backtest per pool), bukan persentase tetap seperti "±5%" — ini konsisten dengan literatur di atas dan mudah dijelaskan ke juri dengan angka konkret.

### 1.3 Trigger rebalance

Tiga jenis trigger, kombinasikan (jangan pilih satu saja):

1. **Keluar range (price exit)** — trigger paling penting: begitu harga tick keluar dari `[tickLower, tickUpper]` posisi, posisi berhenti mengumpulkan fee sepenuhnya (100% modal jadi 1 aset). Deteksi via `slot0().tick` pool vs `tickLower/tickUpper` posisi (baca dari `positions(tokenId)` di NonfungiblePositionManager).
2. **Deviasi dari pusat range** — rebalance preventif sebelum harga benar-benar keluar, mis. saat harga sudah menempati >70–80% dari lebar range ke satu sisi (mengurangi risiko "keluar range saat gas mahal / market sedang bergerak cepat").
3. **Time-based / cooldown** — batas minimum jeda antar-rebalance (mis. minimum 4–6 jam) untuk mencegah "rebalance churn" saat harga berosilasi di tepi range — ini krusial karena riset menunjukkan **rebalancing otomatis rentan terhadap "volatility drag" dan hanya profitable saat fee level tinggi**; churn berlebihan menghancurkan profitabilitas lewat gas + slippage berulang.

### 1.4 Rumus profitabilitas rebalance (net-of-cost)

Rebalance hanya dieksekusi jika:

```
FeeEarnedProjected(range_baru) − FeeEarnedProjected(range_lama, jika tetap)
    − GasCost(withdraw + swap rebalance + deposit)
    − SlippageCost(swap untuk rebalance rasio token)
    − ExpectedIL_delta(range_baru vs range_lama)
  > 0
```

Komponen:
- **IL untuk posisi konsentrasi** (bukan full-range): batas di mana IL → 0 adalah `Pa/P = P/Pb = (1−ρ)²` dengan ρ = fraksi lebar range relatif terhadap harga saat ini (rumus dari riset yang dirangkum Peteris Erins/Auditless, Medium). Formula IL dasar 50/50 pool: `IL = 2√d/(1+d) − 1`, dengan `d` = rasio perubahan harga (`P_new/P_old`); untuk posisi terkonsentrasi, IL ini **diperbesar** oleh faktor konsentrasi (semakin sempit range, semakin besar IL per unit pergerakan harga dalam range).
- **GasCost**: 3 transaksi on-chain (decreaseLiquidity/collect, opsional swap untuk re-rasio, mint posisi baru) — ambil gas price live dari RPC (`eth_gasPrice`) dikali gas limit tiap operasi (⚠️ **PERLU VERIFIKASI** gas limit aktual dari simulasi/estimasi di testnet 97 sebelum mainnet).
- **SlippageCost**: dari `quoteExactInputSingle` (Quoter kontrak PancakeSwap v3) sebelum eksekusi — jangan asumsikan 0.

Riset non-akademik (Medium/DeFi Scientist "Rebalancing vs Passive strategies") menyimpulkan **auto-rebalancing sering underperform passive holding di luar periode volume/fee tinggi** — artinya rule "rebalance hanya jika threshold profitabilitas positif" bukan opsional, itu wajib untuk bisa klaim "lebih baik dari manual" secara jujur.

### 1.5 Metrik yang dilacak & dilaporkan

| Metrik | Definisi |
|---|---|
| Time-in-range % | % waktu (block-weighted) posisi aktif berada dalam range dan mengumpulkan fee |
| Fee APR | Fee terkumpul (dalam USD) / nilai modal rata-rata, dianualisasi |
| IL (realized) | Selisih nilai portofolio LP vs hold 50/50 pasif pada periode sama |
| Net APR | Fee APR − IL realized − (total gas+slippage rebalance / modal, dianualisasi) |
| Jumlah rebalance | Hitungan aksi rebalance per periode (dipakai untuk membuktikan bukan overtrading) |
| Biaya per rebalance | Gas + slippage rata-rata per aksi (USD) |

### 1.6 Data untuk kartu & halaman detail marketplace

**Kartu (ringkas):** Fee APR 30 hari, Net APR 30 hari (setelah gas & IL), Time-in-range %, pair/pool yang didukung, lebar range saat ini, jumlah rebalance 30 hari, win rate vs manual (dari backtest), badge risiko (Low/Med/High berdasarkan volatilitas pool).

**Halaman detail:** grafik Net APR vs Fee APR vs IL (pisahkan tiap komponen — transparansi ini penting agar user tidak dikelabui APR kotor), histori tiap rebalance (timestamp, tick range lama→baru, biaya, alasan trigger), distribusi win rate per rezim pasar (uptrend/downtrend/sideways — jangan hanya angka tunggal karena literatur menunjukkan performa sangat rezim-dependent), kontrak yang dipakai (Factory/NFPM di atas) dengan link BscScan, dan disclosure eksplisit risiko IL + smart contract risk.

### 1.7 Cara backtest jujur

1. Ambil histori tick/harga pool dari `Swap` event log kontrak `PancakeV3Pool` on-chain (rekonstruksi `sqrtPriceX96` per event) — atau proxy dengan harga Binance klines untuk pair yang sama (BNB/USDT dsb) sebagai dataset lebih mudah didapat.
2. Simulasikan posisi dengan formula fee accrual Uniswap v3 standar (`feeGrowthGlobal`, liquidity share) menggunakan volume riil dari histori swap.
3. Jalankan **walk-forward**: window bergeser (mis. mulai tiap hari, durasi 30 hari), minimal 90 window berbeda, mencakup ≥1 periode tren kuat dan ≥1 periode sideways.
4. Bandingkan terhadap 2 baseline: (a) hold 50/50 pasif tanpa LP, (b) LP full-range tanpa rebalance — bukan cuma satu baseline, supaya klaim "lebih baik" tidak cherry-picked.
5. Laporkan win rate, drawdown, dan interval kepercayaan (bukan cuma rata-rata) di window-window tsb.

Sumber untuk framework backtest: paper "Backtesting Framework for Concentrated Liquidity Market Makers on Uniswap V3" (arXiv:2410.09983) — metodologinya generalizable ke PancakeSwap v3 karena mekanisme CLMM identik (fork Uniswap v3).

---

## 2. Agent Grid Trading

### 2.1 Parameter grid

Berdasarkan dokumentasi Binance Grid Trading, Pionex ("Grid Bot Parameters Explained"), dan 3Commas ("Grid bots: Main settings and options") — 📄, semua tiga platform konsisten pada parameter inti:

- **Batas atas (upper price) & batas bawah (lower price)**: bot tidak menempatkan order di luar range ini.
- **Jumlah grid (grid count)**: jumlah level buy+sell; grid count genap dibagi rata buy/sell di sekitar harga saat ini.
- **Spasi arithmetic**: `interval = (upper − lower) / grid_count` — selisih harga antar level tetap. Cocok untuk range sempit / aset harga rendah.
- **Spasi geometric**: rasio persentase antar level tetap (bukan selisih absolut) — cocok untuk range lebar/volatilitas tinggi karena menjaga persentase profit per grid konsisten di semua level harga.
- **Ukuran order per grid**: umumnya `modal_total / grid_count`, dengan opsi alokasi lebih besar di grid dekat harga saat ini (beberapa bot lanjutan melakukan ini, tapi standar-nya rata).

### 2.2 Kapan reset / stop

- **Stop-loss / upper & lower breakout**: begitu harga menembus batas atas/bawah grid secara konsisten (bukan wick sesaat — pakai konfirmasi N-candle atau time-based agar tidak overreact ke noise), bot berhenti dan (opsional) likuidasi ke stablecoin — ini pola standar di Pionex/3Commas ("trigger price", "stop loss").
- **Reset grid**: ketika breakout dikonfirmasi trending (bukan reversal cepat), grid lama dibekukan dan grid baru dihitung ulang di sekitar harga & volatilitas baru — jangan otomatis re-deploy di range lama karena itu justru memperbesar kerugian pada trending market.

### 2.3 Risiko breakout & trending market

Grid trading secara struktural adalah **strategi mean-reversion** — profit dari osilasi harga dalam range, dan **rugi signifikan pada trending market kuat satu arah** karena grid terus membeli saat harga turun (mengumpulkan aset yang terus terdepresiasi) atau kehabisan inventory saat harga naik terus (kehilangan upside). Ini harus didisclosure eksplisit ke user marketplace — bukan cuma disclaimer generik.

### 2.4 Metrik

| Metrik | Definisi |
|---|---|
| Grid profit | Total profit dari fill buy-low/sell-high, terpisah dari perubahan nilai unrealized inventory |
| Jumlah fill | Hitungan order buy & sell yang tereksekusi |
| Drawdown | Penurunan nilai portofolio maksimum dari peak, termasuk unrealized loss saat trending |
| Profit per grid | Rata-rata profit per pasangan buy-sell yang closed |
| Win rate | % pasangan grid (buy→sell) yang closed profit vs total pasangan closed |

### 2.5 Eksekusi on-chain di BSC — poin kritis

**PancakeSwap TIDAK punya order book on-chain native untuk limit order dalam arti CEX (grid bot).** Yang ada:

- **PancakeSwap Limit Order/TWAP** (docs.pancakeswap.finance/trade/limit-orders): 📄 fitur ini **on-chain namun bukan order-book matching di dalam AMM pool** — order diisi oleh **off-chain taker/keeper** yang bersaing mengeksekusi saat harga pasar mencapai harga limit, dan taker mendapat fee dari output token sebagai insentif. Ini artinya limit order PancakeSwap **bergantung pada keeper pihak ketiga**, bukan native matching engine — mirip mekanisme CoW/1inch limit order, bukan grid trading order book seperti Binance.
- **Kesimpulan untuk desain agent grid Fugugent**: agent grid **harus mengimplementasikan sendiri fungsi keeper**: (1) pantau harga on-chain (baca `slot0()` pool PancakeSwap v3 atau harga oracle), (2) saat harga menyentuh level grid, agent (server-side bot / keeper contract) mengeksekusi **swap langsung** via Router/SmartRouter PancakeSwap, bukan menaruh limit order pasif dan menunggu taker lain mengisi. Alternatif: memanfaatkan PancakeSwap Limit Order infra yang ada (jika kontraknya publik & bisa dipanggil programatis) — ⚠️ **PERLU VERIFIKASI** apakah kontrak limit-order PancakeSwap terverifikasi & alamatnya publik untuk BSC sebelum bergantung padanya; saya belum mengonfirmasi alamat kontrak spesifik limit-order engine PancakeSwap di BSC secara live.
- Implikasi biaya: setiap "fill" grid = 1 transaksi swap on-chain (gas + swap fee pool, mis. 0.01–0.25% tergantung fee tier PancakeSwap v3) — ini **beda signifikan dari grid bot CEX (fee maker/taker jauh lebih murah, tanpa gas per-order)**. Desain jumlah grid harus mempertimbangkan bahwa grid rapat = banyak transaksi = biaya gas kumulatif bisa memakan profit tipis per-grid, terutama di aset dengan volatilitas rendah.

### 2.6 Data untuk kartu & halaman detail marketplace

**Kartu:** range harga grid saat ini (upper/lower), jumlah grid & tipe spasi (arithmetic/geometric), grid profit 30 hari (annualized %), win rate, status (active/breakout-stopped), badge "cocok untuk sideways market" (bukan trending).

**Halaman detail:** riwayat semua fill (timestamp, harga, sisi buy/sell, ukuran, gas cost), grafik equity curve vs harga underlying (agar user lihat kapan strategi menang/kalah), breakdown biaya on-chain (jumlah tx, total gas dibayar, % gas dari profit), simulasi skenario trending vs sideways secara terpisah (agar user paham strategi ini bukan "selalu profit").

### 2.7 Cara backtest jujur

1. Ambil OHLCV granular (candle 1 menit–1 jam) dari Binance `/api/v3/klines` untuk pair yang sesuai (mis. BNBUSDT) sebagai proxy harga BSC.
2. Simulasikan level grid & fill berdasarkan candle high/low menyentuh level (bukan hanya close price, karena itu meremehkan jumlah fill riil).
3. Sertakan **biaya on-chain riil per fill** (gas BSC + swap fee tier PancakeSwap) — bukan fee CEX 0.1% — supaya angka tidak menyesatkan dibanding grid bot CEX.
4. Uji minimal 3 rezim: sideways historis (mis. periode konsolidasi BNB), trending naik, trending turun — laporkan win rate & drawdown **per rezim**, bukan agregat, karena performa grid sangat rezim-dependent (lihat §2.3).
5. Baseline pembanding: buy-and-hold pasif pada periode sama.

---

## 3. Agent Yield Optimisation

### 3.1 Sumber APR di BSC — diverifikasi live via DefiLlama Yields API

**Endpoint (gratis, tanpa API key):**
```
GET https://yields.llama.fi/pools
GET https://yields.llama.fi/chart/{pool_id}
```
✅ Diverifikasi live hari ini — `GET /pools` mengembalikan 17.191 pool global, field: `chain`, `project`, `symbol`, `tvlUsd`, `apyBase`, `apyReward`, `apy`, `underlyingTokens`, `pool` (UUID, dipakai untuk endpoint `/chart/{pool}` — juga terverifikasi mengembalikan histori APY/TVL harian sejak 2022).

**Filter untuk BSC** — field `chain` bernilai persis `"BSC"` (✅ diverifikasi; opBNB terpisah sebagai `"Opbnb"`, jangan disamakan). Project slug yang relevan & **dikonfirmasi live memiliki data di chain BSC**:

| Protokol | `project` slug DefiLlama | Jumlah pool BSC (live) |
|---|---|---|
| Venus Core Pool | `venus-core-pool` | 41 |
| Venus Flux (isolated pools) | `venus-flux` | ⚠️ ada di daftar slug tapi belum dicek jumlah pool BSC |
| Aave v3 (BNB Chain) | `aave-v3` | 8 |
| Lista Lending | `lista-lending` | 18 |
| Lista CDP / Liquid Staking | `lista-cdp`, `lista-liquid-staking` | ⚠️ belum dicek jumlah |
| PancakeSwap AMM (v2 & stable) | `pancakeswap-amm` | 41 |
| PancakeSwap AMM v3 | `pancakeswap-amm-v3` | **0 di BSC** — DefiLlama hanya punya data v3 ini untuk `Ethereum` dan `Opbnb`, **bukan BSC**. ⚠️ Artinya untuk fee APR PancakeSwap v3 di BSC, DefiLlama Yields API **tidak bisa dipakai langsung** — perlu hitung sendiri dari on-chain event (lihat §1.7) atau subgraph. |

Contoh data live (dari `GET /pools`, difilter `chain=="BSC"`):
- Venus WBNB supply: `apyBase 0.076%` — pool `747b58ab-aefd-42e1-a312-01ad5a0ab7f5`
- Aave v3 WBNB supply: `apyBase 0.011%` — pool `9380e5ac-3b75-468c-951c-c24ff6497e80`
- Lista Lending BNB: `apyBase 0.137%` — pool `e15db93c-9c49-490c-896d-24092b4d7471`

(Angka-angka di atas adalah snapshot 8 Sep 2026, akan berubah real-time — jangan hardcode nilainya, hanya struktur/endpoint-nya yang stabil.)

### 3.2 Fungsi kontrak on-chain untuk baca supply/borrow rate langsung (tanpa API pihak ketiga)

**Venus Protocol** — pola Compound v2 fork, per-block rate:
- Kontrak token pasar (vToken, mis. vBNB): `supplyRatePerBlock()` dan `borrowRatePerBlock()` — keduanya ✅ **diverifikasi live** via `cast call` ke vBNB `0xA07c5b74C9B40447a954e1466938b865b6BBea36`:
  - `supplyRatePerBlock() → 10940907` (scaled 1e18, per block)
  - `borrowRatePerBlock() → 83484456` (scaled 1e18, per block)
  - Konversi ke APY: `APY = (1 + ratePerBlock/1e18)^(blocksPerYear) − 1`. BSC block time ~0.75–1 detik pasca-upgrade (⚠️ **PERLU VERIFIKASI** angka blocksPerYear terkini karena BSC pernah ubah target block time — jangan pakai asumsi lama 3 detik/block).
- Comptroller (risk engine, alamat inti): `0xfD36E2c2a6789Db23113685031d7F16329158384` — ✅ diverifikasi live, `getAccountLiquidity(address)` merespons `(0,0,0)` untuk address kosong (sesuai ekspektasi: no error, no liquidity, no shortfall).

**Aave v3 BNB Chain:**
- Pool Proxy: `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` — ✅ diverifikasi live, `getUserAccountData(address)` merespons dengan struktur benar (6 return value, healthFactor = max-uint untuk address tanpa hutang — perilaku sesuai spek Aave v3).
- Untuk rate supply/borrow: pakai `getReserveData(asset)` di Pool contract yang sama (mengembalikan `currentLiquidityRate` & `currentVariableBorrowRate`, dalam ray units 1e27) — ⚠️ **PERLU VERIFIKASI**, saya belum memanggil `getReserveData` secara live (baru menguji `getUserAccountData`).
- **PoolAddressesProvider**: alamat `0xA97684ead0e402dC232d5A977953DF7ECBaB3CDb` yang saya temukan dari pencarian web (dipakai di Polygon/Ethereum/Optimism) **TIDAK punya kode kontrak di BSC mainnet** — ❌ dikonfirmasi via `cast code` (return kosong, "does not have any code"). **Jangan pakai alamat ini untuk BSC.** Gunakan langsung Pool Proxy `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` yang sudah terverifikasi berfungsi, atau cari PoolAddressesProvider BSC yang benar via `aave-address-book` package resmi sebelum produksi. ⚠️ **PERLU VERIFIKASI**.

### 3.3 Risk-adjusted APR & threshold pindah pool

Rumus dasar risk-adjusted APR (bukan riset akademik spesifik DeFi, ini adaptasi prinsip risk-adjusted return umum + faktor risiko on-chain):

```
RiskAdjustedAPR = RawAPR × RiskMultiplier

RiskMultiplier = f(TVL_score, Age_score, Audit_score, DepegRisk_score)
```

Saran skema skor (0–1, dikalikan bersama atau rata-rata tertimbang — pilih salah satu secara konsisten & dokumentasikan alasannya ke user):
- **TVL_score**: penalti untuk TVL < ambang tertentu (mis. <$1M dianggap berisiko tinggi manipulasi/exit; >$50M dianggap likuid). Ambang absolut ini **keputusan desain produk**, bukan angka baku industri — nyatakan sebagai asumsi eksplisit.
- **Age_score**: umur protokol/pool sejak deploy — makin muda, makin berisiko (rug/bug belum teruji waktu).
- **Audit_score**: biner atau bertingkat — protokol besar mapan (Venus, Aave) diverifikasi teraudit publik & sudah lama battle-tested; ini fakta yang bisa dicek dari halaman audit resmi masing-masing protokol, bukan dari DefiLlama API.
- **DepegRisk_score**: khusus untuk pool yang underlying-nya stablecoin/LST (mis. USD1, slisBNB) — cek riwayat deviasi dari peg.

**Threshold pindah pool**, hanya migrasi jika:

```
(APR_pool_baru − APR_pool_lama) × durasi_holding_proyeksi × modal
  > GasCost(withdraw + swap jika perlu + deposit) + SlippageCost + BufferRisikoTambahan
```

`BufferRisikoTambahan` penting: pool APR lebih tinggi seringkali lebih berisiko (TVL kecil, protokol baru) — threshold migrasi harus dinaikkan (bukan hanya net-of-gas positif) sebanding dengan selisih risk score, supaya agent tidak terus-menerus "chasing yield" ke pool berisiko demi APR marjinal.

### 3.4 Metrik & data kartu/halaman detail

**Kartu:** Current APR (raw & risk-adjusted), pool/protokol yang dipegang saat ini, jumlah migrasi 30 hari, badge risiko per pool (Low/Med/High dari skema §3.3), TVL protokol.

**Halaman detail:** histori tiap migrasi (dari→ke, APR delta, alasan, biaya), grafik APR historis pool via `/chart/{pool}` DefiLlama, breakdown risk score per komponen (TVL/age/audit/depeg), disclosure sumber data (DefiLlama, dengan catatan "APY dari DefiLlama diperbarui ~tiap jam" — sesuai dokumentasi mereka).

### 3.5 Cara backtest jujur

1. Ambil histori APY harian per pool via `GET /chart/{pool}` DefiLlama untuk semua kandidat pool (Venus/Aave/Lista/PancakeSwap farm) sejak pool tsb listed.
2. Simulasikan agent yield-switcher: tiap hari, hitung apakah threshold migrasi (§3.3) terpenuhi berdasarkan APR historis pada hari itu (bukan APR masa depan — hindari lookahead bias, kesalahan umum backtest DeFi).
3. Kurangi setiap migrasi dengan estimasi gas BSC riil + slippage swap (jika ganti aset).
4. Baseline pembanding: (a) stake pasif di satu pool APR tertinggi awal periode dan tidak pernah pindah, (b) rata-rata APR semua pool kandidat tanpa optimisasi.
5. Laporkan win rate per periode 30 hari rolling, minimal 90 window, plus insiden risiko (mis. berapa kali baseline pasif akhirnya kena pool yang APR-nya jatuh drastis karena TVL drain — ini bagian dari cerita "kenapa agent lebih baik").

---

## 4. Agent Health Factor Monitoring

### 4.1 Rumus health factor

**Venus (model Compound v2 fork)** — tidak punya "health factor" tunggal seperti Aave, tapi setara secara konsep via `getAccountLiquidity`:
- `getAccountLiquidity(address account) → (uint256 error, uint256 liquidity, uint256 shortfall)` di kontrak **Comptroller** — ✅ **diverifikasi live** di `0xfD36E2c2a6789Db23113685031d7F16329158384`.
  - `liquidity > 0` dan `shortfall == 0` → posisi aman, `liquidity` = sisa daya pinjam dalam USD (scaled).
  - `shortfall > 0` → posisi sudah undercollateralized, likuidasi sudah bisa dieksekusi siapa saja.
  - "Health factor" setara bisa dihitung manual: `HF_equiv = (Σ collateral_i × collateralFactor_i) / Σ borrow_i` — ambil `collateralFactorMantissa` per market dari `markets(vTokenAddress)` di Comptroller.

**Aave v3** — health factor eksplisit dari kontrak:
- `getUserAccountData(address user) → (totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor)` di kontrak **Pool** — ✅ **diverifikasi live** di `0x6807dc923806fE8Fd134338EABCA509979a7e0cB`.
  - `healthFactor = (totalCollateralBase × currentLiquidationThreshold) / totalDebtBase` (dalam basis 1e18; nilai `type(uint256).max` berarti tidak ada hutang, dikonfirmasi live).
  - **HF < 1.0 → posisi bisa dilikuidasi.**

### 4.2 Threshold aksi

Skema tiga tingkat (standar praktik monitoring HF, bukan angka baku protokol — ini keputusan produk yang harus dijelaskan ke user):

| Threshold HF (Aave-style) | Aksi |
|---|---|
| HF ≤ 1.5 (atau setara likuiditas Venus mulai menipis) | **Warning** — notifikasi, belum aksi otomatis |
| HF ≤ 1.2 | **Partial repay** atau **top-up collateral** otomatis (ambil dari treasury/wallet yang diotorisasi user) |
| HF ≤ 1.05–1.1 | **Deleverage agresif** — repay besar/withdraw sebagian collateral ke aset stabil, prioritas hindari likuidasi walau harus rugi slippage |
| HF ≤ 1.0 | Sudah terlambat — likuidator lain kemungkinan sudah beraksi; agent tetap coba emergency repay sebagai last resort |

Threshold spesifik (1.5/1.2/1.1) adalah **contoh, bukan hasil riset** — kalibrasi ulang lewat backtest volatilitas aset yang didukung (§4.5), karena aset volatile butuh buffer lebih lebar dari stablecoin.

### 4.3 Estimasi jarak ke likuidasi dalam % pergerakan harga

Untuk Aave v3, dengan 1 collateral & 1 debt asset:
```
% drop harga collateral sampai HF=1 ≈ 1 − (totalDebtBase / (totalCollateralBase × currentLiquidationThreshold))
```
Ini rumus langsung dari definisi HF di atas — pada HF saat ini, `%drop_to_liq = 1 − 1/HF_current` (untuk kasus sederhana 1 aset collateral, harga debt tetap). Untuk multi-collateral/multi-debt, perlu breakdown per-aset dengan bobot nilai USD masing-masing (⚠️ **PERLU VERIFIKASI**: rumus simplifikasi ini tidak otomatis benar untuk portofolio kompleks — perlu simulasi ulang per skenario harga, bukan rumus tertutup tunggal, saat ada >1 aset debt/collateral dengan pergerakan independen).

Untuk Venus, pendekatan sama menggunakan `liquidity`/`shortfall` dan `collateralFactorMantissa` per market.

### 4.4 Sumber harga

- **Chainlink BNB/USD Price Feed di BSC mainnet**: `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` — ✅ **diverifikasi live**: `decimals() = 8`, `description() = "BNB / USD"`, `latestRoundData()` mengembalikan round data valid dengan harga di orde `7.51e10` (yaitu ~$751.045 setelah dibagi `1e8` — nilai ini snapshot hari ini, akan berubah). Sumber resmi: https://docs.chain.link/data-feeds/price-feeds/addresses dan https://data.chain.link/feeds/bsc/mainnet/bnb-usd.
- Untuk agent health factor, **harga collateral/debt terbaik langsung dibaca dari oracle yang dipakai protokol itu sendiri** (Venus & Aave masing-masing punya oracle module internal — Venus pakai `PriceOracle` custom, Aave pakai `AaveOracle` yang biasanya mem-wrap Chainlink feed) — bukan dari feed Chainlink umum secara terpisah, supaya kalkulasi HF/liquidity konsisten dengan yang dipakai kontrak likuidasi sungguhan. ⚠️ **PERLU VERIFIKASI** alamat oracle module spesifik Venus & Aave di BSC (belum saya cek live) sebelum dipakai untuk kalkulasi kritis.
- "Binance Oracle" yang disebut di brief: ⚠️ **PERLU VERIFIKASI** — saya tidak menemukan/verifikasi entitas oracle resmi bernama demikian yang dipakai luas oleh Venus/Aave di BSC dalam riset ini; jangan asumsikan ini sumber harga utama tanpa konfirmasi tambahan.

### 4.5 Metrik

| Metrik | Definisi |
|---|---|
| Liquidation avoided | Jumlah episode di mana HF turun ke bawah threshold warning tapi agent bertindak sebelum HF ≤ 1.0 |
| Waktu respons | Delta waktu (block/detik) antara HF menembus threshold dan transaksi mitigasi agent dikonfirmasi on-chain |
| Biaya intervensi | Gas + slippage (jika swap collateral) + opportunity cost dari repay/deleverage, per intervensi |

### 4.6 Data untuk kartu & halaman detail marketplace

**Kartu:** HF saat ini (live), % jarak ke likuidasi, jumlah "liquidation avoided" historis, waktu respons rata-rata, protokol yang dimonitor (Venus/Aave), aset collateral & debt.

**Halaman detail:** grafik HF historis dengan garis threshold aksi, log tiap intervensi (timestamp, HF sebelum/sesudah, aksi diambil, biaya, tx hash BscScan), simulasi stress-test ("kalau BNB turun 20% besok, HF anda jadi X" — dihitung dari rumus §4.3 dengan harga live dari feed Chainlink di atas), dan disclosure bahwa agent **tidak menjamin 100% mencegah likuidasi** (block time, kongesti network, dan gap harga ekstrem tetap risiko residual).

### 4.7 Cara backtest jujur

1. Ambil histori harga BNB & aset lain dari Binance klines (candle rendah granularitas, mis. 1 menit, untuk menangkap flash-crash yang relevan untuk risiko likuidasi).
2. Simulasikan posisi pinjaman hipotetis (beberapa skenario LTV awal) dan hitung ulang HF di tiap candle historis menggunakan rumus §4.1/§4.3.
3. Simulasikan agent bertindak begitu HF menembus threshold (dengan delay realistis: waktu deteksi + waktu konfirmasi block BSC, ⚠️ **PERLU VERIFIKASI** block time BSC terkini untuk estimasi delay akurat), vs baseline manual (delay reaksi manusia 1–24 jam, sesuai kerangka §0).
4. Hitung berapa kali baseline manual akan kena likuidasi (HF tembus 1.0 sebelum manusia sempat bertindak) vs agent — ini angka **"liquidation avoided"** yang paling kuat untuk juri karena langsung menunjukkan kerugian nyata yang dicegah (likuidasi biasanya mengenakan penalty 5–10% dari collateral, jauh lebih mahal dari biaya intervensi preventif).
5. Fokuskan backtest pada periode volatilitas ekstrem historis BNB (bukan periode tenang saja) — ini justru periode paling relevan untuk membuktikan nilai agent health-factor monitoring.

---

## 5. Ringkasan status verifikasi kontrak & endpoint

| Item | Alamat/Endpoint | Status |
|---|---|---|
| PancakeSwap V3 Factory (BSC) | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | ✅ |
| PancakeSwap V3 NonfungiblePositionManager (BSC) | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | ✅ |
| Venus Comptroller (Core Pool, BSC) | `0xfD36E2c2a6789Db23113685031d7F16329158384` | ✅ |
| Venus vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | ✅ |
| Aave v3 Pool Proxy (BSC) | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | ✅ |
| Aave v3 PoolAddressesProvider (BSC) | `0xA97684ead0e402dC232d5A977953DF7ECBaB3CDb` | ❌ **tidak ada kode di BSC** — jangan pakai, cari ulang via `aave-address-book` resmi |
| Chainlink BNB/USD Feed (BSC) | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | ✅ |
| DefiLlama Yields `/pools` & `/chart/{pool}` | `https://yields.llama.fi/pools`, `https://yields.llama.fi/chart/{pool}` | ✅ |
| PancakeSwap v3 fee/APR data di BSC via DefiLlama | — | ❌ tidak tersedia (project `pancakeswap-amm-v3` di DefiLlama hanya cover Ethereum & Opbnb) — pakai on-chain event log/subgraph sendiri |
| PancakeSwap Limit Order engine (alamat kontrak) | — | ⚠️ PERLU VERIFIKASI |
| Aave `getReserveData()` untuk supply/borrow rate BSC | — | ⚠️ PERLU VERIFIKASI (belum dites live) |
| Venus/Aave oracle module address (dipakai internal untuk HF) | — | ⚠️ PERLU VERIFIKASI |
| "Binance Oracle" sebagai sumber harga | — | ⚠️ PERLU VERIFIKASI (tidak ditemukan konfirmasi eksplisit) |
| PancakeSwap v3 subgraph endpoint BSC | — | ⚠️ PERLU VERIFIKASI (hosted-service The Graph sudah deprecated, endpoint decentralized-network butuh API key — belum dikonfirmasi endpoint terkini) |

---

## Sumber

- [Backtesting Framework for Concentrated Liquidity Market Makers on Uniswap V3 (arXiv:2410.09983)](https://arxiv.org/html/2410.09983)
- [Predictable Loss and Optimal Liquidity Provision (arXiv:2309.08431)](https://arxiv.org/pdf/2309.08431)
- [Adaptive Liquidity Provision in Uniswap V3 with Deep RL (arXiv:2309.10129)](https://arxiv.org/pdf/2309.10129)
- [Risks and Returns of Uniswap V3 Liquidity Providers (arXiv:2205.08904)](https://arxiv.org/pdf/2205.08904)
- [Gamma Strategies docs](https://docs.gamma.xyz/gamma/features/strategies)
- [Impermanent Loss in Uniswap V3 — Auditless/Medium](https://medium.com/auditless/impermanent-loss-in-uniswap-v3-6c7161d3b445)
- [Rebalancing vs Passive strategies for Uniswap V3 — DeFi Scientist/Medium](https://medium.com/@DeFiScientist/rebalancing-vs-passive-strategies-for-uniswap-v3-liquidity-pools-754f033bdabc)
- [Pionex — Grid Bot Parameters Explained](https://www.pionex.com/blog/grid-bot-parameters/)
- [3Commas — Grid bots: Main settings and options](https://help.3commas.io/en/articles/7932030-grid-bots-main-settings-and-options)
- [PancakeSwap — Limit & TWAP Orders docs](https://docs.pancakeswap.finance/trade/limit-orders)
- [PancakeSwap v3 Addresses — developer docs](https://developer.pancakeswap.finance/contracts/v3/addresses)
- [DefiLlama Yields API — pools/chart](https://yields.llama.fi/pools)
- [Venus Protocol docs — Comptroller reference](https://docs-v4.venus.io/technical-reference/reference-isolated-pools/comptroller/comptroller)
- [Venus Protocol GitHub](https://github.com/VenusProtocol/venus-protocol)
- [Aave v3 Pool contract docs](https://aave.com/docs/aave-v3/smart-contracts/pool)
- [Chainlink Data Feeds — BSC addresses](https://docs.chain.link/data-feeds/price-feeds/addresses)
- [Chainlink BNB/USD feed (data.chain.link)](https://data.chain.link/feeds/bsc/mainnet/bnb-usd)
- [Binance Klines API reference (via VoiceOfChain Academy summary)](https://voiceofchain.com/academy/binance-api-historical-data)
- [CryptoDataDownload — Binance historical OHLCV](https://www.cryptodatadownload.com/data/binance/)
