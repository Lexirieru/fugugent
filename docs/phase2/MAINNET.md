# HelloFugu: mainnet plan

BNB Chain's rule for Phase 2: testnet entries may take part, but only a mainnet
deployment can be selected when the campaign ends. This is what moves, in order.

## 1. Contracts (BSC mainnet, chain 56)

- Deploy FuguPriceOracle, FuguRegistry, FuguSubscription, FuguReputation and
  FuguAuditEscrow as UUPS proxies with the existing deploy scripts, `chainId` set to 56.
- Point FuguRegistry's `identityRegistry` at the mainnet ERC-8004 IdentityRegistry
  `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` from day one, so `list()` checks ownership
  from the first listing.
- Configure FuguPriceOracle with the Chainlink BNB/USD mainnet feed.
- Verify every implementation on BscScan (Etherscan V2 API, already in `foundry.toml`).

## 2. Our agents

- Register their ERC-8004 identities on the mainnet registry and list them. The two
  migration scripts used on testnet (`RegisterErc8004Identities`, `RebindAgentIds`) already
  take the registry address as input.
- Fugu Guardian leaves the mock lending pool: its repay path targets a real lending market
  (Venus on BSC), with a new Altana session scoped to that market's `repay` and the debt
  token's `approve`, and the same daily cap.
- Agents that are still advice-only stay listed as advice-only. No agent is described as
  able to act until it has done so on mainnet.

## 3. Backend and frontend

- Backend: `CHAIN_ID=56`, the mainnet registry address, and a mainnet RPC with public
  fallbacks (the fallback mechanism already exists). The registry sweep is unchanged; it
  reads whatever registry it is given, and it will need batching tuned for mainnet's
  larger registry.
- Frontend: `CHAIN` constants and contract addresses switch to 56. The network badge in
  the header already reads from that constant.
- Tracking API and `/api/tracking` spec switch with the backend config; the endpoints stay
  the same, so the quest tracker only needs new contract addresses.

## 4. What does not change

The hire, cancel and rating flows, the spending caps and the revoke path are the same
contracts and the same code. They are exercised end to end by `frontend/e2e/hire-flow.mjs`
and will be re-run against a mainnet fork before launch.
