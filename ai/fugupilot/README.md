# Fugu Pilot

Acts inside limits that cannot be exceeded. It rebalances what you hold, puts idle money to
work, and can copy somebody else's trade at a size you set. Every one of those goes through
the same two sets of limits, and the second set is enforced by the blockchain rather than by
this code.

Listed on the marketplace as listing 7, category `AUTONOMOUS`, wallet
`0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D`.

## What is honestly true today

- The deciding is finished, deterministic and tested. Give it what you hold and your standing
  instructions and it produces the same plan every time.
- The limits are finished and tested: a limit per step, a limit per day, a wait between
  steps, a stop switch, and a record that survives a restart.
- **Nothing has been sent on the blockchain yet.** The function that would send is handed in
  from outside and there is no real one wired up. Fugu Guardian is still the only agent in
  this repo that has moved real money, and its page says so.
- There is no wallet file and no limited key for this agent yet. The address above is already
  written into the marketplace listing and cannot be changed, so the existing key has to be
  adopted rather than a new one made.

## Which places it can actually reach

The product names four protocols. Three of them answer on BNB Chain testnet and one does not.
`src/strategy/venues.ts` records what was read back from each, and the code refuses to plan
anything on a place that was not proven to answer.

| Place | State | How it was checked, on 2026-09-09, chain id 97 |
|---|---|---|
| PancakeSwap v3 | works | Its position manager names the same factory this list does, and that factory returns a real trading pool for WBNB against USDT which answers with a live price. |
| Venus | works | Its market for BNB names the same controller this list does, calls itself vBNB, and the borrowing side answers for an address with nothing in it. |
| Lista liquid staking | works | The token's own supply times the manager's own exchange rate comes to the manager's own total, to within 3753 of the smallest unit there is. Two contracts that were never asked about each other agree. |
| Aave v3 | not there | The address Aave uses on BNB Chain proper has no code at all on the test network, and neither does the address it uses on several other networks. There is no Aave market here to act on. |
| Lista lending | not checked | Only Lista's staking side was proven. No lending address was found and confirmed, and not checked is treated exactly the same as missing. |

Fugu Guardian met the same gap and answered it with a small lending pool of our own. Pilot
does not pretend otherwise: ask it to act on Aave and it refuses and says why.

## Running it

```bash
pnpm install --no-frozen-lockfile
pnpm --filter fugupilot-agent test
pnpm --filter fugupilot-agent typecheck
```

`--no-frozen-lockfile` is not a workaround here. This package's lockfile was made from its own
`package.json` in the same commit, so the frozen check passes for it; the flag is written down
because the four older agents in this folder have lockfiles that do not match theirs.

## Where things are

| File | What it holds |
|---|---|
| `src/strategy/venues.ts` | The list above, and the refusal that makes it real. |
| `src/strategy/decide.ts` | The planner. Pure, deterministic, never a model. |
| `src/strategy/execute.ts` | The limits, and why a failed send still counts. |
| `src/strategy/session.ts` | The three checks on the limited key before anything is sent. |
| `src/strategy/guard.ts` | The cycle and the loop, with the stop switch. |
| `src/strategy/state/store.ts` | What survives a restart, and why damage stops the agent. |
| `src/strategy/identity.ts` | The wallet in its listing, which cannot be changed. |

`session.ts` is deliberately the same file in all three of the new agents. They are separate
packages with no shared workspace between them, so the choice was a copy or an early shared
package. The copy is the honest one for now, and the duplication is written here rather than
left to be discovered.
