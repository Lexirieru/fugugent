# Fugugent — Status Sebenarnya

Diperbarui 2026-09-08. Dokumen ini sengaja menyatakan **apa yang ada dan apa yang belum**,
supaya tidak ada klaim yang tidak didukung kode. Setiap baris "ada" bisa diverifikasi.

## Yang sudah ada dan terbukti

### Smart contract — live di BSC testnet
| Kontrak | Alamat |
|---|---|
| FuguPriceOracle | `0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65` |
| FuguRegistry | `0xb2f36070E6eae3353E8e755172B477DF213ae248` |
| FuguSubscription | `0xfdb083371f44Cf53181350389D3217e51B431776` |
| FuguReputation | `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400` |

104 test termasuk fuzz 256 runs. **E2E dijalankan di jaringan sungguhan**: daftar agent →
sewa → agent tarik bayaran → review → penolakan review ganda. Bukti dan tx hash di
`docs/e2e/2026-09-08-e2e-testnet.md`.

### Empat agent + session key Altana
Keempatnya punya wallet sendiri dengan session ber-batas **terdaftar di Keystore on-chain**
(`0x6b8361C29d05D498b1a12B54A37310f94171E94A`). Siapa pun bisa memverifikasi dengan satu
`eth_call`, tanpa API key: `isValidKey(wallet, keyHash)` → `true` untuk keempatnya.
Batasnya juga terbaca publik: 10 U/hari, 0,02 tBNB/hari, kedaluwarsa 8 Oktober 2026.

Agent Studio berjalan: `bag doctor` 14 PASS / 0 FAIL, `bag dev` menyajikan A2A + MCP, dan
permintaan `negotiate` dijawab **quote bertanda tangan wallet** (0,1 U, lengkap dengan
`negotiation_hash` dan `provider_sig`).

### Lapisan strategi Fugu Guardian
223 test (`cd ai/fuguguardian/app/agent && corepack pnpm test`). Rumus health factor murni
dengan pembulatan yang sengaja diarahkan ke sisi aman, mesin keputusan deterministik yang
gagal keras pada konfigurasi cacat, adapter yang terbukti membaca Aave v3 dari BSC mainnet
(bacaannya ditambatkan ke satu blok, sehingga `Position.blockNumber` benar-benar blok tempat
angkanya dibaca), loop pemantauan (`guard.ts`), jalur eksekusi dengan spend cap dan cooldown
(`execute.ts`), jembatan satuan USD8 ↔ unit token dengan test sendiri (`units.ts`), lapisan
penjelasan dGrid yang gagal dengan aman, dan penandatangan repay lewat session key Altana yang
menolak izin sesi terlalu longgar sebelum satu transaksi pun dikirim (`chain/session.ts`).
Perakitannya sekarang punya satu tempat, `createGuardian()` di `src/strategy/`, yang dipanggil
skrip E2E dan siap dipanggil backend — bukan lagi ±200 baris perakitan yang hanya hidup di
dalam skrip demo.

**Repay tidak bisa terkirim dua kali.** Untuk pengiriman jaringan, "gagal" tidak berarti
"tidak terjadi": `waitForTransactionReceipt` yang timeout melempar SETELAH transaksinya
mendarat. Anggaran, cooldown, dan sebuah catatan repay menggantung karena itu dicatat
**sebelum** transaksi dikirim, dan selama catatan itu belum dibereskan oleh bukti on-chain
(hutang berkurang pada blok yang lebih baru) tidak ada pengiriman baru yang diizinkan.
Satu-satunya galat yang diperlakukan sebagai "tidak terjadi" adalah galat yang secara
eksplisit menyatakan dirinya belum menyentuh jaringan, dan hanya `chain/session.ts` yang boleh
menyatakannya. Konsekuensi yang dinyatakan terbuka: repay yang benar-benar tidak pernah
mendarat membuat Guardian **berhenti bertindak** sampai seorang operator membereskannya lewat
`clearPendingRepay`. Itu pilihan sadar — Guardian yang diam adalah kegagalan yang terlihat.

### Guardian menaikkan health factor posisi — terbukti on-chain
Bukan lagi test unit saja. Satu siklus Guardian dijalankan di BSC testnet terhadap posisi
di **`MockLendingPool` — protokol lending tiruan milik kami sendiri**, ABI-kompatibel
`getUserAccountData` Aave v3, dengan harga agunan yang **kami turunkan sendiri** lewat feed
yang kami miliki. Transaksinya nyata, posisinya nyata, protokolnya bukan. Yang dibuktikan:
rantai baca → putuskan → eksekusi → HF naik benar-benar bekerja ujung ke ujung.

Harga agunan diturunkan sampai **HF 1,14** (zona `PARTIAL_REPAY`), agent memutuskan sendiri,
membayar **$559,02** hutang lewat transaksi nyata, dan **HF naik ke 1,50** — dibaca ulang
dari rantai pada blok transaksinya, bukan dari log.

| | |
|---|---|
| Tx repay | [`0x6ccb4c5a…`](https://testnet.bscscan.com/tx/0x6ccb4c5a8d9f6ca5201dff73a663992dbc6a3b2efa74406e84a02d93584d5fcc) |
| HF sebelum → sesudah | 1,14 → 1,50 (**+0,35**) |
| Hutang | $2.395,83 → $1.836,80 |
| Pengurangan hutang on-chain vs jumlah yang diklaim | sama persis (selisih 0 unit basis 8 desimal) |
| Biaya | 0,0000162 tBNB |

Skrip buktinya, `ai/fuguguardian/app/agent/scripts/e2e-guardian.ts`, mengimpor modul
strategi apa adanya dan **gagal dengan exit code bukan nol** begitu satu klaim tidak
terbukti terhadap bacaan on-chain — termasuk klaim *berapa* yang dibayar. Jalur gagalnya
juga dijalankan sungguhan: exit 1, dan harga testnet tetap dipulihkan. Rinciannya di
`docs/e2e/2026-09-08-e2e-testnet.md`.

> Jalan ini ditandatangani **EOA deployer** dan dipertahankan sebagai riwayat. Jalan yang
> berlaku sekarang ditandatangani session key ber-batas — lihat bagian berikutnya.

### Repay dieksekusi lewat session key Altana ber-batas — terbukti on-chain
Sejak 2026-09-08 repay **tidak lagi** ditandatangani EOA deployer. Ia ditandatangani session
key Altana atas wallet `0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0`, yang batasnya ditegakkan
kontrak akun Altana — bukan oleh kode kami.

Sesi itu hanya boleh memanggil **dua** hal: `MockLendingPool.repay(address,uint256)` dan
`mUSD.approve(address,uint256)`. Cap belanja 0,02 tBNB + 100 mUSD per hari, kedaluwarsa
8 Oktober 2026, terdaftar publik di Keystore (`isValidKey` → `true` untuk keyHash
`0x7a467115…`).

Jalan yang berlaku adalah yang dijalankan setelah perakitan rantai dipindahkan ke composition
root `createGuardian()` (Task 9). E2E **dijalankan ulang sungguhan** lewat jalur baru itu,
karena bukti atas kode yang sudah tidak dipakai lagi bukan bukti:

| | |
|---|---|
| Tx repay lewat sesi (`approve` + `repay`, satu userOp) | [`0xd7acda4c…`](https://testnet.bscscan.com/tx/0xd7acda4cc6505da3ea9b89911b7fa8a884147f0e67e11e6fb9cc8d99d638d06e) (blok 129849537) |
| `Repay.user` pada receipt | `0xbdc69c2d…` (wallet Altana) — **bukan** `0x56A2950d…` (EOA deployer) |
| HF sebelum → sesudah | 1,14 → 1,50 |
| Hutang | $22,53 → $17,27 (dibayar $5,25; selisih klaim vs rantai **0 unit**) |
| Ongkos | 0,000041 tBNB (kedua sisi) |
| Tx grant sesi | [`0x15e67a21…`](https://testnet.bscscan.com/tx/0x15e67a21e5ec25f8459ac2e83798033ca9afe5a14b41143aeb28fe2a47b64b52) |

Empat jalan sebelumnya — termasuk jalan ke-4 (`0x3ec2818c…`, dibayar $6,85) yang sempat menjadi
bukti utama dokumen ini — dipertahankan sebagai riwayat di
`docs/e2e/2026-09-08-e2e-testnet.md` §"Riwayat jalan session key". Angkanya tetap benar;
kodenya yang sudah tidak ada.

**Bukti yang lebih penting: batasnya nyata.** Sesi yang sama, sesaat setelah berhasil membayar,
mencoba `mUSD.transfer(EOA deployer, 1 wei)` dan **ditolak** dengan `UnauthorizedCall` — custom
error kontrak akun Altana, yang muncul saat relay mensimulasikan userOp, jadi transaksinya
tidak pernah disiarkan (nol gas, saldo tidak bergerak, dan **tidak ada blok yang bisa dibuka
untuk penolakan itu**). `mBNB.approve` juga ditolak, membuktikan pengikatan berlaku pada
tingkat kontrak **dan** selector. Uji itu menuntut galatnya benar-benar `UnauthorizedCall` dan
menyebut kontrak yang dicoba; kegagalan jaringan dilempar ulang sebagai kegagalan uji, bukan
diterima sebagai bukti. Rinciannya, termasuk galat verbatim, di
`docs/e2e/2026-09-08-e2e-testnet.md`.

Tiga hal yang **tidak** dibuktikan, dinyatakan supaya tidak disimpulkan lebih: receipt tidak
membedakan kunci admin dari kunci sesi (yang menutupnya: skrip hanya memuat file sesi, plus
penolakan di atas — kunci admin tidak akan pernah ditolak); penolakan tidak punya jejak
on-chain; dan izin Altana mengikat kontrak + selector, **bukan nilai argumen** — `approve`
bebas-spender hanya dinetralkan spend cap dan oleh perilaku Porto yang menolkan allowance di
akhir userOp, perilaku pihak ketiga yang kami temukan secara empiris.

### Kill switch dan persistensi state — sejauh mana ia benar-benar ada
Sebelum ini `killed` hanya bisa bernilai true kalau ia **sudah** true sebelum loop dimulai:
tidak ada jalan menariknya selagi agent berjalan, padahal dokumen ini mendaftarkannya sebagai
kapabilitas. Sekarang `GuardLoopHandle` punya `kill()` yang berlaku seketika, tidak bisa
dibatalkan oleh siklus yang sedang berjalan, dan langsung dipersist. `ExecuteState` (anggaran
harian, cooldown, kill switch, repay menggantung) juga punya store yang disuntikkan
(`state/store.ts`: berkas JSON atau memori; backend bisa menggantinya dengan Postgres), dan
isi berkas yang rusak **ditolak** alih-alih diam-diam mereset seluruh batas.

Yang **belum** ada, dan jangan diklaim: **tuas yang bisa ditekan user.** `kill()` adalah
pemanggilan fungsi di dalam proses — belum ada tombol UI, perintah CLI, atau endpoint HTTP
yang memanggilnya, karena strategi ini memang belum tersambung ke runtime mana pun (lihat
"Yang BELUM ada" #1). Kalimat yang benar: *"kill switch punya jalur runtime dan state-nya
bertahan melewati restart"*, bukan *"user bisa menghentikan agent kapan saja"*. Untuk alasan
yang sama, tidak ada proses jangka panjang yang sungguhan memakai store berkas itu hari ini —
yang ada adalah antarmuka, implementasi, dan test-nya.

Batas kode (`execute.ts`: $2.000/hari) dan batas kriptografis (sesi: 100 mUSD/hari) belum
disamakan. Yang mengikat adalah yang lebih ketat — cap sesi — dan itu arah yang benar, tetapi
permintaan di atas cap akan gagal di relay sebagai error, bukan ditolak rapi oleh `execute.ts`.

## Yang BELUM ada — jangan diklaim

1. **Strategi belum tersambung ke *runtime* agent.** Rantai keputusan → eksekusi → bukti
   on-chain sudah terbukti, dan repay-nya sudah lewat session key ber-batas (lihat di atas),
   tetapi yang menjalankannya adalah skrip E2E, bukan agent A2A/MCP yang disajikan `bag dev`:
   `dualMain.ts` dan `tools.ts` masih belum mengimpor `src/strategy/` sama sekali, jadi agent
   yang berjalan hari ini tetap mengirim teks sebagai deliverable. Yang berubah sejak Task 9
   hanyalah bahwa sambungannya kini punya satu titik masuk yang jelas — `createGuardian()` —
   bukan lima potongan yang harus disalin dari skrip E2E. Titik masuk itu ada; yang
   memanggilnya belum.
   → Kalimat yang benar: *"Guardian terbukti menaikkan HF posisi dari 1,14 ke 1,50 lewat
   transaksi on-chain yang ditandatangani session key ber-batas"*, bukan *"agent yang kami
   sajikan di marketplace sudah melindungi posisi Anda secara otonom"*.

   Catatan teknis yang jujur: sesi Guardian ini **tidak** bisa dimuat lewat
   `ensureAltanaSessionLoaded()`/`getWallet()` milik `@bnbagent/studio-runtime` — jalur itu
   menolak sesi yang `permissions.calls`-nya bukan salinan persis `defaultAgentPermissions()`
   (ERC-8004 + ERC-8183). Sesi ini dimuat langsung lewat `deserializeSession` +
   `AltanaWalletProvider`. Menyambungkannya ke runtime agent berarti menyelesaikan perbedaan
   itu (dua sesi berdampingan, atau satu sesi dengan allowlist gabungan).
2. **Baca mainnet, eksekusi testnet — dua dunia berbeda.** Adapter membaca posisi nyata di
   BSC mainnet karena Venus dan Aave hanya ada di sana; eksekusi agent di testnet.
   Keputusan atas posisi mainnet tidak bisa dieksekusi di testnet. Ini batasan, bukan fitur.
3. **Protokol lending yang dipakai E2E adalah tiruan buatan sendiri.** `MockLendingPool`,
   `MockTokenUSD`/`MockTokenBNB`, dan `MockPriceFeed*` semuanya kami deploy dan kami
   kendalikan; harga agunan pada bukti E2E diturunkan oleh kami sendiri lewat `setAnswer`.
   Guardian belum pernah menyentuh Aave, Venus, atau protokol pihak ketiga mana pun.
   → Kalimat yang benar: *"rantai baca → putuskan → eksekusi terbukti bekerja terhadap pool
   ber-ABI Aave v3"*, bukan *"Guardian sudah menyelamatkan posisi di protokol lending
   nyata"*.
4. **Backtest belum mengukur apa pun.** Yang ada adalah harness plus deret harga sintetis di
   test. Tidak ada satu pun data harga historis di repo.
   → Kalimat yang benar: *"kami membangun harness dan menjalankannya pada deret sintetis"*.
5. **`DELEVERAGE` masih dimodelkan salah di backtest** — agunan tidak ikut turun, padahal
   deleverage sungguhan menjual agunan. Didokumentasikan menonjol di kepala file, tapi belum
   diperbaiki.
6. **Venus belum terhubung ke mesin keputusan.** Adapternya membaca `liquidity`/`shortfall`,
   tapi Venus tidak menyediakan health factor maupun ambang likuidasi agregat, sehingga
   membangun `Position` darinya butuh data per-market yang belum diambil.
7. **Tiga agent lain belum punya strategi.** Rebalancer, Grid, dan Yield baru sebatas
   scaffold dengan session key.
8. **Backend, frontend, dan landing page kosong.** Belum ada marketplace yang bisa dibuka.
9. **Kontrak belum diverifikasi di BscScan** — `BSCSCAN_API_KEY` belum tersedia. Perintah
   verifikasinya sudah disiapkan.

## Batas kepercayaan yang dinyatakan terbuka

- Owner kontrak adalah pihak tepercaya: ia dapat mem-bypass gate reputasi lewat
  `setSubscriptions` maupun upgrade UUPS. Dinyatakan di NatSpec `FuguReputation`.
- Gate anti-sybil mahal bagi penyerang **luar**, tetapi tidak mencegah pemilik listing
  memoles rating listingnya sendiri, karena penyebut ambangnya adalah harga listing itu
  yang ia tentukan sendiri. Dinyatakan di NatSpec.
- `FuguRegistry` belum memverifikasi kepemilikan token ERC-8004 di registry eksternal.
  Siapa pun masih bisa mendaftarkan agent milik orang lain; hanya keunikan agentId dan
  larangan kurasi-sendiri yang menahan.

## Urutan kerja berikutnya

1. Sambungkan strategi Guardian ke runtime agent yang disajikan (`dualMain.ts`/`tools.ts`)
   lewat `createGuardian()`. Penanda tangan repay sudah pindah ke session key Altana ber-batas,
   dan perakitannya sudah punya rumah di `src/`. Sekalian: beri `kill()` sebuah tuas yang bisa
   ditekan user.
2. Samakan jaringan baca dan eksekusi.
3. Backend: BFF 8004scan, indexer, classifier 4 kategori, scheduler.
4. Frontend marketplace: discovery → detail → hire → panel izin & revoke.
5. Strategi untuk tiga agent sisanya.
6. Agent Advantage Report untuk TermiX, dengan data historis nyata.
