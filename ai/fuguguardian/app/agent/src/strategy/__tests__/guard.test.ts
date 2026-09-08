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
const REPAY_ASSET = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

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
    pendingRepay: null,
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
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
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
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => clock };
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
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
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

  it("startGuardLoop mengalirkan state eksekusi antar siklus: anggaran habis di siklus 1 menolak siklus 2, sendRepay hanya sekali", async () => {
    // Round 2 review: test dua-siklus sebelumnya memanggil runGuardCycle
    // langsung dan mengalirkan state secara manual di level test -- itu
    // mengunci kontrak runGuardCycle, TAPI TIDAK mengunci bahwa startGuardLoop
    // benar-benar melakukan pengaliran itu sendiri. Test ini menjalankan dua
    // siklus lewat startGuardLoop sungguhan (fake timers), sehingga kalau
    // baris yang menyimpan `outcome.nextExecuteState` ke `currentExecuteState`
    // dihapus, test ini (bukan hanya test level runGuardCycle) yang gagal.
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
      const theLimits = limits({
        maxPerActionUsd8: 100_000_000_000n, // $1000
        maxPerDayUsd8: 100_000_000_000n, // $1000/hari -- habis dalam satu kirim
        minIntervalSeconds: 0, // isolasi murni pada anggaran harian, bukan cooldown
      });
      const execFn: ExecuteFn = (decision, pos, state) =>
        executeDecision(decision, pos, theLimits, state, execDeps);

      const deps = baseDeps({
        readPosition: vi.fn(async () => EMERGENCY_POSITION),
        executeDecision: execFn,
        now: () => 1_700_000_000,
      });

      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      // Siklus 1 (segera): anggaran penuh -> kirim, menghabiskan seluruh
      // anggaran harian dalam satu transaksi.
      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);

      // Siklus 2, dijadwalkan SENDIRI oleh loop 1000ms kemudian. Bila state
      // eksekusi siklus 1 mengalir dengan benar ke siklus ini, anggaran
      // harian sudah nol -> tidak boleh mengirim lagi.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).toHaveBeenCalledTimes(1);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logger yang melempar terus-menerus (jalur sukses) tidak menghentikan penjadwalan siklus berikutnya", async () => {
    vi.useFakeTimers();
    try {
      const throwingLogger: Logger = {
        info: vi.fn(() => {
          throw new Error("EPIPE");
        }),
        error: vi.fn(() => {
          throw new Error("EPIPE");
        }),
      };
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const deps = baseDeps({ logger: throwingLogger, readPosition });

      const handle = startGuardLoop(deps, 1_000, execState());

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logger yang melempar terus-menerus (jalur gagal) tidak menghentikan penjadwalan siklus berikutnya", async () => {
    vi.useFakeTimers();
    try {
      const throwingLogger: Logger = {
        info: vi.fn(() => {
          throw new Error("EPIPE");
        }),
        error: vi.fn(() => {
          throw new Error("EPIPE");
        }),
      };
      const readPosition = vi.fn(async () => {
        throw new Error("RPC mati");
      });
      const deps = baseDeps({ logger: throwingLogger, readPosition });

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
});

describe("C2 — kegagalan setelah transaksi mendarat tidak pernah membayar dua kali", () => {
  it("runGuardCycle meneruskan state dari RepaySendError, bukan state lama", async () => {
    // Bentuk kegagalan yang menjadi alasan aturan ini ada: transaksinya sudah
    // mendarat di blok, yang gagal hanya `waitForTransactionReceipt`.
    const sendRepay = vi.fn(async () => {
      throw new Error("waitForTransactionReceipt timeout setelah 180s");
    });
    const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits({ minIntervalSeconds: 0 }), state, execDeps);

    const deps = baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
    });

    const { result, nextExecuteState } = await runGuardCycle(deps, execState());

    expectFail(result);
    // Anggaran DAN cooldown bergerak walau siklusnya tercatat gagal...
    expect(nextExecuteState.spentTodayUsd8).toBeGreaterThan(0n);
    expect(nextExecuteState.lastActionAt).toBe(1_700_000_000);
    // ...dan repay dicatat menggantung dengan jangkar rekonsiliasinya.
    expect(nextExecuteState.pendingRepay).not.toBeNull();
    expect(nextExecuteState.pendingRepay?.debtBaseBeforeSend).toBe(EMERGENCY_POSITION.debtBase);
    expect(nextExecuteState.pendingRepay?.blockNumberBeforeSend).toBe(EMERGENCY_POSITION.blockNumber);
  });

  it("INTI TASK: sendRepay melempar setelah tx mendarat -> siklus berikutnya TIDAK mengirim ulang", async () => {
    vi.useFakeTimers();
    try {
      // Satu-satunya hal yang boleh menahan siklus kedua di test ini adalah
      // catatan repay menggantung: cooldown nol, anggaran harian jauh lebih
      // besar daripada satu pembayaran, kill switch mati, dan posisi tetap
      // berada di zona EMERGENCY sehingga `decide` tetap meminta bayar.
      const sendRepay = vi.fn(async () => {
        throw new Error("waitForTransactionReceipt timeout setelah 180s");
      });
      const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
      const theLimits = limits({
        maxPerActionUsd8: 100_000_000_000n,
        maxPerDayUsd8: 100_000_000_000_000n, // tak akan habis oleh satu bayaran
        minIntervalSeconds: 0,
      });
      const execFn: ExecuteFn = (decision, pos, state) =>
        executeDecision(decision, pos, theLimits, state, execDeps);

      // Rantai belum menunjukkan hutang berkurang (node basi / receipt belum
      // terlihat) — persis keadaan di mana versi lama membayar untuk kedua kalinya.
      const deps = baseDeps({
        readPosition: vi.fn(async () => EMERGENCY_POSITION),
        executeDecision: execFn,
        now: () => 1_700_000_000,
      });

      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      // Tiga siklus, satu pengiriman. Inilah yang dibeli oleh seluruh perubahan C2.
      expect(sendRepay).toHaveBeenCalledTimes(1);
      expect(handle.getExecuteState().pendingRepay).not.toBeNull();

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rantai membuktikan repay mendarat -> catatan dibereskan dan Guardian boleh bertindak lagi", async () => {
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => {
        throw new Error("waitForTransactionReceipt timeout setelah 180s");
      });
      const execDeps: ExecuteDeps = { repayAsset: REPAY_ASSET, sendRepay, now: () => 1_700_000_000 };
      const theLimits = limits({
        maxPerActionUsd8: 100_000_000_000n,
        maxPerDayUsd8: 100_000_000_000_000n,
        minIntervalSeconds: 0,
      });
      const execFn: ExecuteFn = (decision, pos, state) =>
        executeDecision(decision, pos, theLimits, state, execDeps);

      // Siklus 1 membaca posisi apa adanya; siklus berikutnya membaca posisi
      // dengan hutang yang SUDAH berkurang pada blok yang lebih baru — bukti
      // on-chain bahwa transaksi yang tadi "gagal" sebenarnya mendarat.
      let bacaanKe = 0;
      const readPosition = vi.fn(async () => {
        bacaanKe += 1;
        if (bacaanKe === 1) return EMERGENCY_POSITION;
        return {
          ...EMERGENCY_POSITION,
          blockNumber: EMERGENCY_POSITION.blockNumber + 5n,
          debtBase: EMERGENCY_POSITION.debtBase - 10_000_000_000n,
        };
      });

      const deps = baseDeps({ readPosition, executeDecision: execFn, now: () => 1_700_000_000 });
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);
      expect(handle.getExecuteState().pendingRepay).not.toBeNull();

      // Siklus 2: rekonsiliasi membereskan catatan, dan karena posisinya masih
      // di zona EMERGENCY, agent boleh mencoba lagi. Guardian tidak membeku
      // selamanya hanya karena satu receipt hilang.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).toHaveBeenCalledTimes(2);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("C3 — kill switch punya tuas, dan state dipersist", () => {
  function killDeps(sendRepay: ReturnType<typeof vi.fn>, overrides: Partial<GuardCycleDeps> = {}) {
    const execDeps: ExecuteDeps = {
      repayAsset: REPAY_ASSET,
      sendRepay: sendRepay as unknown as ExecuteDeps["sendRepay"],
      now: () => 1_700_000_000,
    };
    const execFn: ExecuteFn = (decision, pos, state) =>
      executeDecision(decision, pos, limits({ minIntervalSeconds: 0 }), state, execDeps);
    return baseDeps({
      readPosition: vi.fn(async () => EMERGENCY_POSITION),
      executeDecision: execFn,
      now: () => 1_700_000_000,
      ...overrides,
    });
  }

  it("kill() saat loop berjalan menghentikan pengiriman siklus berikutnya", async () => {
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay);
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(sendRepay).toHaveBeenCalledTimes(1);
      expect(handle.isKilled()).toBe(false);

      handle.kill();
      expect(handle.isKilled()).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).toHaveBeenCalledTimes(1);
      const terakhir = handle.getLastResult();
      expect(terakhir?.ok).toBe(true);
      expect(terakhir?.ok === true ? terakhir.executeReason : "").toMatch(/kill switch/i);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("kill() di TENGAH siklus tidak bisa dibatalkan oleh hasil siklus itu", async () => {
    vi.useFakeTimers();
    try {
      let lepas!: (pos: Position) => void;
      const tertunda = new Promise<Position>((resolve) => {
        lepas = resolve;
      });
      let bacaanKe = 0;
      const readPosition = vi.fn(async () => {
        bacaanKe += 1;
        return bacaanKe === 1 ? tertunda : EMERGENCY_POSITION;
      });
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay, { readPosition });
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }));

      await vi.advanceTimersByTimeAsync(0);
      expect(readPosition).toHaveBeenCalledTimes(1);

      // Kill ditarik selagi siklus 1 masih menunggu RPC. Siklus itu akan
      // selesai membawa state dengan `killed: false` -- state itu TIDAK boleh
      // membatalkan kill yang sudah ditarik.
      handle.kill();
      lepas(EMERGENCY_POSITION);
      await vi.advanceTimersByTimeAsync(0);

      expect(handle.isKilled()).toBe(true);
      expect(handle.getExecuteState().killed).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      // Siklus 1 sempat mengirim (kill datang setelah ia lewat aturan 1);
      // siklus 2 tidak boleh mengirim sama sekali.
      expect(sendRepay).toHaveBeenCalledTimes(1);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saveExecuteState dipanggil setiap siklus dan saat kill()", async () => {
    vi.useFakeTimers();
    try {
      const tersimpan: ExecuteState[] = [];
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay);
      const handle = startGuardLoop(deps, 1_000, execState({ dayStartedAt: 1_700_000_000 }), {
        saveExecuteState: (s) => {
          tersimpan.push(s);
        },
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(tersimpan).toHaveLength(1);
      expect(tersimpan[0].spentTodayUsd8).toBeGreaterThan(0n);

      handle.kill();
      await vi.advanceTimersByTimeAsync(0);
      expect(tersimpan.at(-1)?.killed).toBe(true);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saveExecuteState yang melempar dicatat tetapi tidak mematikan loop", async () => {
    vi.useFakeTimers();
    try {
      const readPosition = vi.fn(async () => SAFE_POSITION);
      const logger = silentLogger();
      const deps = baseDeps({ readPosition, logger });
      const handle = startGuardLoop(deps, 1_000, execState(), {
        saveExecuteState: () => {
          throw new Error("disk penuh");
        },
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(readPosition).toHaveBeenCalledTimes(3);
      expect(logger.error).toHaveBeenCalled();

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("state awal yang sudah killed tetap dihormati dan tidak pernah lepas", async () => {
    vi.useFakeTimers();
    try {
      const sendRepay = vi.fn(async () => "0xdeadbeef" as `0x${string}`);
      const deps = killDeps(sendRepay);
      const handle = startGuardLoop(deps, 1_000, execState({ killed: true }));

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sendRepay).not.toHaveBeenCalled();
      expect(handle.isKilled()).toBe(true);

      handle.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
