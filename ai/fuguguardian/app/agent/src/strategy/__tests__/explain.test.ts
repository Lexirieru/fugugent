import { describe, expect, it, vi } from "vitest";
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
      // Bila timer timeout 20 detik tidak di-clearTimeout setelah generate
      // menang, ia akan tetap terdaftar di sini walau hasilnya sudah tidak
      // dipakai lagi.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
