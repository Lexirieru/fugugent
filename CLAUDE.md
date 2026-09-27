# HelloFugu

A DeFi agent marketplace on BNB Chain for the BNB Chain "The Smart Money Era" hackathon.
Every agent is a cartoon fugu fish character; **the fugu puffs up as risk load rises**
— real risk metrics are visualized as the puff level.

Domains: `hellofugu.xyz` (landing) · `app.hellofugu.xyz` (marketplace) · `api.hellofugu.xyz`
(backend, on the VPS) · `agents.hellofugu.xyz` (each agent's A2A endpoint).
All four are live and served over TLS. A push to `main` runs CI, and a green run deploys
the VPS stack; Vercel builds the two front ends from the same push.
Project account on X: `@hellofuguai` (linked in both footers).

## BNB Chain Phase 2 ("Set and Earn")

Shortlisted. The technical requirements are met and live; `docs/phase2/TRACKING.md` is
what the BNB team reads, and `api.hellofugu.xyz/api/tracking` serves the same content.
What the rules forbid, and what must therefore never come back:

- **No seed, no mock, no hardcoded agent list.** The catalogue is read from the ERC-8004
  IdentityRegistry `0x8004A818…BD9e` on chain 97 (`seed: null` in `backend/src/index.ts`).
- Our nine agents are ERC-8004 ids **2480–2488** = FuguRegistry listings **1–9** (Guardian
  is `97:2480`, listing 1). `FuguRegistry.list()` only accepts an id the caller owns.
- Every hire is capped (the deposit), revocable (`cancel` refunds the rest), and visible on
  `/me` and in `/api/tracking/hires?wallet=`.
- **Team wallets are listed in TRACKING.md so they can be excluded.** Do not pad ratings or
  hires with them: every review on chain today is from the deployer, and the docs say so.
- `docs/phase2/` also holds `MAINNET.md` (migration plan) and the brand kit. Nothing is
  sent to the BNB contact without the repo owner saying so.

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
| `contracts/` | 5 UUPS contracts (Foundry) | live and source-verified on testnet; 9 categories, 9 listings bound to ERC-8004 ids; addresses in `contracts/deployments/bsc-testnet.json` |
| `ai/` | 9 Fugu agents (BNB Agent Studio, Altana wallets) | **Only Guardian has ever sent a transaction.** Rebalancer/Grid/Yield have a decision engine and a backtest and are listed, but cannot execute. Broker/Trader/Pilot/Meter/Steward are newer still: listed, tested, wallets funded with nothing, no session key granted, nothing sent. Pilot/Meter/Steward have no `bag` scaffolding yet either |
| `backend/` | Hono + Postgres + Redis: BFF, ERC-8004 registry sweep, classifier, tracking API | live at `api.hellofugu.xyz`; registry → cache → FuguRegistry fallback, RPC fallback across three public endpoints |
| `frontend/` | Next.js 16 marketplace: catalogue, agent pages with hire/cancel/rate, `/me` console, `/list` for builders | live at `app.hellofugu.xyz`; live-testnet E2E in `frontend/e2e/` |
| `landingpage/` | Vite + React landing: the aircraft-video hero first, then the split hero | live at `hellofugu.xyz` |

**Test counts are deliberately not written here.** They went stale three times in one
day. `.github/workflows/ci.yml` holds the baselines CI actually asserts against, and it
fails when a suite loses tests, so it cannot drift the way a table in a document does.

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
8. **Never type a private key into a page.** E2E scripts read `contracts/.env` inside the
   script and sign in-process; the key is never printed.
9. **UI copy: no em dashes, few words.** Explanations go behind an `InfoTip` ("i"), not
   into paragraphs.

## Commands

```bash
cd contracts && forge test          # contract tests
cd contracts && forge build         # build
bun --cwd frontend dev              # marketplace
bun --cwd landingpage dev           # landing page
bun run --cwd frontend build        # note the word order, see below
bun run --cwd frontend lint
bun run --cwd landingpage build
bag --help                          # BNB Agent Studio CLI
```

> **`bun --cwd <dir> run <script>` does not run anything.** On bun 1.3.9 it prints the
> `bun run` usage text and **exits 0**, which reads exactly like a build that passed. A
> green build reported from that command is not evidence of anything. The working forms
> are `bun run --cwd <dir> <script>` (with `run` before `--cwd`) and `bun --cwd <dir>
> <script>` (with no `run` at all); the broken one is only the two combined.

## Style

- **English for all documentation, code comments, and commit messages.** Code identifiers
  stay in English as always.
- Conversation with the repo owner is in Bahasa Indonesia; everything written into the repo
  is in English.
- Conventional commit format (`feat:`, `fix:`, `docs:`, `chore:`).
