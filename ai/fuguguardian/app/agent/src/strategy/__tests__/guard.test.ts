import { describe, expect, it, vi } from "vitest";
import { runGuardCycle, startGuardLoop, type GuardCycleDeps, type Logger } from "../guard.js";
import {
  executeDecision,
  type ExecuteDeps,
  type ExecuteLimits,
  type ExecuteResult,
  type ExecuteState,
} from "../execute.js";
import type { Decision, Position } from "../types.js";

const ACCOUNT = "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E" as const;

const SAFE_POSITION: Position = {
  protocol: "aave",
  account: ACCOUNT,
  collateralBase: 750_000_000_000n,
  debtBase: 312_500_000_000n,
  liquidationThresholdBps: 7_500n,
  healthFactor: 1_800_000_000_000_000_000n,
  blockNumber: 1n,
};

const RISKY_POSITION: Position = {
  ...SAFE_POSITION,
  debtBase: 500_000_000_000n,
  healthFactor: 1_050_000_000_000_000_000n, // di bawah ambang EMERGENCY (HF_ONE = 1e18)... lihat catatan di bawah
};

function silentLogger(): Logger {
  return { info: vi.fn(), error: vi.fn() };
}

function limits(overrides: Partial<ExecuteLimits> = {}): ExecuteLimits {
  return {
    maxPerActionUsd8: 100_000_000_000n,
    maxPerDayUsd8: 500_000_000_000n,
    minIntervalSeconds: 0,
    ...overrides,
  };
}

function execState(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: 1_000_000,
    lastActionAt: 0,
    killed: false,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<GuardCycleDeps> = {}): GuardCycleDeps {
  return {
    account: ACCOUNT,
    readPosition: vi.fn(async () => SAFE_POSITION),
    executeDecision: vi.fn(
      async (): Promise<ExecuteResult> => ({
        sent: false,
        reason: "test: tidak mengirim",
        amountSentUsd8: 0n,
        cappedPerAction: false,
        cappedPerDay: false,
        txHash: null,
        state: execState(),
      }),
    ),
    explainDecision: vi.fn(async () => "Penjelasan ramah dari LLM."),
    now: () => 1_700_000_000,
    logger: silentLogger(),
    ...overrides,
  };
}

describe("runGuardCycle", () => {
  it("siklus normal menghasilkan catatan lengkap", async () => {
    const deps = baseDeps();
    const result = await runGuardCycle(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.timestamp).toBe(1_700_000_000);
    expect(result.account).toBe(ACCOUNT);
    expect(result.healthFactor).toBe(SAFE_POSITION.healthFactor);
    expect(result.action).toBe("NONE");
    expect(result.amountSentUsd8).toBe(0n);
    expect(result.txHash).toBeNull();
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.explanation).toBe("Penjelasan ramah dari LLM.");
  });

  it("kegagalan pembacaan posisi tidak melempar, tercatat sebagai siklus gagal, dan tidak memanggil eksekusi", async () => {
    const readPosition = vi.fn(async () => {
      throw new Error("RPC mati");
    });
    const executeDecisionSpy = vi.fn();
    const explainDecisionSpy = vi.fn();
    const deps = baseDeps({
      readPosition,
      executeDecision: executeDecisionSpy,
      explainDecision: explainDecisionSpy,
    });

    const record = await runGuardCycle(deps);

    expect(record.ok).toBe(false);
    if (record.ok) throw new Error("unreachable");
    expect(record.error).toContain("RPC mati");
    expect(record.account).toBe(ACCOUNT);
    expect(executeDecisionSpy).not.toHaveBeenCalled();
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("kegagalan eksekusi (mis. ditolak) tidak melempar dan tercatat sebagai siklus gagal", async () => {
    const executeDecisionSpy = vi.fn(async () => {
      throw new Error("eksekusi ditolak oleh session key");
    });
    const explainDecisionSpy = vi.fn();
    const deps = baseDeps({
      executeDecision: executeDecisionSpy,
      explainDecision: explainDecisionSpy,
    });

    const record = await runGuardCycle(deps);

    expect(record.ok).toBe(false);
    if (record.ok) throw new Error("unreachable");
    expect(record.error).toContain("eksekusi ditolak");
    expect(explainDecisionSpy).not.toHaveBeenCalled();
  });

  it("kegagalan penjelasan tidak mengubah hasil eksekusi yang sudah terjadi", async () => {
    const executeResult = {
      sent: true,
      reason: "terkirim",
      amountSentUsd8: 42_000_000n,
      cappedPerAction: false,
      cappedPerDay: false,
      txHash: "0xdeadbeef" as `0x${string}`,
      state: execState({ spentTodayUsd8: 42_000_000n, lastActionAt: 1_700_000_000 }),
    };
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION),
      executeDecision: vi.fn(async () => executeResult),
      explainDecision: vi.fn(async () => {
        throw new Error("dGrid timeout");
      }),
    });

    const result = await runGuardCycle(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Hasil eksekusi tetap utuh walau penjelasan gagal.
    expect(result.amountSentUsd8).toBe(42_000_000n);
    expect(result.txHash).toBe("0xdeadbeef");
    // Penjelasan jatuh kembali ke alasan mentah dari keputusan, bukan melempar.
    expect(typeof result.explanation).toBe("string");
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it("aksi NONE tidak pernah memanggil sendRepay", async () => {
    const sendRepay = vi.fn(async () => "0xabc" as `0x${string}`);
    const execDeps: ExecuteDeps = { sendRepay, now: () => 1_700_000_000 };
    const state = execState();

    const deps = baseDeps({
      readPosition: vi.fn(async () => SAFE_POSITION), // HF tinggi -> decide menghasilkan NONE
      executeDecision: (decision: Decision, pos: Position) =>
        executeDecision(decision, pos, limits(), state, execDeps),
    });

    const result = await runGuardCycle(deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.action).toBe("NONE");
    expect(sendRepay).not.toHaveBeenCalled();
  });

  it("penjelasan dipanggil setelah eksekusi -- urutan pemanggilan dibuktikan", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      executeDecision: vi.fn(async () => {
        order.push("execute");
        return {
          sent: false,
          reason: "test",
          amountSentUsd8: 0n,
          cappedPerAction: false,
          cappedPerDay: false,
          txHash: null,
          state: execState(),
        };
      }),
      explainDecision: vi.fn(async () => {
        order.push("explain");
        return "penjelasan";
      }),
    });

    await runGuardCycle(deps);

    expect(order).toEqual(["execute", "explain"]);
  });
});

describe("startGuardLoop", () => {
  it("loop bisa dihentikan dan berhenti memanggil siklus setelahnya", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000);

      // Siklus pertama berjalan segera.
      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      handle.stop();

      const callsBeforeAdvance = readPosition.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(readPosition).toHaveBeenCalledTimes(callsBeforeAdvance);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() bisa dipanggil segera tanpa menunggu siklus berikutnya", () => {
    vi.useFakeTimers();
    try {
      const deps = baseDeps();
      const handle = startGuardLoop(deps, 60_000);
      expect(() => handle.stop()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
