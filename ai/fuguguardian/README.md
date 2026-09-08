# fuguguardian

A BNB Chain seller agent workspace scaffolded by `bag init` (bnbagent-studio).

- `app/agent/` — the valuable Agent + SOLE on-chain signer (TypeScript, `src/`).
- `.studio/` — secrets (encrypted keystore + .env.local); NEVER commit it.
- `bag dev` — run the agent locally; `bag doctor` — readiness checks.
- `bag deploy --provider aws` — deploy to AWS Bedrock AgentCore (uses the self-rendered `agentcore/` descriptor).

In Claude Code / Cursor, type `/bnbagent-studio` — the skill drives every step.
