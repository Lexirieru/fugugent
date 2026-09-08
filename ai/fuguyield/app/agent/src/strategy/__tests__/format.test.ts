import { describe, expect, it } from "vitest";
import { formatApyBps, formatBps, formatPercentFromBps, formatToken18, formatUsd8 } from "../format.js";

describe("formatUsd8", () => {
  it("12345678 basis 8 desimal adalah $0,12 — bukan dua belas juta", () => {
    expect(formatUsd8(12_345_678n)).toBe("$0,12");
  });

  it("pecahan sen dipotong", () => {
    expect(formatUsd8(99_999_999n)).toBe("$0,99");
  });

  it("pemisah ribuan gaya Indonesia", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12.345.678,00");
  });

  it("negatif tetap terbaca negatif — kerugian tidak boleh menyamar jadi keuntungan", () => {
    expect(formatUsd8(-100_000_000n)).toBe("-$1,00");
  });

  it("nilai di atas MAX_SAFE_INTEGER tetap presisi penuh", () => {
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9.007.199.254.740.993,00");
  });
});

describe("formatApyBps", () => {
  it("500 bps adalah 5,00% setahun", () => {
    expect(formatApyBps(500n)).toBe("5,00%");
  });

  it("dua desimal karena selisih APY yang diperdebatkan strategi ini berukuran puluhan bps", () => {
    expect(formatApyBps(195n)).toBe("1,95%");
    expect(formatApyBps(1n)).toBe("0,01%");
  });

  it("APY besar tetap terbaca", () => {
    expect(formatApyBps(100_000n)).toBe("1.000,00%");
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
  it("2000 bps adalah 20,0 persen", () => {
    expect(formatPercentFromBps(2_000n)).toBe("20,0");
  });

  it("satuan bps ditulis eksplisit", () => {
    expect(formatBps(390n)).toBe("390 bps");
  });
});
