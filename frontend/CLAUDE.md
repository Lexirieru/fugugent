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

## Commands

```bash
bun dev
bun run build
bun run lint
```
