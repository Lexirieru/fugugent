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
    // akun tanpa hutang: Aave mengembalikan 2^256-1
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
