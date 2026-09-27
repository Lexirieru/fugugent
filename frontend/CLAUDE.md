@AGENTS.md

# frontend — Fugugent

Next.js 16 + React 19 + Tailwind v4, package manager **bun**.

Read `../CLAUDE.md` and `../docs/specs/2026-09-08-fugugent-design.md` (§7 and §8)
before building any UI.

## Enforced UI rules

- **No dead ends.** Every empty state names an action and gives you the button for it.
  The judges test this explicitly.
- **Agent detail is a page with a URL**, not a modal. Shareable, with its own fugu OG image.
- **A cost estimate before hiring**, not merely a warning.
- **A `Hired` badge**, to stop a user paying twice.
- **Never ship a half-finished control.** Better to leave the element out
  than to show it broken.
- **Every number is verifiable** — a click leads to the tx hash on BscScan. This answers
  a real market failure: Giza/ARMA shut down in February 2026 after its dashboard showed
  a large AUM while on-chain measurement showed positions close to zero.
- **The fugu puffs up as risk grows** — the puff level is mapped from real risk metrics.

## Pages

`/` catalogue · `/agents` · `/agent/[id]` (hire, cancel, rate; id is `97:<erc8004Id>`) ·
`/me` My agents console (running hires with countdown, past hires, ratings, owned
agents) · `/list` builder path · `/skills` · `/auditors`.

## Copy

No em dashes. Few words. Anything explanatory goes behind `InfoTip` (the "i").
Fugu puff levels are risk readings: with no reading, draw the fish hollow (`level={null}`).

## E2E (Playwright, injected EIP-6963 wallet)

- `e2e/hire-flow.mjs`, `e2e/builder-flow.mjs`: on a fork, with a burner.
- `e2e/my-agents-live.mjs`: the real testnet with the deployer key read from
  `../contracts/.env` in-process. `APP=https://app.hellofugu.xyz` runs it on production;
  locally it must be `http://localhost:3000` (the only non-production origin the API's
  CORS allows). It spends a little tBNB.

## Commands

```bash
bun dev
bun run build
bun run lint
```
