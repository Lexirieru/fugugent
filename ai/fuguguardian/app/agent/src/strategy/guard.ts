/**
 * Loop pemantauan Guardian. Merangkai modul yang sudah ada — `decide`,
 * `executeDecision`, `explainDecision`, pembaca posisi — menjadi satu siklus
 * yang benar-benar berjalan, lalu memanggilnya berulang.
 *
 * Tidak ada logika keputusan atau eksekusi baru di sini: `runGuardCycle`
 * murni menjalankan baca posisi → `decide` → `executeDecision` → lalu
 * `explainDecision`, dan mengubah hasilnya menjadi satu catatan.
 *
 * ATURAN YANG TIDAK BOLEH DILANGGAR:
 *
 * 1. Satu siklus TIDAK PERNAH melempar. Agent yang mati diam-diam jauh
 *    lebih berbahaya daripada agent yang mengeluh — user yang mengira
 *    posisinya sedang dijaga padahal proses sudah mati adalah skenario
 *    terburuk untuk agent yang memegang uang orang lain. Karena itu setiap
 *    tahap (baca posisi, `decide`, eksekusi) dibungkus try/catch sendiri
 *    dan kegagalan di mana pun menghasilkan `CycleResult` gagal, bukan
 *    exception yang menjalar ke `startGuardLoop` dan mematikan proses.
 * 2. `explainDecision` dipanggil SETELAH eksekusi selesai, tidak pernah
 *    sebelum — hasil eksekusi sudah final sebelum kalimat penjelasan
 *    disusun. Kegagalan penjelasan (timeout dGrid, network, dll.) ditangkap
 *    terpisah dan TIDAK PERNAH mengubah `action`/`amountSentUsd8`/`txHash`
 *    yang sudah terjadi; penjelasan jatuh kembali ke `decision.reason`.
 */
import { decide } from "./decide.js";
import type { Action, Decision, Position, Thresholds } from "./types.js";
import type { ExecuteResult } from "./execute.js";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Membaca posisi terkini dari rantai; disuntikkan agar test tak menyentuh jaringan. */
export type ReadPositionFn = (account: `0x${string}`) => Promise<Position>;

/**
 * Bentuk yang dipakai `runGuardCycle` untuk memanggil eksekusi. Ini adalah
 * `executeDecision` asli dari `execute.ts` yang sudah di-partial-apply oleh
 * pemanggil (limits, state, dan `ExecuteDeps` seperti `sendRepay`/`now`
 * ditutup di sisi pemanggil) — `guard.ts` sendiri tidak tahu dan tidak perlu
 * tahu apa pun tentang batas anggaran atau bagaimana transaksi dikirim.
 */
export type ExecuteFn = (decision: Decision, pos: Position) => Promise<ExecuteResult>;

/** `explainDecision` asli, dipanggil setelah eksekusi. */
export type ExplainFn = (pos: Position, decision: Decision) => Promise<string>;

export interface GuardCycleDeps {
  account: `0x${string}`;
  readPosition: ReadPositionFn;
  executeDecision: ExecuteFn;
  explainDecision: ExplainFn;
  /** Jam sekarang dalam detik epoch; disuntikkan agar waktu bisa dikontrol penuh saat test. */
  now: () => number;
  logger: Logger;
  /** Ambang opsional untuk `decide`; default `DEFAULT_THRESHOLDS` bila tidak diisi. */
  thresholds?: Thresholds;
}

/** Catatan satu siklus yang berhasil dijalankan sampai selesai. */
export interface CycleSuccess {
  ok: true;
  timestamp: number;
  account: `0x${string}`;
  healthFactor: bigint | null;
  action: Action;
  amountSentUsd8: bigint;
  txHash: `0x${string}` | null;
  reason: string;
  explanation: string;
}

/**
 * Catatan satu siklus yang gagal di salah satu tahap (baca posisi, `decide`,
 * atau eksekusi). Siklus gagal TETAP menghasilkan catatan — tidak pernah
 * melempar ke pemanggil.
 */
export interface CycleFailure {
  ok: false;
  timestamp: number;
  account: `0x${string}`;
  error: string;
}

export type CycleResult = CycleSuccess | CycleFailure;

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Menjalankan satu siklus pemantauan: baca posisi → `decide` → `executeDecision`
 * → `explainDecision`. Tidak pernah melempar; setiap kegagalan menghasilkan
 * `CycleResult` dengan `ok: false` dan pesan error, sehingga pemanggil
 * (`startGuardLoop`) selalu bisa lanjut ke siklus berikutnya.
 */
export async function runGuardCycle(deps: GuardCycleDeps): Promise<CycleResult> {
  const timestamp = deps.now();

  let pos: Position;
  try {
    pos = await deps.readPosition(deps.account);
  } catch (err) {
    const error = toMessage(err);
    deps.logger.error("guard: gagal membaca posisi, siklus dilewati", {
      account: deps.account,
      error,
    });
    return { ok: false, timestamp, account: deps.account, error };
  }

  let decision: Decision;
  try {
    decision = decide(pos, deps.thresholds);
  } catch (err) {
    const error = toMessage(err);
    deps.logger.error("guard: decide gagal, siklus dilewati", {
      account: deps.account,
      error,
    });
    return { ok: false, timestamp, account: deps.account, error };
  }

  let execResult: ExecuteResult;
  try {
    execResult = await deps.executeDecision(decision, pos);
  } catch (err) {
    const error = toMessage(err);
    deps.logger.error("guard: eksekusi gagal, siklus dilewati", {
      account: deps.account,
      action: decision.action,
      error,
    });
    return { ok: false, timestamp, account: deps.account, error };
  }

  // Titik ini: eksekusi sudah final. Apa pun yang terjadi di bawah pada
  // penjelasan TIDAK PERNAH mengubah `execResult` atau `decision` di atas.
  let explanation: string;
  try {
    explanation = await deps.explainDecision(pos, decision);
  } catch (err) {
    deps.logger.error("guard: penjelasan gagal, memakai alasan mentah", {
      account: deps.account,
      error: toMessage(err),
    });
    explanation = decision.reason;
  }

  deps.logger.info("guard: siklus selesai", {
    account: deps.account,
    action: decision.action,
    sent: execResult.sent,
    txHash: execResult.txHash,
  });

  return {
    ok: true,
    timestamp,
    account: deps.account,
    healthFactor: decision.healthFactor,
    action: decision.action,
    amountSentUsd8: execResult.amountSentUsd8,
    txHash: execResult.txHash,
    reason: decision.reason,
    explanation,
  };
}

export interface GuardLoopHandle {
  /** Menghentikan loop segera. Siklus yang sedang berjalan dibiarkan selesai, tetapi tidak ada siklus baru dijadwalkan sesudahnya. */
  stop: () => void;
}

/**
 * Menjalankan `runGuardCycle` berulang setiap `intervalMs`, dimulai segera
 * (tidak menunggu interval pertama). Mengembalikan handle yang bisa
 * dihentikan kapan saja — baik oleh user (kill switch di level proses)
 * maupun oleh test, tanpa perlu menunggu siklus berikutnya.
 *
 * `runGuardCycle` sendiri sudah dijamin tidak melempar, tetapi loop ini
 * tetap menangkap kegagalan tak terduga di sekitarnya (defense in depth)
 * supaya satu siklus yang bermasalah tidak pernah menghentikan seluruh loop.
 */
export function startGuardLoop(deps: GuardCycleDeps, intervalMs: number): GuardLoopHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, intervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      await runGuardCycle(deps);
    } catch (err) {
      // `runGuardCycle` tidak seharusnya pernah sampai sini, tetapi loop
      // tidak boleh mati diam-diam meski itu terjadi.
      deps.logger.error("guard: siklus melempar tak terduga, loop tetap lanjut", {
        account: deps.account,
        error: toMessage(err),
      });
    }
    scheduleNext();
  }

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
