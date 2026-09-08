import { describe, expect, it } from "vitest";
import { formatBps, formatPercentFromBps, formatPriceUsd8, formatToken18, formatUsd8 } from "../format.js";

describe("formatUsd8", () => {
  it("12345678 basis 8 desimal adalah $0,12 — bukan dua belas juta", () => {
    expect(formatUsd8(12_345_678n)).toBe("$0,12");
  });

  it("pecahan sen dipotong, tidak dibulatkan ke atas", () => {
    expect(formatUsd8(99_999_999n)).toBe("$0,99");
  });

  it("pemisah ribuan gaya Indonesia", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12.345.678,00");
  });

  it("nilai di atas MAX_SAFE_INTEGER tetap presisi penuh", () => {
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9.007.199.254.740.993,00");
  });
});

describe("formatPriceUsd8", () => {
  it("harga besar tetap dua desimal", () => {
    expect(formatPriceUsd8(60_000_000_000n)).toBe("$600,00");
  });

  it("harga token murah TIDAK dipotong menjadi $0,00", () => {
    // This is why prices get their own formatter: every grid line on a token priced at a
    // ten-thousandth of a dollar would look identical through formatUsd8.
    expect(formatPriceUsd8(12_345n)).toBe("$0,00012345");
    expect(formatUsd8(12_345n)).toBe("$0,00");
  });

  it("nol trailing dipangkas tetapi minimal dua desimal dipertahankan", () => {
    expect(formatPriceUsd8(150_000_000n)).toBe("$1,50");
    expect(formatPriceUsd8(100_000_000n)).toBe("$1,00");
  });

  it("negatif tetap terbaca negatif", () => {
    expect(formatPriceUsd8(-100_000_000n)).toBe("-$1,00");
  });
});

describe("formatToken18", () => {
  it("1e18 wei adalah 1,000000 token — semua token BSC 18 desimal", () => {
    expect(formatToken18(10n ** 18n)).toBe("1,000000");
  });

  it("dipotong pada enam desimal", () => {
    expect(formatToken18(1_234_567_890_123_456_789n)).toBe("1,234567");
  });
});

describe("formatPercentFromBps dan formatBps", () => {
  it("285 bps adalah 28,5 persen dibagi sepuluh — yaitu 2,8 persen", () => {
    expect(formatPercentFromBps(285n)).toBe("2,8");
  });

  it("satuan bps ditulis eksplisit supaya tidak tertukar dengan persen", () => {
    expect(formatBps(285n)).toBe("285 bps");
  });

  it("negatif tetap terbaca negatif", () => {
    expect(formatPercentFromBps(-2_000n)).toBe("-20,0");
  });
});
