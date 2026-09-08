import { describe, expect, it } from "vitest";
import { formatBps, formatPercentFromBps, formatToken18, formatUsd8 } from "../format.js";

describe("formatUsd8", () => {
  it("12345678 basis 8 desimal adalah $0,12 — bukan dua belas juta", () => {
    expect(formatUsd8(12_345_678n)).toBe("$0,12");
  });

  it("100000000 adalah tepat $1,00", () => {
    expect(formatUsd8(100_000_000n)).toBe("$1,00");
  });

  it("pecahan sen dipotong, tidak dibulatkan ke atas", () => {
    expect(formatUsd8(99_999_999n)).toBe("$0,99");
  });

  it("pemisah ribuan gaya Indonesia", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12.345.678,00");
  });

  it("negatif tetap terbaca negatif", () => {
    expect(formatUsd8(-100_000_000n)).toBe("-$1,00");
  });

  it("nilai di atas MAX_SAFE_INTEGER tetap presisi penuh", () => {
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9.007.199.254.740.993,00");
  });
});

describe("formatToken18", () => {
  it("1e18 wei adalah 1,000000 token — 18 desimal, termasuk untuk USDT di BSC", () => {
    expect(formatToken18(10n ** 18n)).toBe("1,000000");
  });

  it("menampilkan enam desimal dan memotong sisanya", () => {
    expect(formatToken18(1_234_567_890_123_456_789n)).toBe("1,234567");
  });

  it("nilai sangat kecil tidak dibulatkan menjadi nol yang menyesatkan bila memang nol pada enam desimal", () => {
    expect(formatToken18(1n)).toBe("0,000000");
  });

  it("negatif tetap terbaca negatif", () => {
    expect(formatToken18(-(10n ** 18n))).toBe("-1,000000");
  });
});

describe("formatPercentFromBps", () => {
  it("2000 bps adalah 20,0 persen", () => {
    expect(formatPercentFromBps(2_000n)).toBe("20,0");
  });

  it("3750 bps adalah 37,5 persen", () => {
    expect(formatPercentFromBps(3_750n)).toBe("37,5");
  });

  it("nilai negatif ditampilkan dengan tanda minus, bukan pecahan aneh", () => {
    expect(formatPercentFromBps(-3_750n)).toBe("-37,5");
  });
});

describe("formatBps", () => {
  it("menulis satuan bps secara eksplisit supaya tidak tertukar dengan persen", () => {
    expect(formatBps(50n)).toBe("50 bps");
  });
});
