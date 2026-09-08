# Fugu Guardian — Health Factor Strategy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fugu Guardian can read a real borrow position on BNB Chain, decide when to act using tested deterministic logic, and explain its decision in human language — without an LLM ever touching a financial decision.

**Architecture:** Three strictly separated layers. **The pure layer** (`strategy/`) holds the formulas and the decisions as functions with no I/O — unit-testable and backtestable. **The adapter layer** (`strategy/chain/`) reads on-chain and translates into domain types. **The explanation layer** (`strategy/explain.ts`) calls dGrid asynchronously after the decision has been made. A decision never waits for the LLM.

**Tech Stack:** TypeScript, viem (already present through the SDK), vitest, dGrid through `@ai-sdk/openai`.

**Spec:** `docs/specs/2026-09-08-fugugent-design.md` (§5) and `docs/research/06-agent-strategies.md` (§4)

## Global Constraints

- **Functions in `strategy/` must be PURE**: no network, no `Date.now()`, no `process.env`, no file reads. Time, prices, and positions come in as parameters. That is what makes them backtestable.
- **All on-chain values as `bigint`**, never `number`. 1e18 precision does not fit in a float.
- **Health factor on a 1e18 basis.** `HF = 1.0` is `10n ** 18n`.
- **Aave returns `healthFactor = 2^256-1` when the user has no debt** — verified live. Treat it as "infinite", not as a number.
- **The LLM never makes a financial decision.** `explain.ts` only receives a finished decision and turns it into a sentence.
- Only contract addresses that have been **verified live** may be used (listed per task). Do not add a new address without verifying it with `cast call`.
- Data is read from **BSC mainnet (chain 56)** because Venus and Aave live there; transaction execution stays on testnet. The reads are read-only and cost nothing.
- Custom error classes, not a bare `throw new Error("string")`, for conditions the caller can handle.
- Commands are run from `ai/fuguguardian/app/agent/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/strategy/types.ts` | Domain types: `Position`, `Decision`, `Action`, `Thresholds`. No logic. |
| `src/strategy/healthFactor.ts` | Pure formulas: HF normalization, distance to liquidation, price stress test. |
| `src/strategy/decide.ts` | The pure decision engine: position + thresholds → action + reason. |
| `src/strategy/chain/venus.ts` | Read-only Venus adapter (`getAccountLiquidity`). |
| `src/strategy/chain/aave.ts` | Read-only Aave v3 adapter (`getUserAccountData`). |
| `src/strategy/explain.ts` | Turn a `Decision` into a sentence through dGrid, asynchronous, allowed to fail. |
| `src/strategy/backtest.ts` | Harness: a price series → how many liquidations were prevented vs a human baseline. |
| `src/strategy/__tests__/*.test.ts` | Unit tests per module. |
| `vitest.config.ts` | Test configuration. |

---

### Task 1: Test foundation & domain types

**Files:**
- Create: `vitest.config.ts`, `src/strategy/types.ts`, `src/strategy/__tests__/types.test.ts`
- Modify: `package.json` (add vitest + the test script)

**Interfaces:**
- Produces:
  - `type Protocol = "venus" | "aave"`
  - `type Action = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY"`
  - `interface Position { protocol: Protocol; account: `0x${string}`; collateralBase: bigint; debtBase: bigint; liquidationThresholdBps: bigint; healthFactor: bigint | null; blockNumber: bigint; }`
  - `interface Thresholds { warn: bigint; partialRepay: bigint; deleverage: bigint; }`
  - `interface Decision { action: Action; healthFactor: bigint | null; dropToLiquidationBps: bigint | null; reason: string; suggestedRepayBase: bigint; }`
  - `const HF_ONE = 10n ** 18n`
  - `const DEFAULT_THRESHOLDS: Thresholds`
  - `class PositionError extends Error`

- [ ] **Step 1: Add vitest**

```bash
corepack pnpm add -D vitest
```
Add to the `"scripts"` section of `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Write the type tests first**

`src/strategy/__tests__/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, HF_ONE, PositionError } from "../types.js";

describe("konstanta domain", () => {
  it("HF_ONE adalah 1e18", () => {
    expect(HF_ONE).toBe(10n ** 18n);
  });

  it("ambang default berurutan menurun dan semuanya di atas 1.0", () => {
    expect(DEFAULT_THRESHOLDS.warn).toBeGreaterThan(DEFAULT_THRESHOLDS.partialRepay);
    expect(DEFAULT_THRESHOLDS.partialRepay).toBeGreaterThan(DEFAULT_THRESHOLDS.deleverage);
    expect(DEFAULT_THRESHOLDS.deleverage).toBeGreaterThan(HF_ONE);
  });

  it("ambang default sesuai riset: 1.5 / 1.2 / 1.1", () => {
    expect(DEFAULT_THRESHOLDS.warn).toBe(1_500_000_000_000_000_000n);
    expect(DEFAULT_THRESHOLDS.partialRepay).toBe(1_200_000_000_000_000_000n);
    expect(DEFAULT_THRESHOLDS.deleverage).toBe(1_100_000_000_000_000_000n);
  });

  it("PositionError membawa nama yang benar", () => {
    const e = new PositionError("uji");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("PositionError");
    expect(e.message).toBe("uji");
  });
});
```

- [ ] **Step 4: Run them, confirm they fail**

Run: `corepack pnpm test`
Expected: failure — `../types.js` does not exist yet.

- [ ] **Step 5: Write `src/strategy/types.ts`**

```ts
/** The health factor is expressed on a 1e18 basis, following Aave v3. HF 1.0 = 1e18. */
export const HF_ONE = 10n ** 18n;

export type Protocol = "venus" | "aave";

/**
 * The actions Guardian may take, from the mildest to the most aggressive.
 * This decision is ALWAYS produced by deterministic code, never by an LLM.
 */
export type Action = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY";

/**
 * A snapshot of a borrow position at a single block. Every money value is in the
 * "base unit" of the protocol in question (Aave uses a USD basis with 8 decimals).
 */
export interface Position {
  protocol: Protocol;
  account: `0x${string}`;
  collateralBase: bigint;
  debtBase: bigint;
  /** The liquidation threshold in basis points, e.g. 8000n = 80%. */
  liquidationThresholdBps: bigint;
  /** null means there is no debt at all — not dangerous, in fact the safest state. */
  healthFactor: bigint | null;
  blockNumber: bigint;
}

export interface Thresholds {
  warn: bigint;
  partialRepay: bigint;
  deleverage: bigint;
}

export interface Decision {
  action: Action;
  healthFactor: bigint | null;
  /** How many basis points the collateral price may fall before HF reaches 1.0. */
  dropToLiquidationBps: bigint | null;
  reason: string;
  /** The amount suggested to repay so that HF returns to safety; 0n when not needed. */
  suggestedRepayBase: bigint;
}

/**
 * The default thresholds from docs/research/06 §4.2. This is a product decision, not a
 * protocol constant — our own research marks it as an example that has to be
 * recalibrated through backtesting for more volatile assets.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  warn: 1_500_000_000_000_000_000n,
  partialRepay: 1_200_000_000_000_000_000n,
  deleverage: 1_100_000_000_000_000_000n,
};

export class PositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionError";
  }
}
```

- [ ] **Step 6: Run until green**

Run: `corepack pnpm test`
Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): test foundation and strategy domain types"
```

---

### Task 2: Pure health factor formulas

**Files:**
- Create: `src/strategy/healthFactor.ts`, `src/strategy/__tests__/healthFactor.test.ts`

**Interfaces:**
- Consumes: `Position`, `HF_ONE`, `PositionError` from `types.js`
- Produces:
  - `function computeHealthFactor(collateralBase: bigint, debtBase: bigint, liquidationThresholdBps: bigint): bigint | null`
  - `function dropToLiquidationBps(hf: bigint | null): bigint | null`
  - `function healthFactorAfterPriceDrop(pos: Position, dropBps: bigint): bigint | null`
  - `function repayToReachTarget(pos: Position, targetHf: bigint): bigint`

**Binding formulas:**
```
HF        = collateral × liquidationThresholdBps / 10000 × 1e18 / debt
dropToLiq = 10000 − (10000 × 1e18 / HF)          // basis points, 0 when HF ≤ 1
HF after the collateral price falls by d bps:
            HF' = HF × (10000 − d) / 10000
repay needed for HF to reach a target:
            debt_target = collateral × lt / 10000 × 1e18 / target
            repay = debt − debt_target   (0 when already safe)
```

- [ ] **Step 1: Write the tests first**

`src/strategy/__tests__/healthFactor.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  computeHealthFactor,
  dropToLiquidationBps,
  healthFactorAfterPriceDrop,
  repayToReachTarget,
} from "../healthFactor.js";
import { HF_ONE, type Position } from "../types.js";

const pos = (collateral: bigint, debt: bigint, ltBps = 8000n): Position => ({
  protocol: "aave",
  account: "0x0000000000000000000000000000000000000001",
  collateralBase: collateral,
  debtBase: debt,
  liquidationThresholdBps: ltBps,
  healthFactor: computeHealthFactor(collateral, debt, ltBps),
  blockNumber: 1n,
});

describe("computeHealthFactor", () => {
  it("agunan 1000, hutang 500, LT 80% menghasilkan HF 1.6", () => {
    expect(computeHealthFactor(1000n, 500n, 8000n)).toBe(1_600_000_000_000_000_000n);
  });

  it("tepat di ambang likuidasi menghasilkan HF 1.0", () => {
    expect(computeHealthFactor(1000n, 800n, 8000n)).toBe(HF_ONE);
  });

  it("hutang nol berarti tidak ada risiko sama sekali, dikembalikan null", () => {
    expect(computeHealthFactor(1000n, 0n, 8000n)).toBeNull();
  });

  it("agunan nol dengan hutang berjalan menghasilkan HF nol", () => {
    expect(computeHealthFactor(0n, 100n, 8000n)).toBe(0n);
  });
});

describe("dropToLiquidationBps", () => {
  it("HF 2.0 berarti agunan boleh turun 50%", () => {
    expect(dropToLiquidationBps(2n * HF_ONE)).toBe(5000n);
  });

  it("HF 1.25 berarti agunan boleh turun 20%", () => {
    expect(dropToLiquidationBps(1_250_000_000_000_000_000n)).toBe(2000n);
  });

  it("HF tepat 1.0 berarti tidak ada ruang turun sama sekali", () => {
    expect(dropToLiquidationBps(HF_ONE)).toBe(0n);
  });

  it("HF di bawah 1.0 tetap nol, bukan negatif", () => {
    expect(dropToLiquidationBps(900_000_000_000_000_000n)).toBe(0n);
  });

  it("tanpa hutang, jarak ke likuidasi tidak terdefinisi", () => {
    expect(dropToLiquidationBps(null)).toBeNull();
  });
});

describe("healthFactorAfterPriceDrop", () => {
  it("HF 1.6 setelah agunan turun 25% menjadi 1.2", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 500n), 2500n)).toBe(1_200_000_000_000_000_000n);
  });

  it("turun sebesar jarak ke likuidasi mendaratkan HF tepat di 1.0", () => {
    const p = pos(1000n, 500n);
    const d = dropToLiquidationBps(p.healthFactor)!;
    expect(healthFactorAfterPriceDrop(p, d)).toBe(HF_ONE);
  });

  it("posisi tanpa hutang tetap aman berapa pun harga turun", () => {
    expect(healthFactorAfterPriceDrop(pos(1000n, 0n), 9000n)).toBeNull();
  });
});

describe("repayToReachTarget", () => {
  it("menghitung pembayaran yang membawa HF ke target", () => {
    const p = pos(1000n, 800n); // HF 1.0
    const repay = repayToReachTarget(p, 1_600_000_000_000_000_000n);
    expect(repay).toBe(300n); // remaining debt of 500 gives HF 1.6
  });

  it("posisi yang sudah lebih aman dari target tidak perlu membayar apa pun", () => {
    expect(repayToReachTarget(pos(1000n, 100n), 1_200_000_000_000_000_000n)).toBe(0n);
  });

  it("posisi tanpa hutang tidak perlu membayar apa pun", () => {
    expect(repayToReachTarget(pos(1000n, 0n), 2n * HF_ONE)).toBe(0n);
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `corepack pnpm test`
Expected: failure — the module does not exist yet.

- [ ] **Step 3: Implement**

`src/strategy/healthFactor.ts` — every function pure, no I/O:
```ts
import { HF_ONE, type Position } from "./types.js";

const BPS = 10_000n;

/**
 * An Aave v3 style health factor, on a 1e18 basis.
 * Returns null when there is no debt — that is not a large number, it is the
 * absence of risk. Aave itself returns 2^256-1 for this case; we normalize it
 * to null so that callers can never compare it incorrectly.
 */
export function computeHealthFactor(
  collateralBase: bigint,
  debtBase: bigint,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (debtBase === 0n) return null;
  return (collateralBase * liquidationThresholdBps * HF_ONE) / (BPS * debtBase);
}

/** How many basis points the collateral price may fall before HF touches 1.0. */
export function dropToLiquidationBps(hf: bigint | null): bigint | null {
  if (hf === null) return null;
  if (hf <= HF_ONE) return 0n;
  return BPS - (BPS * HF_ONE) / hf;
}

/** The HF if the collateral price were to fall by `dropBps`. */
export function healthFactorAfterPriceDrop(pos: Position, dropBps: bigint): bigint | null {
  if (pos.debtBase === 0n) return null;
  const sisa = dropBps >= BPS ? 0n : BPS - dropBps;
  return computeHealthFactor(
    (pos.collateralBase * sisa) / BPS,
    pos.debtBase,
    pos.liquidationThresholdBps,
  );
}

/** The amount that must be repaid for HF to reach `targetHf`; 0n when already safe. */
export function repayToReachTarget(pos: Position, targetHf: bigint): bigint {
  if (pos.debtBase === 0n || targetHf === 0n) return 0n;
  const hutangTarget =
    (pos.collateralBase * pos.liquidationThresholdBps * HF_ONE) / (BPS * targetHf);
  if (hutangTarget >= pos.debtBase) return 0n;
  return pos.debtBase - hutangTarget;
}
```

- [ ] **Step 4: Run until green**

Run: `corepack pnpm test`
Expected: every test PASS. If `healthFactorAfterPriceDrop` is off by one unit because of integer rounding, **do not** loosen the assertion — check the order of operations: multiply first, divide last.

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): pure and tested health factor formulas"
```

---

### Task 3: The decision engine

**Files:**
- Create: `src/strategy/decide.ts`, `src/strategy/__tests__/decide.test.ts`

**Interfaces:**
- Consumes: `healthFactor.js`, `types.js`
- Produces: `function decide(pos: Position, thresholds?: Thresholds): Decision`

**Binding rules** (checked in order, from the most severe to the mildest):
| Condition | Action | suggestedRepayBase |
|---|---|---|
| `hf === null` (no debt) | `NONE` | 0n |
| `hf <= HF_ONE` | `EMERGENCY` | repay to bring HF to warn |
| `hf <= deleverage` | `DELEVERAGE` | repay to bring HF to warn |
| `hf <= partialRepay` | `PARTIAL_REPAY` | repay to bring HF to warn |
| `hf <= warn` | `WARN` | 0n |
| otherwise | `NONE` | 0n |

`reason` must state the HF number and the distance to liquidation as a percentage, in Indonesian, without jargon.

- [ ] **Step 1: Write the tests first**

`src/strategy/__tests__/decide.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decide } from "../decide.js";
import { DEFAULT_THRESHOLDS, HF_ONE, type Position } from "../types.js";

// helper: build a position with the desired HF at an LT of 80%
function posWithHf(hf: bigint): Position {
  // collateral fixed at 10_000; debt = collateral × lt / 10000 × 1e18 / hf
  const collateral = 10_000n;
  const debt = hf === 0n ? 0n : (collateral * 8000n * HF_ONE) / (10_000n * hf);
  return {
    protocol: "aave",
    account: "0x0000000000000000000000000000000000000001",
    collateralBase: collateral,
    debtBase: debt,
    liquidationThresholdBps: 8000n,
    healthFactor: debt === 0n ? null : hf,
    blockNumber: 1n,
  };
}

describe("decide", () => {
  it("posisi tanpa hutang tidak memerlukan aksi apa pun", () => {
    const p = posWithHf(0n);
    const d = decide(p);
    expect(d.action).toBe("NONE");
    expect(d.suggestedRepayBase).toBe(0n);
    expect(d.dropToLiquidationBps).toBeNull();
  });

  it("HF 2.0 aman, tidak ada aksi", () => {
    expect(decide(posWithHf(2n * HF_ONE)).action).toBe("NONE");
  });

  it("HF tepat di ambang peringatan memicu WARN", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).action).toBe("WARN");
  });

  it("WARN tidak menyarankan pembayaran apa pun", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.warn)).suggestedRepayBase).toBe(0n);
  });

  it("HF tepat di ambang partial repay memicu PARTIAL_REPAY", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).action).toBe("PARTIAL_REPAY");
  });

  it("PARTIAL_REPAY menyarankan pembayaran yang lebih dari nol", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.partialRepay)).suggestedRepayBase).toBeGreaterThan(0n);
  });

  it("HF tepat di ambang deleverage memicu DELEVERAGE", () => {
    expect(decide(posWithHf(DEFAULT_THRESHOLDS.deleverage)).action).toBe("DELEVERAGE");
  });

  it("HF tepat 1.0 sudah darurat", () => {
    expect(decide(posWithHf(HF_ONE)).action).toBe("EMERGENCY");
  });

  it("HF di bawah 1.0 tetap darurat, bukan lempar error", () => {
    expect(decide(posWithHf(900_000_000_000_000_000n)).action).toBe("EMERGENCY");
  });

  it("alasan menyebut angka health factor", () => {
    const d = decide(posWithHf(1_300_000_000_000_000_000n));
    expect(d.reason).toMatch(/1[.,]3/);
  });

  it("alasan menyebut jarak ke likuidasi dalam persen untuk posisi berisiko", () => {
    const d = decide(posWithHf(1_250_000_000_000_000_000n));
    expect(d.reason).toMatch(/20([.,]0)?\s*%/);
  });

  it("ambang khusus menggantikan ambang default", () => {
    const ketat = { warn: 3n * HF_ONE, partialRepay: 2n * HF_ONE, deleverage: 15n * HF_ONE / 10n };
    expect(decide(posWithHf(25n * HF_ONE / 10n), ketat).action).toBe("WARN");
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `corepack pnpm test`

- [ ] **Step 3: Implement**

`src/strategy/decide.ts`. A pure function; `reason` is assembled from numbers, not from an LLM. Format the HF with two decimals and the distance to liquidation with one decimal, using a comma as the decimal separator per Indonesian convention. The order of the checks is exactly as in the table above — from the most severe to the mildest, so that boundary cases fall to the safer action.

Binding implementation notes:
- `suggestedRepayBase` for `PARTIAL_REPAY`, `DELEVERAGE`, and `EMERGENCY` is computed with `repayToReachTarget(pos, thresholds.warn)` — the recovery target is the warning threshold, not merely clearing the nearest threshold.
- `WARN` and `NONE` are always `0n`.
- `dropToLiquidationBps` is filled from `dropToLiquidationBps(pos.healthFactor)`.

- [ ] **Step 4: Run until green**

Run: `corepack pnpm test`
Expected: every test PASS.

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): deterministic decision engine with tiered thresholds"
```

---

### Task 4: On-chain adapters for Venus & Aave

**Files:**
- Create: `src/strategy/chain/client.ts`, `src/strategy/chain/aave.ts`, `src/strategy/chain/venus.ts`, `src/strategy/__tests__/chain.test.ts`

**Interfaces:**
- Consumes: `viem`, `types.js`
- Produces:
  - `chain/client.ts`: `function createReader(rpcUrl?: string)` → `{ client, readAavePosition, readVenusLiquidity }`. It lives in its own file because both adapters use it.
  - `async function readAavePosition(client, account): Promise<Position>`
  - `async function readVenusLiquidity(client, account): Promise<{ liquidityBase: bigint; shortfallBase: bigint; blockNumber: bigint }>`

**Addresses already verified live (do not swap them without re-verifying):**
```
BSC mainnet RPC   https://bsc-dataseed.bnbchain.org
Aave v3 Pool      0x6807dc923806fE8Fd134338EABCA509979a7e0cB
Venus Comptroller 0xfD36E2c2a6789Db23113685031d7F16329158384
```

**Binding facts, verified live:**
- `getUserAccountData` returns six values in order: `totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor`.
- For an account with no debt, `healthFactor` is `2n ** 256n - 1n`. The adapter **must** normalize it to `null`.
- `getAccountLiquidity` returns three values: `error, liquidity, shortfall`.

- [ ] **Step 1: Write the tests first**

`src/strategy/__tests__/chain.test.ts`. These tests **touch the real network** (read-only, free) — give each test a 30-second `timeout`.
```ts
import { describe, expect, it } from "vitest";
import { createReader } from "../chain/client.js";
import { readVenusLiquidity } from "../chain/venus.js";

const AKUN_KOSONG = "0x0000000000000000000000000000000000000001" as const;

describe("adapter Aave v3 (BSC mainnet, read-only)", () => {
  it("membaca posisi akun kosong tanpa melempar", { timeout: 30_000 }, async () => {
    const r = createReader();
    const pos = await r.readAavePosition(AKUN_KOSONG);
    expect(pos.protocol).toBe("aave");
    expect(pos.account).toBe(AKUN_KOSONG);
    expect(pos.blockNumber).toBeGreaterThan(0n);
  });

  it("menormalkan healthFactor tak terhingga menjadi null", { timeout: 30_000 }, async () => {
    const r = createReader();
    const pos = await r.readAavePosition(AKUN_KOSONG);
    // an account with no debt: Aave returns 2^256-1
    expect(pos.debtBase).toBe(0n);
    expect(pos.healthFactor).toBeNull();
  });
});

describe("adapter Venus (BSC mainnet, read-only)", () => {
  it("membaca likuiditas akun tanpa melempar", { timeout: 30_000 }, async () => {
    const r = createReader();
    const v = await readVenusLiquidity(r.client, AKUN_KOSONG);
    expect(v.shortfallBase).toBe(0n);
    expect(v.blockNumber).toBeGreaterThan(0n);
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `corepack pnpm test`

- [ ] **Step 3: Implement**

In `chain/client.ts`, build `createReader(rpcUrl = "https://bsc-dataseed.bnbchain.org")`, which constructs a viem `publicClient` against the `bsc` chain, exposes the raw `client`, and then delegates to `readAavePosition` and `readVenusLiquidity` from the two adapters. The adapters themselves take `client` as a parameter so they remain testable in isolation.

`readAavePosition` calls `getUserAccountData`, then:
- `healthFactor` is normalized: if the value is `2n ** 256n - 1n` **or** `debtBase === 0n`, make it `null`.
- `liquidationThresholdBps` is filled from `currentLiquidationThreshold` (Aave already returns it in basis points).
- `blockNumber` is taken from `client.getBlockNumber()`.

`readVenusLiquidity` calls `getAccountLiquidity` and returns `liquidity` and `shortfall`. If the `error` value is not `0n`, throw a `PositionError` whose message names that error code.

Put a comment at the top of both files stating that the reads happen on **mainnet** because Venus and Aave only exist there, that they are read-only, and that they cost nothing.

- [ ] **Step 4: Run until green**

Run: `corepack pnpm test`
Expected: every test PASS. If the RPC rejects you, try `https://bsc-rpc.publicnode.com` — **do not** use a `binance.org` domain, it is proven to be blocked from this network.

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): read-only Venus and Aave v3 adapters"
```

---

### Task 5: The explanation layer through dGrid

**Files:**
- Create: `src/strategy/explain.ts`, `src/strategy/__tests__/explain.test.ts`

**Interfaces:**
- Consumes: `Decision`, `Position`, `buildModel` from `../model.js`
- Produces: `async function explainDecision(pos: Position, decision: Decision, deps?: { generate?: GenerateFn }): Promise<string>`

**Binding rules:**
- This function **must not** change the decision. It receives a finished `Decision` and only produces a sentence.
- If the LLM call fails or exceeds 20 seconds, **return `decision.reason` as-is** — do not throw. A failed explanation must never stop the position from being protected.
- The prompt must carry the numbers that were already computed and must forbid the model from inventing any other number.
- `deps.generate` exists so that tests can inject a fake function without touching the network.

- [ ] **Step 1: Write the tests first**

`src/strategy/__tests__/explain.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { explainDecision } from "../explain.js";
import { HF_ONE, type Decision, type Position } from "../types.js";

const pos: Position = {
  protocol: "aave",
  account: "0x0000000000000000000000000000000000000001",
  collateralBase: 1000n,
  debtBase: 500n,
  liquidationThresholdBps: 8000n,
  healthFactor: 1_600_000_000_000_000_000n,
  blockNumber: 1n,
};

const keputusan: Decision = {
  action: "WARN",
  healthFactor: 1_600_000_000_000_000_000n,
  dropToLiquidationBps: 3750n,
  reason: "Health factor 1,60. Agunan boleh turun 37,5% sebelum likuidasi.",
  suggestedRepayBase: 0n,
};

describe("explainDecision", () => {
  it("memakai keluaran model bila pemanggilan berhasil", async () => {
    const teks = await explainDecision(pos, keputusan, {
      generate: async () => "Posisi Anda masih aman.",
    });
    expect(teks).toBe("Posisi Anda masih aman.");
  });

  it("jatuh kembali ke alasan deterministik bila model gagal", async () => {
    const teks = await explainDecision(pos, keputusan, {
      generate: async () => {
        throw new Error("dGrid mati");
      },
    });
    expect(teks).toBe(keputusan.reason);
  });

  it("jatuh kembali ke alasan deterministik bila model mengembalikan teks kosong", async () => {
    const teks = await explainDecision(pos, keputusan, { generate: async () => "   " });
    expect(teks).toBe(keputusan.reason);
  });

  it("tidak pernah mengubah keputusan yang diterimanya", async () => {
    const salinan = { ...keputusan };
    await explainDecision(pos, keputusan, { generate: async () => "apa pun" });
    expect(keputusan).toEqual(salinan);
  });

  it("prompt memuat angka health factor dan melarang mengarang", async () => {
    let promptTertangkap = "";
    await explainDecision(pos, keputusan, {
      generate: async (p) => {
        promptTertangkap = p;
        return "ok";
      },
    });
    expect(promptTertangkap).toContain("1,60");
    expect(promptTertangkap.toLowerCase()).toContain("jangan");
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `corepack pnpm test`

- [ ] **Step 3: Implement**

`src/strategy/explain.ts`. The default `generate` uses `generateText` from `ai` with the model from `buildModel()`. Wrap it in a `Promise.race` against a 20-second timeout. Catch every failure and return `decision.reason`.

The prompt must state: the protocol, the formatted HF number, the distance to liquidation as a percentage, the action taken, and the amount suggested for repayment if there is one — then close with a firm prohibition against inventing numbers beyond the ones given.

Put a comment at the top of the file stating that this module sits **outside the critical path**: the decision was already made before this function was called, and its failure never changes the protection that is running.

- [ ] **Step 4: Run until green**

Run: `corepack pnpm test`
Expected: every test PASS without touching the network (they all use a fake `deps.generate`).

- [ ] **Step 5: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): dGrid explanation outside the critical path, failing safely"
```

---

### Task 6: The backtest harness — proving the agent beats a human

**Files:**
- Create: `src/strategy/backtest.ts`, `src/strategy/__tests__/backtest.test.ts`

**Interfaces:**
- Consumes: `healthFactor.js`, `decide.js`, `types.js`
- Produces:
  - `interface BacktestResult { candles: number; agentInterventions: number; agentLiquidations: number; humanLiquidations: number; liquidationsAvoided: number; }`
  - `function runBacktest(input: { startCollateralBase: bigint; startDebtBase: bigint; liquidationThresholdBps: bigint; priceSeriesBps: bigint[]; humanReactionCandles: number; thresholds?: Thresholds }): BacktestResult`

**Binding simulation model:**
- `priceSeriesBps[i]` is the collateral price relative to the starting price, in basis points (`10000n` = the starting price).
- At each candle, compute the HF from the price-adjusted collateral, then `decide`.
- **The agent** acts on the same candle where the action is not `NONE`/`WARN`: the debt is reduced by `suggestedRepayBase`.
- **The human** only acts `humanReactionCandles` candles after the action was first needed.
- A liquidation is recorded when HF ≤ 1.0 before the party in question got to act.
- `liquidationsAvoided = humanLiquidations − agentLiquidations`.

- [ ] **Step 1: Write the tests first**

`src/strategy/__tests__/backtest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { runBacktest } from "../backtest.js";

const dasar = {
  startCollateralBase: 10_000n,
  startDebtBase: 5_000n,
  liquidationThresholdBps: 8000n,
};

describe("runBacktest", () => {
  it("pasar tenang tidak menghasilkan intervensi maupun likuidasi", () => {
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 10_050n, 9_980n, 10_010n],
      humanReactionCandles: 3,
    });
    expect(r.agentInterventions).toBe(0);
    expect(r.agentLiquidations).toBe(0);
    expect(r.humanLiquidations).toBe(0);
    expect(r.liquidationsAvoided).toBe(0);
  });

  it("menghitung setiap candle yang diberikan", () => {
    const r = runBacktest({ ...dasar, priceSeriesBps: [10_000n, 9_000n, 8_000n], humanReactionCandles: 1 });
    expect(r.candles).toBe(3);
  });

  it("penurunan tajam melikuidasi manusia yang lambat tetapi tidak melikuidasi agent", () => {
    // the collateral falls 45% over two candles; the human only reacts five candles later
    const r = runBacktest({
      ...dasar,
      priceSeriesBps: [10_000n, 7_000n, 5_500n, 5_400n, 5_300n, 5_200n],
      humanReactionCandles: 5,
    });
    expect(r.agentInterventions).toBeGreaterThan(0);
    expect(r.humanLiquidations).toBeGreaterThan(r.agentLiquidations);
    expect(r.liquidationsAvoided).toBe(r.humanLiquidations - r.agentLiquidations);
  });

  it("manusia yang bereaksi secepat agent tidak tertolong lebih banyak", () => {
    const seri = [10_000n, 7_000n, 5_500n, 5_400n];
    const cepat = runBacktest({ ...dasar, priceSeriesBps: seri, humanReactionCandles: 0 });
    expect(cepat.liquidationsAvoided).toBe(0);
  });

  it("posisi tanpa hutang tidak pernah terlikuidasi seberapa pun harga jatuh", () => {
    const r = runBacktest({
      ...dasar,
      startDebtBase: 0n,
      priceSeriesBps: [10_000n, 1_000n, 100n],
      humanReactionCandles: 0,
    });
    expect(r.agentLiquidations).toBe(0);
    expect(r.humanLiquidations).toBe(0);
  });
});
```

- [ ] **Step 2: Run them, confirm they fail**

Run: `corepack pnpm test`

- [ ] **Step 3: Implement**

`src/strategy/backtest.ts`, a pure function with no I/O. Run two separate simulations over the same price series: one for the agent, one for the human with the reaction delay. Record a liquidation when HF touches or falls below `HF_ONE` before that party got to act.

Put a comment at the top of the file stating its limitations honestly: this simulation does not model gas, slippage, failed transactions, or network congestion, so its numbers are an upper bound on the agent's advantage — not a promise.

- [ ] **Step 4: Run until green**

Run: `corepack pnpm test`
Expected: every test PASS.

- [ ] **Step 5: Run the whole suite and record the count**

Run: `corepack pnpm test`
Expected: every test from Task 1–6 green.

- [ ] **Step 6: Commit**

```bash
git add ai/fuguguardian/app/agent
git commit -m "feat(guardian): liquidations-avoided backtest harness"
```

---

## Definition of Done

- [ ] `corepack pnpm test` fully green in `ai/fuguguardian/app/agent/`
- [ ] Every function in `src/strategy/` other than `chain/` and `explain.ts` is pure — no network, no `Date.now()`, no `process.env`
- [ ] The adapters successfully read Aave and Venus from BSC mainnet in a real test
- [ ] `explainDecision` is proven to return the deterministic reason when the LLM fails
- [ ] No financial decision passes through an LLM
- [ ] The backtest reports a `liquidationsAvoided` figure whose origin can be explained
