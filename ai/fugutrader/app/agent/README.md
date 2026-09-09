# fugutrader — A2A + MCP + X402 seller agent

The valuable Agent and the **SOLE key-holder/signer** for the fugutrader seller.
Serves A2A + MCP + X402 directly on AgentCore; every signing op (quote-clamp-sign /
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
bag dev                                    # A2A + MCP + X402 on http://localhost:9000
```

## Deploy

```bash
# From the workspace root:
bag deploy --provider aws
# ships to AgentCore (--protocol A2A) after a readiness sweep; the wallet
# is injected via AWS Secrets Manager, never in the package.
```
