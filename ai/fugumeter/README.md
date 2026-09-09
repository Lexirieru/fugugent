# Fugu Meter

Pays per call, per second, per unit, with nobody approving each payment one at a time. That
last part is the whole product and also the whole danger: a person approving each payment is
a check that catches almost everything, and taking it away means every other check has to be
written down and tested, because there is nothing else left.

Listed on the marketplace as listing 8, category `STREAMING`, wallet
`0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8`.

## What is honestly true today

- The counting, the pricing and the limits are finished, deterministic and tested. The same
  use over the same stretch of time always produces the same bill.
- The mark of what has already been billed is written to disk before a payment goes out, so a
  process killed mid payment comes back and refuses rather than paying again. There is a test
  that kills it at exactly that point, through a real file.
- **Nothing has been paid on the blockchain yet.** The function that would pay is handed in
  from outside and there is no real one wired up. There is no b402 route and no Binance Bazaar
  call, which our own notes say is blocked from Indonesia anyway.
- There is no wallet file and no limited key for this agent yet. The address above is already
  in its marketplace listing and cannot be changed, so the existing key has to be adopted.

## The three rules that are least obvious

**Nothing used means no bill at all.** Not a bill for zero, and no minimum charge. An agent
that pays without anybody approving each payment must never pay for something that did not
happen. A seller who wants a standing fee can bill it as use.

**A bill too large is refused, not paid in part.** Fugu Pilot trims an oversized trade,
because half a trade is still a sensible trade. Half a bill is not: the rest stays owed,
follows the account around, and nobody decided to let it. A bill that does not fit inside the
limits is something a person should look at.

**Fractions of the smallest unit round up.** This agent pays rather than charges. Rounding
down would leave a sliver unpaid on every bill, and slivers left unpaid for a year become a
debt somebody has to chase. Rounding up costs at most one hundred-millionth of a dollar per
line.

## Running it

```bash
pnpm install --no-frozen-lockfile
pnpm --filter fugumeter-agent test
pnpm --filter fugumeter-agent typecheck
```

`--no-frozen-lockfile` is not a workaround for this package: its lockfile was made from its
own `package.json` in the same commit. The flag is written down because the four older agents
in this folder have lockfiles that do not match theirs.

## Where things are

| File | What it holds |
|---|---|
| `src/strategy/meter.ts` | Counting, including the same thing reported twice. |
| `src/strategy/rating.ts` | The price ladder, and where fractions go. |
| `src/strategy/execute.ts` | The limits, the billing mark, and why a failed payment still counts. |
| `src/strategy/session.ts` | The three checks on the limited key, including how close to its end date the agent stops using it. |
| `src/strategy/guard.ts` | The cycle and the loop, with the stop switch. |
| `src/strategy/state/store.ts` | What survives a restart. |
| `src/strategy/identity.ts` | The wallet in its listing, which cannot be changed. |

`session.ts` is the same file in all three of the new agents. They are separate packages with
no shared workspace, so the choice was a copy or an early shared package, and the copy is
written down here rather than left to be found.
