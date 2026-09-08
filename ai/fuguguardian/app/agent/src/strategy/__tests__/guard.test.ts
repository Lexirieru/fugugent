import { describe, expect, it, vi } from "vitest";
import {
  runGuardCycle,
  startGuardLoop,
  type CycleResult,
  type ExecuteFn,
  type GuardCycleDeps,
  type Logger,
} from "../guard.js";
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

// HF 1,05e18 > HF_ONE (1e18) tetapi <= ambang deleverage default (1,1e18) ->
// `decide` menghasilkan DELEVERAGE, bukan EMERGENCY (yang butuh HF <= 1,0e18).
const RISKY_POSITION: Position = {
  ...SAFE_POSITION,
  debtBase: 500_000_000_000n,
  healthFactor: 1_050_000_000_000_000_000n,
};

// HF <= HF_ONE -> EMERGENCY.
const EMERGENCY_POSITION: Position = {
  ...SAFE_POSITION,
  debtBase: 600_000_000_000n,
  healthFactor: 980_000_000_000_000_000n,
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

function canned(overrides: Partial<ExecuteResult> = {}): ExecuteResult {
  return {
    sent: false,
    reason: "test: tidak mengirim",
    amountSentUsd8: 0n,
    cappedPerAction: false,
    cappedPerDay: false,
    txHash: null,
    state: execState(),
    ...overrides,
  };
}

function baseDeps(overrides: Partial<GuardCycleDeps> = {}): GuardCycleDeps {
  return {
    account: ACCOUNT,
    readPosition: vi.fn(async () => SAFE_POSITION),
    executeDecision: vi.fn(async (): Promise<ExecuteResult> => canned()),
    explainDecision: vi.fn(async () => "Penjelasan ramah dari LLM."),
    now: () => 1_700_000_000,
    logger: silentLogger(),
    ...overrides,
  };
}

function expectOk(result: CycleResult): asserts result is CycleResult & { ok: true } {
  if (!result.ok) throw new Error(`expected ok cycle, got failure: ${result.error}`);
}

function expectFail(result: CycleResult): asserts result is CycleResult & { ok: false } {
  if (result.ok) throw new Error("expected failed cycle, got success");
}

describe("runGuardCycle", () => {
  it("siklus normal menghasilkan catatan lengkap", async () => {
    // RISKY_POSITION (aksi != NONE) sengaja dipakai di sini, bukan
    // SAFE_POSITION, supaya `explainDecision` benar-benar dipanggil dan
    // catatan memuat penjelasan dari mock, bukan fallback `decision.reason`
    // (lihat aturan #2 di kepala modul: NONE melewati explainDecision).
    const deps = baseDeps({ readPosition: vi.fn(async () => RISKY_POSITION) });
    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.timestamp).toBe(1_700_000_000);
    expect(result.account).toBe(ACCOUNT);
    expect(result.healthFactor).toBe(RISKY_POSITION.healthFactor);
    expect(result.action).not.toBe("NONE");
    expect(result.sent).toBe(false);
    expect(result.amountSentUsd8).toBe(0n);
    expect(result.txHash).toBeNull();
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
    expect(typeof result.executeReason).toBe("string");
    expect(result.explanation).toBe("Penjelasan ramah dari LLM.");
    // Tidak ada eksekusi nyata di siklus ini -> state eksekusi tidak berubah.
    expect(nextExecuteState).toEqual(execState());
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

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectFail(result);
    expect(result.error).toContain("RPC mati");
    expect(result.account).toBe(ACCOUNT);
    expect(executeDecisionSpy).not.toHaveBeenCalled();
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalled();
    expect(nextExecuteState).toEqual(execState());
  });

  it("kegagalan eksekusi (mis. ditolak) tidak melempar dan tercatat sebagai siklus gagal, state tidak berubah", async () => {
    const executeDecisionSpy = vi.fn(async () => {
      throw new Error("eksekusi ditolak oleh session key");
    });
    const explainDecisionSpy = vi.fn();
    const startingState = execState({ spentTodayUsd8: 7_000_000n, lastActionAt: 42 });
    const deps = baseDeps({
      executeDecision: executeDecisionSpy,
      explainDecision: explainDecisionSpy,
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, startingState);

    expectFail(result);
    expect(result.error).toContain("eksekusi ditolak");
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    // Kontrak execute.ts: state hanya berubah SETELAH kirim berhasil. Kalau
    // executeDecision melempar, tidak ada state baru -- state lama diteruskan
    // apa adanya, bukan diam-diam dianggap berubah.
    expect(nextExecuteState).toEqual(startingState);
  });

  it("kegagalan penjelasan tidak mengubah hasil eksekusi yang sudah terjadi", async () => {
    const successResult = canned({
      sent: true,
      reason: "terkirim",
      amountSentUsd8: 42_000_000n,
      txHash: "0xdeadbeef" as `0x${string}`,
      state: execState({ spentTodayUsd8: 42_000_000n, lastActionAt: 1_700_000_000 }),
    });
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION),
      executeDecision: vi.fn(async () => successResult),
      explainDecision: vi.fn(async () => {
        throw new Error("dGrid timeout");
      }),
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectOk(result);
    // Hasil eksekusi tetap utuh walau penjelasan gagal.
    expect(result.sent).toBe(true);
    expect(result.amountSentUsd8).toBe(42_000_000n);
    expect(result.txHash).toBe("0xdeadbeef");
    expect(nextExecuteState).toEqual(successResult.state);
    // Penjelasan jatuh kembali PERSIS ke alasan mentah dari keputusan, bukan
    // ke pesan error yang bocor atau string generik lain.
    expect(result.explanation).toBe(result.reason);
  });

  it("aksi NONE tidak pernah memanggil sendRepay (lewat executeDecision asli)", async () => {
    const sendRepay = vi.fn(async () => "0xabc" as `0x${string}`);
    const execDeps: ExecuteDeps = { sendRepay, now: () => 1_700_000_000 };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits(), state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => SAFE_POSITION), // HF tinggi -> decide menghasilkan NONE
      executeDecision: execFn,
    });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.action).toBe("NONE");
    expect(sendRepay).not.toHaveBeenCalled();
  });

  it("aksi NONE tidak memanggil explainDecision sama sekali", async () => {
    const explainDecisionSpy = vi.fn(async () => "tidak boleh terlihat");
    const deps = baseDeps({
      readPosition: vi.fn(async () => SAFE_POSITION),
      explainDecision: explainDecisionSpy,
    });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.action).toBe("NONE");
    expect(explainDecisionSpy).not.toHaveBeenCalled();
    expect(result.explanation).toBe(result.reason);
  });

  it("aksi selain NONE tetap memanggil explainDecision", async () => {
    const explainDecisionSpy = vi.fn(async () => "penjelasan LLM");
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION),
      explainDecision: explainDecisionSpy,
    });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.action).not.toBe("NONE");
    expect(explainDecisionSpy).toHaveBeenCalledOnce();
    expect(result.explanation).toBe("penjelasan LLM");
  });

  it("penjelasan dipanggil setelah eksekusi -- urutan pemanggilan dibuktikan", async () => {
    const order: string[] = [];
    const deps = baseDeps({
      readPosition: vi.fn(async () => RISKY_POSITION), // butuh aksi != NONE agar explain dipanggil
      executeDecision: vi.fn(async () => {
        order.push("execute");
        return canned();
      }),
      explainDecision: vi.fn(async () => {
        order.push("explain");
        return "penjelasan";
      }),
    });

    await runGuardCycle(deps, execState());

    expect(order).toEqual(["execute", "explain"]);
  });

  it("dua siklus berturut-turut dengan executeDecision asli: siklus kedua ditolak oleh cooldown/anggaran, sendRepay hanya sekali", async () => {
    const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
    let clock = 1_700_000_000;
    const execDeps: ExecuteDeps = { sendRepay, now: () => clock };
    const theLimits = limits({
      maxPerActionUsd8: 100_000_000_000n, // $1000
      maxPerDayUsd8: 100_000_000_000n, // $1000/hari -- habis dalam satu kirim
      minIntervalSeconds: 3_600, // 1 jam
    });
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, theLimits, state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
      now: () => clock,
    });

    const initialState = execState({ dayStartedAt: clock });

    const first = await runGuardCycle(deps, initialState);
    expectOk(first.result);
    expect(first.result.sent).toBe(true);
    expect(sendRepay).toHaveBeenCalledTimes(1);
    // Anggaran harian sudah habis dan cooldown baru mulai -- state HARUS
    // membawa ini ke siklus berikutnya, bukan direset ke `initialState`.
    expect(first.nextExecuteState.spentTodayUsd8).toBeGreaterThan(0n);
    expect(first.nextExecuteState.lastActionAt).toBe(clock);

    // Siklus kedua, 60 detik kemudian (mensimulasikan intervalMs = 60_000
    // di startGuardLoop) -- BUKAN 1 jam, jadi masih dalam cooldown DAN
    // anggaran harian sudah habis dari siklus pertama.
    clock += 60;
    const second = await runGuardCycle(deps, first.nextExecuteState);
    expectOk(second.result);
    expect(second.result.sent).toBe(false);
    expect(second.result.amountSentUsd8).toBe(0n);
    // sendRepay TIDAK dipanggil lagi -- inilah pembuktian bahwa state
    // benar-benar mengalir, bukan direset diam-diam setiap siklus.
    expect(sendRepay).toHaveBeenCalledTimes(1);
  });

  it("logger yang melempar (mis. EPIPE) tidak menghentikan siklus", async () => {
    const throwingLogger: Logger = {
      info: vi.fn(() => {
        throw new Error("EPIPE");
      }),
      error: vi.fn(() => {
        throw new Error("EPIPE");
      }),
    };
    const deps = baseDeps({
      logger: throwingLogger,
      readPosition: vi.fn(async () => {
        throw new Error("RPC mati");
      }),
    });

    const { result } = await runGuardCycle(deps, execState());

    expectFail(result);
    expect(result.error).toContain("RPC mati");
  });

  it("now() yang melempar tidak menghentikan siklus, timestamp fallback dipakai", async () => {
    const throwingNow = vi.fn(() => {
      throw new Error("jam sistem rusak");
    });
    const deps = baseDeps({ now: throwingNow });

    const { result } = await runGuardCycle(deps, execState());

    expectOk(result);
    expect(result.timestamp).toBe(0);
  });

  it("catatan membedakan alasan keputusan dari alasan eksekusi (kill switch menolak EMERGENCY)", async () => {
    const sendRepay = vi.fn(async () => "0xabc" as `0x${string}`);
    const execDeps: ExecuteDeps = { sendRepay, now: () => 1_700_000_000 };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits(), state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
    });

    const { result } = await runGuardCycle(deps, execState({ killed: true }));

    expectOk(result);
    expect(result.action).toBe("EMERGENCY");
    expect(result.sent).toBe(false);
    expect(result.amountSentUsd8).toBe(0n);
    expect(sendRepay).not.toHaveBeenCalled();
    // Alasan keputusan bicara soal health factor/likuidasi...
    expect(result.reason).toMatch(/likuidasi|darurat/i);
    // ...sedangkan alasan eksekusi harus secara eksplisit bicara soal kill switch
    // -- pembaca catatan harus bisa membedakan "tidak dikirim karena kill
    // switch" dari "tidak dikirim karena cooldown/anggaran habis".
    expect(result.executeReason).toMatch(/kill switch/i);
    expect(result.executeReason).not.toBe(result.reason);
  });
});

describe("startGuardLoop", () => {
  it("loop bisa dihentikan dan berhenti memanggil siklus setelahnya", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

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

  it("kegagalan pembacaan posisi berulang tidak menghentikan loop -- siklus 2 dan 3 tetap berjalan", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => {
        throw new Error("RPC selalu mati");
      });
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);
      expect(handle.getLastResult()?.ok).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);
      expect(handle.getLastResult()?.ok).toBe(false);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop() dipanggil selagi siklus sedang berjalan mencegah siklus berikutnya dijadwalkan", async () => {
    vi.useFakeTimers();
    try {
      let resolveReadPosition!: (pos: Position) => void;
      const pending = new Promise<Position>((resolve) => {
        resolveReadPosition = resolve;
      });
      const readPosition = vi.fn(async () => pending);
      const deps = baseDeps({ readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      // Siklus pertama sudah dimulai (readPosition dipanggil) tapi belum
      // selesai -- stop() dipanggil DI TENGAH siklus yang sedang berjalan.
      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);
      handle.stop();

      // Siklus pertama akhirnya selesai...
      resolveReadPosition(SAFE_POSITION);
      await vi.advanceTimersByTimeAsync(0);

      // ...tetapi karena stop() sudah dipanggil sebelum selesai, tidak ada
      // siklus baru yang dijadwalkan sesudahnya.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(readPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("onCycle dipanggil dengan catatan setiap siklus dan getLastResult mengikuti siklus terbaru", async () => {
    vi.useFakeTimers();
    try {
      const onCycle = vi.fn();
      const deps = baseDeps({ onCycle });
      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(onCycle).toHaveBeenCalledTimes(1);
      const firstArg = onCycle.mock.calls[0][0] as CycleResult;
      expect(firstArg.ok).toBe(true);
      expect(handle.getLastResult()).toEqual(firstArg);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logger.info memuat health factor dan jumlah terformat, bukan basis mentah", async () => {
    vi.useFakeTimers();
    try {
      const logger = silentLogger();
      const deps = baseDeps({ logger });
      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(logger.info).toHaveBeenCalled();
      const meta = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
      expect(meta.healthFactor).toBe("1,80");
      expect(meta.amountSentUsd8).toBe("$0,00");
      expect(typeof meta.decisionReason).toBe("string");
      expect(typeof meta.executeReason).toBe("string");

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("intervalMs nol atau negatif ditolak, bukan menjadi busy loop", () => {
    const deps = baseDeps();
    expect(() => startGuardLoop(deps, 0, execState())).toThrow();
    expect(() => startGuardLoop(deps, -100, execState())).toThrow();
  });
});
