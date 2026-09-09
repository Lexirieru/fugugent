# ai — the four Fugu agents

Four autonomous DeFi agents, scaffolded with BNB Agent Studio (`bag`), self-hosted on a
VPS, executing through non-custodial Altana session keys.

| Agent | Category | Protocols | Trigger |
|---|---|---|---|
| `fugurebalancer` | Rebalancing | PancakeSwap v3 | out of range / deviation / interval |
| `fugugrid` | Grid Trading | PancakeSwap v3 swaps | a keeper watching `slot0()` |
| `fuguyield` | Yield Optimisation | Venus, Aave v3, Lista | APR spread > the cost threshold |
| `fuguguardian` | Health Factor | Venus, Aave v3 | HF below the threshold |

Project names are ≤23 chars, alphanumeric, starting with a letter (an AgentCore rule) — no
`-`/`_`/`.`.

## Rules

1. **A strategy is pure deterministic code** in `app/agent/src/strategy/`, with no I/O,
   unit-testable and backtestable. An LLM never decides money.
2. **dGrid is only for asynchronous explanations & research.** The model
   `openai/gpt-5.6-luna` has a measured latency of 30–46 seconds. If that sat on the
   critical path, Guardian would be 45 seconds late while the price is falling.
3. **Studio has no scheduler** — its README says explicitly "there is no background
   poller". Scheduling comes from BullMQ in `backend/`.
4. **Studio has no strategy templates.** All 14 of its skills and 7 of its recipes are
   about commercial plumbing. The alpha is our own work.
5. **Signing is fixed code**, never a tool an LLM can call.

## Altana traps that have already claimed victims

- An empty `calls: []` means **unlimited** permission. Always fill in an explicit allowlist.
- USDT/USDC on BNB have **18 decimals**, not 6.
- The native spend cap also pays the relay fee — a cap that is too small makes every
  execution `FAILED` with code 300.
- `execute()` **does not throw on failure** → check `result.status !== "CONFIRMED"`.
- `getKeys` does not drop expired keys, only revoked ones → a cross-check is mandatory.
- `bag init --wallet-kind altana --llm-provider pieverse-llm` is **rejected** (Altana
  refuses generic message signing). Use a provider that takes an API key.
- `@altananetwork/mcp` requires `bunx`; `npx` fails.

## Commands

```bash
bag init <name> --wallet-kind altana --destination self --no-onboard
bag wallet new && bag wallet session grant
bag doctor && bag dev
```

`.env` holds `DGRID_API_KEY` — gitignored.

## Wallet & session status (BSC testnet)

All four agents have their own Altana wallet with a bounded session registered in the
on-chain Keystore `0x6b8361C29d05D498b1a12B54A37310f94171E94A`. All of them are verified
with `isValidKey` → `true` and pass `bag doctor` 14 PASS / 0 FAIL.

| Agent | Category | Altana admin wallet |
|---|---|---|
| `fuguguardian` | Health Factor | `0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0` |
| `fugurebalancer` | Rebalancing | `0xb8f155D1278f0437b9De7c63911f2C0EDa485941` |
| `fugugrid` | Grid Trading | `0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9` |
| `fuguyield` | Yield Optimisation | `0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866` |

Every session: **10 U/day + 0.02 tBNB/day, expiry 30 days (8 Oct 2026)**, `register=true`.

`fuguguardian` has a **second session** dedicated to DeFi, separate from the commercial
session above: the file `.studio/wallets/altana-session-guardian.json`, an allowlist of only
`MockLendingPool.repay(address,uint256)` + `mUSD.approve(address,uint256)`, caps of
0.02 tBNB + 100 mUSD/day, keyHash
`0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377`.
It is granted through `app/agent/scripts/grant-session-guardian.ts`, not
`bag wallet session grant` (that CLI has no allowlist option). This session **cannot** be
loaded through `ensureAltanaSessionLoaded()`/`getWallet()`: the studio runtime rejects a
session whose `permissions.calls` is not an exact copy of `defaultAgentPermissions()`. Load
it through `deserializeSession` + `AltanaWalletProvider` (see
`app/agent/scripts/altana.ts`).

**The Porto trap that has already cost one route:** a spend-capped session key runs through
a guarded executor that **returns the ERC-20 allowance to zero at the end of the same
userOp**. An `approve` in a separate transaction is therefore pointless — `approve` and its
use must be in one userOp (`client.execute({ session, calls: [...] })`).

**A finding:** granting a session does **not** require a U balance in the wallet — U is only
used for the Commerce allowance. `bag doctor` will WARN about the U balance, but the session
is still valid and registered. Useful, because the U faucet is limited to 10 U per 30
minutes.

Public verification without any API key:
```bash
cast call --rpc-url https://data-seed-prebsc-1-s1.bnbchain.org:8545 \
  0x6b8361C29d05D498b1a12B54A37310f94171E94A \
  'isValidKey(address,bytes32)(bool)' <AGENT_WALLET> <KEY_HASH>
```
`KEY_HASH` = `cast keccak <session public key>`; the public key comes from
`bag wallet session status` (run inside `app/agent/`).

Renew: `bag wallet session grant --force`. Revoke: `bag wallet session revoke --yes`.

**Never** print, copy, or parse the `signer` portion of a session file.
