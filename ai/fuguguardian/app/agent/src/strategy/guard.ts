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
 * 1. Satu siklus TIDAK PERNAH melempar — bukan hanya untuk kegagalan baca
 *    posisi/`decide`/eksekusi, tetapi juga untuk kegagalan `now()` atau
 *    `logger` itu sendiri (round fix pertama: `logger` yang melempar EPIPE
 *    dulu bisa membuat `tick()` mati diam-diam karena `scheduleNext()`
 *    dilewati). Semua pemanggilan logger lewat `logInfo`/`logError` yang
 *    membungkam exception, dan `deps.now()` punya fallback bila gagal.
 * 2. `explainDecision` dipanggil SETELAH eksekusi selesai, tidak pernah
 *    sebelum — hasil eksekusi sudah final sebelum kalimat penjelasan
 *    disusun. Kegagalannya TIDAK PERNAH mengubah `action`/`amountSentUsd8`/
 *    `txHash` yang sudah terjadi. Untuk aksi `NONE` ia dilewati sama sekali
 *    — dGrid butuh 3–46 detik untuk kalimat yang tidak dibaca siapa pun saat
 *    posisi sehat (CLAUDE.md #1: dGrid tidak pernah di jalur kritis).
 * 3. State eksekusi (`ExecuteState` dari `execute.ts`: anggaran harian,
 *    cooldown, kill switch) MENGALIR eksplisit lewat tipe — `runGuardCycle`
 *    menerimanya sebagai parameter dan mengembalikan versi barunya lewat
 *    `nextExecuteState`; `startGuardLoop` yang menyimpannya sendiri di
 *    antara siklus. Ini memperbaiki cacat round pertama: closure pemanggil
 *    yang "harus ingat" menyimpan `execResult.state` membuat batas harian
 *    dan cooldown mati total begitu loop berjalan lebih dari satu siklus.
 * 4. Eksekusi yang GAGAL SETELAH menyentuh jaringan (`RepaySendError`) TETAP
 *    memajukan state. Putaran sebelumnya mengembalikan state lama di semua
 *    jalur gagal — benar untuk kegagalan sebelum kirim, dan berbahaya untuk
 *    kegagalan sesudahnya: receipt yang timeout membuat anggaran dan cooldown
 *    tidak bergerak, dan siklus berikutnya membayar lagi. Lihat catatan
 *    lengkapnya di kepala `execute.ts`.
 */
import { decide } from "./decide.js";
import { formatHf, formatUsd8 } from "./format.js";
import type { Action, Decision, Position, Thresholds } from "./types.js";
import { RepaySendError, type ExecuteResult, type ExecuteState } from "./execute.js";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Membaca posisi terkini dari rantai; disuntikkan agar test tak menyentuh jaringan. */
export type ReadPositionFn = (account: `0x${string}`) => Promise<Position>;

/**
 * Bentuk yang dipakai `runGuardCycle` untuk memanggil eksekusi. Ini adalah
 * `executeDecision` asli dari `execute.ts` yang di-partial-apply oleh
 * pemanggil hanya untuk `limits` dan `ExecuteDeps` (`sendRepay`/`now`) —
 * `state` TIDAK ditutup oleh closure pemanggil, melainkan diteruskan
 * eksplisit oleh `runGuardCycle` pada setiap panggilan (lihat catatan C1
 * di atas). Wiring yang benar di sisi pemanggil:
 *
 * ```ts
 * const execFn: ExecuteFn = (decision, pos, state) =>
 *   executeDecision(decision, pos, limits, state, execDeps);
 * ```
 */
export type ExecuteFn = (
  decision: Decision,
  pos: Position,
  state: ExecuteState,
) => Promise<ExecuteResult>;

/** `explainDecision` asli, dipanggil setelah eksekusi (dan dilewati untuk aksi `NONE`). */
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
  /**
   * Dipanggil setelah setiap siklus (sukses maupun gagal) dengan catatan
   * lengkapnya — dipakai `startGuardLoop` supaya catatan tidak "hilang" di
   * dalam loop (round pertama: `tick()` membuang nilai balik `runGuardCycle`
   * begitu saja). Kegagalan callback ini tidak pernah menghentikan loop.
   */
  onCycle?: (result: CycleResult) => void;
}

/** Catatan satu siklus yang berhasil dijalankan sampai selesai. */
export interface CycleSuccess {
  ok: true;
  timestamp: number;
  account: `0x${string}`;
  healthFactor: bigint | null;
  action: Action;
  /** true bila transaksi repay benar-benar terkirim pada siklus ini. */
  sent: boolean;
  amountSentUsd8: bigint;
  /** true bila jumlah dipotong oleh batas per-aksi (lihat `execute.ts`). */
  cappedPerAction: boolean;
  /** true bila jumlah dipotong oleh sisa anggaran harian (lihat `execute.ts`). */
  cappedPerDay: boolean;
  txHash: `0x${string}` | null;
  /**
   * Alasan KEPUTUSAN — kenapa `decide` memilih `action` ini (`decision.reason`).
   * TIDAK sama dengan `executeReason` di bawah: sebuah `EMERGENCY` yang
   * benar secara keputusan bisa saja tetap `sent: false` karena kill switch,
   * cooldown, atau anggaran habis — dan itu hanya terlihat di `executeReason`.
   */
  reason: string;
  /** Alasan EKSEKUSI — kenapa terkirim, tidak terkirim, atau dipotong (`ExecuteResult.reason`). */
  executeReason: string;
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

/** Hasil satu panggilan `runGuardCycle`: catatan siklus plus state eksekusi yang harus dibawa ke siklus berikutnya. */
export interface GuardCycleOutcome {
  result: CycleResult;
  /**
   * State eksekusi untuk siklus BERIKUTNYA. Sama persis dengan input `executeState`
   * bila siklus ini gagal sebelum sempat mengeksekusi (baca posisi/`decide` gagal)
   * atau bila `executeDecision` sendiri melempar (mengikuti kontrak `execute.ts`:
   * anggaran hanya berubah setelah kirim benar-benar berhasil). Pemanggil WAJIB
   * memakai nilai ini, bukan `executeState` lama, pada panggilan berikutnya.
   */
  nextExecuteState: ExecuteState;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Logging yang tidak pernah melempar. `logger` adalah dependensi yang
 * disuntikkan dari luar (mis. menulis ke pipa, file, atau layanan eksternal)
 * — kegagalannya (pipa tertutup -> EPIPE, disk penuh, dll.) TIDAK PERNAH
 * boleh menghentikan Guardian. Round pertama melewatkan ini: `logger.error`
 * yang melempar di dalam blok `catch` milik `tick()` membuat `scheduleNext()`
 * tidak pernah tercapai, sehingga loop mati diam-diam tanpa jejak sama
 * sekali — persis kegagalan yang task ini ada untuk mencegahnya.
 */
function logInfo(logger: Logger, message: string, meta?: Record<string, unknown>): void {
  try {
    logger.info(message, meta);
  } catch {
    // Logging tidak boleh pernah menjadi alasan Guardian berhenti bekerja.
  }
}

function logError(logger: Logger, message: string, meta?: Record<string, unknown>): void {
  try {
    logger.error(message, meta);
  } catch {
    // Sama seperti di atas.
  }
}

/** Memanggil callback yang disuntikkan pemanggil tanpa membiarkan kegagalannya menjalar. */
function safeInvoke(fn: () => void): void {
  try {
    fn();
  } catch {
    // Callback pihak luar tidak boleh pernah mematikan loop.
  }
}

/**
 * Menjalankan satu siklus pemantauan: baca posisi → `decide` → `executeDecision`
 * → `explainDecision` (dilewati untuk `NONE`). Tidak pernah melempar; setiap
 * kegagalan — termasuk `deps.now()` atau `deps.logger` itu sendiri gagal —
 * menghasilkan `CycleResult` dengan `ok: false`/catatan yang tetap lengkap,
 * sehingga pemanggil (`startGuardLoop`) selalu bisa lanjut ke siklus berikutnya.
 *
 * `executeState` mengalir eksplisit: nilai baru selalu ada di
 * `outcome.nextExecuteState`, dan pemanggil (termasuk `startGuardLoop`
 * sendiri) bertanggung jawab meneruskannya ke panggilan berikutnya — lihat
 * catatan di atas modul ini soal kenapa ini tidak boleh jadi convention
 * yang "diingat sendiri" oleh kode perakit.
 */
export async function runGuardCycle(
  deps: GuardCycleDeps,
  executeState: ExecuteState,
): Promise<GuardCycleOutcome> {
  let timestamp: number;
  try {
    timestamp = deps.now();
  } catch (err) {
    // `now()` gagal adalah kegagalan dependensi kecil, bukan alasan untuk
    // berhenti melindungi posisi — pakai timestamp fallback dan lanjut.
    logError(deps.logger, "guard: now() gagal, memakai timestamp fallback", {
      account: deps.account,
      error: toMessage(err),
    });
    timestamp = 0;
  }

  let pos: Position;
  try {
    pos = await deps.readPosition(deps.account);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "guard: gagal membaca posisi, siklus dilewati", {
      account: deps.account,
      error,
    });
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  let decision: Decision;
  try {
    decision = decide(pos, deps.thresholds);
  } catch (err) {
    const error = toMessage(err);
    logError(deps.logger, "guard: decide gagal, siklus dilewati", {
      account: deps.account,
      error,
    });
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  let execResult: ExecuteResult;
  try {
    execResult = await deps.executeDecision(decision, pos, executeState);
  } catch (err) {
    const error = toMessage(err);
    if (err instanceof RepaySendError) {
      // Transaksinya MUNGKIN sudah mendarat — hanya pembacaan hasilnya yang
      // gagal. State yang dibawa galat ini sudah memotong anggaran, memulai
      // cooldown, dan mencatat repay menggantung; meneruskannya adalah
      // satu-satunya yang mencegah siklus berikutnya membayar untuk kedua
      // kalinya. Mengembalikan `executeState` lama di sini adalah bug C2.
      logError(deps.logger, "guard: pengiriman repay gagal SETELAH mungkin terkirim", {
        account: deps.account,
        action: decision.action,
        error,
        catatan:
          "anggaran dan cooldown tetap dipotong; repay dicatat menggantung sampai " +
          "rantai menunjukkan hutang berkurang",
      });
      return {
        result: { ok: false, timestamp, account: deps.account, error },
        nextExecuteState: err.stateAfterSend,
      };
    }
    logError(deps.logger, "guard: eksekusi gagal, siklus dilewati", {
      account: deps.account,
      action: decision.action,
      error,
    });
    // Kegagalan yang terjadi SEBELUM apa pun menyentuh jaringan (atau sebelum
    // `executeDecision` sempat mengirim): tidak ada yang berubah di rantai,
    // jadi state lama diteruskan apa adanya.
    return {
      result: { ok: false, timestamp, account: deps.account, error },
      nextExecuteState: executeState,
    };
  }

  // Titik ini: eksekusi sudah final. Apa pun yang terjadi di bawah pada
  // penjelasan TIDAK PERNAH mengubah `execResult` atau `decision` di atas.
  let explanation: string;
  if (decision.action === "NONE") {
    // Tidak ada apa pun untuk dijelaskan pada posisi yang aman, dan
    // memanggil dGrid di sini hanya menambah 3–46 detik ke siklus paling
    // umum (posisi sehat) untuk kalimat yang tidak dibaca siapa pun.
    explanation = decision.reason;
  } else {
    try {
      explanation = await deps.explainDecision(pos, decision);
    } catch (err) {
      logError(deps.logger, "guard: penjelasan gagal, memakai alasan mentah", {
        account: deps.account,
        error: toMessage(err),
      });
      explanation = decision.reason;
    }
  }

  return {
    result: {
      ok: true,
      timestamp,
      account: deps.account,
      healthFactor: decision.healthFactor,
      action: decision.action,
      sent: execResult.sent,
      amountSentUsd8: execResult.amountSentUsd8,
      cappedPerAction: execResult.cappedPerAction,
      cappedPerDay: execResult.cappedPerDay,
      txHash: execResult.txHash,
      reason: decision.reason,
      executeReason: execResult.reason,
      explanation,
    },
    nextExecuteState: execResult.state,
  };
}

/** Menulis catatan satu siklus ke logger, dengan nilai USD/HF sudah terformat (tidak pernah basis mentah). */
function logCycleResult(logger: Logger, result: CycleResult): void {
  if (!result.ok) {
    logError(logger, "guard: siklus gagal", {
      account: result.account,
      timestamp: result.timestamp,
      error: result.error,
    });
    return;
  }

  logInfo(logger, "guard: siklus selesai", {
    account: result.account,
    timestamp: result.timestamp,
    action: result.action,
    healthFactor: result.healthFactor === null ? "tidak ada hutang" : formatHf(result.healthFactor),
    sent: result.sent,
    amountSentUsd8: formatUsd8(result.amountSentUsd8),
    cappedPerAction: result.cappedPerAction,
    cappedPerDay: result.cappedPerDay,
    txHash: result.txHash,
    decisionReason: result.reason,
    executeReason: result.executeReason,
    explanation: result.explanation,
  });
}

export interface GuardLoopOptions {
  /**
   * Menyimpan `ExecuteState` setiap kali ia berubah — setelah setiap siklus DAN
   * segera setelah `kill()`. Disuntikkan sebagai fungsi, bukan store konkret,
   * supaya backend bisa memasang Postgres tanpa menyentuh modul ini
   * (`state/store.ts` menyediakan implementasi berkas JSON dan memori).
   *
   * Kegagalannya dicatat lewat logger dan TIDAK PERNAH menghentikan loop:
   * disk penuh tidak boleh membuat Guardian berhenti melindungi posisi. Ia
   * dilaporkan, bukan disembunyikan.
   */
  saveExecuteState?: (state: ExecuteState) => Promise<void> | void;
}

export interface GuardLoopHandle {
  /** Menghentikan loop segera. Siklus yang sedang berjalan dibiarkan selesai, tetapi tidak ada siklus baru dijadwalkan sesudahnya. */
  stop: () => void;
  /**
   * Kill switch sebagai TUAS SUNGGUHAN, bukan sekadar field pada state awal.
   *
   * Sebelum ini `killed` hanya bisa bernilai true kalau ia SUDAH true sebelum
   * loop dimulai — tidak ada jalan menariknya selagi agent berjalan, padahal
   * dokumen produk menyebutnya "jalan keluar user". `kill()` menutup itu:
   * ia langsung menyetel `killed`, mempersistkannya, dan sejak saat itu setiap
   * siklus berikutnya ditolak `executeDecision` pada aturan pertama.
   *
   * Ini KAIT SATU ARAH. Sebuah siklus yang sedang berjalan saat `kill()`
   * dipanggil akan selesai dengan state yang masih `killed: false`; hasil
   * itu TIDAK boleh membatalkan kill. Karena itu kill dicatat terpisah dan
   * di-OR-kan ke setiap state yang masuk.
   *
   * `kill()` tidak menghentikan loop: pemantauan dan pencatatan tetap jalan,
   * yang berhenti adalah pengiriman transaksi. Untuk berhenti total panggil
   * `stop()` juga.
   */
  kill: () => void;
  /** Apakah kill switch sudah ditarik. */
  isKilled: () => boolean;
  /** State eksekusi terkini (anggaran, cooldown, kill switch, repay menggantung). */
  getExecuteState: () => ExecuteState;
  /** Catatan siklus terakhir yang selesai, atau `null` bila belum ada satu pun yang selesai. */
  getLastResult: () => CycleResult | null;
}

/**
 * Menjalankan `runGuardCycle` berulang setiap `intervalMs`, dimulai segera
 * (tidak menunggu interval pertama). `initialExecuteState` adalah state
 * eksekusi awal (anggaran harian, cooldown, kill switch); `startGuardLoop`
 * sendiri yang menyimpan dan meneruskan versi terbarunya ke setiap siklus
 * berikutnya lewat `outcome.nextExecuteState` — pemanggil tidak perlu (dan
 * tidak harus) mengelola state itu sendiri lagi.
 *
 * Mengembalikan handle yang bisa dihentikan kapan saja — baik oleh user
 * (kill switch di level proses) maupun oleh test, tanpa perlu menunggu
 * siklus berikutnya. Bila `stop()` dipanggil selagi satu siklus sedang
 * berjalan, siklus itu dibiarkan selesai tetapi tidak ada siklus baru yang
 * dijadwalkan sesudahnya.
 *
 * `runGuardCycle` sendiri sudah dijamin tidak melempar (termasuk kegagalan
 * `now()`/`logger`), tetapi `tick()` tetap membungkusnya dalam try/finally
 * sebagai lapis pertahanan kedua: `scheduleNext()` ada di blok `finally`
 * sehingga bahkan kegagalan tak terduga yang lolos dari semua penjagaan di
 * atas tidak pernah menghentikan penjadwalan siklus berikutnya.
 */
export function startGuardLoop(
  deps: GuardCycleDeps,
  intervalMs: number,
  initialExecuteState: ExecuteState,
  options: GuardLoopOptions = {},
): GuardLoopHandle {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `guard: intervalMs harus bilangan positif dan hingga, diterima ${intervalMs}.`,
    );
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Kait kill satu arah, terpisah dari state siklus: hasil siklus yang sudah
  // berjalan sebelum `kill()` tidak boleh mengembalikan `killed` ke false.
  let killLatched = initialExecuteState.killed;
  let currentExecuteState = initialExecuteState;
  let lastResult: CycleResult | null = null;

  function withKillLatch(state: ExecuteState): ExecuteState {
    return killLatched && !state.killed ? { ...state, killed: true } : state;
  }

  async function persist(state: ExecuteState): Promise<void> {
    if (!options.saveExecuteState) return;
    try {
      await options.saveExecuteState(state);
    } catch (err) {
      logError(deps.logger, "guard: gagal menyimpan state eksekusi, loop tetap berjalan", {
        account: deps.account,
        error: toMessage(err),
      });
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(() => {
      // Timer sudah menyala dan tidak lagi valid untuk di-`clearTimeout` --
      // null-kan sebelum `tick()` supaya `stop()` yang dipanggil sesudahnya
      // tidak memegang id basi (tidak berbahaya, tapi tidak rapi).
      timer = null;
      void tick();
    }, intervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const outcome = await runGuardCycle(deps, withKillLatch(currentExecuteState));
      currentExecuteState = withKillLatch(outcome.nextExecuteState);
      await persist(currentExecuteState);
      lastResult = outcome.result;
      logCycleResult(deps.logger, outcome.result);
      if (deps.onCycle) {
        safeInvoke(() => deps.onCycle!(outcome.result));
      }
    } catch (err) {
      // `runGuardCycle` tidak seharusnya pernah sampai sini, tetapi loop
      // tidak boleh mati diam-diam meski itu terjadi (defense in depth).
      logError(deps.logger, "guard: siklus melempar tak terduga di loop, lanjut ke siklus berikutnya", {
        account: deps.account,
        error: toMessage(err),
      });
    } finally {
      scheduleNext();
    }
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
    kill: () => {
      killLatched = true;
      currentExecuteState = withKillLatch(currentExecuteState);
      logInfo(deps.logger, "guard: kill switch ditarik, tidak ada transaksi baru yang dikirim", {
        account: deps.account,
      });
      // Dipersist di latar: `kill()` harus langsung berlaku di memori, dan
      // penyimpanannya tidak boleh membuat pemanggil menunggu I/O.
      void persist(currentExecuteState);
    },
    isKilled: () => killLatched,
    getExecuteState: () => currentExecuteState,
    getLastResult: () => lastResult,
  };
}
