# Riset 05 — Lanskap Kompetitif: Marketplace/Registry Agent Kripto & AI

Tanggal: 2026-09-08
Status: riset sekunder (web), untuk mengisi keputusan desain marketplace Fugugent.
Catatan: **HelloMinds** sudah diriset mendalam di `docs/research/02-hellominds-benchmark.md` —
di sini hanya disebut sekilas sebagai pembanding UX, tidak diulang.

Kriteria juri yang jadi lensa analisis:
1. **Functionality** — journey land → cari agent per kategori → paham fungsinya → aktivasi,
   tanpa dead end, untuk orang nol pengetahuan.
2. **Data Quality** — data real-time akurat melampaui hitungan dasar, cukup untuk memutuskan
   agent mana yang dihire.
3. **Agent Diversity** — 4 kategori (rebalancing LP, grid trading, yield optimisation,
   health factor monitoring) sama dalamnya.

---

## 1. Virtuals Protocol (Base, agent commerce)

- **Sumber**: [whitepaper.virtuals.io/acp/acp-changelogs](https://whitepaper.virtuals.io/acp/acp-changelogs), [rockawayx.com](https://www.rockawayx.com/insights/virtuals-agent-commerce-protocol-in-public-beta), [messari.io](https://messari.io/report/understanding-virtuals-protocol-a-comprehensive-overview), [datawallet.com](https://www.datawallet.com/crypto/what-is-virtuals-protocol)
- **Discovery**: Agent Commerce Protocol (ACP) marketplace punya tag visual per layanan, tombol
  **Hire** dan **Trade** terpisah dan langsung terlihat di kartu. Filter mencakup status
  graduated/sandbox dan online/offline. Tidak ada bukti kategori DeFi granular (rebalancing/grid/
  health factor) — kategorisasi lebih ke jenis layanan agent umum (trading, content, dsb).
- **Data di kartu/detail**: aGDP (agent GDP) ranking, job volume & success rate, metrik mingguan
  (aGDP output, interaksi, unique users), status aktif (hijau jika terhubung <10 menit terakhir),
  rating bintang + ulasan tertulis pasca-job, modul "Agent Examples" (contoh output nyata sebelum
  hire).
- **Aktivasi/hire**: tombol **Hire** di profil agent langsung memicu chat dengan intent hire;
  dashboard job melacak status; retry otomatis ke agent terbaik berikutnya jika job gagal. Model
  ekonomi: agent punya token sendiri (bonding curve), bukan sekadar biaya langganan.
- **Sinyal kepercayaan**: rating pasca-job, status online real-time, riwayat job. Tidak ada audit
  kontrak per-agent yang terlihat publik di level marketplace.
- **Kekurangan nyata**: mayoritas dari 18.000+ agent yang ditokenisasi punya market cap kecil dan
  turun tajam dari puncak Januari 2025; revenue protokol turun signifikan dari puncak $3.9jt/bulan;
  ekor panjang didominasi proyek tanpa produk/audiens nyata — masalah klasik "kuantitas tanpa
  kualitas" pada marketplace terbuka. Juga ada situs phishing yang meniru Virtuals (bukan cacat
  produk asli, tapi menandakan risiko kepercayaan brand di ruang ini).
  Sumber: [ventureburn.com](https://ventureburn.com/virtuals-protocol-explained-the-ai-agent-launchpad-taking-crypto-by-storm/), [pcrisk.com](https://www.pcrisk.com/removal-guides/31469-fake-virtuals-protocol-website-scam)

## 2. Olas / Pearl (Autonolas)

- **Sumber**: [olas.network/blog/introducing-pearl-v1](https://olas.network/blog/introducing-pearl-v1-the-ai-agent-app-store-powered-by-olas), [olas.network/blog/pearl](https://olas.network/blog/pearl), [ownyourmind.ai](https://ownyourmind.ai/projects/autonolas/), marketplace.olas.network
- **Discovery**: Pearl diposisikan sebagai "AI Agent App Store" desktop (Mac/Windows) — install app,
  lalu browse agent bawaan (mis. Optimus Agent = portfolio manager adaptif, Prediction Agent =
  forecaster). Marketplace on-chain terpisah di `marketplace.olas.network` — agent saling
  menyewa skill agent lain, transaksi terbuka/transparan ("AI Agent Bazaar"). Dokumentasi publik
  tidak merinci UI filter/kategori/search yang jelas.
- **Data**: user memonitor parameter & aksi real-time agent sendiri layaknya portofolio pribadi.
  Angka jaringan publik: ~3.670 agent deployed, 614 Daily Active Agents, 4,4M OLAS staked
  (per 29 Jun 2026). Tidak ada bukti tampilan APR/PnL per-agent yang dibakukan di kartu marketplace.
- **Aktivasi**: install Pearl → setup agent (wizard beberapa menit) → stake OLAS awal → klik
  "Start Agent". Dana diamankan lewat **Safe smart wallet** (non-custodial), bisa top-up
  kartu debit/kredit lewat bridging otomatis. Staking reward tidak dijamin, tergantung agent
  memenuhi target performa.
- **Sinyal kepercayaan**: staking sebagai skin-in-the-game, transparansi on-chain marketplace.
- **Kekurangan nyata**: dokumentasi publik minim soal metrik performa per-agent yang bisa
  dibandingkan sebelum stake (user harus percaya dulu, baru lihat hasil).

## 3. Almanak

- **Sumber**: [almanak.co](https://almanak.co/), [docs.almanak.co/docs/wallets](https://docs.almanak.co/docs/wallets/), [docs.almanak.co/docs/set-permissions](https://docs.almanak.co/docs/set-permissions/), [github.com/almanak-co/sdk](https://github.com/almanak-co/sdk), [blocmates.com](https://www.blocmates.com/articles/almanak-your-personal-ai-quant)
- **Discovery**: "Strategy Marketplace" — user bisa publikasikan & invest ke strategi orang lain;
  ada juga repositori strategi dari protokol pihak ketiga untuk ekosistem mereka sendiri.
- **Data**: sebelum deploy, strategi bisa **backtest & paper-trade di mainnet fork** (simulasi
  agent-based) — jadi calon "hire" bisa lihat hasil simulasi historis dulu, bukan cuma klaim.
  Almanak's Strategy Optimisation Suite menonjol sebagai fitur unik dibanding kompetitor lain.
- **Aktivasi/custody** (paling detail & relevan untuk desain Fugugent): user pakai **Safe Wallet**
  (1-of-1 multisig, user tetap sole owner) + **Zodiac Roles Modifier** untuk permission granular
  — whitelist fungsi kontrak spesifik + batasan parameter yang boleh dipanggil "Deployment EOA"
  (akun eksekusi otomatis terpisah dari Safe). Saat membuat Deployment dari strategi, user
  **tanda tangan satu transaksi** untuk apply permission tsb ke wallet-nya. Deployment EOA yang
  bayar gas & sign transaksi eksekusi harian — bukan wallet utama user. Model ini sangat mirip
  dengan rencana Fugugent (Altana session key: call allowlist + spend cap + expiry).
- **Sinyal kepercayaan**: kode strategi versioned & dimiliki user (bukan black box), backtest
  wajib sebelum live.
- **Kekurangan nyata**: dokumentasi publik untuk UI marketplace (kartu, filter, rating) minim;
  produk terasa lebih untuk quant/developer (butuh paham Python/strategi) daripada "orang nol
  pengetahuan" — gap besar dibanding target UX Fugugent.

## 4. Giza / ARMA — kasus penting: proyek yang gagal & "metric inflation"

- **Sumber**: [ownyourmind.ai/projects/giza](https://ownyourmind.ai/projects/giza/), [defillama.com/protocol/giza](https://defillama.com/protocol/giza), [chainwire.org](https://chainwire.org/2025/01/29/gizas-arma-breaks-new-ground-on-base-with-advanced-defi-automation/), [stablewatch.io](https://www.stablewatch.io/research/giza-project-spotlight)
- **Discovery/data**: dashboard ARMA menampilkan deposit (TVL) & APY per market, filter per
  protokol, sort by deposit/APY. Mendukung AAVE, Morpho, Compound, Moonwell.
- **Klaim awal**: TVL >$16M, $1.3B "agentic volume", APY iklan 15%, backtest klaim "2x yield
  enhancement" vs posisi statis.
- **Yang terjadi**: **26 Feb 2026 Giza mengumumkan ARMA & Pulse di-wind-down**, deadline migrasi
  26 Mar 2026, dana user dikembalikan. Digantikan "Giza World" (agent unified) yang klaim
  assets-under-agent & volume besar **tanpa verifikasi pihak ketiga** — dan pengukuran on-chain
  independen per 24 Jun 2026 menunjukkan posisi agent nyaris nol, kontras dengan angka yang
  ditampilkan di homepage. **Ini adalah bukti nyata risiko "vanity metrics tanpa verifikasi
  on-chain"** — argumen kuat untuk kenapa Data Quality (metrik yang bisa diverifikasi on-chain,
  bukan self-reported) adalah pembeda krusial.
- **Pelajaran untuk Fugugent**: jangan pernah menampilkan AUM/volume/APY tanpa link ke sumber
  on-chain yang bisa diaudit siapa pun (block explorer, event log, atau agregator independen).

## 5. Fetch.ai Agentverse

- **Sumber**: [docs.agentverse.ai/documentation/getting-started/agentverse-marketplace](https://docs.agentverse.ai/documentation/getting-started/agentverse-marketplace), [agentverse.ai/ai-agent-marketplace](https://agentverse.ai/ai-agent-marketplace), [progressiverobot.com](https://www.progressiverobot.com/2026/04/14/what-is-agentverse/)
- **Discovery**: kategori seperti Finance, Crypto, Trading, Image generation, Search, Travel,
  Weather, News, Data & analytics, Developer tools, Productivity, Translation. Search bar
  (alamat agent/protokol) + 3 dropdown filter (agent type, state Active/Inactive, trust level
  Verified/Unverified). Ada **advanced search syntax mirip GitHub**: `is:active`, `is:verified`,
  `is:fetch-ai`, `has:location`, `has:readme`, `has:guide`, `has:interactions:1k/10k/100k/1m`,
  `tag:finance` dsb — ini pola query yang cukup canggih untuk power user, tapi berpotensi jadi
  dead-end bagi user awam yang tidak tahu sintaksnya.
- **Data di kartu**: status tag (Active/Offline), badge Verified/Unverified, **rating score**
  (dipengaruhi frekuensi muncul di search, frekuensi dipakai, kecocokan konten), lokasi
  geografis, ikon manifest protokol.
- **Aktivasi**: tombol **"Chat with Agent"** yang fungsional secara langsung membuka percakapan
  lewat integrasi ASI:One — tidak ada alur "hire" formal dengan pembayaran/scoping tugas yang
  terdokumentasi publik.
- **Kekurangan nyata**: dokumentasi tidak menyebut uptime %, struktur biaya/harga eksplisit, atau
  alur pembayaran — data finansial (APR/PnL/fee) tampaknya tidak menjadi fokus utama kartu
  (Agentverse lebih general-purpose agent directory daripada marketplace DeFi khusus).

## 6. Recall Network

- **Sumber**: [messari.io/report/recall-onchain-ai-and-intelligence-competitions](https://messari.io/report/recall-onchain-ai-and-intelligence-competitions), [docs.recall.network/competitions](https://docs.recall.network/competitions) (404 saat diakses — dicatat, lanjut pakai sumber sekunder), [koreaittimes.com](https://www.koreaittimes.com/news/articleView.html?idxno=143609), [recall.network](https://recall.network/)
- **Discovery**: bukan marketplace hire langsung, melainkan **arena kompetisi** — agent trading
  bersaing di leaderboard real-time selama periode tetap (mis. AlphaWave, 7 hari, prize pool
  $25.000 USDC).
- **Data**: leaderboard real-time menampilkan **PnL**, dan smart contract mencatat setiap
  aksi/input/output/waktu/metrik performa. **AgentRank** (diluncurkan 29 Agu 2025, terinspirasi
  PageRank) mengonversi hasil kompetisi jadi ranking permanen & skill-specific — "queryable
  source of reputation" yang dipakai marketplace/app lain. Setiap kompetisi pakai metrik tetap &
  publik: PnL untuk trading, akurasi untuk reasoning, konsistensi dari waktu ke waktu; **reputasi
  meluruh (decay) kalau agent tidak aktif**.
- **Sinyal kepercayaan**: karena berbasis kompetisi head-to-head dengan hasil on-chain/tercatat,
  ini adalah salah satu model **track record terverifikasi paling kredibel** di antara semua yang
  diriset — layak dicontoh untuk konsep "leaderboard 4 kategori Fugugent".
- **Kekurangan nyata**: fokus ke kompetisi/paper-trading, bukan alur hire-untuk-kelola-dana-nyata
  yang mulus untuk user awam.

## 7. Theoriq

- **Sumber**: [theoriq.ai](https://theoriq.ai/), [crypto.news](https://crypto.news/theoriq-unveils-mainnet-touts-new-era-ai-driven-defi/), [theoriq.ai/blog/theoriq-mainnet-thq-tge-launch-guide-details](https://www.theoriq.ai/blog/theoriq-mainnet-thq-tge-launch-guide-details), Medium (XT Exchange)
- **Status**: mainnet baru live **15 Des 2025**, jadi masih sangat baru — AlphaSwarm &
  AlphaProtocol sudah publik, termasuk "Theoriq Knowledge Agent".
- **Discovery/model**: bukan marketplace kartu-agent klasik, melainkan **agent swarm** —
  agent register, publish kapabilitas, lalu dinamis membentuk swarm (role allocation, voting,
  strategi adaptif) untuk tugas kompleks (trading, yield optimization, treasury management).
- **Sinyal kepercayaan**: reputasi dibangun dari aksi tercatat on-chain/anchored off-chain +
  evaluator agent independen menilai hasil — mirip konsep "independent audit agent" yang bisa
  jadi diferensiasi Fugugent (agent yang mengaudit agent lain).
- **Kekurangan nyata**: karena baru live, data publik tentang UI marketplace (kartu, filter) dan
  track record jangka panjang masih minim/belum matang untuk dibandingkan.

## 8. OpenAI GPT Store (pembanding UX non-kripto)

- **Sumber**: [openai.com/index/introducing-the-gpt-store](https://openai.com/index/introducing-the-gpt-store/), [venturebeat.com](https://venturebeat.com/ai/openai-updates-gpt-store-with-ratings-and-expanded-builder-profiles), Medium ("How to Rank Your GPT"), OpenAI Developer Community
- **Discovery**: kategori seperti DALL·E, writing, research, programming, education, lifestyle.
  Ranking mirip app-store + search engine: keyword, relevansi, rating, level aktivitas — GPT yang
  update rutin naik peringkat, yang ditinggalkan turun.
- **Data**: rating bintang 1-5, jumlah rating, **jumlah total percakapan yang pernah dimulai**
  ditampilkan di profil builder — metrik penggunaan riil, bukan cuma klaim.
- **Aktivasi**: 1 klik untuk mulai chat — tidak ada friksi wallet/dana karena bukan produk
  finansial.
- **Kekurangan nyata (relevan sebagai warning)**: dengan >3 juta GPT dibuat, store jadi penuh
  spam/duplikat, banyak clone nama mirip yang "farm interaksi lalu rusak atau menyuntik prompt
  tanpa izin", beberapa GPT membocorkan prompt internal atau gampang dimanipulasi jadi
  phishing, dan proses takedown sering tanpa penjelasan jelas ke creator. **Pelajaran: rating +
  jumlah percakapan saja tidak cukup untuk moderasi kualitas — perlu sinyal tambahan (verifikasi,
  audit, atau kurasi manual untuk kategori berisiko tinggi).**

## 9. Poe (pembanding UX non-kripto)

- **Sumber**: [poe.com/blog/introducing-creator-monetization-for-poe](https://poe.com/blog/introducing-creator-monetization-for-poe), [creator.poe.com/docs/resources/creator-monetization](https://creator.poe.com/docs/resources/creator-monetization), [perplexityaimagazine.com](https://perplexityaimagazine.com/ai-tools/poe-ai-review-2026/)
- **Discovery**: kategori luas (tutoring, knowledge, therapy, entertainment, assistant, analysis,
  storytelling, roleplay, generasi media). "Distribution tetap masalah tersulit" — banyak bot
  bernama mirip, prompt tipis, output kualitas rendah bikin discovery noisy.
- **Data**: dashboard analitik creator melacak rata-rata earning dari paywall/subscription/pesan
  per periode waktu, update harian; API monetisasi mendukung harga variabel berdasar panjang
  input/output/kompleksitas komputasi.
- **Aktivasi**: langsung chat, model bayar per-pesan atau via subscription — sangat rendah friksi.
- **Kekurangan nyata**: total payout kreator baru >$100rb per pertengahan 2026 — menunjukkan
  monetisasi long-tail masih kecil meski platform besar; discovery quality masih jadi keluhan
  utama.

## 10. Catatan pembanding lain yang disinggung juri/tim (tidak diriset ulang di sini)

- **8004scan, BNB Agent Studio, Altana, PancakeSwap/TermiX**: sudah diriset mendalam di
  `docs/research/01-bnb-agent-studio.md`, `03-altana.md`, `04-8004scan-termix-pancakeswap.md`.
- **3Commas / Pionex** (grid trading bot, non-agent-marketplace tapi relevan untuk kategori grid
  trading): platform ini sudah menampilkan **win rate, Sharpe/Sortino ratio, profit factor, max
  drawdown**, dan marketplace "copy strategy" dengan **riwayat performa terverifikasi** + deploy
  1-klik. Backtest historis 120 hari. Ini jadi baseline data quality yang harus dilampaui Fugugent
  untuk kategori grid trading spesifik di DeFi/BSC.
  Sumber: [3commas.io/blog/ai-trading-bot-performance-analysis](https://3commas.io/blog/ai-trading-bot-performance-analysis), [help.3commas.io grid bots](https://help.3commas.io/en/articles/7932030-grid-bots-main-settings-and-options)

---

## Ringkasan lintas-produk (tabel kasar)

| Produk | Discovery kategori jelas? | Data performa terverifikasi on-chain? | Alur hire ≤3 klik? | Custody non-custodial jelas? | Track record kompetitif (leaderboard)? |
|---|---|---|---|---|---|
| Virtuals ACP | Sebagian | Sebagian (rating pasca-job) | Ya | Tidak eksplisit | Tidak |
| Olas Pearl | Tidak terdokumentasi jelas | Tidak (self-reported) | Ya (setelah install app) | Ya (Safe) | Tidak |
| Almanak | Ya (strategy marketplace) | Ya (backtest wajib) | Tidak (perlu tanda tangan permission, ditujukan quant) | Ya (Safe+Zodiac) | Tidak |
| Giza/ARMA | Ya | **Tidak (klaim tanpa verifikasi — lalu bubar)** | Ya | Sebagian | Tidak |
| Fetch.ai Agentverse | Ya (tag & syntax canggih) | Tidak (rating popularitas saja) | Ya (chat langsung) | N/A (bukan agent finansial) | Tidak |
| Recall Network | Tidak (arena kompetisi, bukan hire) | **Ya (leaderboard on-chain/tercatat)** | N/A | N/A | **Ya (AgentRank)** |
| Theoriq | Tidak (swarm, bukan katalog) | Sebagian (baru, evaluator agent) | N/A | Sebagian | Tidak (masih baru) |
| GPT Store | Ya | Sebagian (rating + jumlah chat) | Ya (1 klik) | N/A | Tidak |
| Poe | Ya | Sebagian (earning dashboard) | Ya (1 klik) | N/A | Tidak |

**Kesimpulan pola**: tidak ada satupun produk yang menggabungkan **(a)** discovery per-kategori
yang jelas untuk orang awam, **(b)** metrik performa yang terverifikasi on-chain secara real-time
(bukan self-reported), **(c)** custody non-custodial yang transparan dengan revoke 1-klik, **dan**
**(d)** leaderboard kompetitif lintas-agent dalam satu kategori yang sama. Fugugent bisa menang
dengan menggabungkan keempatnya sekaligus, terutama untuk 4 kategori DeFi spesifik yang belum
dilayani mendalam oleh siapa pun di atas.

---

## Peluang Diferensiasi Fugugent

### A. Metrik Data Quality spesifik per kategori + sumber datanya

| # | Metrik | Kategori relevan | Cara hitung / sumber data |
|---|---|---|---|
| 1 | Realized APR 7d/30d/90d (net, setelah fee) | Yield optimisation, LP | Rekonstruksi dari histori deposit/withdraw + saldo aktual on-chain (event log kontrak vault/strategi), bukan APY iklan protokol. Bandingkan dengan `apyBase`/`apyReward` dari [DefiLlama Yields API](https://github.com/DefiLlama/yield-server) sebagai baseline pasar. |
| 2 | Max drawdown | Semua 4 kategori | Time-series NAV/nilai posisi agent (snapshot per blok/interval) → hitung peak-to-trough terbesar. |
| 3 | Sharpe / Sortino ratio | Yield optimisation, grid trading | Return harian dari time-series NAV di atas, dibagi volatilitas (Sortino: hanya downside deviation). Baseline industri: 3Commas/Cryptohopper sudah menampilkan ini untuk bot trading. |
| 4 | Fee vs profit (net-of-fee return) | Semua | Selisih gross PnL (dari transaksi on-chain) dikurangi total gas + fee protokol + fee platform Fugugent, ditampilkan sebagai breakdown, bukan angka gabungan. |
| 5 | Gas cost per rebalance/aksi | Rebalancing LP, grid trading | Sum `gasUsed * gasPrice` dari tiap tx eksekusi agent (indexer event log kontrak agent di BSC testnet), dirata-ratakan per aksi. |
| 6 | Slippage rata-rata per eksekusi | Grid trading, rebalancing | Selisih expected price (quote saat submit) vs execution price aktual dari tx receipt/DEX swap event. |
| 7 | Time-in-range (%) | Rebalancing LP (concentrated liquidity) | Persentase waktu harga pool berada dalam range posisi LP agent, dihitung dari price oracle/pool tick history — pola sudah dipakai [Revert Finance](https://medium.com/blockchain-biz/why-you-should-use-revert-finance-prior-to-entering-any-lp-on-uniswap-a4779a1a7c49). |
| 8 | Impermanent loss (IL) real vs fee earned | Rebalancing LP | Bandingkan nilai posisi LP aktual vs hold-equivalent (formula IL standar), dikurangi fee yang sudah diklaim — Revert Finance & DefiLlama Yields sudah punya flag `ilRisk`. |
| 9 | Jarak ke likuidasi (health factor & % drop harga pemicu) | Health factor monitoring | `HF = (collateral * liq. threshold) / debt` langsung dari kontrak lending (Aave/Venus di BSC) via `getUserAccountData` atau setara; tampilkan juga "butuh harga turun X% untuk liquidation" — pola dari [HF Guard](https://hfguard.app/) dan [Otomato](https://otomato.xyz/protocols/aave). |
| 10 | Win rate & jumlah trade | Grid trading | % grid order yang closed profit dari total order tereksekusi, dari event log kontrak grid agent. |
| 11 | Uptime agent (%) | Semua | Heartbeat/ping berkala dari runtime agent ke backend Fugugent, dicatat sebagai time-series; tampilkan 30 hari terakhir, bukan klaim "99.9%" statis. |
| 12 | Latensi respons agent (deteksi → eksekusi) | Semua, krusial untuk health factor & grid | Selisih timestamp trigger (harga/HF menembus threshold) vs timestamp tx dieksekusi on-chain — bisa dibaca dari block timestamp tx vs waktu event pemicu di indexer sendiri. |
| 13 | Jumlah user aktif & AUM per agent, dengan link block explorer | Semua | Query langsung dari smart contract Fugugent (jumlah wallet unik yang delegasi + total value under management), bukan angka yang di-hardcode di frontend — tautkan ke BscScan testnet sebagai bukti (menghindari kasus Giza). |
| 14 | Backtest historis sebelum live (opsional per strategi) | Semua, terutama yield/grid | Simulasi terhadap data harga historis on-chain (subgraph/indexer sendiri), ditampilkan sebagai grafik dengan disclaimer "past performance ≠ future" — pola Almanak (mainnet fork simulation). |
| 15 | Audit/verifikasi kontrak agent | Semua | Link langsung ke source-verified contract di BscScan + status audit (jika ada) sebagai badge di kartu, bukan hanya teks "audited" tanpa link. |
| 16 | Skor reputasi lintas-kategori (leaderboard) | Semua | Adaptasi ala Recall AgentRank: agregasi metrik on-chain per kategori jadi ranking yang meluruh (decay) jika agent tidak aktif — beri user "top 3 agent per kategori" langsung di halaman kategori. |

### B. Ide diferensiasi konkret (untuk 3 kriteria juri)

1. **"Verified on-chain" badge wajib**: setiap angka AUM/PnL/APR di kartu agent harus punya link
   klik-through ke bukti on-chain (tx hash/block explorer) — langsung menjawab kegagalan Giza
   (angka tanpa verifikasi).
2. **Halaman kategori dengan leaderboard, bukan cuma daftar**: 4 kategori masing-masing punya
   ranking berbasis metrik yang sama (mis. risk-adjusted return), ala Recall AgentRank, supaya
   user awam langsung tahu "agent mana yang terbaik di kategori ini" tanpa harus baca detail.
3. **"3-klik hire, revoke 1-klik" sebagai janji UX eksplisit**: tampilkan progress bar aktivasi
   (pilih agent → set limit sesi → sign) supaya tidak ada dead end, dan tombol revoke selalu
   terlihat di dashboard (seperti yang direncanakan dengan Altana session key).
4. **Simulasi "coba dulu" sebelum commit dana nyata**: mode paper-trade/backtest per agent
   (terinspirasi Almanak & Recall competitions) supaya user nol pengetahuan bisa lihat hasil
   simulasi dulu sebelum hire dengan dana asli.
5. **Perbandingan head-to-head antar-agent dalam kategori sama**: tabel bandingkan 2-3 agent
   berdampingan (APR net, drawdown, fee, uptime) — belum ada satupun kompetitor yang riset ini
   temukan menyediakan comparison view langsung di marketplace.
6. **Breakdown fee vs profit transparan**: tunjukkan "kamu dapat $X net setelah gas $Y dan fee
   platform $Z" — bukan cuma APR headline, mengatasi kekaburan yang jadi masalah di GPT Store
   (klaim vs realita) dan Giza (APY iklan vs hasil riil).
7. **Uptime & latensi sebagai metrik kepercayaan first-class**, khusus untuk health factor
   monitoring (di mana keterlambatan = risiko likuidasi nyata) — tampilkan grafik histori
   respons, bukan janji SLA tanpa bukti.
8. **Kurasi kualitas eksplisit untuk kategori berisiko finansial**: karena GPT Store & Virtuals
   menunjukkan open marketplace gampang penuh proyek "no product no audience", Fugugent bisa
   punya proses review/sandbox wajib sebelum agent DeFi tayang publik (mirip status
   graduated/sandbox Virtuals, tapi dengan kriteria data quality eksplisit).
9. **Reputasi yang meluruh (decay) jika agent tidak aktif** — cegah agent lama dengan track
   record bagus tapi sudah mati terus nangkring di atas leaderboard (pelajaran dari AgentRank).
10. **Independent "auditor agent"** yang mengevaluasi/memverifikasi klaim agent lain secara
    otomatis dan mempublikasikan skor — konsep dari Theoriq (evaluator agent) yang belum ada
    satupun kompetitor DeFi lain menerapkannya secara konkret ke user-facing marketplace.
11. **Kategori sama-dalam**: pastikan tiap 4 kategori punya field data yang setara persis
    (bukan salah satu kategori dapat metrik lengkap dan yang lain minim) — beri health factor
    monitoring metrik non-trading seperti "distance to liquidation %", bukan dipaksa APR seperti
    kategori yield.
12. **Riwayat aksi agent yang bisa di-scroll (activity feed)**, bukan cuma angka agregat —
    tiap rebalance/grid order/health check ditampilkan sebagai baris log dengan tx hash, mirip
    job dashboard Virtuals ACP tapi lebih granular untuk konteks DeFi.
13. **Filter "sudah live berapa lama" dan "jumlah dana yang pernah dikelola"** sebagai proxy
    maturity, karena rating bintang sendirian (pola GPT Store/Poe) gampang dimanipulasi/kosong
    di awal.
14. **Slippage & gas efficiency sebagai pembeda kompetitif antar-agent** dalam kategori grid
    trading/rebalancing — metrik yang bahkan 3Commas/Pionex (grid bot mapan) tidak secara
    eksplisit expose ke user per-agent.
15. **Bahasa & UI zero-jargon di depan, detail teknis di belakang** — tampilkan APR/health factor
    dengan penjelasan 1-baris ("makin dekat ke 1.0, makin berisiko likuidasi") supaya user nol
    pengetahuan tidak dead-end di istilah, sambil tetap expose data mentah untuk yang mau
    verifikasi (mengatasi masalah Fetch.ai Agentverse yang search syntax-nya terlalu teknis
    untuk pemula).

---

## Sumber yang tidak bisa diakses penuh

- `docs.recall.network/competitions` mengembalikan 404 saat WebFetch — informasi Recall di atas
  disusun dari cache Google/Messari/artikel sekunder, bukan dokumentasi resmi langsung. Perlu
  diverifikasi ulang manual di `docs.recall.network` sebelum dikutip sebagai fakta pasti.
- Detail UI kartu/filter Pearl marketplace (`marketplace.olas.network`) dan Almanak tidak
  ditemukan dalam bentuk screenshot/dokumentasi rinci publik — deskripsi di atas adalah rekonstruksi
  dari blog post & docs teks, bukan observasi UI langsung.
