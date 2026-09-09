# fugutrader

Fugu Trader buys one call at a time, and sells the same way.

A seller answers a request with a price instead of an answer. This agent reads that price,
decides whether to pay it, signs one authorisation for that exact amount, and asks again.
Neither side ever holds the other's key, and the authorisation is good for one payment and
a few minutes.

Listing 6 in `FuguRegistry`, capability `COMMERCE`, agent wallet
`0x1B82F72346a8553a968fafD6AC07A21d4A88589f`.

## What works today, and what does not

| Part | State |
|---|---|
| The decision engine in `app/agent/src/strategy/` | 119 tests, all deterministic, no network |
| The selling half: price demand, check, settle, then work | built, and tested with a real signature |
| The buying half: read the price, decide, sign once, ask again | built, and tested against that seller |
| A payment refused without a valid signature, accepted with one | proven in `src/x402/__tests__/roundtrip.test.ts` |
| Money actually moving on the blockchain | **never done.** The wallet holds no money |

The last row is the honest one. The round-trip test signs with a real key, and the seller
checks that signature with the same code it would use in production, so "unpaid is refused,
paid is served" is genuinely demonstrated. What is stubbed is the final step where the
authorisation is broadcast, because that needs a funded wallet and this agent's wallet has
never held anything. The wallet was adopted rather than created: the listing on the
blockchain already names it, and that field cannot be changed after the listing is
registered.

The sentence for this agent's card, which should appear exactly as written:

> Fugu Trader decides whether one paid request is worth paying for, and can sign one
> authorisation for that exact amount. Both halves of the exchange are built and a real
> signature is checked end to end in its tests, but no payment has yet been settled on the
> blockchain: its wallet holds no money.

## How it decides

Nine rules put a payment option aside, and each one has a name that appears in the answer:

| Rule | What it stops |
|---|---|
| `SCHEME` | signing a kind of authorisation this agent has never read |
| `CHAIN` | paying on a chain where the money is real |
| `RAIL` | signing a structure whose meaning was not established |
| `TOKEN` | spending whichever token the seller preferred |
| `PAYEE` | paying somebody other than the expected recipient |
| `AMOUNT` | treating an unreadable price as free |
| `TIMEOUT_WINDOW` | leaving an authorisation usable for longer than it needs to be |
| `PRICE_CAP` | paying whatever is asked, since the format has no upper bound |
| `WINDOW` | spending more across a window than was allowed |

On top of those, a running total: the per-call cap cannot stop a loop, because a thousand
correct one-cent payments are a thousand correct decisions.

And one rule that lives in the buyer rather than the engine: a payment is attempted at most
once per request. A seller that answers a paid request with another price gets no second
payment, because pay-and-retry is a loop that spends real money at whatever rate the
network allows.

Every rule was checked by deleting it and running the suite. All 22 deletions made in
`fugutrader` turned the suite red.

## Both halves

**Buying.** `src/x402/buyer.ts` and `src/x402/signers.ts`. The signing step is injected, so
the running agent uses a delegated key with a spending cap and an expiry date that the
wallet contract enforces, while the tests use an ordinary key. Both produce the same
envelope and are checked by the same code.

**Selling.** `src/x402/route.ts`, at `POST /fugu-x402`, switched on by
`FUGU_X402_SELLER_ENABLED=1`. It needs an address to be paid at and a separate key whose
only job is to pay for delivering the settlement transaction. That key never receives the
earnings: the recipient is bound into the buyer's signature, so it cannot be redirected
even if the key is stolen.

The path is deliberately not `/x402`. That one belongs to the seller the scaffold ships,
which needs merchant credentials from a Binance developer account this project does not
have and cannot apply for from the network it is built on. That seller is switched off in
`studio.toml`, with the reason written next to the switch.

## A note on the licence

`@altananetwork/x402-server` is published under GPL-3.0-or-later, while
`@altananetwork/sdk` is Apache-2.0. Only `src/x402/merchant.ts` and `src/x402/route.ts`
import it, so the obligation reaches exactly those two files and whatever links them.
Nothing in `src/strategy/` touches it. This is worth a decision before the seller ships,
not after.

## Commands

```bash
pnpm install --frozen-lockfile        # the lockfile matches; it does not in the four older agents
pnpm --filter fugutrader-agent run test
pnpm --filter fugutrader-agent run typecheck
pnpm --filter fugutrader-agent run dev

# to switch the selling half on
FUGU_X402_SELLER_ENABLED=1 \
FUGU_X402_PAY_TO=0x1B82F72346a8553a968fafD6AC07A21d4A88589f \
FUGU_X402_FACILITATOR_KEY=0x... \
pnpm --filter fugutrader-agent run dev
```

## Layout

- `app/agent/src/strategy/` the decision engine and the reader for a seller's price demand.
  Pure: no network, no clock, no environment.
- `app/agent/src/x402/` both halves of the exchange, and the only place the GPL library is
  reached.
- `app/agent/src/purchase.ts` the layer between untrusted JSON and the engine.
- `app/agent/src/tools.ts`, `agentCard.ts`, `executor.ts` how the two skills are offered
  over A2A and MCP.
- `.studio/` the wallet and the secrets. Never committed.
