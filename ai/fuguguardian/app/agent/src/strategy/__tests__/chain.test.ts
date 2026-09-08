import { describe, expect, it } from "vitest";
import { createReader } from "../chain/client.js";
import { readVenusLiquidity } from "../chain/venus.js";

const AKUN_KOSONG = "0x0000000000000000000000000000000000000001" as const;

describe("the Aave v3 adapter (BSC mainnet, read-only)", () => {
  it("reads an empty account's position without throwing", { timeout: 30_000 }, async () => {
    const r = createReader();
    const pos = await r.readAavePosition(AKUN_KOSONG);
    expect(pos.protocol).toBe("aave");
    expect(pos.account).toBe(AKUN_KOSONG);
    expect(pos.blockNumber).toBeGreaterThan(0n);
  });

  it("normalizes an infinite healthFactor to null", { timeout: 30_000 }, async () => {
    const r = createReader();
    const pos = await r.readAavePosition(AKUN_KOSONG);
    // an account with no debt: Aave returns 2^256-1
    expect(pos.debtBase).toBe(0n);
    expect(pos.healthFactor).toBeNull();
  });
});

describe("the Venus adapter (BSC mainnet, read-only)", () => {
  it("reads an account's liquidity without throwing", { timeout: 30_000 }, async () => {
    const r = createReader();
    const v = await readVenusLiquidity(r.client, AKUN_KOSONG);
    // The field names state their own scale (1e18), unlike Position's `*Base` fields, which
    // are on Aave's 8-decimal basis.
    expect(v.shortfallUsd18).toBe(0n);
    expect(v.liquidityUsd18).toBe(0n);
    expect(v.blockNumber).toBeGreaterThan(0n);
  });
});
