# Fugugent

A DeFi agent marketplace on BNB Chain for the BNB Chain "The Smart Money Era" hackathon.
Every agent is a cartoon fugu fish character; **the fugu puffs up as risk load rises**
— real risk metrics are visualized as the puff level.

Domains: `hellofugu.xyz` (landing, already purchased) · `app.hellofugu.xyz` (marketplace) · `api.hellofugu.xyz`
**Nothing is deployed to these domains yet.**

## Documents to read before changing anything

| File | Contents |
|---|---|
| `docs/specs/2026-09-08-fugugent-design.md` | The architecture spec — **the binding authority** |
| `docs/research/00-decisions.md` | 10 locked decisions + the dGrid test results |
| `docs/setup/ENVIRONMENT.md` | Credentials, verified contract addresses, network constants |
| `docs/plans/` | Implementation plans per subsystem |
| `docs/research/01`–`06` | Verified research (Agent Studio, HelloMinds, Altana, 8004scan, competitors, strategy) |

## Structure

| Folder | Contents | Status |
|---|---|---|
| `contracts/` | 4 UUPS contracts (Foundry) | live on testnet, 131 tests |
| `ai/` | 4 Fugu agents (BNB Agent Studio, Altana wallets) | Guardian proven on-chain through a session key (249 tests); Rebalancer/Grid/Yield have a decision engine + backtest (88/99/93), execution not yet wired |
| `backend/` | Hono + Postgres + Redis: BFF, classifier, tiered fallback | running on Docker Compose, 374 tests; the 4-level fallback proven live |
| `frontend/` | Next.js 16 marketplace | list + URL-addressable detail + rental flow, build green |
| `landingpage/` | Next.js 16 landing | finished, build green |

## Rules that must never be broken

1. **A financial decision never passes through an LLM.** A strategy is deterministic code
   that can be backtested. dGrid (`openai/gpt-5.6-luna`) has a latency of 30–46 seconds —
   it is only for asynchronous explanations and the research agent, never on the critical
   path.
2. **Every token on BSC has 18 decimals, USDT included.** Not 6.
3. **`RPC_URL` must be overridden.** The SDK default uses the `binance.org` domain, which
   is blocked from Indonesia. Use `https://data-seed-prebsc-1-s1.bnbchain.org:8545`.
4. **Every call to 8004scan must carry a browser `User-Agent`** — without it the API
   answers HTTP 500, not 429. Always through the backend, never from the browser.
5. **Altana sessions: an empty `calls: []` means unlimited permission.** Always fill in an
   explicit allowlist.
6. **Never commit `.env`.** Everything is already gitignored; do not loosen it.
7. **Testnet only** (chainId 97). Never use a private key that touches mainnet.

## Commands

```bash
cd contracts && forge test          # contract tests
cd contracts && forge build         # build
bun --cwd frontend dev              # marketplace
bun --cwd landingpage dev           # landing page
bag --help                          # BNB Agent Studio CLI
```

## Style

- **English for all documentation, code comments, and commit messages.** Code identifiers
  stay in English as always.
- Conversation with the repo owner is in Bahasa Indonesia; everything written into the repo
  is in English.
- Conventional commit format (`feat:`, `fix:`, `docs:`, `chore:`).
