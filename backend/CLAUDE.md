# backend — Fugugent

Hono + Postgres (Drizzle) + Redis + BullMQ. TypeScript. Serves `api.hellofugu.xyz`.

## Four responsibilities

1. **ERC-8004 registry reader** (`src/sources/registry.ts`) — the primary source. Sweeps
   the IdentityRegistry `0x8004A818…BD9e` by state (`ownerOf`/`tokenURI`/`getAgentWallet`
   per id through Multicall3, pinned to one block) every 5 minutes. Not `eth_getLogs`:
   no free BSC testnet RPC serves historical logs (measured 2026-09-25).
2. **FuguRegistry reader** — our own rentable listings, overlaid on every page.
3. **4-category classifier** — semantic search + pre-filter + keywords + LLM, results cached.
4. **BullMQ scheduler** — what BNB Agent Studio does not have; it triggers all four agents.

## Resilience rules (these are the judging criteria, not nice-to-haves)

- **A browser `User-Agent` is mandatory** on every 8004scan call. Without it the API
  answers HTTP 500, not 429. Verified live.
- **Exponential backoff retry 3–5x + a circuit breaker.** The upstream is proven to answer
  `500 DATABASE_ERROR` intermittently — 4 out of 5 attempts failed during the research.
- **Tiered fallback:** ERC-8004 registry → Postgres cache (last sweep) → FuguRegistry.
  **No seed in production** (`seed: null`): the BNB Phase 2 rules forbid mock data,
  hardcoded agent lists and seeded records. 8004scan is not in the ladder; it is only
  where a mint tx hash is *found*, and `registry-proof.ts` shows it only after the
  receipt proves `Registered(agentId)` from the registry.
- **Metadata URIs are attacker-controlled.** `registry-metadata.ts` fetches only https
  and ipfs, refuses private/IP-literal hosts, re-checks every redirect, caps size and
  time. Do not loosen these to "get more names".
- **Cache TTLs:** agent detail 60s · leaderboard 5m · trending 1m · global 60s.
- **Spam filters are mandatory.** Of the 309k BSC agents the majority are bulk
  registrations. Use `is_registered=true`, `min_score`, `has_a2a=true`,
  `owner_publisher_tier`.

## Data sources

```
ERC-8004   0x8004A818BFB912233c491871b3d84c89A494BD9e  (testnet; mainnet 0x8004A169…a432)
8004scan   https://api.8004scan.io/api/v1     (tx-hash hints only; browser User-Agent)
DefiLlama  https://yields.llama.fi/pools      (chain "BSC")
RPC        https://data-seed-prebsc-1-s1.bnbchain.org:8545
```

`pancakeswap-amm-v3` is **not** covered by DefiLlama for BSC — the PancakeSwap v3 fee APR
has to be computed ourselves from on-chain events.

## Metrics we compute ourselves (the product's main differentiator)

Realized APR 7d/30d · time-in-range % · cost per rebalance · fees vs profit · max
drawdown · distance to liquidation % · agent uptime · median latency · average cost per run.
**Every number must come with a clickable tx hash.**
