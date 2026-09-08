import { describe, expect, it, vi } from "vitest";
import { executeDecision, type ExecuteDeps, type ExecuteLimits, type ExecuteState } from "../execute.js";
import type { Decision, Position } from "../types.js";

const POS: Position = {
  protocol: "aave",
  account: "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E",
  collateralBase: 750_000_000_000n,
  debtBase: 312_500_000_000n,
  liquidationThresholdBps: 7_500n,
  healthFactor: 1_800_000_000_000_000_000n,
  blockNumber: 1n,
};

function decisionWith(action: Decision["action"], suggestedRepayBase: bigint): Decision {
  return {
    action,
    healthFactor: POS.healthFactor,
    dropToLiquidationBps: 0n,
    reason: "test",
    suggestedRepayBase,
  };
}

function limits(overrides: Partial<ExecuteLimits> = {}): ExecuteLimits {
  return {
    maxPerActionUsd8: 100_000_000_000n, // $1000
    maxPerDayUsd8: 500_000_000_000n, // $5000
    minIntervalSeconds: 300,
    ...overrides,
  };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: 1_000_000,
    lastActionAt: 0,
    killed: false,
    ...overrides,
  };
}

function deps(overrides: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    sendRepay: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe("executeDecision", () => {
  it("aturan 1: kill switch mutlak, tidak pernah mengirim", async () => {
    const d = decisionWith("EMERGENCY", 50_000_000_000n);
    const s = state({ killed: true });
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 1: kill switch mengalahkan segalanya, bahkan saat semua batas lain longgar", async () => {
    const d = decisionWith("PARTIAL_REPAY", 1_000n);
    const s = state({ killed: true, lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 999_999 });
    const result = await executeDecision(d, POS, limits({ minIntervalSeconds: 0 }), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it.each(["NONE", "WARN"] as const)("aturan 2: aksi %s tidak pernah mengirim", async (action) => {
    const d = decisionWith(action, 0n);
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 3: jumlah melebihi batas per-aksi dipotong, bukan ditolak", async () => {
    const d = decisionWith("PARTIAL_REPAY", 200_000_000_000n); // $2000, batas $1000
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(true);
    expect(result.amountSentUsd8).toBe(100_000_000_000n);
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 100_000_000_000n);
  });

  it("tidak memotong bila jumlah masih di bawah batas per-aksi", async () => {
    const d = decisionWith("PARTIAL_REPAY", 50_000_000_000n); // $500
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(false);
    expect(result.amountSentUsd8).toBe(50_000_000_000n);
  });

  it("aturan 4: jumlah melebihi sisa anggaran harian dipotong ke sisa", async () => {
    const d = decisionWith("PARTIAL_REPAY", 80_000_000_000n); // $800, di bawah cap per-aksi
    const s = state({ spentTodayUsd8: 450_000_000_000n }); // sisa dari $5000: $500
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerDay).toBe(true);
    expect(result.amountSentUsd8).toBe(50_000_000_000n); // sisa $500
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 50_000_000_000n);
  });

  it("pemotongan per-aksi dan harian berlaku bersamaan", async () => {
    // suggestedRepayBase ($2000) > maxPerActionUsd8 ($1000) > sisa harian ($300)
    const d = decisionWith("PARTIAL_REPAY", 200_000_000_000n);
    const s = state({ spentTodayUsd8: 470_000_000_000n }); // sisa dari $5000: $300
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(true);
    expect(result.cappedPerDay).toBe(true);
    // Jumlah yang benar-benar terkirim adalah sisa harian ($300), bukan
    // batas per-aksi ($1000) — pemotongan kedua lebih ketat dari yang pertama.
    expect(result.amountSentUsd8).toBe(30_000_000_000n);
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 30_000_000_000n);
  });

  it("aturan 4: sisa anggaran harian nol -> tidak mengirim", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 500_000_000_000n }); // sudah habis
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 5: cooldown menolak sebelum minIntervalSeconds terlewati", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 299 }); // minIntervalSeconds default 300
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 5: cooldown mengizinkan tepat setelah minIntervalSeconds terlewati", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 300 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(dep.sendRepay).toHaveBeenCalledOnce();
  });

  it("aturan 6: setelah kirim berhasil, spentTodayUsd8 dan lastActionAt diperbarui", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 5_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({ now: () => 1_000_500 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.state.spentTodayUsd8).toBe(15_000_000_000n);
    expect(result.state.lastActionAt).toBe(1_000_500);
    expect(result.state.dayStartedAt).toBe(1_000_000);
  });

  it("aturan 6: anggaran harian direset bila sudah lewat 24 jam", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 499_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({ now: () => 1_000_000 + 86_401 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerDay).toBe(false);
    expect(result.amountSentUsd8).toBe(10_000_000_000n);
    expect(result.state.spentTodayUsd8).toBe(10_000_000_000n);
    expect(result.state.dayStartedAt).toBe(1_000_000 + 86_401);
  });

  it("tidak mengirim apa pun ke jaringan sungguhan — sendRepay selalu dependency yang disuntikkan", async () => {
    const d = decisionWith("EMERGENCY", 10_000_000_000n);
    const dep = deps();
    await executeDecision(d, POS, limits(), state(), dep);
    expect(dep.sendRepay).toHaveBeenCalledTimes(1);
  });

  it("kegagalan kirim tidak menghabiskan anggaran", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 5_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const spentTodaySebelum = s.spentTodayUsd8;
    const lastActionAtSebelum = s.lastActionAt;
    const dep = deps({
      sendRepay: vi.fn(async () => {
        throw new Error("RPC menolak transaksi");
      }),
      now: () => 1_000_500,
    });

    // Kegagalan tidak boleh ditelan diam-diam — pemanggil harus melihatnya.
    await expect(executeDecision(d, POS, limits(), s, dep)).rejects.toThrow(
      "RPC menolak transaksi",
    );

    // State yang dipegang pemanggil sama sekali tidak berubah: anggaran
    // tidak boleh terpakai untuk transaksi yang gagal dikirim.
    expect(s.spentTodayUsd8).toBe(spentTodaySebelum);
    expect(s.lastActionAt).toBe(lastActionAtSebelum);
  });
});
