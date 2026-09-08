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
114 test (`cd ai/fuguguardian/app/agent && corepack pnpm test`). Rumus health factor murni
dengan pembulatan yang sengaja diarahkan ke sisi aman, mesin keputusan deterministik yang
gagal keras pada konfigurasi cacat, adapter yang terbukti membaca Aave v3 dari BSC mainnet,
loop pemantauan (`guard.ts`), jalur eksekusi dengan spend cap/cooldown/kill switch
(`execute.ts`), dan lapisan penjelasan dGrid yang gagal dengan aman.

### Guardian benar-benar menyelamatkan posisi — terbukti on-chain
Bukan lagi test unit saja. Satu siklus Guardian dijalankan di BSC testnet terhadap posisi
lending sungguhan: harga agunan diturunkan sampai **HF 1,14** (zona `PARTIAL_REPAY`), agent
memutuskan sendiri, membayar **$729,16** hutang lewat transaksi nyata, dan **HF naik ke
1,50** — dibaca ulang dari rantai, bukan dari log.

| | |
|---|---|
| Tx repay | [`0x318d4709…`](https://testnet.bscscan.com/tx/0x318d4709a391db889c4f97e82bbd4a1ae57dd42a9434a44c32c1c572f849cf6e) |
| HF sebelum → sesudah | 1,14 → 1,50 (**+0,35**) |
| Hutang | $3.125,00 → $2.395,83 |
| Biaya | 0,0000162 tBNB |

Skrip buktinya, `ai/fuguguardian/app/agent/scripts/e2e-guardian.ts`, mengimpor modul
strategi apa adanya dan **gagal dengan exit code bukan nol** begitu satu klaim tidak
terbukti terhadap bacaan on-chain. Rinciannya di `docs/e2e/2026-09-08-e2e-testnet.md`.

## Yang BELUM ada — jangan diklaim

1. **Strategi belum tersambung ke *runtime* agent, dan repay belum lewat session key.**
   Rantai keputusan → eksekusi → bukti on-chain sudah terbukti (lihat di atas), tetapi
   yang menjalankannya adalah skrip E2E, bukan agent A2A/MCP yang disajikan `bag dev`:
   `dualMain.ts` dan `tools.ts` masih belum mengimpor `src/strategy/` sama sekali, jadi
   agent yang berjalan hari ini tetap mengirim teks sebagai deliverable. Transaksi repay-nya
   juga ditandatangani EOA deployer, bukan session key Altana — spend cap, cooldown, dan
   kill switch ditegakkan di `execute.ts` dan diuji, tapi belum di sisi kunci on-chain.
   → Kalimat yang benar: *"Guardian terbukti menaikkan HF posisi dari 1,14 ke 1,50 lewat
   transaksi on-chain"*, bukan *"agent yang kami sajikan di marketplace sudah melindungi
   posisi Anda secara otonom"*.
2. **Baca mainnet, eksekusi testnet — dua dunia berbeda.** Adapter membaca posisi nyata di
   BSC mainnet karena Venus dan Aave hanya ada di sana; eksekusi agent di testnet.
   Keputusan atas posisi mainnet tidak bisa dieksekusi di testnet. Ini batasan, bukan fitur.
3. **Backtest belum mengukur apa pun.** Yang ada adalah harness plus deret harga sintetis di
   test. Tidak ada satu pun data harga historis di repo.
   → Kalimat yang benar: *"kami membangun harness dan menjalankannya pada deret sintetis"*.
4. **`DELEVERAGE` masih dimodelkan salah di backtest** — agunan tidak ikut turun, padahal
   deleverage sungguhan menjual agunan. Didokumentasikan menonjol di kepala file, tapi belum
   diperbaiki.
5. **Venus belum terhubung ke mesin keputusan.** Adapternya membaca `liquidity`/`shortfall`,
   tapi Venus tidak menyediakan health factor maupun ambang likuidasi agregat, sehingga
   membangun `Position` darinya butuh data per-market yang belum diambil.
6. **Tiga agent lain belum punya strategi.** Rebalancer, Grid, dan Yield baru sebatas
   scaffold dengan session key.
7. **Backend, frontend, dan landing page kosong.** Belum ada marketplace yang bisa dibuka.
8. **Kontrak belum diverifikasi di BscScan** — `BSCSCAN_API_KEY` belum tersedia. Perintah
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

1. Sambungkan strategi Guardian ke runtime agent yang disajikan (`dualMain.ts`/`tools.ts`),
   dan pindahkan penanda tangan repay dari EOA deployer ke session key Altana.
2. Samakan jaringan baca dan eksekusi.
3. Backend: BFF 8004scan, indexer, classifier 4 kategori, scheduler.
4. Frontend marketplace: discovery → detail → hire → panel izin & revoke.
5. Strategi untuk tiga agent sisanya.
6. Agent Advantage Report untuk TermiX, dengan data historis nyata.
