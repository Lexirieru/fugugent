# ai — empat agent Fugu

Empat agent DeFi otonom, di-scaffold dengan BNB Agent Studio (`bag`), dijalankan
sendiri di VPS, mengeksekusi lewat session key Altana non-custodial.

| Agent | Kategori | Protokol | Trigger |
|---|---|---|---|
| `fugurebalancer` | Rebalancing | PancakeSwap v3 | keluar range / deviasi / interval |
| `fugugrid` | Grid Trading | PancakeSwap v3 swap | keeper pantau `slot0()` |
| `fuguyield` | Yield Optimisation | Venus, Aave v3, Lista | selisih APR > ambang biaya |
| `fuguguardian` | Health Factor | Venus, Aave v3 | HF di bawah ambang |

Nama project ≤23 char, alfanumerik, diawali huruf (aturan AgentCore) — tanpa `-`/`_`/`.`.

## Aturan

1. **Strategi = kode deterministik murni** di `app/agent/src/strategy/`, tanpa I/O,
   bisa di-unit-test dan di-backtest. LLM tidak pernah memutuskan uang.
2. **dGrid hanya untuk penjelasan asinkron & riset.** Model `openai/gpt-5.6-luna`,
   latensi terukur 30–46 detik. Kalau ini di jalur kritis, Guardian telat 45 detik
   saat harga jatuh.
3. **Studio tidak punya scheduler** — README-nya eksplisit "there is no background
   poller". Penjadwalan datang dari BullMQ di `backend/`.
4. **Tidak ada template strategi di Studio.** Seluruh 14 skill dan 7 recipe-nya soal
   plumbing komersial. Alpha adalah kerja kita.
5. **Signing adalah kode tetap**, tidak pernah tool yang bisa dipanggil LLM.

## Jebakan Altana yang sudah memakan korban

- `calls: []` kosong = izin **tanpa batas**. Selalu isi allowlist eksplisit.
- USDT/USDC di BNB **18 desimal**, bukan 6.
- Native spend cap juga membayar relay fee — cap kekecilan bikin semua eksekusi
  `FAILED` code 300.
- `execute()` **tidak melempar saat gagal** → cek `result.status !== "CONFIRMED"`.
- `getKeys` tidak membuang key expired, hanya yang di-revoke → wajib cross-check.
- `bag init --wallet-kind altana --llm-provider pieverse-llm` **ditolak** (Altana
  menolak generic message signing). Pakai provider ber-API-key.
- `@altananetwork/mcp` wajib `bunx`, `npx` gagal.

## Perintah

```bash
bag init <nama> --wallet-kind altana --destination self --no-onboard
bag wallet new && bag wallet session grant
bag doctor && bag dev
```

`.env` berisi `DGRID_API_KEY` — gitignored.

## Status wallet & session (BSC testnet)

Keempat agent punya wallet Altana sendiri dengan session ber-batas yang terdaftar di
Keystore on-chain `0x6b8361C29d05D498b1a12B54A37310f94171E94A`. Semuanya diverifikasi
dengan `isValidKey` → `true` dan lolos `bag doctor` 14 PASS / 0 FAIL.

| Agent | Kategori | Wallet admin Altana |
|---|---|---|
| `fuguguardian` | Health Factor | `0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0` |
| `fugurebalancer` | Rebalancing | `0xb8f155D1278f0437b9De7c63911f2C0EDa485941` |
| `fugugrid` | Grid Trading | `0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9` |
| `fuguyield` | Yield Optimisation | `0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866` |

Semua session: **10 U/hari + 0,02 tBNB/hari, expiry 30 hari (8 Okt 2026)**, `register=true`.

**Temuan:** grant session **tidak** memerlukan saldo U di wallet — U hanya dipakai untuk
allowance Commerce. `bag doctor` akan WARN soal saldo U, tapi session tetap sah dan
terdaftar. Berguna karena faucet U dibatasi 10 U per 30 menit.

Verifikasi publik tanpa API key apa pun:
```bash
cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
  0x6b8361C29d05D498b1a12B54A37310f94171E94A \
  'isValidKey(address,bytes32)(bool)' <WALLET_AGENT> <KEY_HASH>
```
`KEY_HASH` = `cast keccak <session public key>`; public key dari `bag wallet session status`
(dijalankan di `app/agent/`).

Perpanjang: `bag wallet session grant --force`. Cabut: `bag wallet session revoke --yes`.

**Jangan pernah** mencetak, menyalin, atau mem-parse bagian `signer` dari file session.
