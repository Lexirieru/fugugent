# Technical Gate Results — run 2026-09-08

Two risks from the spec (§10, R2 and R3) were tested with a throwaway `bag init` scaffold in
the scratchpad. Both are answered; the throwaway scaffold has been deleted.

## R3 — dGrid as the Agent Studio LLM provider: ✅ WORKS

`bag init --wallet-kind altana --llm-provider openai` is **accepted** (the combination that
was rejected involves `pieverse-llm`, not this one).

But the CLI and the runtime have **no** base URL option at all — `grep base_url|baseURL`
over `studio.toml` and all of `@bnbagent/studio-runtime` found nothing.

**The way in is `app/agent/src/model.ts`**, which is our file, not the runtime's. It calls
`resolveModel()` from the runtime, but nothing forces us to use that. Proven to work:

```ts
import { createOpenAI } from "@ai-sdk/openai";

const dgrid = createOpenAI({
  baseURL: "https://api.dgrid.ai/v1",
  apiKey: process.env.DGRID_API_KEY,
  headers: { "User-Agent": "Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36" },
});
const model = dgrid.chat("openai/gpt-5.6-luna");
```

**Three things are mandatory, and each one took time to find:**

1. **`.chat()` is mandatory.** Without it, `@ai-sdk/openai` v4 uses the **Responses API**;
   dGrid answers correctly but in a leaner format, so the SDK throws
   `AI_APICallError`. `.chat()` forces Chat Completions, which both sides understand.
2. **A browser `User-Agent` header is mandatory.** Without it dGrid replies **HTTP 403** —
   exactly like 8004scan replying 500. Proven: Python `urllib` fails, `curl` with a UA
   succeeds.
3. **`@ai-sdk/openai` must be added explicitly** (`pnpm add @ai-sdk/openai`). It is only a
   transitive dependency of `ai`, and strict pnpm refuses a direct import.

Test results: text **3.3 seconds**; tool calling **11.4 seconds** with correct arguments
(`{"wallet":"0xABC","protocol":"venus"}`). dGrid latency varies from 3 to 46 seconds
depending on load — not constant, as first assumed.

## R2 — Altana SDK version conflict: ⚠️ CONFIRMED

`bag init` produces an `app/agent/package.json` that pins:
```
"@bnbagent/studio-runtime": "0.0.13"
"@bnbagent/sdk": "0.5.5"
"@altananetwork/sdk": "0.7.1"
```
Meanwhile the Altana research (docs/research/03) says ERC-8183 on testnet reverts with
`PolicyNotWhitelisted()` on SDK ≤0.8.0 and requires 0.9.0. The Studio documentation itself
states that doctor, readiness, and runtime loading **reject version drift**.

**Decision:** stay on the pinned `0.7.1`, do not force an upgrade.
- What is **required** to win the Altana track is the **session key**: the agent's own
  wallet, a session with a call allowlist + spend cap + expiry, registered in the Keystore,
  real transactions through the session key, and revoke from the UI. All of that exists in 0.7.1.
- ERC-8183 is only a **bonus**. The escrow path we use for hiring is Studio's
  `@bnbagent/sdk@0.5.5`, not the Altana ERC-8183 SDK.
- If we later go after the Altana ERC-8183 bonus, that package gets used **separately in
  `backend/`**, outside the Studio project, so its pin is not violated.

## Verified scaffold configuration

The `studio.toml` produced by `--wallet-kind altana`:
```toml
[wallet]
kind = "altana"
keystore_dir = "../../.studio/wallets"
session_file = "../../.studio/wallets/altana-session.json"

[llm]
provider = "openai"
model = "gpt-4o-mini"     # we will swap this via model.ts to openai/gpt-5.6-luna
```
The `src/` files it generates: `agentCard.ts`, `dualMain.ts`, `executor.ts`, `mcpMain.ts`,
`model.ts`, `requestLimits.ts`, `sellerCore.ts`, `signing.ts`, `tools.ts`.
