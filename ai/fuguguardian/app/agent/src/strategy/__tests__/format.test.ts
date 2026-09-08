import { describe, expect, it } from "vitest";
import { formatHf, formatPercentFromBps, formatUsd8 } from "../format.js";
import { HF_ONE } from "../types.js";

describe("formatUsd8", () => {
  it("12345678 (basis 8 desimal) adalah $0,12, bukan belasan juta", () => {
    // Inti bug satuan yang diperbaiki: angka mentah 12345678 terbaca manusia
    // sebagai dua belas juta, padahal artinya dua belas sen.
    expect(formatUsd8(12_345_678n)).toBe("$0,12");
  });

  it("100000000 adalah tepat $1,00", () => {
    expect(formatUsd8(100_000_000n)).toBe("$1,00");
  });

  it("nol ditampilkan sebagai $0,00", () => {
    expect(formatUsd8(0n)).toBe("$0,00");
  });

  it("pecahan sen dipotong, tidak dibulatkan ke atas", () => {
    // 0,999999 dolar tidak boleh terlihat sebagai $1,00.
    expect(formatUsd8(99_999_999n)).toBe("$0,99");
  });

  it("nilai besar memakai pemisah ribuan gaya Indonesia", () => {
    expect(formatUsd8(1_234_567_800_000_000n)).toBe("$12.345.678,00");
  });

  it("nilai negatif tetap terbaca sebagai negatif", () => {
    expect(formatUsd8(-100_000_000n)).toBe("-$1,00");
  });

  it("nilai jauh di atas MAX_SAFE_INTEGER tetap presisi penuh", () => {
    // 9_007_199_254_740_993 (2^53 + 1) sebagai basis 8 desimal.
    // Lewat Number() digit terakhirnya akan hilang; bigint mempertahankannya.
    expect(formatUsd8(900_719_925_474_099_300_000_001n)).toBe("$9.007.199.254.740.993,00");
  });
});

describe("formatHf", () => {
  it("1e18 adalah 1,00", () => {
    expect(formatHf(HF_ONE)).toBe("1,00");
  });

  it("dua desimal selalu ditulis penuh", () => {
    expect(formatHf(1_600_000_000_000_000_000n)).toBe("1,60");
    expect(formatHf(1_050_000_000_000_000_000n)).toBe("1,05");
  });

  it("dipotong ke bawah supaya posisi tidak terlihat lebih sehat dari aslinya", () => {
    expect(formatHf(1_299_999_999_999_999_999n)).toBe("1,29");
  });
});

describe("formatPercentFromBps", () => {
  it("2000 bps adalah 20,0 persen", () => {
    expect(formatPercentFromBps(2000n)).toBe("20,0");
  });

  it("3750 bps adalah 37,5 persen", () => {
    expect(formatPercentFromBps(3750n)).toBe("37,5");
  });

  it("nol bps adalah 0,0 persen", () => {
    expect(formatPercentFromBps(0n)).toBe("0,0");
  });
});
