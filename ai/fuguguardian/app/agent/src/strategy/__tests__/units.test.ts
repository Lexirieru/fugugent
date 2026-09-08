import { describe, expect, it } from "vitest";
import {
  USD8_ONE,
  UnitConversionError,
  assertFeedIsUsd8,
  assertTokenDecimalsAgree,
  tokenUnitsToUsd8,
  usd8ToTokenUnits,
} from "../units.js";

const ASET = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const HARGA_SATU_DOLAR = USD8_ONE; // $1.00 on the 8-decimal basis
const HARGA_750 = 75_000_000_000n; // $750,00

describe("usd8ToTokenUnits", () => {
  it("$1,00 pada harga $1,00 dengan token 18 desimal = 1e18 unit", () => {
    expect(usd8ToTokenUnits(USD8_ONE, 18, HARGA_SATU_DOLAR)).toBe(10n ** 18n);
  });

  it("$6,85 pada harga $1,00 dengan token 18 desimal", () => {
    expect(usd8ToTokenUnits(685_000_000n, 18, HARGA_SATU_DOLAR)).toBe(6_850_000_000_000_000_000n);
  });

  it("stablecoin BSC tetap 18 desimal, bukan 6 — jumlah unitnya beda 10^12", () => {
    // CLAUDE.md #2: every token on BSC has 18 decimals, including USDT. If someone uses 6
    // out of habit from another chain, the amount sent is off by a factor of ten trillion.
    // This test nails that gap down so it is visible.
    const delapanBelas = usd8ToTokenUnits(USD8_ONE, 18, HARGA_SATU_DOLAR);
    const enam = usd8ToTokenUnits(USD8_ONE, 6, HARGA_SATU_DOLAR);
    expect(delapanBelas / enam).toBe(10n ** 12n);
  });

  it("$750,00 pada harga $750,00 dengan token 18 desimal = 1e18 unit (satu token)", () => {
    expect(usd8ToTokenUnits(HARGA_750, 18, HARGA_750)).toBe(10n ** 18n);
  });

  it("membulatkan KE BAWAH: agent tidak pernah mengirim lebih dari yang diputuskan", () => {
    // $0.00000001 at a price of $1 with a zero-decimal token = 1e-8 tokens -> 0 units.
    expect(usd8ToTokenUnits(1n, 0, HARGA_SATU_DOLAR)).toBe(0n);
    // One unit short of two full units is still one unit, not two.
    expect(usd8ToTokenUnits(199_999_999n, 0, HARGA_SATU_DOLAR)).toBe(1n);
  });

  it("nol menghasilkan nol, bukan melempar", () => {
    expect(usd8ToTokenUnits(0n, 18, HARGA_SATU_DOLAR)).toBe(0n);
  });

  it.each([
    ["harga nol", () => usd8ToTokenUnits(USD8_ONE, 18, 0n)],
    ["harga negatif", () => usd8ToTokenUnits(USD8_ONE, 18, -1n)],
    ["jumlah negatif", () => usd8ToTokenUnits(-1n, 18, HARGA_SATU_DOLAR)],
    ["desimal negatif", () => usd8ToTokenUnits(USD8_ONE, -1, HARGA_SATU_DOLAR)],
    ["desimal pecahan", () => usd8ToTokenUnits(USD8_ONE, 18.5, HARGA_SATU_DOLAR)],
    ["desimal tak masuk akal", () => usd8ToTokenUnits(USD8_ONE, 78, HARGA_SATU_DOLAR)],
  ])("menolak masukan tak masuk akal (%s) alih-alih menghitung diam-diam", (_l, jalankan) => {
    expect(jalankan).toThrow(UnitConversionError);
  });
});

describe("tokenUnitsToUsd8", () => {
  it("1e18 unit token 18 desimal pada harga $1,00 = $1,00", () => {
    expect(tokenUnitsToUsd8(10n ** 18n, 18, HARGA_SATU_DOLAR)).toBe(USD8_ONE);
  });

  it("1e18 unit pada harga $750,00 = $750,00", () => {
    expect(tokenUnitsToUsd8(10n ** 18n, 18, HARGA_750)).toBe(HARGA_750);
  });

  it("membulatkan ke bawah", () => {
    expect(tokenUnitsToUsd8(10n ** 18n - 1n, 18, HARGA_SATU_DOLAR)).toBe(USD8_ONE - 1n);
  });
});

describe("assertTokenDecimalsAgree", () => {
  // This replaces the "round-trip check" that used to be in the E2E script. That check
  // computed a*10^d/p then *p/10^d with the SAME d and p, so it holds for any d and p and
  // could never catch wrong decimals or a wrong feed. What actually catches them is
  // comparing two DIFFERENT SOURCES for the same number.
  it("dua sumber sepakat -> lolos", () => {
    expect(() => assertTokenDecimalsAgree(18, 18, ASET)).not.toThrow();
  });

  it("konfigurasi pool bilang 17 sementara token sendiri bilang 18 -> ditolak", () => {
    expect(() => assertTokenDecimalsAgree(17, 18, ASET)).toThrow(UnitConversionError);
    expect(() => assertTokenDecimalsAgree(17, 18, ASET)).toThrow(/17/);
  });
});

describe("assertFeedIsUsd8", () => {
  it("feed 8 desimal lolos: seluruh lapisan ini memperlakukan jawabannya sebagai USD basis 8", () => {
    expect(() => assertFeedIsUsd8(8, ASET)).not.toThrow();
  });

  it.each([6, 18])("feed %s desimal ditolak, bukan dipakai apa adanya", (d) => {
    // `MockPriceFeed` takes `decimals_` as a constructor parameter, so a non-8-decimal feed
    // is not hypothetical — it could be deployed today.
    expect(() => assertFeedIsUsd8(d, ASET)).toThrow(UnitConversionError);
  });
});
