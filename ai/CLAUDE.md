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

| Agent | Wallet admin Altana | Session |
|---|---|---|
| `fuguguardian` | `0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0` | aktif, 30 hari, 10 U/hari + 0,02 tBNB/hari, terdaftar di Keystore |

Verifikasi publik tanpa API key apa pun:
```bash
cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
  0x6b8361C29d05D498b1a12B54A37310f94171E94A \
  'isValidKey(address,bytes32)(bool)' <WALLET_AGENT> <KEY_HASH>
```
`KEY_HASH` = `cast keccak <session public key>`. Session public key bisa dilihat dengan
`bag wallet session status` (jalankan dari `app/agent/`).

Perpanjang session yang kedaluwarsa: `bag wallet session grant --force`, lalu deploy ulang.
Cabut: `bag wallet session revoke --yes`.

**Jangan pernah** mencetak, menyalin, atau mem-parse bagian `signer` dari file session.
