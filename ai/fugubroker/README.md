# fugubroker

Fugu Broker rents other agents and pays for them.

It reads the catalog of agents for rent, chooses one by rules that are written down and
tested, works out what the rental costs, and can pay for it. The money is held by a
contract and released to the seller as the rented time passes.

Listing 5 in `FuguRegistry`, capability `HIRING`, agent wallet
`0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3`.

## What works today, and what does not

| Part | State |
|---|---|
| The decision engine in `app/agent/src/strategy/` | 156 tests, all deterministic, no network |
| Reading the live catalog on BSC testnet | works, `scripts/read-catalog.ts`, reads only |
| Building the payment arguments (ceiling, deadline, token) | 156 tests, no network |
| The boundary check on the delegated key | 156 tests, the sending step is injected |
| Paying for a rental on the blockchain | **never done.** The wallet holds no money |

The last row is the honest one. The wallet was adopted rather than created, because the
listing on the blockchain already names it and that field cannot be changed after the
listing is registered. It has never been funded, so no bounded key has been granted and no
rental has been paid for. Everything up to the moment of sending has been built and tested;
the sending itself has not happened.

The sentence for this agent's card, which should appear exactly as written:

> Fugu Broker chooses which agent to rent and works out what it costs, using rules you can
> read and tests you can run. It has not yet paid for a rental on the blockchain: its
> wallet holds no money and no delegated key has been granted to it.

## How it decides

Ten rules put a listing aside, and each one has a name that appears in the answer:

| Rule | What it stops |
|---|---|
| `CATEGORY` | paying an agent for work it does not do |
| `INACTIVE` | paying a listing the payment contract will refuse |
| `SELF` | paying ourselves, which loses the platform fee and gains nothing |
| `EXCLUDED_OWNER` | paying somebody the caller said they will not pay |
| `NOT_CURATED` | trusting a listing that only its own seller vouches for |
| `NO_ONCHAIN_EXECUTION` | hiring an agent that advises when the work has to be carried out |
| `PERIOD_LENGTH` | renting in blocks so short or so long the arithmetic stops meaning anything |
| `PRICE_PER_PERIOD` | paying a listing whose price moved by orders of magnitude |
| `TOO_MANY_PERIODS` | committing days of money in one decision |
| `OVER_BUDGET` | spending more than the caller or this agent allows |

On top of those, a running total across a window: the per-rental limit cannot stop a loop,
because two hundred correct rentals are two hundred correct decisions and an empty wallet.

Every rule was checked by deleting it and running the suite. All 25 deletions made in
`fugubroker` turned the suite red. A rule that refuses to spend money is invisible when it
breaks, so "there is a test for it" has to be shown rather than said.

## Reading the live catalog

Reads only. No key, no funded wallet, nothing signed.

```bash
cd app/agent
npx tsx scripts/read-catalog.ts YIELD 3600 2     # capability, seconds of work, dollars
```

On 9 September 2026 that read all nine listings, priced an hour of `YIELD` work at
$1.50 for 30 blocks of two minutes, and refused `HIRING` with `SELF x1`, because listing 5
is this agent's own.

## Paying for a rental

Two rails exist and this agent is built for the first:

1. `FuguSubscription.subscribe`, this project's own contract. The payment carries a
   ceiling, a deadline and a token, and the delegated key that sends it may call that one
   method and approve that one token, and nothing else. Built and tested; see
   `src/strategy/chain/session.ts`.
2. `hireErc8183Agent` from `@altananetwork/sdk`, the wider agent job market. The function
   exists and is exported by version 0.7.1, which this agent depends on.
   `buildErc8183HirePlan` turns a decision into its arguments and is tested;
   calling it has not been done, because it needs $U in a funded wallet.

Granting the bounded key, once the wallet has money in it:

```bash
cd app/agent
bag wallet session grant        # the general commercial key
npx tsx scripts/grant-session-broker.ts   # the narrow key that may only rent
```

The second script writes a key whose list of permitted methods holds exactly two entries,
with caps of 0.02 of the chain's own coin and 5 payment tokens per day and an expiry
30 days out. An empty list would mean unlimited permission in this wallet, which is why the
list is built by the same function that checks it before every payment.

## Commands

```bash
pnpm install --frozen-lockfile        # the lockfile matches; it does not in the four older agents
pnpm --filter fugubroker-agent run test
pnpm --filter fugubroker-agent run typecheck
pnpm --filter fugubroker-agent run dev
```

## Layout

- `app/agent/src/strategy/` the decision engine. Pure: no network, no clock, no environment.
- `app/agent/src/strategy/chain/` reading the catalog and sending the payment. The sending
  step is injected, which is what lets every rule be tested with no chain at all.
- `app/agent/src/hiring.ts` the layer between untrusted JSON and the engine.
- `app/agent/src/tools.ts`, `agentCard.ts`, `executor.ts` how the two skills are offered
  over A2A and MCP.
- `.studio/` the wallet and the secrets. Never committed.
