# Fugugent — Brainstorming Decisions (Locked)

Date: 2026-09-08
Status: initial decisions from the brainstorming session, before the final design doc.

## Product
- **Name**: Fugugent. Domain: `fugugent.xyz`
- **UX benchmark**: hellominds.ai
- **Visual identity**: every agent is a cartoon fugu fish character, with several
  expression states (idle, working, alert, profit). Assets are generated.

## Locked decisions
| # | Topic | Decision |
|---|-------|-----------|
| 1 | 4 priority agents | Exactly the 4 categories required by the main track, skinned as fugu characters: Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring |
| 2 | Track scope | Go after all of them: Main + Altana + TermiX + PancakeSwap |
| 3 | Marketplace content | Hybrid — index live agents (8004scan / Agent Studio) + 4 first-party Fugu agents as the flagship that can actually be hired |
| 4 | Custody / execution | Altana session key, non-custodial. One wallet per agent, a limited session (call allowlist + spend cap + expiry), registered in the on-chain Keystore, 1-click revoke from the UI |
| 5 | Network | BSC **testnet** (chainId 97) for the DeFi agents and smart contracts |
| 6 | Monetisation | Two paths: subscription + on-chain escrow for the 4 DeFi agents; x402/b402 pay-per-call for agent-to-agent data/research services |
| 7 | Stack | Full TypeScript — Hono/Fastify + Postgres + Redis + BullMQ; viem for chain access |
| 8 | Infra | VPS, Docker Compose + Caddy (automatic TLS), domain already owned |
| 9 | Smart contracts | Upgradeable (proxy). Foundry + OpenZeppelin upgradeable (already in `contracts/lib`) |
| 10 | LLM | **dGrid** — `https://api.dgrid.ai/v1`, an OpenAI-compatible gateway to 200+ models |

## Work order priority
1. Smart contracts (upgradeable, proxy)
2. AI / agent runtime
3. Backend (indexer, API, scheduler)
4. Frontend marketplace
5. Landing page

## Initial dGrid findings (verified)
- OpenAI-compatible gateway, 200+ models, endpoint `POST /v1/chat/completions`
  (docs: https://docs.dgrid.ai/)
- Free router: model id `dgridai/free` — 10 req/min, 100 req/day (rises to 20/min,
  1000/day after topping up ≥ $5). The underlying model changes from request to request,
  so do not rely on it for specific model behaviour.
  (docs: https://docs.dgrid.ai/ai-gateway/free-models-router.md)
- Supports tool calling, streaming, embeddings, image gen, TTS/transcription, moderation.
- **x402 native on BSC**: network `eip155:56`, payment token **USD1**
  `0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d`. Flow: a request without the `x-payment`
  header → `402 Payment Required` + payment requirements → the client signs → retry with
  the `x-payment` header. (docs: https://docs.dgrid.ai/x402/overview.md)
  → Big implication: **a Fugu agent can pay for its own inference costs** out of its own
  Altana wallet. That satisfies the Altana bonus track (x402) and strengthens the
  "sovereign agent" story. Note: this x402 path is on **BSC mainnet**, while our DeFi
  agents are on testnet — we have to decide whether the inference payment path runs on
  mainnet with small amounts.

## Toolchain verified on the machine
node v24.10.0 · bun 1.3.9 · forge/cast 1.7.1 · Python 3.14.4 · Docker 29.4.0 · darwin arm64
Already present: `contracts/lib/{forge-std, openzeppelin-contracts, openzeppelin-contracts-upgradeable}`,
`frontend/` & `landingpage/` = Next.js 16.3.4 + React 19.2.8 + Tailwind v4 (bun).
`backend/` and `ai/` are still empty.

## Open questions (to be answered once research is done)
- Does BNB Agent Studio have a public discovery API for listing live agents on BSC?
- Do the Fugu agents have to be built ON TOP OF the Agent Studio CLI (main track
  requirement: "agents surfaced on your marketplace must be live on BSC")?
- The Altana Keystore contract address on BSC testnet.
- Whether dGrid's x402 is available on BSC testnet or only on mainnet.

## dGrid test results (2026-09-08)
Model chosen: **`openai/gpt-5.6-luna`** (cheap).
- Tool calling: **supported**, arguments generated correctly.
- Latency: **30–46 seconds** for short prompts, consistent across attempts
  (not a cold start).

**Implication:** this model must NOT sit on an agent's critical path. This validates
decision #13 (financial decisions are deterministic, the LLM is only for explanations
and research): explanations are produced asynchronously after the action has been
executed, so 45 seconds of latency never delays protecting a user's position.
