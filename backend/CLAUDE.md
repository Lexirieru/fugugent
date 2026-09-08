# backend — Fugugent

Hono + Postgres (Drizzle) + Redis + BullMQ. TypeScript. Melayani `api.fugugent.xyz`.

## Empat tanggung jawab

1. **BFF / proxy 8004scan** — frontend tidak pernah memanggil 8004scan langsung.
2. **Indexer ERC-8004 + kontrak Fugu** — `eth_getLogs`, jaring pengaman bila API tumbang.
3. **Classifier 4 kategori** — semantic search + pre-filter + keyword + LLM, hasil di-cache.
4. **Scheduler BullMQ** — yang tidak dipunyai BNB Agent Studio; memicu keempat agent.

## Aturan ketahanan (ini kriteria juri, bukan nice-to-have)

- **`User-Agent` browser wajib** pada setiap panggilan 8004scan. Tanpa itu API membalas
  HTTP 500, bukan 429. Terverifikasi live.
- **Retry exponential backoff 3–5× + circuit breaker.** Upstream terbukti membalas
  `500 DATABASE_ERROR` intermiten — 4 dari 5 percobaan gagal saat riset.
- **Fallback berjenjang:** API → cache Postgres → baca on-chain → seed terkurasi.
  Marketplace tidak boleh pernah kosong saat juri membukanya.
- **Cache TTL:** detail agent 60s · leaderboard 5m · trending 1m · global 60s.
- **Wajib filter spam.** Dari 309k agent BSC mayoritas bulk registration. Gunakan
  `is_registered=true`, `min_score`, `has_a2a=true`, `owner_publisher_tier`.

## Sumber data

```
8004scan   https://api.8004scan.io/api/v1     (header X-API-Key + User-Agent browser)
DefiLlama  https://yields.llama.fi/pools      (chain "BSC")
RPC        https://data-seed-prebsc-1-s1.bnbchain.org:8545
```

`pancakeswap-amm-v3` **tidak** tercakup DefiLlama untuk BSC — fee APR PancakeSwap v3
harus dihitung sendiri dari event on-chain.

## Metrik yang dihitung sendiri (pembeda utama produk)

Realized APR 7d/30d · time-in-range % · biaya per rebalance · fee vs profit · max
drawdown · jarak ke likuidasi % · uptime agent · median latency · biaya rata-rata per run.
**Setiap angka harus menyertakan tx hash yang bisa diklik.**
