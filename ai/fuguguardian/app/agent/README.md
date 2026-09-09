# fuguguardian — A2A + MCP seller agent

The valuable Agent and the **SOLE key-holder/signer** for the fuguguardian seller.
Serves A2A + MCP directly on AgentCore; every signing op (quote-clamp-sign /
submit / settle) is fixed entrypoint code in `src/signing.ts` — never an
LLM-callable tool.

## What's here

- `src/dualMain.ts` — A2A-native dual-face entrypoint on port 9000.
- `src/mcpMain.ts` — imported MCP server library mounted at `/mcp`.
- `src/executor.ts` — async A2A negotiate + notify_funded execution.
- `src/agentCard.ts` — the discoverable AgentCard (+ OAuth2/Cognito scheme).
- `src/signing.ts` — protocol-neutral signing entrypoints. ALL on-chain writes
  go through these functions — never an LLM-callable tool.
- `src/model.ts` — provider adapter (e.g. the Pieverse managed model with
  budget-gated LLM-credit auto-renew).
- `src/tools.ts` — read-only chain tools.
- `src/strategy/` — the deterministic strategy: `decide` (thresholds),
  `execute` (caps, cooldown, kill switch, pending repay), `guard` (the
  monitoring loop), `createGuardian` (the composition root). No LLM touches
  any of it.
- `src/guardianRuntime.ts` — runs `createGuardian` inside THIS process: the
  monitoring loop, the one-way kill latch, and cycle serialization.
- `src/guardianTools.ts` — the four Guardian tools, exposed on both faces.
- `src/altana.ts` — the bounded Altana session -> "send this batch". Shared by
  the runtime and by `scripts/`.
- `studio.toml` — Agent's own config (wallet, LLM, price bounds, budget).
- the wallet key material lives OUTSIDE this sub-project so deploy packaging can
  never bundle it: an evm-local keystore at the WORKSPACE root `.studio/wallets/`,
  or the twak mnemonic in the project's twak home (gitignored either way).

## Set up

```bash
# from the workspace root — installs the agent package too (pnpm workspace):
pnpm install
```

## Run locally

Run the Agent with `bag dev` from the workspace root — it auto-loads
`.studio/.env.local` and runs the agent in-process (`tsx src/dualMain.ts`, no
Docker). Use `bag dev --container` to run it via `agentcore dev` in Docker
for image parity.

```bash
bag dev                                    # A2A + MCP on http://localhost:9000
```

## The Fugu Guardian monitoring loop

Off by default. With `FUGU_GUARDIAN_ENABLED=1` the same process also runs the
health-factor loop: read position -> `decide` -> `executeDecision` -> repay
through the bounded Altana session, on an interval, with the daily budget /
cooldown / kill switch persisted to JSON.

```bash
FUGU_GUARDIAN_ENABLED=1 FUGU_GUARDIAN_INTERVAL_MS=15000 bag dev
```

| Variable | Default | Meaning |
|---|---|---|
| `FUGU_GUARDIAN_ENABLED` | off | `1`/`true`/`yes`/`on` starts the loop |
| `FUGU_GUARDIAN_INTERVAL_MS` | `60000` | cycle interval |
| `FUGU_GUARDIAN_RPC_URL` | the verified BSC testnet seed | falls back to `BSC_TESTNET_RPC_URL`; a `binance.org` host is refused (blocked from Indonesia) |
| `FUGU_GUARDIAN_POOL` | `MockLendingPool` | the pool read + repaid |
| `FUGU_GUARDIAN_REPAY_ASSET` | mUSD | the debt token |
| `FUGU_GUARDIAN_SESSION_FILE` | `.studio/wallets/altana-session-guardian.json` | the bounded session |
| `FUGU_GUARDIAN_STATE_FILE` | `.studio/guardian-state.json` | budget / cooldown / kill switch / pending repay |
| `FUGU_GUARDIAN_MAX_PER_ACTION_USD8` | `1000000000` ($10) | per-repay cap, 8-decimal basis, digits only |
| `FUGU_GUARDIAN_MAX_PER_DAY_USD8` | `5000000000` ($50) | per-day cap |
| `FUGU_GUARDIAN_MIN_INTERVAL_SECONDS` | `300` | cooldown between repays |

**A bad configuration stops the boot.** A non-positive interval, a malformed
address or cap, a per-action cap above the per-day cap, a `binance.org` RPC, a
chain that is not 97, a session allowlist looser than `repay` + `approve`, a
disabled repay asset, a feed that is not 8 decimals — every one of them exits
non-zero at start rather than turning into a log line under a healthy `/ping`.

Four tools are exposed on BOTH faces (A2A tool set + MCP `/mcp`):
`guardian_position`, `guardian_execute_state`, `guardian_run_cycle`, and
`guardian_kill_switch`. None of them takes a parameter: the action, the amount,
the thresholds, the caps and the cooldown are deterministic code. The kill
switch is **one-way** — there is no tool that clears it; an operator edits
`killed` in the state file after deciding by hand.

## Deploy

```bash
# From the workspace root:
bag deploy --provider aws
# ships to AgentCore (--protocol A2A) after a readiness sweep; the wallet
# is injected via AWS Secrets Manager, never in the package.
```
