# backend — Fugugent

Hono + Postgres (Drizzle) + Redis + BullMQ. TypeScript. Serves `api.hellofugu.xyz`.

## Four responsibilities

1. **8004scan BFF / proxy** — the frontend never calls 8004scan directly.
2. **ERC-8004 + Fugu contract indexer** — `eth_getLogs`, a safety net when the API is down.
3. **4-category classifier** — semantic search + pre-filter + keywords + LLM, results cached.
4. **BullMQ scheduler** — what BNB Agent Studio does not have; it triggers all four agents.

## Resilience rules (these are the judging criteria, not nice-to-haves)

- **A browser `User-Agent` is mandatory** on every 8004scan call. Without it the API
  answers HTTP 500, not 429. Verified live.
- **Exponential backoff retry 3–5x + a circuit breaker.** The upstream is proven to answer
  `500 DATABASE_ERROR` intermittently — 4 out of 5 attempts failed during the research.
- **Tiered fallback:** API → Postgres cache → on-chain read → curated seed.
  The marketplace must never be empty when the judges open it.
- **Cache TTLs:** agent detail 60s · leaderboard 5m · trending 1m · global 60s.
- **Spam filters are mandatory.** Of the 309k BSC agents the majority are bulk
  registrations. Use `is_registered=true`, `min_score`, `has_a2a=true`,
  `owner_publisher_tier`.

## Data sources

```
8004scan   https://api.8004scan.io/api/v1     (X-API-Key header + browser User-Agent)
DefiLlama  https://yields.llama.fi/pools      (chain "BSC")
RPC        https://data-seed-prebsc-1-s1.bnbchain.org:8545
```

`pancakeswap-amm-v3` is **not** covered by DefiLlama for BSC — the PancakeSwap v3 fee APR
has to be computed ourselves from on-chain events.

## Metrics we compute ourselves (the product's main differentiator)

Realized APR 7d/30d · time-in-range % · cost per rebalance · fees vs profit · max
drawdown · distance to liquidation % · agent uptime · median latency · average cost per run.
**Every number must come with a clickable tx hash.**
