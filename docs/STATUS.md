# Fugugent — The Actual Status

Updated 2026-09-09. This document deliberately states **what really exists and what does
not**. There is one rule: **every claim that something exists must say how someone else can
check it themselves** — a tx hash, a `cast` command, an endpoint, or a test command. Claims
that cannot be checked are not written down, even if they sound true.

The last part of this document (§D) records claims that were **downgraded** because the
evidence was insufficient. That list is kept on purpose.

---

## Numbers you can recompute

| What is measured | Number | How to check |
|---|---|---|
| Contracts (Foundry) | **200** tests | `cd contracts && forge test` |
| Fugu Guardian | **285** tests | `cd ai/fuguguardian/app/agent && corepack pnpm test` |
| Fugu Rebalancer | **130** tests | `cd ai/fugurebalancer/app/agent && corepack pnpm test` |
| Fugu Grid | **144** tests | `cd ai/fugugrid/app/agent && corepack pnpm test` |
| Fugu Yield | **141** tests | `cd ai/fuguyield/app/agent && corepack pnpm test` |
| Backend | **484** tests (1 skipped) | `cd backend && corepack pnpm test` |
| **Total** | **not recomputable on 2026-09-09 (evening)** | see the note below |
| History | **136** commits on top of the initial commit, clean working tree | `git log --oneline \| wc -l` → 137 (including `87508a2` "Initial commit"); `git status --porcelain` → empty |
| Landing + marketplace | build and lint green | `bun --cwd landingpage run build`; `bun --cwd frontend run build && … run lint` |

Every number in that table was recounted on 2026-09-09 by running the command beside it, not
carried over from a previous edit. The previous values (131 / 249 / 88 / 99 / 93 / 374 =
1,034) are wrong everywhere they still appear outside this document.

**The total is deliberately blank, and two rows above it need care.**

The contracts row is settled: **200**, counted by running `forge test` on the evening of
2026-09-09. The old **147** was already stale before that run; the suite stood at **190** on
the commit this work started from, and the category expansion added **10**: seven in
`test/CategoryUpgradeSafety.t.sol` and three more in the rewritten `test/ListAgentsScript.t.sol`.
So 147 → 200 is not "53 new tests", it is one stale number replaced by a counted one plus ten
real additions.

The backend row is **stale and currently red**. `npx vitest run` in `backend/` reports **646
tests, of which 91 fail** (554 pass, 1 skipped), and `tsc --noEmit` reports two errors
(`src/classify.ts:264`, `src/service/agents.ts:394`). The cause is known and named in B16:
`CATEGORIES` in `backend/src/types.ts` went from four entries to nine to match the contract,
and five of those nine have no classifier rules and no curated seed entry yet. Until that is
finished, adding these rows up would produce a figure wrong in two directions at once, so no
total is written.

**The landing page is `landingpage/`.** This reverses what earlier versions of this document
said, and the reversal is real rather than a correction of a mistake: there were two landing
pages for a while. The Next.js one in `landingpage-fugugent/` was the live one; the HelloFugu
redesign was then built in `landingpage/` (Vite + React + Tailwind v4), and it is the directory
the Vercel `landingpage` project deploys. `landingpage-fugugent/` was deleted on 2026-09-09 so
that only one of them can be the answer. Its brand SVGs and puff meter were already present in
`landingpage/public/`, byte for byte; nothing was lost with it.

The one skipped backend test is the real Postgres path, which only runs when
`FUGU_TEST_DATABASE_URL` is set (`skipIf`); without that variable the repositories are tested
through PGlite.

---

## A. What exists and is proven

### A1. Five UUPS contracts, live on BSC testnet (chainId 97)

| Contract | Address |
|---|---|
| FuguPriceOracle | `0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65` |
| FuguRegistry | `0xb2f36070E6eae3353E8e755172B477DF213ae248` |
| FuguSubscription | `0xfdb083371f44Cf53181350389D3217e51B431776` |
| FuguReputation | `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400` |
| FuguAuditEscrow | `0x0354d2a4be40f118e4d1301915ee2ff54eec8a52` |

200 tests including a 256-run fuzz. **The marketplace lifecycle was run on the real network**:
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

### A3. The Fugu Guardian strategy layer — 285 tests

`cd ai/fuguguardian/app/agent && corepack pnpm test`. 281 of them run with no network at all;
the remaining 4 (`strategy/__tests__/chain.test.ts`, `strategy/__tests__/testnet.test.ts`) do
call an RPC and therefore partly assert the state of the testnet, not only the state of the
code. 36 of the 285 are the runtime tests described in A9; none of the original 249 were
removed.

What is in it: a pure health factor formula with rounding deliberately biased to the safe side;
a deterministic decision engine that fails hard on malformed configuration; an adapter proven
to read Aave v3 from BSC mainnet with the readings anchored to a single block; the monitoring
loop (`guard.ts`); the execution path with a spend cap and cooldown (`execute.ts`); the bridge
between USD8 units and token units (`units.ts`); the dGrid explanation layer that fails safe;
and the repay signer through an Altana session key that refuses a session whose permissions are
too loose before a single transaction is sent (`chain/session.ts`). Assembly happens in one
place, `createGuardian()` in `src/strategy/`. What now calls it inside the served agent is
`guardianRuntime.ts` — see A9.

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

All three have a pure decision engine + backtest + `format.ts`, with 130 / 144 / 141 tests and
a clean `tsc --noEmit` (the counts include the advisory-layer tests from A10; the engines
themselves are unchanged). There is no network, no `Date.now()`, and no `process.env` anywhere on
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

`docker compose up` brings up three healthy containers; the API is on `:8787`. 484 tests
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
`app.hellofugu.xyz` (checked: no `href` to it anywhere in `page.tsx`).

The stale honesty copy recorded here earlier (*"223 tests"*, a `NOT_LIVE` list that A9, A10
and B9 had already overtaken) lived in `landingpage-fugugent/src/app/page.tsx`, which no longer
exists. The rewritten landing page in `landingpage/` carries its own honest section, and it is
the one to check from now on.

### A8. Visual identity

`docs/brand/` holds the palette, the characters, the 5-step puff scale, and the rules that are
**enforced in code**: body colour = agent identity and never changes because of risk; body
shape + ring pattern = risk. 13 SVG files in `landingpage/public/brand/`, regenerated
with:

```bash
python3 docs/brand/generate-svg.py landingpage/public/brand
```

Tested in **full grayscale at 48 px**: all four characters can still be matched to their names
and all five levels stay in order, because the ring patterns do not depend on colour at all.
`frontend/src/lib/fugu.ts` is a TypeScript port of the same generator — the fish on the landing
page and the fish in the app are the same fish.

**The images are not the output of a generative model.** See §C8.

### A9. Guardian runs its own strategy inside the agent it serves, and the kill switch can be pulled from outside the process

Two new files close what used to be B1 and B2. `guardianRuntime.ts` connects `createGuardian()`
to `dualMain.ts` and `mcpMain.ts`; `guardianTools.ts` builds the tools once for both faces.
`src/strategy/` was not rewritten — `createGuardian`, `guard.ts`, `execute.ts` and `decide.ts`
are used exactly as they are, and the loop is `startGuardLoop` from `guard.ts`, not a second
loop. The grep that used to find nothing now finds the imports:

```bash
grep -rn "strategy" ai/fuguguardian/app/agent/src/*.ts
```

It is opt-in (`FUGU_GUARDIAN_ENABLED=1`) so the other faces still boot on a machine that has no
Guardian session file. With it off, the agent boots exactly as before.

**What was run, not what is intended.** `FUGU_GUARDIAN_ENABLED=1 FUGU_GUARDIAN_INTERVAL_MS=15000
bag dev`:

- `guardian-runtime: monitoring loop started {"chainId":97,…}`, then
  `A2A native + MCP tunneled serving on 127.0.0.1:9000`;
- **five** cycles against the real BSC testnet position, 15–16 seconds apart, each one
  `action: "NONE"`, `healthFactor: "8.49"`, `sent: false`. The consecutive timestamps are what
  makes it a loop rather than a single call;
- then `monitoring loop stopped`.

**A broken configuration kills the process at boot, not at the first cycle.** Each of these was
run for real and exited 1 before any loop existed: `FUGU_GUARDIAN_INTERVAL_MS=0`; a per-action
cap above the per-day cap (*"the per-action cap would never bind"*); a mainnet RPC (*"reports
chain id 56; Guardian only runs on 97"*); a missing session file. The mainnet refusal is the
important shape — mainnet is refused **before** the loop exists.

The four tools registered on both faces take **no parameters at all**: `guardian_position`,
`guardian_execute_state`, `guardian_run_cycle`, `guardian_kill_switch`. The caller chooses
*when* a deterministic evaluation happens, never what it decides, and no LLM enters the cycle
(CLAUDE.md rule 1) — `explainDecision` is left at its default, `decision.reason` verbatim.

**The kill switch was pulled from a separate process** — an MCP client over streamable HTTP to
`http://127.0.0.1:9000/mcp`, not an in-process call and not a test harness:

| Step | Answer |
|---|---|
| `guardian_run_cycle` before the kill | `"executeReason": "Action NONE requires no transaction execution."` |
| `guardian_kill_switch` | `"killSwitchEngaged": true` |
| `guardian_run_cycle` after the kill | `"executeReason": "Kill switch engaged: execution is stopped entirely."` |
| the state file afterwards | `"killed": true` |

`executeReason` moving from the "nothing to do" rule to the kill rule is the observable evidence
that the lever reaches `executeDecision` and changes **which** rule refuses. Monitoring carried
on afterwards and kept reading `healthFactor: "8.49"` — **the kill stops spending, not
watching.** The latch is one-way: no tool and no code path in the runtime clears it, and it is
re-asserted on every loop handle the runtime ever creates.

Cycles are serialized on purpose. `Guardian.start()` and `Guardian.runOnce()` hold
`ExecuteState` **separately**, so a tool cycle running beside the loop would read the same
budget, the same cooldown and the same `pendingRepay: null` — and **both would send**, a double
payment produced by the wiring alone. An out-of-band cycle is therefore REFUSED
(`GuardianBusyError`) rather than queued, and the loop is stopped but never dropped while one
runs, so `kill()` has no blind window.

That demo deliberately ran against a scratch state file, so the real
`.studio/guardian-state.json` still reads `killed: false` and the A4 evidence is not left
blocked.

**What this does NOT prove, and it is the limit that matters.** It does not prove the kill
switch stops a real **send**. The live position sits at HF 8.49 ($150.00 collateral, $13.24
debt), so the cycle after the kill would have answered `NONE` regardless. That a kill actually
prevents a send is proven **only in unit tests** — an EMERGENCY position, a control run in
which `sendCalls` is called once, and a killed run in which it is never called. The testnet
price was deliberately **not** pushed down to manufacture an emergency: that spends real tBNB
and mutates shared testnet state the A4 evidence depends on.
→ The correct sentence is: *"a user can pull the kill switch from outside the process and the
next cycle refuses on the kill rule"*, not *"the kill switch is proven to have stopped a repay
that was about to go out"*.

Two more things it does not prove: **no repay has ever been sent through the runtime on chain**
(there is no new transaction hash — the session-key send path is unchanged and still rests on
A4's `0x619cfbe3…`), and the **AgentCore deploy is unverified** — all of the above is a local
`bag dev`, and `bag doctor` still warns about missing AWS credentials.

One technical note from B1 survives as a resolved note rather than an open problem: this session
still **cannot** be loaded through `ensureAltanaSessionLoaded()`/`getWallet()` from
`@bnbagent/studio-runtime`, which rejects any session whose `permissions.calls` is not an exact
copy of `defaultAgentPermissions()`. The runtime loads it directly via `deserializeSession` +
`AltanaWalletProvider` in `src/altana.ts`, which is now shared by the runtime and the E2E script
instead of being duplicated.

### A10. Rebalancer, Grid and Yield can be called — and they answer with advice, not with actions

All three used to hold a complete decision engine that **nothing imported**: `dualMain.ts`,
`mcpMain.ts` and `tools.ts` were byte-for-byte the Agent Studio scaffold, so someone could rent
them (B3) and get nothing callable. Each package gained one file, `src/advisory.ts`, sitting
between an untrusted JSON payload and the engine. `src/strategy/` was not touched; it stays
pure.

| Agent | A2A skill = MCP tool = LLM tool |
|---|---|
| Rebalancer | `rebalance_advisory`, `rebalance_thresholds` |
| Grid | `grid_advisory`, `grid_feasibility` |
| Yield | `yield_advisory`, `yield_breakeven` |

All three were started with `npx tsx src/dualMain.ts` and probed live over **both** faces: the
A2A agent card at `GET /.well-known/agent-card.json`, and `tools/list` over the real
StreamableHTTP `/mcp` endpoint rather than the in-memory test transport. Malformed input comes
back classified — `AdvisoryInputError` for the wrong shape, the engine's own `PortfolioError` /
`GridError` / `YieldError` for a well-formed but impossible one — instead of the commerce path's
generic "seller operation failed; retry later". Grid's `state` and Yield's
`consecutiveFavorable` are required and never defaulted: a guessed `lotsHeld: 0` would answer
about a grid nobody runs.

**Callable is not the same as capable. There is still no on-chain execution — see B3.** Every
payload carries `onchainExecution: false`, `executionPerformed: false` and `advisoryOnly: true`;
every tool and skill description opens with "ANALYSIS ONLY" and states "THIS TOOL DOES NOT
TRADE" / "DOES NOT MOVE FUNDS" on the agent card, where a buyer reads it **before** paying.
Field names are advice-shaped (`recommendedAction`, `suggestedTrades`, `valueThatWouldMove`,
`nextStateIfActedOn`) and there is no `trades`, `fills`, `executedTrades` or `newPosition` key —
asserted negatively. A regex sweep per package asserts that no payload, including the ones that
recommend acting, matches `tx_hash`, `broadcast`, `submitted`, `executed`, `filled`, `withdrew`,
`deposited` or "has been …".

**The decision worth showing is each engine refusing to act.** All three came out of live runs
over A2A or MCP:

| Agent | Answer | The sentence it gave |
|---|---|---|
| Rebalancer | `BLOCKED_BY_COST` | "moving $10.00 would spend $0.31, which is 315 bps of the value moved — beyond the 50 bps budget." |
| Grid | `profitable: false` | "narrowest spacing 28 bps, round trip costs 130 bps, requires 260 bps." |
| Yield | `STAY` / `SPREAD_BELOW_BREAKEVEN` | "spread 200 bps, required 390 bps at a $16.00 migration cost over 30 days." |

An agent that answers "no, this loses money" is the product working, not the product failing.
The default cost models behind those numbers are still estimates and not measurements (C9); the
payloads say so in their own `costModel.why` field rather than hiding it.

### A11. The catalog holds nine categories, and the widening did not disturb the four that were already there

`Category` in `contracts/src/types/FuguTypes.sol` grew from four values to nine on 2026-09-09.
The five new ones were **appended** after `HEALTH_FACTOR`: `HIRING` 4, `COMMERCE` 5,
`AUTONOMOUS` 6, `STREAMING` 7, `TREASURY` 8. Indices 0 to 3 did not move, and that is the whole
risk of this change: a `Category` is stored inside every listing as its number, an upgrade
replaces code and never rewrites storage, so reordering the enum would silently relabel every
listing that already exists. Nothing would revert and nothing would warn.

| | |
|---|---|
| Proxy | `0xb2f36070E6eae3353E8e755172B477DF213ae248` (unchanged) |
| Implementation before | `0xd68968cf68e9930a689e0fc9d648a898050a548a` |
| Implementation after | [`0x13836c1b…`](https://testnet.bscscan.com/address/0x13836c1bc0d32def6b6c0ec2acf120c2f342f3eb#code), source-verified |
| Implementation deploy tx | [`0xfa3d5106…`](https://testnet.bscscan.com/tx/0xfa3d51060328db38a268de78705b01e9c876fa062651a55aaa4d92d514112176) |
| Upgrade tx | [`0x24438b39…`](https://testnet.bscscan.com/tx/0x24438b39a85ceeb9411d1cb4197ea8369eb1d1a44c3213656a43cf32c4050c5f) (block 130002412, 37,649 gas) |
| `INIT_DATA` | empty, deliberately. The widening adds no state variable, so there is no reinitializer to run |

**Three pieces of evidence, none of which is an assumption.**

1. *The upgrade was actually needed.* Before it, `countByCategory(4)` on the live proxy
   reverted with empty data, because 4 is out of range for a four-value enum. After it, the
   same call answers a number. That is also why `ListAgents.s.sol` probes for the highest
   category before it spends anything.

2. *No existing listing changed.* All four listings were read with `getListing` before the
   upgrade and again after the upgrade **and** after five more registrations. The two outputs
   are byte for byte identical, metadata string included, and `countByCategory(0..3)` is still
   1 each. Repeat it:

   ```bash
   for i in 1 2 3 4; do
     cast call --rpc-url "$BSC_TESTNET_RPC_URL" 0xb2f36070E6eae3353E8e755172B477DF213ae248 \
       'getListing(uint256)((uint256,address,address,uint8,uint128,uint32,bool,bool,string))' $i
   done
   ```

3. *A test that fails if anyone reorders the enum later.*
   `contracts/test/CategoryUpgradeSafety.t.sol` does not compare the new code against itself,
   which would prove nothing. It deploys a proxy over `test/legacy/FuguRegistryLegacy.sol`, a
   **frozen copy of the pre-expansion source** with its own four-value enum, registers one
   listing per old category through that old code, upgrades the proxy to today's implementation,
   and reads everything back against hard-coded indices. Proved by mutation: moving `HIRING`
   in front of `HEALTH_FACTOR` turns four of its seven tests red
   (`test_oldListingsKeepTheirCategoryAfterUpgrade` fails with `3 != 4`), and moving it back
   turns them green.

The catalog now holds **nine listings, one per category**. `listingCount()` is 9 and
`countByCategory` is 1 for every value 0 through 8. The five newest are Broker (5), Trader (6),
Pilot (7), Meter (8), Steward (9), all registered in block 130003272 for 5,342,324 gas in total,
at $0.05 per 120-second period. Addresses, wallets, and one tx hash per listing are in
`docs/setup/ENVIRONMENT.md` §G3 and `contracts/deployments/bsc-testnet.json`.

**What that does NOT mean:** five categories being full is not five agents working. Listings 5
to 9 were registered before their code existed, and each one says so on chain. See B16 and B17.

---

## B. What does NOT exist yet — do not claim it

1. ~~**The strategy is not wired into the agent *runtime*.**~~ **Resolved 2026-09-09** — see A9.
   `dualMain.ts` and `mcpMain.ts` now reach `createGuardian()` through `guardianRuntime.ts` and
   `guardianTools.ts`, the loop was watched running five real BSC testnet cycles, and a broken
   configuration kills the process at boot with exit 1. The session-loading difference noted
   here was resolved by loading the session directly in `src/altana.ts` rather than through
   `ensureAltanaSessionLoaded()`.
   What is still true and must not be dropped: **no repay has ever been sent through the
   runtime.** The only on-chain repay Guardian has ever made is the one in A4, sent by
   `scripts/e2e-guardian.ts`. The live loop has only ever answered `NONE`.

2. ~~**There is no kill switch lever a user can press.**~~ **Resolved 2026-09-09, with one limit
   that has to be stated every time** — see A9. An MCP client in a **separate process** calls
   `guardian_kill_switch` over `http://127.0.0.1:9000/mcp`, the next cycle refuses with
   `"Kill switch engaged: execution is stopped entirely."`, `killed: true` is persisted, and the
   monitoring loop keeps reading the position.
   **The limit:** it is *not* proven that the kill stops a real **send**. The live position was
   at HF 8.49, so that cycle would have decided `NONE` regardless — what the live run proves is
   that the lever reaches `executeDecision` and changes which rule refuses. That a kill prevents
   a send is proven **only in unit tests** (an EMERGENCY position, a control run that sends and
   a killed run that does not). The testnet price was deliberately not manipulated to force the
   real case.
   Still absent: a **UI** lever. The marketplace has no kill switch button and no Revoke button;
   what exists is an MCP/A2A tool, which is a lever for a client, not for a person in a browser.

3. **Rebalancer, Grid, and Yield are not wired to on-chain execution. This is still open, and
   only half of it moved.** They are now **callable**: `rebalance_advisory` /
   `rebalance_thresholds`, `grid_advisory` / `grid_feasibility`, `yield_advisory` /
   `yield_breakeven`, all six exercised live over A2A **and** MCP (A10). They **cannot act**.
   Not one transaction has ever been sent by any of the three, and that is a deliberate boundary
   rather than an unfinished edge: there is no mock DEX, and building one was not part of the
   work. Every payload carries `onchainExecution: false` and `executionPerformed: false`, every
   tool description opens with "ANALYSIS ONLY … DOES NOT TRADE", and a regex sweep per package
   asserts no payload claims a transaction.
   → The correct sentence is: *"they can be called and they give advice"*, not *"they manage a
   portfolio"* and not *"they trade"*.
   As of 2026-09-09 all three **are registered in `FuguRegistry`** and can be rented
   (`listingCount()` was 4 then and is 9 now; every category holds exactly one listing). Their price is
   `5000000` = $0.05 per 120-second period, deliberately half of Guardian's, and their
   on-chain metadata carries `onchainExecution: false`. Registration transactions, all in
   block 129903555: Rebalancer
   [`0x858701b4…`](https://testnet.bscscan.com/tx/0x858701b4238910259427eda6181d5488c1d29bc72b33f3c957d58108694b29c1),
   Grid
   [`0x326c3c90…`](https://testnet.bscscan.com/tx/0x326c3c909d8e55a9b07d7886b5ef314fd652f62299d1854c687dd0f65143eafb),
   Yield
   [`0xf67c457f…`](https://testnet.bscscan.com/tx/0xf67c457f4a678dbbf0a62f101b6518ff8c2c42b83bbd2e7fe21d9b9d91683aa3).
   Being rentable, and now being callable, is still not the same as being able to act: they send
   no transactions.

4. **The marketplace has been pointed at a live backend once, by hand, and that run was not
   recorded.** Narrowed on 2026-09-09, not closed. `createHttpSource` is written out in full for
   all four endpoints and the default is still `seedSource` (`NEXT_PUBLIC_API_BASE_URL` unset →
   seed, `frontend/src/lib/data/index.ts`). What is automatically tested is still only the seed
   path and the dead-API path. One manual browser session against a live backend on `:8787` is
   reported in `.superpowers/sdd/naming-fix-report.md` — the list page served the live catalogue
   and the detail page fell back to seed — but **no artifact of that session exists in the
   repo**; screenshot capture was blocked in that environment. A report of a run is not a run
   anyone else can check, so the claim stays here rather than moving to §A.
   → The correct sentence is: *"the HTTP source has been exercised once by hand"*, not *"the
   marketplace runs on the live backend"*.

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

9. ~~**The contracts are not verified on BscScan.**~~ **Resolved 2026-09-09.** All five UUPS
   implementations and every mock are source-verified, including the new `FuguRegistry`
   implementation deployed for the category expansion
   ([`0x13836c1b…`](https://testnet.bscscan.com/address/0x13836c1bc0d32def6b6c0ec2acf120c2f342f3eb#code)). BscScan recognises each proxy as a proxy
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

12. **A hire has now been signed, but not from the browser.** Two claims used to sit in this
    item and only one of them has moved, so they are separated here on purpose.

    **Closed:** *"no hire has ever been signed, because no wallet here holds tBNB"*. On
    2026-09-09 a hire was signed and landed:
    [`0x74fa4d9d…`](https://testnet.bscscan.com/tx/0x74fa4d9d67daea5c722f2dbc9fd1f43d7e5725d621c412e079085c7c856fe8ac),
    block 130003006, 498,652 gas, status 1. Read back from chain rather than from the receipt:

    ```bash
    cast call --rpc-url "$BSC_TESTNET_RPC_URL" 0xfdb083371f44Cf53181350389D3217e51B431776 \
      'getSub(uint256)((uint256,address,address,uint256,uint256,uint64,uint64,bool,uint16))' 2
    # (1, 0x9F594C130cADB4a928C86f1AFe85C6888892494e, 0x0000…0000, 665249242281113, 0,
    #  1788947875, 1788948475, false, 500)
    ```

    Subscription 2 is on listing 1 (Fugu Guardian, HEALTH_FACTOR), paid in **native tBNB**
    (`payToken` is the zero address), 665,249,242,281,113 wei deposited. Listing 1 costs $0.10
    per 120-second period, so that is five periods, $0.50, converted to tBNB by
    `FuguPriceOracle` at the moment of the call. `feeBps` is 500: the 5% comes out of the
    agent's payout when it claims, it is not added on top of the deposit. The escrow contract
    holds the whole amount.

    **Still open, and it is not a detail:** that signature came from `cast send` in a terminal,
    **not from a button in the browser**. The wagmi/Reown path in `frontend/` has still never
    signed a real hire. `frontend/src/components/wallet/` holds a Reown AppKit connect control
    and a `hire-action.tsx` that reads the price from `FuguRegistry`, refetches the quote, caps
    `maxAmount` at quote + 1%, sets a block-time deadline and simulates before opening the
    wallet, all gated on `NEXT_PUBLIC_REOWN_PROJECT_ID`. None of it has been exercised against
    a real signature. "A hire has been signed" and "a hire has been signed from the marketplace"
    are two different claims and must not be merged into one.

    Two more things that must not be smoothed over. The subscriber wallet
    `0x9F594C130cADB4a928C86f1AFe85C6888892494e` was created with `cast wallet new` for this
    purpose and funded with 0.02 tBNB from the deployer; it is not a real user's wallet. And
    `claimed` is **0**: the money sits in escrow and no agent has withdrawn any of it, so nobody
    may write that the agent has been paid.
    → The correct sentence is: *"one hire has been signed from a terminal and the money is in
    escrow"*, not *"you can hire an agent from the marketplace"* and not *"the agent has been
    paid"*.

13. **Listing 1's on-chain `agentWallet` is the deployer EOA, not Guardian's Altana wallet.**
    Check it with one call:

    ```bash
    cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
      0xb2f36070E6eae3353E8e755172B477DF213ae248 \
      'getListing(uint256)((uint256,address,address,uint8,uint128,uint32,bool,bool,string))' 1
    # agentWallet = 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E  (deployer EOA)
    ```

    The wallet that actually signs is `0xbdc69c2d…` (A2/A4). The listing's base64 metadata
    declares that Altana wallet and states the disagreement in its own `limits` field, but the
    struct field itself still holds the EOA, because `updateListing` cannot touch `agentWallet`
    and `FuguRegistry` has no setter for it — only a **new** listing could fix it, which would
    double the HEALTH_FACTOR category count. Anyone reading the chain alone will link Guardian's
    activity to the wrong address. `contracts/test/UpdateGuardianMetadataScript.t.sol` asserts
    the disagreement on purpose so it cannot be silently "fixed".

14. **Listing 1's on-chain metadata now carries stale claims of its own.** Its `limits` string
    still reads *"not yet wired into the A2A/MCP runtime the agent serves … and there is no
    user-facing kill switch"* and its `verify` string still says *"249 tests"*. A9 replaced both.
    Nobody has re-run `UpdateGuardianMetadata` since, so the chain is currently more pessimistic
    than the repo — which is the safe direction to be wrong in, but it is still wrong.

15. **There is no public deployment.** The backend and agents are meant for a VPS and the
    frontend for Vercel; neither has happened, and nothing answers on any domain. A landing
    domain has been purchased and **nothing is deployed to it** — do not expect a site there.
    One thing that cannot be settled from inside this repo: the domain name itself. `README.md`
    and the root `CLAUDE.md` say `hellofugu.xyz`; `docs/setup/ENVIRONMENT.md`, the rest of
    `docs/`, and the shipped code (`landingpage/index.html`,
    `frontend/src/app/layout.tsx`) all say `hellofugu.xyz`. Which one is actually registered is
    not verifiable here, and this document will not guess. Either way the answer to "is it
    live?" is no.

16. **The backend does not know the five new categories yet, and its test suite is red because
    of it.** `CATEGORIES` in `backend/src/types.ts` was widened to nine so it keeps matching the
    contract enum, which is the only ordering that can be correct. Nothing else in the backend
    was widened with it, and TypeScript caught exactly where:

    - `src/classify.ts:264` — `RULES` is a `Record<Category, Rule[]>` and has no entry for
      `HIRING`, `COMMERCE`, `AUTONOMOUS`, `STREAMING`, `TREASURY`. At runtime
      `RULES[category]` is `undefined` and `classify()` throws.
    - `src/service/agents.ts:394` — another exhaustive `Record<Category, string>`, same five
      keys missing.
    - `src/service/seed.ts` — the curated seed holds four agents, so the promise that the
      marketplace is never empty is now only kept for four of nine categories.

    Measured, not guessed: `cd backend && npx vitest run` gives **91 failed / 554 passed /
    1 skipped**, in `classify.test.ts`, `agents.routes.test.ts`, `service/agents.test.ts` and
    `service/seed.test.ts`; `npx tsc --noEmit` gives the two errors above. Until this is
    finished the marketplace can serve the five new listings only through the on-chain read,
    and `/api/categories` cannot answer for them at all.

17. **The five new agents can be rented and can do nothing.** Broker, Trader, Pilot, Meter and
    Steward are listed on chain (A11), and that is the entire extent of them. At the moment
    they were registered there was no code in `ai/fugubroker`, `ai/fugutrader`, `ai/fugupilot`,
    `ai/fugumeter` or `ai/fugusteward`; there is no test suite to quote, no decision engine, no
    backtest, and not one of the five wallets has ever signed anything. Their on-chain metadata
    says exactly that: `implemented: false`, `onchainExecution: false`, a `limits` string
    beginning *"Not built yet"*, and a `verify` command that shows the absence rather than
    quoting a test count. Renting one today holds the money and starts nothing.
    → The correct sentence is: *"nine categories are listed"*, never *"nine agents work"*.

18. **The five new agent wallets were created before their agents, and the chain cannot be
    corrected if the agent teams generate different ones.** `agentWallet` is written once by
    `list()`: `FuguRegistry` has no setter for it and `updateListing` does not reach it. The five
    directories held no wallet at registration time, so five brand-new testnet EOAs were
    generated with `cast wallet new`, written into the listings, and their keys kept in
    `contracts/.env` (gitignored, unfunded, never used anywhere else). The addresses are in
    `docs/setup/ENVIRONMENT.md` §G3. Whoever builds one of these agents has to **adopt** its
    address (`bag wallet new --private-key -`) rather than generate a fresh one. If they
    generate a fresh one, the listing points at a wallet the agent does not use, permanently,
    exactly like listing 1 already does (B13). Only the metadata could then carry the real
    address, because metadata is the one field still changeable.

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
an operator clears it. That failure direction is intentional. What still does not exist is a
long-running process living for days on top of this store: the runtime is wired up now (A9), but
the longest observed run is five cycles over about 75 seconds, and none of them sent anything.
Day-boundary rollover, a session expiring under a running loop, and a real pending repay
surviving a restart have all only been exercised in tests.

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
| "89 commits" | `git log --oneline \| wc -l` answers **90**; 89 is the number of commits on top of `87508a2` "Initial commit". The number written in §Numbers states both. That whole row is now stale in the other direction — it reads 136/137 as of this edit. |
| "The kill switch works" (2026-09-09) | It can be pulled from outside the process and the next cycle refuses on the kill rule — but the position was at HF 8.49, so that cycle would have refused anyway. "It stops a send" was narrowed to a unit-test claim (A9, B2). |
| "Rebalancer, Grid and Yield are wired up" (2026-09-09) | They are *callable*, not *capable*. B3 was rewritten rather than closed: six tools answer over A2A and MCP, and not one of them can send a transaction. |
| "The marketplace runs against the live backend" | One manual browser session is reported, with no artifact left in the repo. A report of a run is not a run anyone else can check, so it stayed in §B (B4). |
| "There is no connect wallet button" | Stale in the *other* direction: the button and the whole signing path now exist. The honest replacement is not "you can hire an agent" but "no hire has ever been signed, because no wallet here holds tBNB" (B12). |
| "No hire has ever been signed" | Closed on 2026-09-09 by tx `0x74fa4d9d…`, read back as `getSub(2)`. What replaces it is narrower, not wider: the signature came from `cast send` in a terminal, the subscriber wallet was made for the occasion, and `claimed` is still 0. The browser path remains unproven (B12). |
| "The landing page is `landingpage-fugugent/`" | True when written, and no longer: the HelloFugu redesign was built in `landingpage/`, that is what the Vercel project deploys, and `landingpage-fugugent/` was deleted on 2026-09-09. A directory that used to be right is the easiest kind of stale claim to miss. |
| Guardian listing metadata: "no user-facing kill switch", "249 tests" | Still what the chain says. The repo moved and the on-chain string did not; recorded as B14 rather than quietly corrected here. |

---

## Next order of work

1. ~~Wire `createGuardian()` into the agent runtime that is served, and give `kill()` a lever a
   user can press (B1, B2).~~ **Done 2026-09-09 (A9).** What is left from it: force the
   EMERGENCY case on testnet so the kill switch is proven to stop a real send, and send one
   repay **through the runtime** so A4's evidence stops being the only on-chain repay.
2. Sign one hire **from the browser** (B12). A hire has now been signed on chain, but with
   `cast send` from a terminal; the wagmi/Reown path still needs a Reown project id and a
   funded wallet in a browser. After that, have the agent `claim` so `claimed` stops being 0.
3. Connect the marketplace to a live backend and prove it with one **recorded** run (B4).
4. The risk endpoint (`bloatLevel` + raw metrics) so the puffing fugu mechanic has data (B5).
5. Scheduler + indexer, and set `breakoutConfirmObservations`/`minConsecutiveFavorable` together
   with their cadence (B11).
6. Reconcile the read network and the execution network (C2), or state the mock clearly as a
   product boundary.
7. ~~Verify the contracts on BscScan (B9).~~ **Done 2026-09-09.**
8. On-chain execution for Rebalancer, Grid, and Yield (B3) — which means a mock DEX first, and
   that decision has not been taken.
9. Re-run `UpdateGuardianMetadata` so listing 1 stops advertising limits that no longer apply
   (B14), and decide whether a new listing is worth it to fix `agentWallet` (B13).
10. Teach the backend the five new categories so its suite goes green again (B16): classifier
    rules in `src/classify.ts`, the label map in `src/service/agents.ts`, and five curated seed
    entries in `src/service/seed.ts`. This is the one item blocking a recomputable test total.
11. Build the five agents that are listed but empty (B17), and have each one adopt the wallet
    its listing already names (B18) instead of generating a new one. Then run `updateListing`
    on listings 5 to 9 so their metadata stops saying "Not built yet".
