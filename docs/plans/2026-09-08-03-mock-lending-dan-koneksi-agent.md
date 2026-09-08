# Testnet Mock Lending + Guardian Connected — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fugu Guardian really protects a borrow position on BSC testnet — it reads the position, decides, and **executes the transaction** through an Altana session key, all on one network.

**Architecture:** Build a mock lending protocol with an Aave v3 interface on testnet (`MockLendingPool` + `MockPriceFeed` + two tokens), so the existing adapter can be used as-is with nothing but the addresses swapped. Then connect the strategy layer to the agent runtime: monitoring loop → `decide()` → bounded execution → record.

**Tech Stack:** Solidity 0.8.30 + Foundry, TypeScript + viem, `@altananetwork/sdk` 0.7.1, vitest.

**Spec:** `docs/specs/2026-09-08-fugugent-design.md` §5 · **Honest status:** `docs/STATUS.md`

## Global Constraints

- Solidity `^0.8.30`, OZ 5.7.0, **no `__gap`** (append-only), custom errors.
- `MockLendingPool.getUserAccountData` **must** return six values in exactly the order and units Aave v3 uses: `totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor`. Base unit = **USD, 8 decimals**. HF on a **1e18** basis. No debt → HF = `type(uint256).max`.
- The logic of the existing TypeScript adapter **must not be changed** — only the addresses and the chain differ. If the mock is correct, the adapter runs as-is. That is the test of whether the mock is right.
- All TS values as `bigint`; local imports use the `.js` extension.
- **Execution must go through an Altana session key**, not the admin key. The spend cap is enforced in the agent code, not merely entrusted to Altana.
- Do not touch `healthFactor.ts`, `decide.ts`, `explain.ts`, `backtest.ts` — all of them have passed review.
- Contract commands are run from `contracts/`, agent commands from `ai/fuguguardian/app/agent/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `contracts/src/mocks/MockPriceFeed.sol` | An AggregatorV3 whose price the owner can set — to simulate a price drop. |
| `contracts/src/mocks/MockToken.sol` | An 18-decimal ERC20 with an open `mint` (testnet). |
| `contracts/src/mocks/MockLendingPool.sol` | A lending protocol with the Aave v3 interface. The only thing that holds funds. |
| `contracts/test/MockLendingPool.t.sol` | Tests for the mock contract. |
| `contracts/script/DeployMocks.s.sol` | Deploy + seed liquidity + create a sample position. |
| `ai/.../src/strategy/chain/testnet.ts` | Testnet address configuration + `createTestnetReader`. |
| `ai/.../src/strategy/execute.ts` | Execute a decision through the session key, with a spend cap and a kill switch. |
| `ai/.../src/strategy/guard.ts` | The monitoring loop: read → decide → execute → record. |
| `ai/.../src/strategy/__tests__/execute.test.ts` | Tests for the spend limits and the kill switch. |

---

### Task 1: Mock price feed & token

**Files:** Create `contracts/src/mocks/MockPriceFeed.sol`, `contracts/src/mocks/MockToken.sol`, `contracts/test/Mocks.t.sol`

**Interfaces:**
- `MockPriceFeed(uint8 decimals_, int256 initialAnswer)` — `setAnswer(int256)` onlyOwner, `latestRoundData()`, `decimals()`, `description()`
- `MockToken(string name, string symbol)` — open `mint(address,uint256)`, 18 decimals

- [ ] **Step 1: Write the tests**

`contracts/test/Mocks.t.sol` — test that: the feed returns the initial price; `setAnswer` changes it and updates `updatedAt`; a non-owner cannot call `setAnswer`; the token has 18 decimals and `mint` increases the balance.

- [ ] **Step 2: Run them, confirm they fail.** `forge test --match-contract MocksTest`
- [ ] **Step 3: Implement.** `MockPriceFeed` stores `answer` and `updatedAt`; `setAnswer` sets `updatedAt = block.timestamp`. `MockToken` inherits OZ `ERC20`, and `Ownable` is not needed for mint (testnet).
- [ ] **Step 4: Green.** `forge test --match-contract MocksTest -vv`
- [ ] **Step 5: Commit.** `feat(contracts): mock price feed and token for testnet`

---

### Task 2: `MockLendingPool` with the Aave v3 interface

**Files:** Create `contracts/src/mocks/MockLendingPool.sol`, `contracts/test/MockLendingPool.t.sol`

**Binding interfaces:**
```solidity
function addAsset(address token, address feed, uint16 ltvBps, uint16 liquidationThresholdBps) external;   // onlyOwner
function supply(address asset, uint256 amount) external;
function withdraw(address asset, uint256 amount) external;
function borrow(address asset, uint256 amount) external;
function repay(address asset, uint256 amount) external;
function getUserAccountData(address user) external view returns (
    uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase,
    uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor);
```

**Binding calculation rules:**
```
usdValue8(asset, amount)     = amount × feedPrice8 / 10^tokenDecimals
totalCollateralBase          = Σ usdValue8(collateral)
totalDebtBase                = Σ usdValue8(debt)
currentLiquidationThreshold  = collateral-value-weighted average of liquidationThresholdBps
ltv                          = collateral-value-weighted average of ltvBps
healthFactor                 = totalCollateralBase × currentLiquidationThreshold × 1e18 / (10000 × totalDebtBase)
                               if totalDebtBase == 0 → type(uint256).max
availableBorrowsBase         = max(0, totalCollateralBase × ltv / 10000 − totalDebtBase)
```
`borrow` reverts if it would drop HF below 1e18. `withdraw` reverts under the same rule.

- [ ] **Step 1: Write the tests.** At minimum: supply increases collateral; with no debt HF = `type(uint256).max`; supplying 1000 USD and then borrowing 500 USD at an LT of 80% gives an HF of exactly 1.6e18; halving the collateral price gives an HF of 0.8e18; a `borrow` that violates HF is rejected; `repay` raises HF again; the weighted average is correct for two collaterals with different LTs.
- [ ] **Step 2: Run them, confirm they fail.**
- [ ] **Step 3: Implement.** Store the asset list per user. Use `SafeERC20`. Do not use `__gap`. This contract is **not** upgradeable — it is a test tool, not part of the product.
- [ ] **Step 4: Green,** and make sure the whole `forge test` suite is still green (104 previously).
- [ ] **Step 5: Commit.** `feat(contracts): MockLendingPool with the Aave v3 interface`

---

### Task 3: Deploy the mocks + seed liquidity + a sample position

**Files:** Create `contracts/script/DeployMocks.s.sol`; update `contracts/deployments/bsc-testnet.json`

- [ ] **Step 1: Write the script.** Deploy `MockToken` mUSD and mBNB; a `MockPriceFeed` for each (mUSD $1.00; mBNB at the BNB price at the time, e.g. $750); `MockLendingPool`; `addAsset` for both (mUSD LTV 80%/LT 85%, mBNB LTV 60%/LT 75%); mint tokens to the deployer; **supply liquidity** in mUSD to the pool so there is something to borrow; then create a **sample position**: supply mBNB as collateral and borrow mUSD so that HF lands around 1.8.
- [ ] **Step 2: Simulate without broadcasting.** Make sure it succeeds and that the sample position's HF is printed.
- [ ] **Step 3: Deploy for real** with `--broadcast`.
- [ ] **Step 4: Verify on-chain** with `cast call getUserAccountData` — paste all six values, and make sure the HF is sensible.
- [ ] **Step 5: Record the addresses** in `deployments/bsc-testnet.json` under the `mocks` key.
- [ ] **Step 6: Commit.** `feat(contracts): deploy mock lending + seed liquidity on testnet`

---

### Task 4: The testnet adapter

**Files:** Create `ai/.../src/strategy/chain/testnet.ts`, `ai/.../src/strategy/__tests__/testnet.test.ts`

**Interfaces:** `createTestnetReader(rpcUrl?)` → `{ client, readPosition(account) }`, using the **existing** `readAavePosition` with the `MockLendingPool` address.

**Rule:** do not rewrite the reading logic. If `readAavePosition` cannot be used as-is, that means the mock is wrong — fix the mock, not the adapter.

- [ ] **Step 1: A test** that reads the sample position from testnet and asserts: `healthFactor` is not null, `collateralBase > 0`, `debtBase > 0`, `liquidationThresholdBps` between 1 and 10000. Timeout 30 seconds.
- [ ] **Step 2: Fail first.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Commit.** `feat(guardian): testnet adapter pointing at the mock lending pool`

---

### Task 5: Bounded execution through the session key

**Files:** Create `ai/.../src/strategy/execute.ts`, `ai/.../src/strategy/__tests__/execute.test.ts`

**Interfaces:**
```ts
export interface ExecuteLimits { maxPerActionUsd8: bigint; maxPerDayUsd8: bigint; minIntervalSeconds: number; }
export interface ExecuteDeps { sendRepay: (asset: `0x${string}`, amount: bigint) => Promise<`0x${string}`>; now: () => number; }
export interface ExecuteState { spentTodayUsd8: bigint; dayStartedAt: number; lastActionAt: number; killed: boolean; }
export async function executeDecision(d: Decision, pos: Position, limits: ExecuteLimits, state: ExecuteState, deps: ExecuteDeps): Promise<ExecuteResult>
```

**Binding rules — all enforced BEFORE the transaction is sent:**
1. `state.killed === true` → never send anything. The kill switch is absolute.
2. `d.action === "NONE"` or `"WARN"` → send nothing.
3. `d.suggestedRepayBase > limits.maxPerActionUsd8` → **clamp** to that limit, do not reject; record that it was clamped.
4. `state.spentTodayUsd8 + amount > limits.maxPerDayUsd8` → clamp to the remaining budget; if nothing remains, send nothing.
5. `deps.now() - state.lastActionAt < limits.minIntervalSeconds` → send nothing (cooldown).
6. After a successful send, update `spentTodayUsd8` and `lastActionAt`. Reset daily when `now` passes `dayStartedAt + 86400`.

`deps.sendRepay` is injected so that tests never touch the network.

- [ ] **Step 1: Tests** for all six rules above plus: per-action clamping, daily clamping, the daily reset, the cooldown rejecting and then allowing once it has passed, and the kill switch beating everything else.
- [ ] **Step 2: Fail first.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green, without touching the network.**
- [ ] **Step 5: Commit.** `feat(guardian): bounded execution with spend cap, cooldown, kill switch`

---

### Task 6: The monitoring loop

**Files:** Create `ai/.../src/strategy/guard.ts`, `ai/.../src/strategy/__tests__/guard.test.ts`

**Interfaces:** `runGuardCycle(deps, executeState): Promise<{ result: CycleResult; nextExecuteState: ExecuteState }>` — one cycle: read the position → `decide` → `executeDecision` (execution state flows explicitly through the parameter and the return value) → produce a record. Plus `startGuardLoop(deps, intervalMs, initialExecuteState)`, which calls it repeatedly, holds the execution state between cycles itself, and handles errors.

**Rules:**
- A single cycle **must not throw**. An RPC read failure is recorded and the next cycle still runs — an agent that dies silently is more dangerous than an agent that complains.
- The dGrid explanation is called **after** execution, never before, and its failure is ignored.
- Every cycle produces a record containing: time, HF, action, the amount sent, the tx hash if there is one, and the reason.

- [ ] **Step 1: Tests** with injected dependencies: a normal cycle produces a record; a read failure does not throw and is recorded; an explanation failure does not change the execution result; a `NONE` action does not call `sendRepay`.
- [ ] **Step 2: Fail first.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Commit.** `feat(guardian): monitoring loop that never dies silently`

---

### Task 7: A real E2E on testnet

**Files:** Create `ai/.../scripts/e2e-guardian.ts`; update `docs/e2e/2026-09-08-e2e-testnet.md`

A script that runs the full scenario on testnet and prints the proof:
1. Read the sample position, print the starting HF.
2. **Lower the mBNB price** through `MockPriceFeed.setAnswer` so that HF falls below the `partialRepay` threshold.
3. Run one Guardian cycle.
4. Print: the decision, the amount paid, the **tx hash**, and the HF afterwards.
5. Assert that the HF afterwards is higher than before, and print the difference.

- [ ] **Step 1: Write the script.**
- [ ] **Step 2: Run it for real** on testnet. Paste the entire output.
- [ ] **Step 3: Document** the result in `docs/e2e/` with clickable tx hashes.
- [ ] **Step 4: Update `docs/STATUS.md`** — move the "strategy not yet connected" item from the NOT DONE list to the DONE list, with the evidence.
- [ ] **Step 5: Commit.** `feat(guardian): E2E position protection proven on testnet`

---

## Definition of Done

- [ ] `forge test` green; `corepack pnpm test` green
- [ ] Mock lending live on testnet with liquidity and a sample position
- [ ] The existing `readAavePosition` is used **as-is** against the mock — proving its interface is correct
- [ ] Guardian executes a real repay through the session key, with a tx hash
- [ ] The spend cap, cooldown, and kill switch are enforced in code and tested
- [ ] The position's HF is proven to rise after the agent intervenes
- [ ] `docs/STATUS.md` updated honestly

---

### Task 8: Repay through a bounded Altana session key

**Why this task exists:** Task 7 proves the strategy chain works, but the repay is signed
by the **deployer EOA** — a key with full authority. That does not satisfy the Definition of
Done item "Guardian executes a real repay through the session key". The spend limits,
cooldown, and kill switch are currently enforced only in our own code; anyone holding that
key can bypass them. Fugugent's main selling point is the opposite: **an agent that
cryptographically cannot exceed its permissions**, even if its code is hijacked.

**Files:**
- Create: `ai/fuguguardian/app/agent/src/strategy/chain/session.ts`
- Modify: `ai/fuguguardian/app/agent/scripts/e2e-guardian.ts` (swap the `sendRepay` signer)
- Test: `ai/fuguguardian/app/agent/src/strategy/__tests__/session.test.ts`
- Docs: `docs/e2e/2026-09-08-e2e-testnet.md`, `docs/STATUS.md`

**Interfaces:**
- Consumes: `ensureAltanaSessionLoaded`, `getWallet` from `@bnbagent/studio-runtime/wallet`
  (already used at `dualMain.ts:63,266`); `REPAY_ASSET_ADDRESS`, `ExecuteDeps.sendRepay`
  from `execute.ts`; `MOCK_LENDING_POOL_ADDRESS` from `chain/testnet.ts`.
- Produces: `createSessionSendRepay(...): ExecuteDeps["sendRepay"]` — a drop-in replacement
  for the EOA signer in the E2E script.

**Binding constraints:**
- An empty `calls: []` means **unlimited permission**. The allowlist must be explicit: only
  `MockLendingPool.repay` and `mUSD.approve`, nothing more.
- Never print, parse, or copy the `signer` part of the session file.
- The native cap also pays the relay fee — account for it, do not cut it close.
- Testnet only (chainId 97).

- [ ] **Step 1: Grant a bounded session.** `bag wallet session grant` with an explicit allowlist,
      a spend cap, and an expiry. Record the parameters in `docs/e2e/` (not the session contents).
- [ ] **Step 2: Write `session.ts`** — build a `sendRepay` that signs through the session.
      No strategy logic here; only signing and sending.
- [ ] **Step 3: Unit tests** with a mocked session: the allowlist is passed through as-is, and
      empty `calls` is **rejected** by our own code before it reaches the SDK.
- [ ] **Step 4: Re-run the E2E** using `createSessionSendRepay`. Prove from the receipt
      that the sender is the **session address, not the deployer EOA**.
- [ ] **Step 5: Proof of rejection** — send one call outside the allowlist (e.g. an mUSD
      `transfer` to another address) through the same session, and prove it is **rejected**. This
      is the most important proof in this task: the limits are real, not merely promised by our code.
- [ ] **Step 6: Update `docs/e2e/` and `docs/STATUS.md`** — move the session key item
      from NOT DONE to DONE, with the tx hash of the success and the proof of rejection.
- [ ] **Step 7: Commit.** `feat(guardian): repay through a bounded Altana session key`

---

### Task 9: Make Guardian actually runnable as a service

**Why this task exists:** the final review of the whole branch found three defects that are only
visible when you look at the chain as a whole. All three must be fixed before the backend is
built on top of it.

**Files:**
- Create: `src/strategy/units.ts`, `src/strategy/createGuardian.ts`, `src/strategy/state/store.ts` + a test for each
- Modify: `src/strategy/execute.ts`, `src/strategy/guard.ts`, `src/strategy/chain/testnet.ts`,
  `scripts/e2e-guardian.ts`, `docs/STATUS.md`

**The order the reviewer recommends — follow it:** C3 → C2 → I2+I3 → C1 → I4 → doc cleanup.

- [ ] **C3 — persistent `ExecuteState` + a lever for the kill switch.**
      A restart currently resets `spentTodayUsd8`, `dayStartedAt`, and `lastActionAt` — the
      cooldown is bypassed immediately. And `GuardLoopHandle` only has `stop()`/`getLastResult()`;
      there is no way to set `killed` while the loop is running, even though `docs/STATUS.md:34`
      lists the kill switch as a capability. **This is the one claim that promises more than the
      evidence supports** — fix the path, or lower the claim until that path exists.
      The store can be as simple as a JSON file; what matters is that its interface is injected, so
      the backend can replace it with Postgres without touching the strategy.
- [ ] **C2 — repay idempotency.**
      `waitForTransactionReceipt` times out after the tx has landed → `sendRepay` throws →
      `guard.ts` returns the old state → it pays again on the next cycle, until the session cap runs out.
      For network sends, "failed" does not mean "did not happen". Record it in-flight
      **before** sending and settle it afterwards; or at the very least never send a repay
      while `pos.blockNumber` has not passed the block of the last known repay.
      A test is required: `sendRepay` throws after the tx has "landed" → the next cycle does **not**
      send it again.
- [ ] **I2 + I3 — parameterize the repay asset, give unit conversion a home.**
      `REPAY_ASSET_ADDRESS` is hardcoded in the pure module `execute.ts`. USD8↔token-unit
      conversion only lives in the script; move it to `src/strategy/units.ts` with its own tests.
      The current "round-trip" check is **tautological** — `a·10^d/p·p/10^d` holds for any `d` and
      any `p`, so it does not catch a wrong decimals value or a wrong feed the way its comment
      claims. Replace it with a check that really catches those, or drop the claim.
- [ ] **C1 — `createGuardian()` in `src/`.**
      The complete chain only lives in `scripts/e2e-guardian.ts`. Five pieces of assembly
      (unit conversion, reading `assets()` + the feed, the balance check, the initial
      `ExecuteState`, `relaySender`) have no counterpart in `src/` and are not guarded by tests —
      anyone wiring up the runtime will copy them from the demo script. Build the composition root
      in `src/`, and then have **the E2E call it** instead of reassembling it.
- [ ] **I4 — pin `readAavePosition` to a single block.** `Position.blockNumber` currently
      comes from a separate RPC call, not from the block the numbers were read at.
- [ ] **Doc cleanup:** `docs/e2e/` lines 53-58 are stale (contradicted by the same document);
      the root `CLAUDE.md` still marks `ai/` as "not started"; `docs/STATUS.md` says 135 tests when there are 142.
- [ ] **Commit.** `fix(guardian): state persistence, repay idempotency, composition root`

**Deliberately deferred, recorded in the ledger:** I1, I5, I6, I7, and the remaining Minor items.
