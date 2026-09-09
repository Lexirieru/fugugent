# contracts — Fugugent

Foundry. Solidity `^0.8.30`, OpenZeppelin 5.7.0 (a submodule in `lib/`). BSC testnet (97).

## The four contracts

| Contract | Responsibility |
|---|---|
| `FuguPriceOracle` | USD(8 decimals) → a token amount, via Chainlink or a fixed price. Touches no funds. |
| `FuguRegistry` | The catalogue of agent listings per category. Touches no funds. |
| `FuguSubscription` | **The only one that holds funds.** Escrow, pro-rata claims, refunds, revenue share. |
| `FuguReputation` | Reviews gated on proof of subscription. Touches no funds. |

## Rules

- **Do not write `__gap`.** OZ 5.x uses ERC-7201 namespaced storage, so a parent cannot
  shift a child's slots. What does apply: **append-only** — a new variable goes only at the
  end, never inserted and never removed. Guarded by `test/Upgrade.t.sol`.
- Every contract: `Initializable` + `UUPSUpgradeable` + `OwnableUpgradeable`, with
  `_disableInitializers()` in the constructor and an `onlyOwner` `_authorizeUpgrade`.
- USD prices are always 8 decimals, and the variables end in `Usd8`.
- **A per-token staleness threshold, not a uniform one.** Verified on testnet: BNB/USD
  updates far more often than USDT/USD (a gap of ~8 hours). A uniform threshold would
  reject every USDT payment.
- **USDT on BSC has 18 decimals.** Do not hardcode 6.
- Custom errors, not `require` strings.
- The native coin = `address(0)`.

## Addresses verified live (BSC testnet 97, 2026-09-08)

```
Chainlink BNB/USD   0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526   (8 decimals)
Chainlink USDT/USD  0xEca2605f0BCF2BA5966372C99837b1F182d3D620
Chainlink BUSD/USD  0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa
USDT  0x337610d27c682E347C9cD60BD4b3b107C9d34dDd   (18 decimals)
BUSD  0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee
U     0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565   (no feed → FIXED_USD $1)
WBNB  0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd
```

**Wrong, do not use:** the Aave PoolAddressesProvider `0xA97684ea...` has no code on BSC.

## Commands

```bash
forge build
forge test                                  # the whole suite
forge test --match-contract FuguSubscriptionTest -vv
source .env && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast --verify
```

`.env` holds `PRIVATE_KEY` — gitignored, do not read it, do not commit it.
