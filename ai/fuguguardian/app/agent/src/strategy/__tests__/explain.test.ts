import { describe, expect, it } from "vitest";
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
});
