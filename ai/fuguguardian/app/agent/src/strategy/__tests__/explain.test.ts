import { describe, expect, it, vi } from "vitest";
import { decide } from "../decide.js";
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

  it("timer dibersihkan setelah generate berhasil", async () => {
    vi.useFakeTimers();
    try {
      const teks = await explainDecision(pos, keputusan, {
        generate: async () => "Selesai lebih dulu daripada timeout.",
      });
      expect(teks).toBe("Selesai lebih dulu daripada timeout.");
      // If the 20-second timeout timer is not cleared once generate wins, it stays
      // registered here even though its result is no longer used.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumlah repay muncul sebagai dolar terbaca, bukan angka basis mentah", async () => {
    // 12345678 on the 8-decimal basis = $0.12. Before the fix this raw number went into
    // the prompt as-is and could be read back to the user as tens of millions of dollars.
    const keputusanRepay: Decision = {
      action: "PARTIAL_REPAY",
      healthFactor: 1_150_000_000_000_000_000n,
      dropToLiquidationBps: 1304n,
      reason: "Health factor 1,15.",
      suggestedRepayBase: 12_345_678n,
    };
    let promptTertangkap = "";
    await explainDecision(pos, keputusanRepay, {
      generate: async (p) => {
        promptTertangkap = p;
        return "ok";
      },
    });
    expect(promptTertangkap).toContain("$0,12");
    expect(promptTertangkap).not.toContain("12345678");
    expect(promptTertangkap.toLowerCase()).toContain("dolar as");
  });

  it("angka di prompt identik dengan angka di reason deterministik", async () => {
    // Both sides use the single formatting source (src/strategy/format.ts), so the user
    // cannot possibly see two versions of the same number.
    const p: Position = {
      protocol: "aave",
      account: "0x0000000000000000000000000000000000000001",
      collateralBase: 10_000n,
      debtBase: 6_400n,
      liquidationThresholdBps: 8000n,
      healthFactor: HF_ONE * 125n / 100n,
      blockNumber: 1n,
    };
    const d = decide(p);
    let promptTertangkap = "";
    await explainDecision(p, d, {
      generate: async (teks) => {
        promptTertangkap = teks;
        return "ok";
      },
    });
    expect(d.reason).toContain("1,25");
    expect(promptTertangkap).toContain("1,25");
    expect(d.reason).toContain("20,0%");
    expect(promptTertangkap).toContain("20,0%");
  });
});
