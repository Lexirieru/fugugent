import { describe, expect, it } from "vitest";
import { createTestnetReader } from "../chain/testnet.js";
import { computeHealthFactor } from "../healthFactor.js";

/** The owner of the sample position in MockLendingPool on BSC testnet. */
const AKUN_CONTOH = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;

describe("adapter testnet (MockLendingPool, read-only)", () => {
  it(
    "membaca posisi contoh dari mock lending pool testnet",
    { timeout: 30_000 },
    async () => {
      const r = createTestnetReader();
      const pos = await r.readPosition(AKUN_CONTOH);

      expect(pos.healthFactor).not.toBeNull();
      expect(pos.collateralBase).toBeGreaterThan(0n);
      expect(pos.debtBase).toBeGreaterThan(0n);
      expect(pos.liquidationThresholdBps).toBeGreaterThanOrEqual(1n);
      expect(pos.liquidationThresholdBps).toBeLessThanOrEqual(10_000n);

      // The health factor is DELIBERATELY not pinned to a snapshot number.
      //
      // The previous version demanded HF ~= 1.8 — the sample position's value just after
      // deploy. That was not testing the adapter, it was testing "nobody has touched testnet
      // yet", and it went red the instant the Guardian E2E script
      // (`scripts/e2e-guardian.ts`) did exactly its job: repay part of the debt, permanently
      // reducing the sample position's debt and raising its HF. A test that goes red because
      // the product works is a test demanding the wrong thing.
      //
      // What this adapter really has to guarantee: the numbers the pool reports are read
      // from the right tuple positions and in the right units. That is checked by
      // recomputing HF from `collateralBase`, `debtBase`, and `liquidationThresholdBps` on
      // the SAME reading, using a standalone TypeScript implementation. If the field order
      // is swapped or a unit is off, these two numbers will not match.
      const hf = pos.healthFactor as bigint;
      expect(hf).toBeGreaterThan(0n);
      expect(hf).toBe(
        computeHealthFactor(pos.collateralBase, pos.debtBase, pos.liquidationThresholdBps),
      );

      // The position's identity is still pinned — these two values are NOT changed by a
      // repay, so pinning them does not bring back the brittleness just removed.
      //
      //   - `collateralBase`: a repay only touches the debt side. The sample position's
      //     collateral stays at 10 mBNB, and at the feed price of $750 that is $7,500.00.
      //   - `liquidationThresholdBps`: the pool's asset configuration, not the position's
      //     state.
      //
      // Without both, this test would pass against any Aave v3-ABI pool with any position
      // that happens to be internally consistent — even the wrong pool address would go
      // unnoticed.
      //
      // The dependency is clear and deliberate: `collateralBase` is only correct while the
      // feed's mBNB price is $750. The E2E script (`scripts/e2e-guardian.ts`) lowers that
      // price temporarily, then ALWAYS restores it in a `finally` — including when it fails
      // partway through. If this test goes red here, that is an honest signal that testnet
      // was left in an unrestored state, not merely a fussy test.
      expect(pos.collateralBase).toBe(750_000_000_000n); // $7.500,00 @ $750/mBNB
      expect(pos.liquidationThresholdBps).toBe(7_500n); // 75%
    },
  );
});
