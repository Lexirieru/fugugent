# Fugugent — The Actual Status

Updated 2026-09-08. This document deliberately states **what really exists and what does
not**. There is one rule: **every claim that something exists must say how someone else can
check it themselves** — a tx hash, a `cast` command, an endpoint, or a test command. Claims
that cannot be checked are not written down, even if they sound true.

The last part of this document (§D) records claims that were **downgraded** because the
evidence was insufficient. That list is kept on purpose.

---

## Numbers you can recompute

| What is measured | Number | How to check |
|---|---|---|
| Contracts (Foundry) | **131** tests | `cd contracts && forge test` |
| Fugu Guardian | **249** tests | `cd ai/fuguguardian/app/agent && corepack pnpm test` |
| Fugu Rebalancer | **88** tests | `cd ai/fugurebalancer/app/agent && corepack pnpm test` |
| Fugu Grid | **99** tests | `cd ai/fugugrid/app/agent && corepack pnpm test` |
| Fugu Yield | **93** tests | `cd ai/fuguyield/app/agent && corepack pnpm test` |
| Backend | **374** tests (1 skipped) | `cd backend && corepack pnpm test` |
| **Total** | **1,034** tests | |
| History | **89** commits on top of the initial commit, clean working tree | `git log --oneline \| wc -l` → 90 (including `87508a2` "Initial commit"); `git status --porcelain` → empty |
| Landing + marketplace | build and lint green | `bun --cwd landingpage run build && bun --cwd landingpage run lint`; the same for `frontend` |

The one skipped backend test is the real Postgres path, which only runs when
`FUGU_TEST_DATABASE_URL` is set (`skipIf`); without that variable the repositories are tested
through PGlite.

---

## A. What exists and is proven

### A1. Four UUPS contracts, live on BSC testnet (chainId 97)

| Contract | Address |
|---|---|
| FuguPriceOracle | `0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65` |
| FuguRegistry | `0xb2f36070E6eae3353E8e755172B477DF213ae248` |
| FuguSubscription | `0xfdb083371f44Cf53181350389D3217e51B431776` |
| FuguReputation | `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400` |

131 tests including a 256-run fuzz. **The marketplace lifecycle was run on the real network**:
list an agent → rent → agent withdraws payment → review → second review rejected. The whole
cycle cost 0.0015 tBNB. The tx hash for each step is in `docs/e2e/2026-09-08-e2e-testnet.md`.

The most important thing about that cycle, and it can be checked from two view calls: the
anti-sybil gate `hasSubscribed` flips `false` → `true` **exactly when the agent actually
receives money**, not when the user subscribes.

### A2. Four agent wallets with Altana session keys registered on-chain

All four agents have their own wallet with a bounded session **registered in the Keystore**
`0x6b8361C29d05D498b1a12B54A37310f94171E94A`. Anyone can verify this without any API key at
all, with a single `eth_call`:

```bash
cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
  0x6b8361C29d05D498b1a12B54A37310f94171E94A \
  'isValidKey(address,bytes32)(bool)' \
  0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0 \
  0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377
# true
```

Agent Studio runs: `bag doctor` gives 14 PASS / 0 FAIL, `bag dev` serves A2A + MCP on `:9000`,
and a `negotiate` request is answered with a **wallet-signed quote** (0.1 U, complete with
`negotiation_hash` and `provider_sig`).

**What cannot be read from the chain:** the contents of the allowlist. The Altana account
hash-commits its `permissions`, so what is public is only the existence and validity of the
key. What proves the contents of the permissions is the denial in A4.

### A3. The Fugu Guardian strategy layer — 249 tests

`cd ai/fuguguardian/app/agent && corepack pnpm test`. 245 of them run with no network at all;
the remaining 4 (`chain.test.ts`, `testnet.test.ts`) do call an RPC and therefore partly assert
the state of the testnet, not only the state of the code.

What is in it: a pure health factor formula with rounding deliberately biased to the safe side;
a deterministic decision engine that fails hard on malformed configuration; an adapter proven
to read Aave v3 from BSC mainnet with the readings anchored to a single block; the monitoring
loop (`guard.ts`); the execution path with a spend cap and cooldown (`execute.ts`); the bridge
between USD8 units and token units (`units.ts`); the dGrid explanation layer that fails safe;
and the repay signer through an Altana session key that refuses a session whose permissions are
too loose before a single transaction is sent (`chain/session.ts`). Assembly happens in one
place, `createGuardian()` in `src/strategy/`.

**A repay cannot be sent twice.** For network sends, "failed" does not mean "did not happen": a
`waitForTransactionReceipt` that times out throws AFTER the transaction has landed. The budget,
the cooldown, and the pending repay record are therefore written **before** the transaction is
sent and **saved to file before the transaction leaves**, not after the cycle finishes. Until
that record is cleared by on-chain evidence — the debt fell **by the amount we paid**, within a
tolerance of 2 units in 8-decimal base — no new send is allowed. A user paying it themselves, a
partial liquidation, or a falling debt-asset price does not clear it. The consequence is stated
openly: a repay that genuinely never lands leaves Guardian **stopped** until an operator clears
it with `clearPendingRepay`. A silent Guardian is a visible failure.

### A4. Guardian raises a position's health factor — proven on-chain, through a bounded session key

Not a unit test. One Guardian cycle was run on BSC testnet through the composition root
`createGuardian().runOnce()`, with the repay **signed by an Altana session key**, not by the
deployer EOA. Re-run it:

```bash
cd ai/fuguguardian/app/agent && npx tsx scripts/e2e-guardian.ts
```

| | |
|---|---|
| Repay tx (`approve` + `repay`, **one atomic userOp**) | [`0x619cfbe3…`](https://testnet.bscscan.com/tx/0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc) (block 129852222) |
| `Repay.user` on the receipt | `0xbdc69c2d…` (Altana wallet) — **not** `0x56A2950d…` (deployer EOA) |
| HF before → after | **1.14 → 1.50** |
| Debt | $17.27 → $13.24 (paid $4.03) |
| Claim vs on-chain debt reduction | **0 units** in 8-decimal base (2 is the maximum allowed) |
| Session grant tx | [`0x15e67a21…`](https://testnet.bscscan.com/tx/0x15e67a21e5ec25f8459ac2e83798033ca9afe5a14b41143aeb28fe2a47b64b52) |
| Cost | 0.000041 tBNB (both sides) |

That session may call exactly **two** things: `MockLendingPool.repay(address,uint256)` and
`mUSD.approve(address,uint256)`. Cap 0.02 tBNB + 100 mUSD per day, expiring 8 October 2026.

The proof script contains **no strategy logic at all**: it imports the strategy modules as they
are and **fails with a non-zero exit code** the moment one claim is not proven against an
on-chain reading — including the claim of *how much* was paid. Every "before" and "after"
reading is anchored to its transaction's block height via an `eth_call` with an explicit
`blockNumber`, so a public RPC answering stale causes a failure rather than a number that looks
right. The failure path was also run for real (`E2E_FORCE_FAIL_AFTER_DROP=1`): exit 1, and
the testnet price was still restored by the `finally` block.

**The bound is real, and this is the decisive evidence.** The same session, moments after
successfully paying, tried `mUSD.transfer(deployer EOA, 1 wei)` and was **rejected** with
`UnauthorizedCall` — a custom error of the Altana account contract, not a validation in our
code. `mBNB.approve` was also rejected, proving the binding holds at the contract level **and**
the selector level. That test demands that the error actually contains `UnauthorizedCall` and
names the contract that was attempted; with the relay pointed at a dead endpoint, the probe
script dies with exit 1 instead of printing a check mark.

**The state file after this run** (`.studio/guardian-state.json`, gitignored) proves persistence
on the real path, not only in unit tests:

```json
{ "version": 1, "spentTodayUsd8": "403063169", "dayStartedAt": 1788880016,
  "lastActionAt": 1788880017, "killed": false, "pendingRepay": null }
```

Five earlier runs are kept as history in
`docs/e2e/2026-09-08-e2e-testnet.md` §"Session key run history" — **not used as
evidence**, because evidence about code that is no longer in use is not evidence.

**The protocol is a mock.** See §C1 — this is the most important limitation in this document
and it must not be skipped.

### A5. The other three decision engines: Rebalancer, Grid, Yield

All three have a pure decision engine + backtest + `format.ts`, with 88 / 99 / 93 tests and a
clean `tsc --noEmit`. There is no network, no `Date.now()`, and no `process.env` anywhere on
any decision path; the entire outside world arrives through arguments. Money values are in
8-decimal base, tokens in 18 decimals (including USDT on BSC), percentages in bps.

The binding thresholds are **derived, not guessed**, and a configuration that violates them
makes `decide` fail hard rather than quietly never transacting:

- **Rebalancer** — a 500 bps band **and** a 50 bps cost gate relative to turnover;
  `minEconomicTurnoverBase()` derives the minimum turnover from gas and the budget
  (`T ≥ gas × 10000 / (M − r)`), and returns `null` when the budget is impossible.
- **Grid** — the spacing between lines must be ≥ 2× the cost of one round trip, measured at the
  **upper bound** where the percentage spacing is narrowest. A $500–$700 grid with 11 lines
  passes; the same grid with 101 lines is **rejected before a single decision is taken**.
- **Yield** — `breakEvenSpreadBps = ceil(cost × 10000 × 365 / (principal × days))`, multiplied
  by a 2.00× safety factor. This threshold is **inversely** proportional to principal and
  horizon: $10,000 over 30 days requires 390 bps; a $200 principal requires 1582 bps. "Highest
  APY" is therefore not an answer.

**The backtests contradict their own author's assumptions, and that was turned into a test
named `KEJUJURAN`.** Both can be run:

```bash
cd ai/fugurebalancer/app/agent && corepack pnpm test   # backtest.test.ts:73
cd ai/fugugrid/app/agent && corepack pnpm test         # backtest.test.ts:68
```

- Rebalancer: on a $10,000 portfolio with 5% swings, **always-rebalance actually beats** the
  band ($996 vs $952 per $1,000) — the band trades away some of the volatility harvest for the
  certainty of not wasting fees, and that is not a free win.
- Grid: on a directional uptrend, **buy-and-hold beats the grid** — the grid sells the rise.

The direction of each backtest's bias is also stated at the top of its file, including the ones
that hurt its own conclusion: the Yield bias **favours** the `chaser` that loses, so its loss is
a lower bound; and risk never actually materialises in the simulation, so the risk gate — the
most important part of the Yield strategy — is **not visible in any number**.

### A6. Backend — four fallback tiers, proven live

`docker compose up` brings up three healthy containers; the API is on `:8787`. 374 tests
(`cd backend && corepack pnpm test`).

What was **verified directly in a live container**, not inferred from tests:

| What was tested | Measured result |
|---|---|
| `/api/categories` with **real** 8004scan data | REBALANCING **19**, GRID **42**, YIELD **29** — `source: scan8004`, `ageSeconds: 0` |
| `/api/health?strict=1` when everything is healthy | **HTTP 200** |
| `?strict=1` during a real 8004scan outage (intermittent 500 DATABASE_ERROR) | **HTTP 503** |
| `?strict=1` with Postgres stopped | **HTTP 503** |
| `?strict=1` after recovery | **HTTP 200** |
| `/api/agents` with Postgres down | still **HTTP 200 in 0.57 seconds** (before optimisation: 31 seconds) |
| All four tiers (scan8004 / cache / onchain / seed) | proven live by **blocking DNS**, not by changing configuration |
| `bigint` across HTTP | 30 digits and uint128-max come back identical; via `Number` they are corrupted |

Check it yourself after `docker compose up`:

```bash
curl -s localhost:8787/api/categories | head
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8787/api/health?strict=1'
docker stop fugugent-postgres && \
  curl -s -o /dev/null -w '%{http_code}\n' 'localhost:8787/api/health?strict=1'   # 503
```

Two design decisions that separate honest numbers from good-looking numbers, both born from
review findings and locked down by tests:

1. **404 is not for "we don't know".** `/api/agents/:id` returns 404 only when all four tiers
   answer empty; if the source is down it answers 200 with `healthy: false`. The earlier version
   deleted real agents from the marketplace every time upstream went down.
2. **`healthy` requires evidence that at least one REAL source works.** The seed does not count
   — it is a file inside the bundle, it cannot fail, so counting it makes `healthy` a tautology.
   With no observation → `false`.

One defect found **because** it was verified in a live container rather than in a test: the
cache health probe used to conclude "healthy" from the absence of an exception, then
**overwrite an honest line that had already admitted failure** — reporting `cache=true, age=0`
against a dead database. Reproduced 3×, and the root cause fixed (`getLatestSourceHealth`
genuinely does not throw; the probe is now a real query whose result is read).

The 4-category classification was validated against **167 real agents** from 8004scan, and that
validation found a misclassification that had passed every unit test (*Narrow Band Allocator* →
HEALTH_FACTOR 0.94). Another finding worth recording because it invalidates a planning
assumption: the OASF fields (`oasf_skills`/`oasf_domains`) are **absent** from both `GET /agents`
and the detail endpoint, and their vocabulary is entirely generic — OASF cannot pick a category,
so it is used only as a multiplier.

### A7. Marketplace (`frontend/`) and landing page (`landingpage/`)

Both build and lint green (`bun --cwd <dir> run build`, `… run lint`), with zero horizontal
scroll measured via `scrollWidth` vs `clientWidth` from 320 to 1280 px.

The marketplace has an agent list with a **URL-backed** category filter (`?category=…`, SSR,
shareable), a URL-backed detail page with a session key permission panel and an evidence list,
a rental flow with a cost estimate, a per-agent OG image, and an honest state when the backend
does not answer — tested for real by building against `http://127.0.0.1:9`: the page renders
fully, states `fetch failed` as it is, shows an empty list, and **zero fake data**.

No component calls `fetch`; every page talks to a single `MarketplaceSource` interface.
`bigint` is translated in one place (`data/wire.ts`), which **rejects `number`** for money
values.

What is deliberately **not** shown, because showing it would mean making it up: success rate,
median latency, run count, active hirers, equity charts, a live run feed, AUM/TVL/APR, star
ratings (`totalFeedbacks = 0`), a leaderboard, and guessed puff levels — the three agents with
no reading are drawn hollow and dashed with a "no live reading" chip, their identity still
readable, only their risk channel missing. The landing page also carries no link to
`app.fugugent.xyz`.

### A8. Visual identity

`docs/brand/` holds the palette, the characters, the 5-step puff scale, and the rules that are
**enforced in code**: body colour = agent identity and never changes because of risk; body
shape + ring pattern = risk. 13 SVG files in `landingpage/public/brand/`, regenerated with:

```bash
python3 docs/brand/generate-svg.py landingpage/public/brand
```

Tested in **full grayscale at 48 px**: all four characters can still be matched to their names
and all five levels stay in order, because the ring patterns do not depend on colour at all.
`frontend/src/lib/fugu.ts` is a TypeScript port of the same generator — the fish on the landing
page and the fish in the app are the same fish.

**The images are not the output of a generative model.** See §C8.

---

## B. What does NOT exist yet — do not claim it

1. **The strategy is not wired into the agent *runtime*.** The decide → execute → on-chain
   evidence chain is proven (A4), but what runs it is `createGuardian()` called by the E2E
   script — **not** the A2A/MCP agent served by `bag dev`. `dualMain.ts`, `mcpMain.ts`, and
   `tools.ts` still do not import `src/strategy/` at all (`grep -rn "strategy"
   ai/fuguguardian/app/agent/src/*.ts` finds only a comment in `model.ts`), so the agent running
   today still sends text as its deliverable. The entry point exists; the caller does not.
   → The correct sentence is: *"Guardian is proven to raise a position's HF from 1.14 to 1.50
   through an on-chain transaction signed by a bounded session key"*, not *"the agent we serve in
   the marketplace already protects your position autonomously"*.

   An honest technical note: this Guardian session **cannot** be loaded through
   `ensureAltanaSessionLoaded()`/`getWallet()` from `@bnbagent/studio-runtime` — that path
   rejects a session whose `permissions.calls` is not an exact copy of `defaultAgentPermissions()`
   (ERC-8004 + ERC-8183). This session is loaded directly via `deserializeSession` +
   `AltanaWalletProvider`. Wiring it up means resolving that difference.

2. **There is no kill switch lever a user can press.** `GuardLoopHandle.kill()` takes effect
   immediately, cannot be undone by the cycle in progress, and is persisted straight away — but
   it is **a function call inside the process**. There is no UI button, no CLI command, and no
   HTTP endpoint that calls it. The marketplace therefore also deliberately does not carry a
   Revoke button or a kill switch lever.
   → The correct sentence is: *"the kill switch has a runtime path and its state survives a
   restart"*, not *"users can stop the agent at any time"*.

3. **Rebalancer, Grid, and Yield are not wired to on-chain execution.** What exists is a pure
   decision engine + backtest (A5). Not one transaction has ever been sent by any of the three.
   As of 2026-09-09 all three **are registered in `FuguRegistry`** and can be rented
   (`listingCount() = 4`; every category holds exactly one listing). Their price is
   `5000000` = $0.05 per 120-second period, deliberately half of Guardian's, and their
   on-chain metadata carries `onchainExecution: false`. Registration transactions, all in
   block 129903555: Rebalancer
   [`0x858701b4…`](https://testnet.bscscan.com/tx/0x858701b4238910259427eda6181d5488c1d29bc72b33f3c957d58108694b29c1),
   Grid
   [`0x326c3c90…`](https://testnet.bscscan.com/tx/0x326c3c909d8e55a9b07d7886b5ef314fd652f62299d1854c687dd0f65143eafb),
   Yield
   [`0xf67c457f…`](https://testnet.bscscan.com/tx/0xf67c457f4a678dbbf0a62f101b6518ff8c2c42b83bbd2e7fe21d9b9d91683aa3).
   Being rentable is not the same as being able to act: they still send no transactions.

4. **The marketplace has never been run against a live backend.** `createHttpSource` is written
   out in full for all four endpoints, but the default is still `seedSource`; what has actually
   been tested is the seed path and the dead-API path. There is not one run proving the frontend
   displaying 110 real agents from `:8787`.

5. **There is no risk endpoint.** `bloatLevel` and the per-agent raw metrics do not exist in
   `backend/src/types.ts`. Until they do, the marketplace HTTP path draws every fugu hollow —
   honest, but it removes the core mechanic of the product.

6. **The backtests have not touched a single piece of historical price data.** What exists is a
   harness plus **synthetic** price series. There is no historical data file in the repo.
   → The correct sentence is: *"we built a harness and ran it on synthetic series"*.

7. **`DELEVERAGE` is still modelled wrongly in the Guardian backtest** — the collateral does not
   fall with it, whereas a real deleverage sells collateral. Documented prominently at the top
   of `src/strategy/backtest.ts`, not yet fixed.

8. **Venus is not connected to the decision engine.** The adapter reads `liquidity`/`shortfall`,
   but Venus provides neither a health factor nor an aggregate liquidation threshold, so building
   a `Position` from it needs per-market data that is not being fetched.

9. ~~**The contracts are not verified on BscScan.**~~ **Resolved 2026-09-09.** All four UUPS
   implementations and every mock are source-verified. BscScan recognises each proxy as a proxy
   and resolves its implementation, so the **Read/Write as Proxy** tab works — anyone can call
   the contracts from a browser with no tooling. Status confirmed through the BscScan
   `getsourcecode` API, not from a `forge` success message. See the "BscScan verification"
   section of `docs/e2e/2026-09-08-e2e-testnet.md` for the address table. The `ERC1967Proxy`
   source itself is still unverified; it is stock OpenZeppelin and is not needed for the proxy
   tab to work.

10. **There is no 8004scan API key.** The backend runs on the anonymous tier of **30
    requests/minute** (`SCAN8004_API_KEY` empty → `ANONYMOUS_RATE_LIMIT_PER_MINUTE`). All the
    category numbers in A6 were obtained on that tier.

11. **There is no scheduler and no indexer.** The backend today is a BFF + cache + classifier +
    fallback. There is no BullMQ, no periodic job, and Redis is not used on any path. The direct
    consequence: the thresholds `breakoutConfirmObservations = 3` (Grid) and
    `minConsecutiveFavorable = 3` (Yield) are tied to a scheduler cadence that is **not yet
    decided** — three observations per minute is three minutes; per day is three days.

12. **There is no connect wallet button.** In-browser signing does not exist. The rental flow
    gives `cast` commands that are exactly the calls that button would make — `quote()` to the
    oracle first, a 1% slippage cap, then `subscribe(...)` — and they can be copied and produce
    real transactions.

---

## C. Known limitations

### C1. `MockLendingPool` is our own mock pool, not a real lending protocol

This is the most important limitation in this document. `MockLendingPool`,
`MockTokenUSD`/`MockTokenBNB`, and `MockPriceFeed*` were all deployed and are all controlled by
us; the collateral price in the E2E evidence **was pushed down by us** via `setAnswer` on a feed
we own. It was deliberately made ABI-compatible with Aave v3's `getUserAccountData` so that
`readAavePosition` could be used unchanged.

The position is real, the transactions are real, the debt really did fall and the money did not
come back. **The pool is not.** Guardian has never touched Aave, Venus, or any third-party
protocol.
→ The correct sentence is: *"the read → decide → execute chain is proven to work against a pool
with an Aave v3 ABI"*, not *"Guardian has already saved a position in a real lending protocol"*.

### C2. Read on mainnet, execute on testnet — two different worlds

The adapter reads real positions on BSC mainnet because Venus and Aave only exist there; the
agent executes on testnet. A decision about a mainnet position cannot be executed on testnet.

### C3. Session key permissions do not bind argument values

Altana permissions bind **contract + selector**, not argument values. This session is therefore
technically allowed to call `mUSD.approve(<anyone>, <any amount>)`. What holds it back: the
per-token spend cap on the session; our own code, which has only ever assembled an `approve` for
the pool (gone the moment the process is hijacked); and the Porto guarded executor zeroing the
allowance at the end of the userOp — **third-party behaviour we found empirically**, not
something our contracts guarantee. Real argument binding needs an intermediary contract.

That Porto behaviour also has a hard consequence, found through one failed run: an `approve`
sent as its own transaction succeeded, and the following `repay` then reverted with
`ERC20InsufficientAllowance(allowance: 0)`. **`approve` and `repay` must be in one userOp.**

### C4. A session key denial leaves no on-chain trace

`UnauthorizedCall` appears while the relay **simulates** the userOp against the account contract;
the transaction is never broadcast. There is no block a judge can open for that denial. What a
third party can check: the error message is a custom error of the account contract (that string
does not exist in any `node_modules`), its keyHash matches our key, and no balance moved a single
wei.
→ The accurate sentence is: *"rejected by the Altana account validator while the relay simulated
it"*, not *"there is a reverted transaction on-chain"*.

### C5. The receipt does not distinguish an admin key from a session key

Both act as the same wallet, and the Orchestrator does not write the signer's keyHash into the
logs. What closes that gap, and only this far: the E2E script only ever loaded the **session
file** (the admin keystore is never opened on the repay path), and the same session was rejected
for `transfer` — whereas an admin key would never be rejected.

### C6. Two spend limits, and the stricter one binds

| Layer | Limit | Enforced by |
|---|---|---|
| `execute.ts` | $2,000/day, $1,000/action, 60-second cooldown | our code — gone if the process is hijacked |
| Session spend cap | 100 mUSD/day, 0.02 tBNB/day | the Altana account contract — survives even if the code is hijacked |

The two have not been reconciled. The consequence: a request above 100 mUSD/day will not be
refused cleanly by `execute.ts` (which thinks $2,000 is still available) — it will fail at the
relay as an error.

### C7. The remaining failure window in state persistence

The process can die after the record is saved but before the network call leaves. What is left
behind is a pending record for a transaction that never existed, and Guardian holds back until
an operator clears it. That failure direction is intentional. What does not exist yet is a
long-running process living for days on top of this store — for that, the runtime has to be
wired up first (B1).

### C8. The character images are produced as our own parametric SVGs

**Zero images were produced by a generative model.** Both image-generation MCPs in this
environment are not connected; four attempts were made and all four replied *"MCP server is not
connected"*. The assets that exist were drawn via `docs/brand/generate-svg.py`, which translates
the geometry in `characters.md` and `puff-levels.md` into shapes. The prompts in
`image-prompts.md` have **never been run** — treat them as a mature specification, not as a
proven recipe. There are no PNG files; this environment has no SVG rasterizer. A dichromatic
colour-blindness simulation has not been run either; only full grayscale.

### C9. Strategy numbers that are not yet calibrated

These are also written as `TIDAK YAKIN` comments in the respective `types.ts` files, and repeated
here so they are not read as measurements: `rebalanceBandBps = 500` was calibrated for
stock/bond portfolios, not crypto; `expectedHoldingDays = 30` is an assumption that determines
the whole behaviour of Yield; the `2.00×` multiplier in Grid and Yield is a product decision, not
a derivation; `maxPlausibleApyBps = 100_000` is a heuristic; and **the entire
`DEFAULT_COST_MODEL`/`DEFAULT_SWITCH_COST` is an estimate, not a measurement** — it must be
replaced with real numbers from the chain layer before it decides anything about money.

### C10. Trust boundaries in the contracts

- The contract owner is a trusted party: they can bypass the reputation gate via
  `setSubscriptions` or through a UUPS upgrade. Stated in the `FuguReputation` NatSpec.
- The anti-sybil gate is expensive for an **outside** attacker, but it does not stop a listing
  owner from polishing their own listing's rating, because the denominator of the threshold is
  the listing price they set themselves.
- `FuguRegistry` does not yet verify ERC-8004 token ownership in the external registry. Anyone
  can still register someone else's agent; only agentId uniqueness and the ban on self-curation
  hold it back.
- The mock pool's liquidity provider address uses a deterministic key from
  `keccak256("fugu-mock-lending-lp-testnet-seed")`. Anyone who reads the repo can withdraw that
  mock liquidity — acceptable because the tokens are worthless, and stated in a comment in the
  script.

---

## D. Claims downgraded because the evidence was insufficient

This section is the reason this document can be trusted. It records sentences that **were
written or planned**, then withdrawn once the evidence was examined.

| Claim that once stood | Why it was downgraded |
|---|---|
| "The backend, frontend, and landing page are empty" | No longer true; but the replacement is **not** "the marketplace works end to end" — see B4, the frontend has never been run against a live backend. |
| "A kill switch is available" | `killed` used to be able to become true only if it was already true before the loop started. `kill()` now exists and is persisted, but a lever a user can press still does not exist (B2). |
| "Repay through a session key" (runs 4 and 5) | The code has changed twice since. Evidence about code that is no longer in use is not evidence — the E2E was re-run, and the old runs were demoted to history. |
| "Out-of-permission calls are rejected (there is an exception)" | "There is an exception" is not evidence of permissions: a 502 relay, a receipt timeout, and a nonce race also throw. The assertion was narrowed to require `UnauthorizedCall` + the contract name, then proven to fail correctly with the relay switched off. |
| "The cache is healthy" on `/api/health` | The probe concluded healthy from the absence of an exception and overwrote an honest line that had already admitted failure. Found in a live container, not in a test. |
| "The `total` number of agents served" | It used to use `upstreamTotal`, which overstated it. `total` is now always the count of real items; `upstreamTotal` moved into the trail. |
| "`healthy: true`" when only the seed worked | The seed is a file in the bundle and cannot fail — counting it makes `healthy` a tautology. With no observation of a real source → `false`. |
| "The rebalancing band is better" | Contradicted by its own backtest on large swings, and the result was locked in as a `KEJUJURAN` test rather than hidden. |
| "Grid beats hold" | Contradicted by its own backtest on a directional trend, also locked in as a `KEJUJURAN` test. |
| "expectPartialRevert because of a forge limitation" | A reviewer tested it themselves and proved that a full match passes on the same forge — so that was a loosening disguised as a technical constraint. Replaced with a full match containing the exact HF value. |
| "89 commits" | `git log --oneline \| wc -l` answers **90**; 89 is the number of commits on top of `87508a2` "Initial commit". The number written in §Numbers states both. |

---

## Next order of work

1. Wire `createGuardian()` into the agent runtime that is served (`dualMain.ts`/`mcpMain.ts`/
   `tools.ts`), and resolve the session-loading difference along the way (B1). Give `kill()` a
   lever a user can press (B2).
2. Connect the marketplace to a live backend and prove it with one recorded run (B4).
3. The risk endpoint (`bloatLevel` + raw metrics) so the puffing fugu mechanic has data (B5).
4. Scheduler + indexer, and set `breakoutConfirmObservations`/`minConsecutiveFavorable` together
   with their cadence (B11).
5. Reconcile the read network and the execution network (C2), or state the mock clearly as a
   product boundary.
6. ~~Verify the contracts on BscScan (B9).~~ **Done 2026-09-09.**
7. On-chain execution strategy for Rebalancer, Grid, and Yield (B3).
