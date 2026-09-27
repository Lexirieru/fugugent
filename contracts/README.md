# contracts

The five HelloFugu contracts, built with Foundry. BSC testnet (chain 97), every one a
UUPS proxy with a verified implementation.

| Contract | Proxy | Role |
|---|---|---|
| FuguRegistry | `0xb2f36070E6eae3353E8e755172B477DF213ae248` | Listings, each bound to an ERC-8004 agent id its owner holds |
| FuguSubscription | `0xfdb083371f44Cf53181350389D3217e51B431776` | Hire (escrow), payout by the second, cancel with refund |
| FuguReputation | `0x279B31B00F64C0ce85BCe2Bd7e377CdcAE58d400` | Ratings, only from wallets that paid |
| FuguPriceOracle | `0xB5f72a0ab0bA971c8C4F69D4A075cB7fd7859e65` | USD (8 decimals) to token amount via Chainlink |
| FuguAuditEscrow | `0x0354d2a4be40f118e4d1301915ee2ff54eec8a52` | Audit fee and auditor bond, held together |

Implementations, upgrade history and every deployment tx are in
[`deployments/bsc-testnet.json`](deployments/bsc-testnet.json).

```bash
forge build
forge test
source .env && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast --verify
```

`.env` holds `PRIVATE_KEY` and is gitignored. Rules for changing these contracts
(append-only storage, the append-only `Category` enum) are in [`CLAUDE.md`](CLAUDE.md).
