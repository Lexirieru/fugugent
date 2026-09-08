# Fugugent — Status Sebenarnya

Diperbarui 2026-09-08. Dokumen ini sengaja menyatakan **apa yang benar-benar ada dan apa yang
belum**. Aturannya satu: **setiap klaim "ada" harus menyebut cara orang lain memeriksanya
sendiri** — tx hash, perintah `cast`, endpoint, atau perintah test. Klaim yang tidak bisa
diperiksa tidak ditulis, walaupun kedengarannya benar.

Bagian akhir dokumen ini (§D) mencatat klaim-klaim yang **diturunkan** karena buktinya kurang.
Daftar itu sengaja dipertahankan.

---

## Angka yang bisa dihitung ulang

| Yang diukur | Angka | Cara memeriksa |
|---|---|---|
| Kontrak (Foundry) | **131** test | `cd contracts && forge test` |
| Fugu Guardian | **249** test | `cd ai/fuguguardian/app/agent && corepack pnpm test` |
| Fugu Rebalancer | **88** test | `cd ai/fugurebalancer/app/agent && corepack pnpm test` |
| Fugu Grid | **99** test | `cd ai/fugugrid/app/agent && corepack pnpm test` |
| Fugu Yield | **93** test | `cd ai/fuguyield/app/agent && corepack pnpm test` |
| Backend | **374** test (1 dilewati) | `cd backend && corepack pnpm test` |
| **Total** | **1.034** test | |
| Riwayat | **89** commit di atas commit awal, working tree bersih | `git log --oneline \| wc -l` → 90 (termasuk `87508a2` "Initial commit"); `git status --porcelain` → kosong |
| Landing + marketplace | build dan lint hijau | `bun --cwd landingpage run build && bun --cwd landingpage run lint`; sama untuk `frontend` |

Satu test dilewati di backend adalah jalur Postgres sungguhan yang hanya berjalan bila
`FUGU_TEST_DATABASE_URL` diisi (`skipIf`); tanpa variabel itu repositori diuji lewat PGlite.

---

## A. Yang sudah ada dan terbukti

### A1. Empat kontrak UUPS, live di BSC testnet (chainId 97)

| Kontrak | Alamat |
|---|---|
| FuguPriceOracle | `0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65` |
| FuguRegistry | `0xb2f36070E6eae3353E8e755172B477DF213ae248` |
| FuguSubscription | `0xfdb083371f44Cf53181350389D3217e51B431776` |
| FuguReputation | `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400` |

131 test termasuk fuzz 256 runs. **Siklus hidup marketplace dijalankan di jaringan sungguhan**:
daftar agent → sewa → agent tarik bayaran → review → penolakan review kedua. Seluruh siklus
berbiaya 0,0015 tBNB. Tx hash per langkah ada di `docs/e2e/2026-09-08-e2e-testnet.md`.

Yang paling penting dari siklus itu, dan bisa diperiksa dari dua panggilan view: gerbang
anti-sybil `hasSubscribed` berubah `false` → `true` **tepat saat agent benar-benar menerima
uang**, bukan saat user berlangganan.

### A2. Empat wallet agent dengan session key Altana terdaftar on-chain

Keempat agent punya wallet sendiri dengan session ber-batas yang **terdaftar di Keystore**
`0x6b8361C29d05D498b1a12B54A37310f94171E94A`. Siapa pun bisa memverifikasi tanpa API key apa
pun, cukup satu `eth_call`:

```bash
cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
  0x6b8361C29d05D498b1a12B54A37310f94171E94A \
  'isValidKey(address,bytes32)(bool)' \
  0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0 \
  0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377
# true
```

Agent Studio berjalan: `bag doctor` 14 PASS / 0 FAIL, `bag dev` menyajikan A2A + MCP di `:9000`,
dan permintaan `negotiate` dijawab **quote bertanda tangan wallet** (0,1 U, lengkap dengan
`negotiation_hash` dan `provider_sig`).

**Yang tidak terbaca dari rantai:** isi allowlist-nya. Akun Altana meng-hash-commit
`permissions`, jadi yang publik hanya keberadaan dan keabsahan kuncinya. Yang membuktikan isi
izin adalah penolakan di A4.

### A3. Lapisan strategi Fugu Guardian — 249 test

`cd ai/fuguguardian/app/agent && corepack pnpm test`. 245 di antaranya berjalan tanpa jaringan
sama sekali; 4 sisanya (`chain.test.ts`, `testnet.test.ts`) memang memanggil RPC dan karena itu
sebagian menyatakan keadaan testnet, bukan hanya keadaan kode.

Isinya: rumus health factor murni dengan pembulatan yang sengaja diarahkan ke sisi aman; mesin
keputusan deterministik yang gagal keras pada konfigurasi cacat; adapter yang terbukti membaca
Aave v3 dari BSC mainnet dengan bacaan ditambatkan ke satu blok; loop pemantauan (`guard.ts`);
jalur eksekusi dengan spend cap dan cooldown (`execute.ts`); jembatan satuan USD8 ↔ unit token
(`units.ts`); lapisan penjelasan dGrid yang gagal dengan aman; dan penandatangan repay lewat
session key Altana yang menolak izin sesi terlalu longgar sebelum satu transaksi pun dikirim
(`chain/session.ts`). Perakitannya punya satu tempat, `createGuardian()` di `src/strategy/`.

**Repay tidak bisa terkirim dua kali.** Untuk pengiriman jaringan, "gagal" tidak berarti "tidak
terjadi": `waitForTransactionReceipt` yang timeout melempar SETELAH transaksinya mendarat.
Anggaran, cooldown, dan catatan repay menggantung karena itu dicatat **sebelum** transaksi
dikirim dan **disimpan ke berkas sebelum transaksi berangkat**, bukan setelah siklus selesai.
Selama catatan itu belum dibereskan oleh bukti on-chain — hutang turun **sebesar yang kita
bayar**, toleransi 2 unit basis 8 desimal — tidak ada pengiriman baru yang diizinkan. User yang
membayar sendiri, likuidasi parsial, atau harga aset hutang yang jatuh tidak membereskannya.
Konsekuensi yang dinyatakan terbuka: repay yang benar-benar tidak pernah mendarat membuat
Guardian **berhenti bertindak** sampai operator membereskannya lewat `clearPendingRepay`.
Guardian yang diam adalah kegagalan yang terlihat.

### A4. Guardian menaikkan health factor posisi — terbukti on-chain, lewat session key ber-batas

Bukan test unit. Satu siklus Guardian dijalankan di BSC testnet lewat composition root
`createGuardian().runOnce()`, dengan repay yang **ditandatangani session key Altana**, bukan EOA
deployer. Jalankan ulang:

```bash
cd ai/fuguguardian/app/agent && npx tsx scripts/e2e-guardian.ts
```

| | |
|---|---|
| Tx repay (`approve` + `repay`, **satu userOp atomik**) | [`0x619cfbe3…`](https://testnet.bscscan.com/tx/0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc) (blok 129852222) |
| `Repay.user` pada receipt | `0xbdc69c2d…` (wallet Altana) — **bukan** `0x56A2950d…` (EOA deployer) |
| HF sebelum → sesudah | **1,14 → 1,50** |
| Hutang | $17,27 → $13,24 (dibayar $4,03) |
| Selisih klaim vs pengurangan hutang on-chain | **0 unit** basis 8 desimal (maksimum yang sah 2) |
| Tx grant sesi | [`0x15e67a21…`](https://testnet.bscscan.com/tx/0x15e67a21e5ec25f8459ac2e83798033ca9afe5a14b41143aeb28fe2a47b64b52) |
| Ongkos | 0,000041 tBNB (kedua sisi) |

Sesi itu hanya boleh memanggil **dua** hal: `MockLendingPool.repay(address,uint256)` dan
`mUSD.approve(address,uint256)`. Cap 0,02 tBNB + 100 mUSD per hari, kedaluwarsa 8 Oktober 2026.

Skrip buktinya **tidak berisi logika strategi apa pun**: ia mengimpor modul strategi apa adanya
dan **gagal dengan exit code bukan nol** begitu satu klaim tidak terbukti terhadap bacaan
on-chain — termasuk klaim *berapa* yang dibayar. Setiap bacaan "sebelum" dan "sesudah"
ditambatkan ke tinggi blok transaksinya lewat `eth_call` ber-`blockNumber` eksplisit, jadi RPC
publik yang membalas basi menyebabkan kegagalan, bukan angka yang terlihat benar. Jalur gagalnya
juga dijalankan sungguhan (`E2E_PAKSA_GAGAL_SETELAH_TURUN=1`): exit 1, dan harga testnet tetap
dipulihkan oleh `finally`.

**Batasnya nyata, dan ini bukti yang menentukan.** Sesi yang sama, sesaat setelah berhasil
membayar, mencoba `mUSD.transfer(EOA deployer, 1 wei)` dan **ditolak** dengan `UnauthorizedCall`
— custom error kontrak akun Altana, bukan validasi kode kami. `mBNB.approve` juga ditolak,
membuktikan pengikatan berlaku pada tingkat kontrak **dan** selector. Uji itu menuntut galatnya
benar-benar memuat `UnauthorizedCall` dan menyebut kontrak yang dicoba; dengan relay diarahkan ke
endpoint mati, skrip probe mati dengan exit 1 alih-alih mencetak tanda centang.

**Berkas state setelah jalan ini** (`.studio/guardian-state.json`, gitignored) membuktikan
persistensi di jalur sungguhan, bukan hanya di unit test:

```json
{ "version": 1, "spentTodayUsd8": "403063169", "dayStartedAt": 1788880016,
  "lastActionAt": 1788880017, "killed": false, "pendingRepay": null }
```

Lima jalan sebelumnya dipertahankan sebagai riwayat di
`docs/e2e/2026-09-08-e2e-testnet.md` §"Riwayat jalan session key" — **tidak dipakai sebagai
bukti**, karena bukti atas kode yang sudah tidak dipakai lagi bukan bukti.

**Protokolnya tiruan.** Lihat §C1 — ini keterbatasan terpenting dokumen ini dan tidak boleh
dilewati.

### A5. Tiga mesin keputusan lain: Rebalancer, Grid, Yield

Ketiganya punya mesin keputusan murni + backtest + `format.ts`, dengan 88 / 99 / 93 test dan
`tsc --noEmit` bersih. Tidak ada jaringan, `Date.now()`, atau `process.env` di jalur keputusan
mana pun; seluruh dunia luar masuk lewat argumen. Nilai uang basis 8 desimal, token 18 desimal
(termasuk USDT di BSC), persentase dalam bps.

Ambang yang mengikat **diturunkan, bukan ditebak**, dan konfigurasi yang melanggarnya membuat
`decide` gagal keras alih-alih diam-diam tidak pernah bertransaksi:

- **Rebalancer** — pita 500 bps **dan** gerbang biaya 50 bps relatif turnover;
  `minEconomicTurnoverBase()` menurunkan turnover minimum dari gas dan anggaran
  (`T ≥ gas × 10000 / (M − r)`), dan mengembalikan `null` kalau anggarannya mustahil.
- **Grid** — jarak antar-garis wajib ≥ 2× ongkos satu putaran, diukur di **batas atas** tempat
  jarak persentase paling sempit. Grid $500–$700 dengan 11 garis lolos; grid yang sama dengan
  101 garis **ditolak sebelum satu keputusan pun diambil**.
- **Yield** — `breakEvenSpreadBps = ceil(ongkos × 10000 × 365 / (pokok × hari))`, dikali pengali
  keamanan 2,00×. Ambang ini berbanding **terbalik** dengan pokok dan horizon: $10.000 selama
  30 hari menuntut 390 bps; pokok $200 menuntut 1582 bps. "APY tertinggi" karena itu bukan
  jawaban.

**Backtest membantah asumsi pembuatnya sendiri, dan itu dijadikan test bernama `KEJUJURAN`.**
Dua-duanya bisa dijalankan:

```bash
cd ai/fugurebalancer/app/agent && corepack pnpm test   # backtest.test.ts:73
cd ai/fugugrid/app/agent && corepack pnpm test         # backtest.test.ts:68
```

- Rebalancer: pada portofolio $10.000 dengan ayunan 5%, **rebalance-selalu justru unggul** atas
  pita ($996 vs $952 per $1.000) — pita menukar sebagian panen volatilitas dengan kepastian tidak
  boros ongkos, dan itu bukan kemenangan gratis.
- Grid: pada tren berarah naik, **beli-lalu-diamkan mengalahkan grid** — grid menjual kenaikannya.

Arah bias tiap backtest juga dinyatakan di kepala berkasnya, termasuk yang merugikan kesimpulan
sendiri: bias Yield **memihak** `chaser` yang kalah, sehingga kekalahannya adalah batas bawah;
dan risiko tidak pernah benar-benar terjadi di simulasi, sehingga gerbang risiko — bagian
terpenting strategi Yield — **tidak terlihat di angka mana pun**.

### A6. Backend — empat tingkat fallback, terbukti hidup

`docker compose up` menyalakan tiga kontainer sehat; API di `:8787`. 374 test
(`cd backend && corepack pnpm test`).

Yang **diverifikasi sendiri di kontainer hidup**, bukan disimpulkan dari test:

| Yang diuji | Hasil terukur |
|---|---|
| `/api/categories` dengan data 8004scan **nyata** | REBALANCING **19**, GRID **42**, YIELD **29** — `source: scan8004`, `ageSeconds: 0` |
| `/api/health?strict=1` saat semua sehat | **HTTP 200** |
| `?strict=1` saat 8004scan tumbang sungguhan (500 DATABASE_ERROR intermiten) | **HTTP 503** |
| `?strict=1` saat Postgres dimatikan | **HTTP 503** |
| `?strict=1` setelah pulih | **HTTP 200** |
| `/api/agents` saat Postgres mati | tetap **HTTP 200 dalam 0,57 detik** (sebelum dioptimasi: 31 detik) |
| Keempat tingkat (scan8004 / cache / onchain / seed) | terbukti hidup lewat **blokir DNS**, bukan ganti konfigurasi |
| `bigint` melewati HTTP | 30 digit dan uint128-max identik bolak-balik; lewat `Number` rusak |

Periksa sendiri setelah `docker compose up`:

```bash
curl -s localhost:8787/api/categories | head
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8787/api/health?strict=1'
docker stop fugugent-postgres && \
  curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8787/api/health?strict=1'   # 503
```

Dua keputusan desain yang membedakan angka jujur dari angka yang enak dilihat, keduanya lahir
dari temuan review dan dikunci test:

1. **404 bukan untuk "tidak tahu".** `/api/agents/:id` hanya 404 bila keempat tingkat menjawab
   kosong; kalau sumbernya tumbang ia menjawab 200 dengan `healthy: false`. Versi sebelumnya
   menghapus agent nyata dari marketplace setiap kali upstream tumbang.
2. **`healthy` menuntut bukti minimal satu sumber SUNGGUHAN bekerja.** Seed tidak dihitung — ia
   berkas di dalam bundel, tidak bisa mati, jadi menghitungnya membuat `healthy` tautologi. Tanpa
   observasi → `false`.

Satu cacat yang ditemukan **karena** diverifikasi di kontainer hidup, bukan di test: probe
kesehatan cache pernah menyimpulkan "sehat" dari absennya exception, lalu **menimpa baris jujur
yang sudah mengaku gagal** — melaporkan `cache=true, age=0` terhadap database yang mati.
Direproduksi 3×, dan akarnya diperbaiki (`getLatestSourceHealth` memang tidak melempar; probenya
kini kueri sungguhan yang hasilnya dibaca).

Klasifikasi 4 kategori divalidasi terhadap **167 agent sungguhan** dari 8004scan, dan validasi
itu menemukan salah-kategori yang lolos seluruh test unit (*Narrow Band Allocator* →
HEALTH_FACTOR 0,94). Temuan lain yang layak dicatat karena membatalkan asumsi rencana: field
OASF (`oasf_skills`/`oasf_domains`) **tidak ada** di `GET /agents` maupun detail, dan kosakatanya
seluruhnya generik — OASF tidak sanggup memilih kategori, jadi ia dipakai sebagai pengali saja.

### A7. Marketplace (`frontend/`) dan landing page (`landingpage/`)

Keduanya build dan lint hijau (`bun --cwd <dir> run build`, `… run lint`), nol scroll horizontal
diukur lewat `scrollWidth` vs `clientWidth` pada 320–1280 px.

Marketplace punya daftar agent dengan penyaring kategori **ber-URL** (`?category=…`, SSR, bisa
dibagikan), halaman detail ber-URL dengan panel izin session key dan daftar bukti, alur sewa
dengan estimasi biaya, OG image per agent, dan keadaan jujur saat backend tidak menjawab —
diuji sungguhan dengan membangun terhadap `http://127.0.0.1:9`: halaman tampil utuh, menyebut
`fetch failed` apa adanya, daftar kosong, **nol data palsu**.

Tidak ada komponen yang memanggil `fetch`; semua halaman berbicara dengan satu antarmuka
`MarketplaceSource`. `bigint` diterjemahkan di satu tempat (`data/wire.ts`) yang **menolak
`number`** untuk nilai uang.

Yang sengaja **tidak** ditampilkan, karena menampilkannya berarti mengarang: success rate,
median latency, jumlah run, hirer aktif, grafik ekuitas, live run feed, AUM/TVL/APR, reputasi
bintang (`totalFeedbacks = 0`), leaderboard, dan tingkat kembung yang ditebak — tiga agent tanpa
bacaan digambar berlubang dan bergaris putus-putus dengan chip "no live reading", identitasnya
tetap terbaca, kanal risikonya yang hilang. Landing page juga tidak memuat tautan ke
`app.fugugent.xyz`.

### A8. Identitas visual

`docs/brand/` memuat palet, karakter, skala 5 tingkat kembung, dan aturan yang **ditegakkan
kode**: warna badan = identitas agent dan tidak pernah berubah karena risiko; bentuk badan +
pola cincin = risiko. 13 berkas SVG di `landingpage/public/brand/`, dihasilkan ulang dengan:

```bash
python3 docs/brand/generate-svg.py landingpage/public/brand
```

Diuji **grayscale penuh pada 48 px**: keempat karakter tetap bisa dipasangkan ke namanya dan
kelima tingkat tetap berurutan, karena pola cincin tidak bergantung warna sama sekali.
`frontend/src/lib/fugu.ts` adalah port TypeScript dari generator yang sama — ikan di landing page
dan ikan di aplikasi adalah ikan yang sama.

**Gambarnya bukan hasil model generatif.** Lihat §C8.

---

## B. Yang BELUM ada — jangan diklaim

1. **Strategi belum tersambung ke *runtime* agent.** Rantai keputusan → eksekusi → bukti on-chain
   sudah terbukti (A4), tetapi yang menjalankannya adalah `createGuardian()` yang dipanggil skrip
   E2E — **bukan** agent A2A/MCP yang disajikan `bag dev`. `dualMain.ts`, `mcpMain.ts`, dan
   `tools.ts` masih belum mengimpor `src/strategy/` sama sekali (`grep -rn "strategy"
   ai/fuguguardian/app/agent/src/*.ts` hanya menemukan satu komentar di `model.ts`), jadi agent
   yang berjalan hari ini tetap mengirim teks sebagai deliverable. Titik masuknya ada; yang
   memanggilnya belum.
   → Kalimat yang benar: *"Guardian terbukti menaikkan HF posisi dari 1,14 ke 1,50 lewat transaksi
   on-chain yang ditandatangani session key ber-batas"*, bukan *"agent yang kami sajikan di
   marketplace sudah melindungi posisi Anda secara otonom"*.

   Catatan teknis yang jujur: sesi Guardian ini **tidak** bisa dimuat lewat
   `ensureAltanaSessionLoaded()`/`getWallet()` milik `@bnbagent/studio-runtime` — jalur itu menolak
   sesi yang `permissions.calls`-nya bukan salinan persis `defaultAgentPermissions()` (ERC-8004 +
   ERC-8183). Sesi ini dimuat langsung lewat `deserializeSession` + `AltanaWalletProvider`.
   Menyambungkannya berarti menyelesaikan perbedaan itu.

2. **Tuas kill switch yang bisa ditekan user belum ada.** `GuardLoopHandle.kill()` berlaku
   seketika, tidak bisa dibatalkan siklus yang sedang berjalan, dan langsung dipersist — tetapi ia
   **pemanggilan fungsi di dalam proses**. Belum ada tombol UI, perintah CLI, atau endpoint HTTP
   yang memanggilnya. Marketplace karena itu juga sengaja tidak memasang tombol Revoke maupun tuas
   kill switch.
   → Kalimat yang benar: *"kill switch punya jalur runtime dan state-nya bertahan melewati
   restart"*, bukan *"user bisa menghentikan agent kapan saja"*.

3. **Rebalancer, Grid, dan Yield belum tersambung ke eksekusi on-chain.** Yang ada adalah mesin
   keputusan murni + backtest (A5). Tidak ada satu pun transaksi yang pernah dikirim oleh ketiganya.
   Marketplace menyatakan sendiri ketiganya "scaffold saja, tidak terdaftar di FuguRegistry, belum
   bisa disewa", dan tidak memberi harga maupun tombol hire.

4. **Marketplace belum pernah dijalankan terhadap backend hidup.** `createHttpSource` sudah ditulis
   lengkap untuk keempat endpoint, tetapi default-nya tetap `seedSource`; yang diuji sungguhan baru
   jalur seed dan jalur API-mati. Belum ada satu pun jalan yang membuktikan frontend menampilkan 110
   agent nyata dari `:8787`.

5. **Endpoint risiko belum ada.** `bloatLevel` dan metrik mentah per agent tidak ada di
   `backend/src/types.ts`. Selama belum ada, jalur HTTP marketplace menggambar semua fugu berlubang
   — jujur, tetapi menghilangkan mekanik inti produk.

6. **Backtest belum menyentuh satu pun data harga historis.** Yang ada adalah harness plus deret
   harga **sintetis**. Tidak ada berkas data historis di repo.
   → Kalimat yang benar: *"kami membangun harness dan menjalankannya pada deret sintetis"*.

7. **`DELEVERAGE` masih dimodelkan salah di backtest Guardian** — agunan tidak ikut turun, padahal
   deleverage sungguhan menjual agunan. Didokumentasikan menonjol di kepala
   `src/strategy/backtest.ts`, belum diperbaiki.

8. **Venus belum terhubung ke mesin keputusan.** Adapternya membaca `liquidity`/`shortfall`, tapi
   Venus tidak menyediakan health factor maupun ambang likuidasi agregat, sehingga membangun
   `Position` darinya butuh data per-market yang belum diambil.

9. **Kontrak belum diverifikasi di BscScan** — `BSCSCAN_API_KEY` belum tersedia. Perintah
   verifikasinya sudah disiapkan. Sampai itu dilakukan, source code kontrak tidak bisa dibaca dari
   explorer.

10. **API key 8004scan belum ada.** Backend berjalan pada tier anonim **30 request/menit**
    (`SCAN8004_API_KEY` kosong → `ANONYMOUS_RATE_LIMIT_PER_MINUTE`). Semua angka kategori di A6
    diperoleh pada tier itu.

11. **Scheduler dan indexer belum ada.** Backend hari ini adalah BFF + cache + classifier +
    fallback. Tidak ada BullMQ, tidak ada pekerjaan periodik, dan Redis belum dipakai satu jalur
    pun. Konsekuensinya langsung: ambang `breakoutConfirmObservations = 3` (Grid) dan
    `minConsecutiveFavorable = 3` (Yield) terikat pada kadens penjadwal yang **belum ditentukan** —
    tiga pengamatan per menit adalah tiga menit; per hari adalah tiga hari.

12. **Tidak ada tombol connect wallet.** Penandatanganan di browser belum ada. Alur sewa memberi
    perintah `cast` yang sama persis dengan panggilan yang akan dibuat tombol itu — `quote()` ke
    oracle lebih dulu, cap slippage 1%, lalu `subscribe(...)` — bisa disalin dan menghasilkan
    transaksi nyata.

---

## C. Keterbatasan yang diketahui

### C1. `MockLendingPool` adalah pool tiruan buatan sendiri, bukan protokol lending sungguhan

Ini keterbatasan terpenting dokumen ini. `MockLendingPool`, `MockTokenUSD`/`MockTokenBNB`, dan
`MockPriceFeed*` semuanya kami deploy dan kami kendalikan; harga agunan pada bukti E2E
**kami turunkan sendiri** lewat `setAnswer` pada feed yang kami miliki. Ia sengaja dibuat
ABI-kompatibel `getUserAccountData` Aave v3 supaya `readAavePosition` bisa dipakai apa adanya.

Posisinya nyata, transaksinya nyata, hutangnya benar-benar berkurang dan uangnya tidak kembali.
**Pool-nya tidak.** Guardian belum pernah menyentuh Aave, Venus, atau protokol pihak ketiga mana pun.
→ Kalimat yang benar: *"rantai baca → putuskan → eksekusi terbukti bekerja terhadap pool ber-ABI
Aave v3"*, bukan *"Guardian sudah menyelamatkan posisi di protokol lending nyata"*.

### C2. Baca mainnet, eksekusi testnet — dua dunia berbeda

Adapter membaca posisi nyata di BSC mainnet karena Venus dan Aave hanya ada di sana; eksekusi agent
di testnet. Keputusan atas posisi mainnet tidak bisa dieksekusi di testnet.

### C3. Izin session key tidak mengikat nilai argumen

Izin Altana mengikat **kontrak + selector**, bukan nilai argumen. Sesi ini karena itu secara teknis
boleh memanggil `mUSD.approve(<siapa pun>, <berapa pun>)`. Yang menahannya: spend cap per token
pada sesi; kode kami yang hanya pernah menyusun `approve` untuk pool (hilang begitu proses dibajak);
dan guarded executor Porto yang menolkan allowance di akhir userOp — **perilaku pihak ketiga yang
kami temukan secara empiris**, bukan yang dijamin kontrak kami. Pengikatan argumen yang sungguhan
butuh kontrak perantara.

Perilaku Porto itu juga punya konsekuensi keras yang ditemukan lewat satu jalan yang gagal:
`approve` yang dikirim sebagai transaksi tersendiri berhasil, lalu `repay` berikutnya revert dengan
`ERC20InsufficientAllowance(allowance: 0)`. **`approve` dan `repay` wajib berada dalam satu userOp.**

### C4. Penolakan session key tidak meninggalkan jejak on-chain

`UnauthorizedCall` muncul saat relay **mensimulasikan** userOp terhadap kontrak akun; transaksinya
tidak pernah disiarkan. Tidak ada blok yang bisa dibuka juri untuk penolakan itu. Yang bisa
diperiksa pihak ketiga: pesan galatnya adalah custom error kontrak akun (string itu tidak ada di
`node_modules` mana pun), keyHash-nya cocok dengan kunci kami, dan saldo tidak bergerak satu wei pun.
→ Kalimat yang tepat: *"ditolak oleh validator akun Altana saat relay mensimulasikannya"*, bukan
*"ada transaksi revert di rantai"*.

### C5. Receipt tidak membedakan kunci admin dari kunci sesi

Keduanya bertindak sebagai wallet yang sama, dan Orchestrator tidak menuliskan keyHash penandatangan
ke log. Yang menutup celah itu, dan hanya sejauh ini: skrip E2E hanya pernah memuat **file sesi**
(keystore admin tidak pernah dibuka di jalur repay), dan sesi yang sama ditolak untuk `transfer` —
sedangkan kunci admin tidak akan pernah ditolak.

### C6. Dua batas belanja, dan yang mengikat adalah yang lebih ketat

| Lapisan | Batas | Ditegakkan oleh |
|---|---|---|
| `execute.ts` | $2.000/hari, $1.000/aksi, cooldown 60 detik | kode kami — hilang kalau prosesnya dibajak |
| Spend cap sesi | 100 mUSD/hari, 0,02 tBNB/hari | kontrak akun Altana — bertahan walau kode dibajak |

Keduanya belum disamakan. Konsekuensinya: permintaan di atas 100 mUSD/hari tidak akan ditolak rapi
oleh `execute.ts` (yang mengira masih ada $2.000), melainkan gagal di relay sebagai error.

### C7. Jendela kegagalan yang tersisa pada persistensi state

Proses bisa mati setelah catatan tersimpan tetapi sebelum panggilan jaringan berangkat. Yang
tertinggal adalah catatan menggantung untuk transaksi yang tidak pernah ada, dan Guardian menahan
diri sampai operator membereskannya. Arah kegagalan itu disengaja. Yang belum ada adalah proses
jangka panjang yang hidup berhari-hari di atas store ini — untuk itu runtime-nya harus tersambung
lebih dulu (B1).

### C8. Gambar karakter dihasilkan sebagai SVG parametrik buatan sendiri

**Nol gambar dihasilkan oleh model generatif.** Kedua MCP pembuat gambar di lingkungan ini tidak
tersambung; dicoba empat kali dan keempatnya membalas *"MCP server is not connected"*. Aset yang ada
digambar lewat `docs/brand/generate-svg.py`, yang menerjemahkan geometri di `karakter.md` dan
`tingkat-kembung.md` menjadi bentuk. Prompt di `prompt-gambar.md` **belum pernah dijalankan** —
perlakukan ia sebagai spesifikasi yang matang, bukan resep yang sudah terbukti. Tidak ada berkas
PNG; lingkungan ini tidak punya rasterizer SVG. Simulasi buta warna dikromat juga belum dijalankan;
yang ada baru grayscale penuh.

### C9. Angka strategi yang belum terkalibrasi

Ditulis juga sebagai komentar `TIDAK YAKIN` di masing-masing `types.ts`, dan diulang di sini supaya
tidak terbaca sebagai hasil pengukuran: `rebalanceBandBps = 500` dikalibrasi untuk portofolio
saham/obligasi, bukan kripto; `expectedHoldingDays = 30` adalah asumsi yang menentukan seluruh
perilaku Yield; pengali `2,00×` di Grid dan Yield adalah keputusan produk, bukan turunan;
`maxPlausibleApyBps = 100_000` heuristik; dan **seluruh `DEFAULT_COST_MODEL`/`DEFAULT_SWITCH_COST`
adalah taksiran, bukan pengukuran** — wajib diganti angka nyata dari lapisan chain sebelum
memutuskan uang.

### C10. Batas kepercayaan pada kontrak

- Owner kontrak adalah pihak tepercaya: ia dapat mem-bypass gate reputasi lewat `setSubscriptions`
  maupun upgrade UUPS. Dinyatakan di NatSpec `FuguReputation`.
- Gate anti-sybil mahal bagi penyerang **luar**, tetapi tidak mencegah pemilik listing memoles
  rating listingnya sendiri, karena penyebut ambangnya adalah harga listing yang ia tentukan sendiri.
- `FuguRegistry` belum memverifikasi kepemilikan token ERC-8004 di registry eksternal. Siapa pun
  masih bisa mendaftarkan agent milik orang lain; hanya keunikan agentId dan larangan kurasi-sendiri
  yang menahan.
- Alamat penyedia likuiditas pool tiruan memakai kunci deterministik dari
  `keccak256("fugu-mock-lending-lp-testnet-seed")`. Siapa pun yang membaca repo dapat menarik
  likuiditas mock itu — dapat diterima karena tokennya tanpa nilai, dan dinyatakan di komentar script.

---

## D. Klaim yang diturunkan karena buktinya kurang

Bagian ini adalah alasan dokumen ini bisa dipercaya. Ia mencatat kalimat yang **pernah ditulis atau
direncanakan**, lalu dicabut ketika buktinya diperiksa.

| Klaim yang sempat berdiri | Kenapa diturunkan |
|---|---|
| "Backend, frontend, dan landing page kosong" | Sudah tidak benar; tetapi penggantinya **bukan** "marketplace jalan ujung ke ujung" — lihat B4, frontend belum pernah dijalankan terhadap backend hidup. |
| "Kill switch tersedia" | `killed` dulu hanya bisa true kalau ia sudah true sebelum loop dimulai. Sekarang `kill()` ada dan dipersist, tetapi tuas yang bisa ditekan user tetap belum ada (B2). |
| "Repay lewat session key" (jalan ke-4 dan ke-5) | Kodenya sudah berubah dua kali sejak itu. Bukti atas kode yang tidak dipakai lagi bukan bukti — E2E dijalankan ulang, jalan lama turun menjadi riwayat. |
| "Panggilan di luar izin ditolak (ada exception)" | "Ada exception" bukan bukti izin: relay 502, receipt timeout, dan nonce race juga melempar. Assertion dipersempit menuntut `UnauthorizedCall` + nama kontrak, lalu dibuktikan gagal-benar dengan relay dimatikan. |
| "Cache sehat" pada `/api/health` | Probe menyimpulkan sehat dari absennya exception dan menimpa baris jujur yang sudah mengaku gagal. Ditemukan di kontainer hidup, bukan di test. |
| "`total` agent yang dilayani" | Sempat memakai `upstreamTotal` yang melebih-lebihkan. Sekarang `total` selalu jumlah item nyata; `upstreamTotal` pindah ke trail. |
| "`healthy: true`" saat hanya seed yang bekerja | Seed adalah berkas dalam bundel dan tidak bisa mati — menghitungnya membuat `healthy` tautologi. Tanpa observasi sumber sungguhan → `false`. |
| "Pita rebalancing lebih baik" | Dibantah backtest sendiri pada ayunan besar, dan hasilnya dikunci sebagai test `KEJUJURAN`, bukan disembunyikan. |
| "Grid mengungguli hold" | Dibantah backtest sendiri pada tren berarah, juga dikunci sebagai test `KEJUJURAN`. |
| "expectPartialRevert karena kendala forge" | Reviewer mengujinya sendiri dan membuktikan full match lulus di forge yang sama — jadi itu pelonggaran yang menyamar sebagai kendala teknis. Diganti full match berisi nilai HF persis. |
| "89 commit" | `git log --oneline \| wc -l` menjawab **90**; 89 adalah jumlah commit di atas `87508a2` "Initial commit". Angka yang ditulis di §Angka menyebut keduanya. |

---

## Urutan kerja berikutnya

1. Sambungkan `createGuardian()` ke runtime agent yang disajikan (`dualMain.ts`/`mcpMain.ts`/
   `tools.ts`), sekalian selesaikan perbedaan pemuatan sesi (B1). Beri `kill()` tuas yang bisa
   ditekan user (B2).
2. Sambungkan marketplace ke backend hidup dan buktikan dengan satu jalan terekam (B4).
3. Endpoint risiko (`bloatLevel` + metrik mentah) supaya mekanik fugu mengembang punya data (B5).
4. Scheduler + indexer, dan setel `breakoutConfirmObservations`/`minConsecutiveFavorable` bersama
   kadensnya (B11).
5. Samakan jaringan baca dan eksekusi (C2), atau nyatakan mock sebagai batas produk dengan jelas.
6. Verifikasi kontrak di BscScan begitu `BSCSCAN_API_KEY` tersedia (B9).
7. Strategi eksekusi on-chain untuk Rebalancer, Grid, dan Yield (B3).
