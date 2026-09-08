# Hasil Gate Teknis — dijalankan 2026-09-08

Dua risiko di spec (§10, R2 dan R3) diuji dengan scaffold percobaan `bag init` di
scratchpad. Keduanya terjawab; scaffold percobaan sudah dihapus.

## R3 — dGrid sebagai provider LLM Agent Studio: ✅ BISA

`bag init --wallet-kind altana --llm-provider openai` **diterima** (kombinasi dengan
`pieverse-llm` yang ditolak, bukan ini).

Tapi CLI dan runtime **tidak** punya opsi base URL sama sekali — `grep base_url|baseURL`
di `studio.toml` dan seluruh `@bnbagent/studio-runtime` tidak menemukan apa pun.

**Jalannya lewat `app/agent/src/model.ts`**, yang merupakan file milik kita, bukan milik
runtime. Ia memanggil `resolveModel()` dari runtime, tapi tidak ada yang mengharuskan kita
memakainya. Terbukti bekerja:

```ts
import { createOpenAI } from "@ai-sdk/openai";

const dgrid = createOpenAI({
  baseURL: "https://api.dgrid.ai/v1",
  apiKey: process.env.DGRID_API_KEY,
  headers: { "User-Agent": "Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36" },
});
const model = dgrid.chat("openai/gpt-5.6-luna");
```

**Tiga hal yang wajib, dan masing-masing sudah memakan waktu untuk ditemukan:**

1. **`.chat()` wajib.** Tanpa itu `@ai-sdk/openai` v4 memakai **Responses API**; dGrid
   menjawab dengan benar tetapi dalam format yang lebih ramping sehingga SDK melempar
   `AI_APICallError`. `.chat()` memaksa Chat Completions yang dipahami keduanya.
2. **Header `User-Agent` browser wajib.** Tanpa itu dGrid membalas **HTTP 403** — persis
   seperti 8004scan yang membalas 500. Terbukti: `urllib` Python gagal, `curl` dengan UA
   berhasil.
3. **`@ai-sdk/openai` harus ditambahkan eksplisit** (`pnpm add @ai-sdk/openai`). Ia hanya
   dependency transitif `ai`, dan pnpm strict menolak import langsung.

Hasil uji: teks **3,3 detik**; tool calling **11,4 detik** dengan argumen benar
(`{"wallet":"0xABC","protocol":"venus"}`). Latensi dGrid bervariasi 3–46 detik tergantung
beban — bukan konstan seperti dugaan awal.

## R2 — konflik versi Altana SDK: ⚠️ TERKONFIRMASI

`bag init` menghasilkan `app/agent/package.json` yang mem-pin:
```
"@bnbagent/studio-runtime": "0.0.13"
"@bnbagent/sdk": "0.5.5"
"@altananetwork/sdk": "0.7.1"
```
Sementara riset Altana (docs/research/03) menyebut ERC-8183 di testnet revert
`PolicyNotWhitelisted()` pada SDK ≤0.8.0 dan menuntut 0.9.0. Dokumentasi Studio sendiri
menyatakan doctor, readiness, dan runtime loading **menolak version drift**.

**Keputusan:** pakai `0.7.1` yang di-pin, jangan dipaksa naik.
- Yang **wajib** untuk menang track Altana adalah **session key**: wallet agent sendiri,
  session dengan call allowlist + spend cap + expiry, terdaftar di Keystore, transaksi
  nyata lewat session key, dan revoke dari UI. Semua itu ada di 0.7.1.
- ERC-8183 hanya **bonus**. Jalur escrow yang kita pakai untuk hiring adalah
  `@bnbagent/sdk@0.5.5` milik Studio, bukan Altana ERC-8183 SDK.
- Kalau nanti kita mengejar bonus ERC-8183 Altana, paketnya dipakai **terpisah di
  `backend/`**, di luar project Studio, sehingga pin-nya tidak dilanggar.

## Konfigurasi scaffold yang terverifikasi

`studio.toml` yang dihasilkan `--wallet-kind altana`:
```toml
[wallet]
kind = "altana"
keystore_dir = "../../.studio/wallets"
session_file = "../../.studio/wallets/altana-session.json"

[llm]
provider = "openai"
model = "gpt-4o-mini"     # akan kita ganti lewat model.ts ke openai/gpt-5.6-luna
```
File `src/` yang dihasilkan: `agentCard.ts`, `dualMain.ts`, `executor.ts`, `mcpMain.ts`,
`model.ts`, `requestLimits.ts`, `sellerCore.ts`, `signing.ts`, `tools.ts`.
