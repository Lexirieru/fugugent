# Fugu Steward

Runs repeating payments and scheduled subscriptions, for several agents sharing one wallet,
each with different powers.

Listed on the marketplace as listing 9, category `TREASURY`, wallet
`0xB92Dd50E84560E719627AcE28b32060dbF0E7083`.

## What is honestly true today

- The schedule, the separation between agents, the record of what has been paid and the
  limits are all finished, deterministic and tested.
- Dying in the middle of a payment and coming back is tested through a real file on disk, in
  both shapes: the payment that never left, and the payment that landed while only reading
  the result failed. Both end in the same silence, because from the agent's side they cannot
  be told apart.
- **Nothing has been paid on the blockchain yet.** The function that would pay is handed in
  and there is no real one wired up.
- There is no wallet file and no limited key for this agent yet. The address above is already
  in its marketplace listing and cannot be changed, so the existing key has to be adopted.

## What the separation between agents does and does not do

Each agent on the wallet has its own list of people it may pay, its own list of contract and
method it may use, its own limit per payment and its own limit per day. A power belonging to
another agent on the same wallet is worth exactly as much to this one as a power belonging to
nobody.

Said plainly, because it matters: the limited key caps things on the blockchain, and it caps
them for the whole key. It cannot tell one of our agents from another, because from the
account contract's side they are the same signer. So this separation can only be enforced in
this repo, and an attacker who runs our process can ignore it. What they cannot ignore is the
key's own limits. Two layers, and only one of them is ours.

## Catching up after being switched off

An agent down for a month has thirty payments waiting. Two limits stop that becoming an
accident:

- at most one late period is paid per cycle, so the backlog clears at a speed a person can
  watch and the stop switch can be pulled between any two of them;
- anything further back than three periods is reported and never paid on its own. A payment a
  month late is a decision, and a person makes decisions.

Both refuse in the direction of doing too little. An agent that pays late is visibly late; an
agent that pays thirty times in one second is invisible until the money is gone.

## Running it

```bash
pnpm install --no-frozen-lockfile
pnpm --filter fugusteward-agent test
pnpm --filter fugusteward-agent typecheck
```

`--no-frozen-lockfile` is not a workaround for this package: its lockfile was made from its
own `package.json` in the same commit. The flag is written down because the four older agents
in this folder have lockfiles that do not match theirs.

## Where things are

| File | What it holds |
|---|---|
| `src/strategy/schedule.ts` | When things are due, and how far back the agent will go. |
| `src/strategy/scope.ts` | Several agents, one wallet, different powers. |
| `src/strategy/ledger.ts` | What has been paid, and what is being paid right now. |
| `src/strategy/execute.ts` | The limits, per agent, and why a failed payment still counts. |
| `src/strategy/session.ts` | The three checks on the limited key before anything is sent. |
| `src/strategy/guard.ts` | The cycle and the loop, with the stop switch. |
| `src/strategy/state/store.ts` | What survives a restart. |
| `src/strategy/identity.ts` | The wallet in its listing, which cannot be changed. |

`session.ts` is the same file in all three of the new agents. They are separate packages with
no shared workspace, so the choice was a copy or an early shared package, and the copy is
written down here rather than left to be found.
