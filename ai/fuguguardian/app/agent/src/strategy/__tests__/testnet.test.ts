import { describe, expect, it } from "vitest";
import { createTestnetReader } from "../chain/testnet.js";

/**
 * Posisi contoh yang sudah dipasang manual di MockLendingPool BSC testnet:
 * agunan $7.500, hutang $3.125, ambang likuidasi 75%, HF 1,8000.
 */
const AKUN_CONTOH = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;
const HF_KIRA_KIRA = 1_800_000_000_000_000_000n; // 1.8e18

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

      // HF harus mendekati 1.8e18 — beri toleransi kecil untuk drift harga oracle mock.
      const hf = pos.healthFactor as bigint;
      const toleransi = 10_000_000_000_000_000n; // 0.01e18
      const selisih = hf > HF_KIRA_KIRA ? hf - HF_KIRA_KIRA : HF_KIRA_KIRA - hf;
      expect(selisih).toBeLessThanOrEqual(toleransi);
    },
  );
});
