/**
 * Eksekusi ber-batas: pertahanan kedua sebelum transaksi repay dikirim
 * lewat session key Altana. Session key membatasi belanja di sisi rantai,
 * tetapi keselamatan dana user tidak boleh bergantung pada satu lapisan
 * saja — batas di modul ini adalah lapisan kedua, dan kill switch adalah
 * jalan keluar user.
 *
 * Modul ini sendiri bebas I/O: waktu sekarang, alamat aset, dan pengiriman
 * transaksi disuntikkan lewat `deps`, sehingga seluruh aturan bisa diuji
 * tanpa menyentuh jaringan sama sekali dan tanpa satu pun alamat rantai
 * tertanam di sini.
 *
 * Ketujuh aturan berikut ditegakkan SEBELUM transaksi dikirim, tepat dalam
 * urutan ini:
 *   1. `state.killed` → tidak pernah mengirim apa pun. Mutlak, diperiksa
 *      paling awal, mengalahkan segalanya.
 *   2. `state.pendingRepay` belum direkonsiliasi → tidak mengirim apa pun.
 *      Lihat "Kenapa kegagalan kirim justru MEMOTONG anggaran" di bawah.
 *   3. Aksi `NONE`/`WARN` → tidak mengirim (tidak memerlukan eksekusi).
 *   4. Jumlah melebihi `maxPerActionUsd8` → dipotong ke batas itu, bukan
 *      ditolak; dicatat lewat `cappedPerAction`.
 *   5. Jumlah melebihi sisa `maxPerDayUsd8` → dipotong ke sisa lewat
 *      `cappedPerDay`; bila sisa nol, tidak mengirim.
 *   6. Masih dalam `minIntervalSeconds` sejak `lastActionAt` → tidak
 *      mengirim (cooldown).
 *   7. Anggaran dan cooldown dicatat SEBELUM `sendRepay` dipanggil, dan
 *      `pendingRepay` dibereskan hanya bila `sendRepay` benar-benar kembali
 *      dengan hash.
 *
 * ## Kenapa kegagalan kirim justru MEMOTONG anggaran
 *
 * Sampai putaran sebelumnya modul ini hanya mengubah state SETELAH `sendRepay`
 * berhasil, dan `guard.ts` mengembalikan state lama begitu `sendRepay`
 * melempar. Untuk sebuah fungsi murni itu benar; untuk PENGIRIMAN JARINGAN itu
 * terbalik. `waitForTransactionReceipt` yang timeout, RPC yang putus, atau
 * receipt yang datang dari node basi semuanya melempar SESUDAH transaksinya
 * mendarat di blok. Dengan aturan lama, anggaran harian dan `lastActionAt`
 * tidak bergerak, siklus berikutnya melihat posisi yang (mungkin) masih
 * berisiko, dan agent membayar LAGI — berulang sampai cap sesi habis. Setiap
 * pembayaran itu uang sungguhan.
 *
 * Aturan yang benar untuk pengiriman jaringan: **"gagal" tidak berarti "tidak
 * terjadi".** Karena itu:
 *
 *   - Anggaran, `lastActionAt`, dan sebuah catatan `pendingRepay` disusun
 *     SEBELUM `sendRepay` dipanggil.
 *   - Bila `sendRepay` melempar, modul ini melempar `RepaySendError` yang
 *     MEMBAWA state itu (`stateAfterSend`), sehingga pemanggil meneruskannya
 *     ke siklus berikutnya alih-alih pura-pura tidak terjadi apa-apa.
 *   - Selama `pendingRepay` belum dibereskan, aturan 2 menolak mengirim apa
 *     pun. Guardian memilih diam daripada membayar dua kali.
 *
 * Satu-satunya pengecualian adalah galat yang PASTI belum menyentuh jaringan
 * (`NeverSentError`): validasi aset/jumlah dan pembacaan on-chain yang gagal
 * sebelum batch dikirim. Yang menandainya adalah `chain/session.ts`, satu-satunya
 * modul yang tahu di mana persis batas jaringan itu. Galat yang TIDAK bertanda
 * selalu dianggap "mungkin sudah terkirim" — asumsi yang mahal ke arah yang
 * aman, bukan ke arah yang membayar dua kali.
 */
import type { Action, Decision, Position } from "./types.js";

const SECONDS_PER_DAY = 86_400;

/** Aksi yang secara definisi memerlukan pembayaran (lihat decide.ts). */
const ACTIONS_REQUIRING_REPAY: ReadonlySet<Action> = new Set([
  "PARTIAL_REPAY",
  "DELEVERAGE",
  "EMERGENCY",
]);

export interface ExecuteLimits {
  /** Batas dolar (basis 8 desimal, sama seperti Position.collateralBase) per satu aksi. */
  maxPerActionUsd8: bigint;
  /** Batas dolar total yang boleh dibelanjakan dalam satu hari berjalan. */
  maxPerDayUsd8: bigint;
  /** Jarak minimum dalam detik sejak aksi terakhir sebelum aksi berikutnya boleh dikirim. */
  minIntervalSeconds: number;
}

export interface ExecuteDeps {
  /**
   * Alamat token hutang yang dibayar. DISUNTIKKAN, tidak lagi konstanta modul:
   * modul ini murni dan tidak boleh terikat pada satu aset di satu chain.
   * Alamat testnetnya ada di `chain/testnet.ts` bersama alamat rantai lain.
   */
  repayAsset: `0x${string}`;
  /** Mengirim transaksi repay sungguhan; disuntikkan agar modul ini tidak menyentuh jaringan. */
  sendRepay: (asset: `0x${string}`, amount: bigint) => Promise<`0x${string}`>;
  /** Jam sekarang dalam detik epoch; disuntikkan agar waktu bisa dikontrol penuh saat test. */
  now: () => number;
}

/**
 * Catatan satu repay yang sudah dicoba dikirim tetapi belum terbukti selesai.
 * Selama ini tidak null, `executeDecision` menolak mengirim apa pun.
 */
export interface PendingRepay {
  readonly asset: `0x${string}`;
  /** Jumlah yang dicoba dibayar, basis 8 desimal. */
  readonly amountUsd8: bigint;
  /** Detik epoch saat `sendRepay` dipanggil. */
  readonly startedAt: number;
  /** Hash bila sempat diketahui; null bila kegagalan terjadi sebelum hash ada. */
  readonly txHash: `0x${string}` | null;
  /** `debtBase` tepat sebelum kirim — jangkar rekonsiliasi (lihat `reconcilePendingRepay`). */
  readonly debtBaseBeforeSend: bigint;
  /** Blok posisi tepat sebelum kirim — jangkar kedua. */
  readonly blockNumberBeforeSend: bigint;
}

export interface ExecuteState {
  /** Total yang sudah dibelanjakan sejak `dayStartedAt`, basis 8 desimal. */
  spentTodayUsd8: bigint;
  /** Detik epoch mulai hari anggaran berjalan saat ini. */
  dayStartedAt: number;
  /** Detik epoch aksi terakhir yang berhasil dikirim; 0 berarti belum pernah. */
  lastActionAt: number;
  /** Kill switch user. Saat true, tidak ada aksi apa pun yang boleh dikirim. */
  killed: boolean;
  /**
   * Repay yang sudah dicoba dikirim tetapi belum terbukti mendarat. null berarti
   * tidak ada yang menggantung dan Guardian bebas bertindak.
   */
  pendingRepay: PendingRepay | null;
}

export interface ExecuteResult {
  sent: boolean;
  /** Penjelasan singkat kenapa terkirim atau tidak. */
  reason: string;
  /** Jumlah sungguhan yang dikirim, basis 8 desimal. 0n bila tidak terkirim. */
  amountSentUsd8: bigint;
  /** true bila jumlah dipotong oleh batas per-aksi. */
  cappedPerAction: boolean;
  /** true bila jumlah dipotong oleh sisa anggaran harian. */
  cappedPerDay: boolean;
  /** Hash transaksi bila terkirim, null bila tidak. */
  txHash: `0x${string}` | null;
  /** State baru yang harus dipersist oleh pemanggil — modul ini tidak memutasi `state` masukan. */
  state: ExecuteState;
}

/**
 * Galat yang DIJAMIN terjadi sebelum apa pun menyentuh jaringan, sehingga aman
 * diperlakukan sebagai "tidak terjadi": anggaran tidak terpotong dan tidak ada
 * `pendingRepay` yang tertinggal.
 *
 * Yang boleh menandai sebuah galat seperti ini hanyalah modul yang tahu persis
 * di mana batas jaringan berada — `chain/session.ts`. Ditandai lewat properti
 * (`neverSent`), bukan `instanceof`, supaya galat milik modul lain
 * (mis. `SessionPermissionError`) bisa ikut menyatakannya tanpa harus mewarisi
 * kelas dari sini.
 */
export class NeverSentError extends Error {
  readonly neverSent = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NeverSentError";
  }
}

/**
 * Apakah `err` menyatakan dirinya belum menyentuh jaringan sama sekali?
 * Default-nya SELALU false: galat yang tidak menyatakan apa-apa diperlakukan
 * sebagai "mungkin sudah terkirim". Arah asumsi ini yang menentukan apakah
 * agent membayar dua kali.
 */
export function wasNeverSent(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { neverSent?: unknown }).neverSent === true
  );
}

/**
 * `sendRepay` melempar setelah — atau mungkin setelah — transaksi menyentuh
 * jaringan. Membawa state yang WAJIB dipakai pemanggil untuk siklus berikutnya:
 * anggaran sudah terpotong dan `pendingRepay` sudah tercatat.
 */
export class RepaySendError extends Error {
  readonly stateAfterSend: ExecuteState;
  constructor(message: string, stateAfterSend: ExecuteState, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepaySendError";
    this.stateAfterSend = stateAfterSend;
  }
}

function notSent(reason: string, state: ExecuteState): ExecuteResult {
  return {
    sent: false,
    reason,
    amountSentUsd8: 0n,
    cappedPerAction: false,
    cappedPerDay: false,
    txHash: null,
    state,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Membereskan `pendingRepay` bila posisi TERBARU membuktikan repay-nya mendarat.
 *
 * Buktinya dua-duanya wajib, dan keduanya dibaca dari rantai, bukan dari niat:
 *   1. posisi dibaca pada blok yang lebih baru daripada blok sebelum kirim, dan
 *   2. hutangnya BERKURANG dibanding nilai sebelum kirim.
 *
 * Kalau hutang belum berkurang, `pendingRepay` sengaja DIBIARKAN. Transaksi yang
 * masih di mempool bisa mendarat kapan saja, jadi "belum terlihat" tidak pernah
 * berarti "tidak akan terjadi", dan membersihkannya karena bosan menunggu persis
 * mengembalikan bug yang aturan ini ada untuk mencegahnya.
 *
 * Konsekuensinya dinyatakan terbuka: repay yang benar-benar TIDAK PERNAH mendarat
 * membuat Guardian berhenti bertindak sampai seorang operator membereskannya
 * (`clearPendingRepay`). Guardian yang diam adalah kegagalan yang terlihat; agent
 * yang membayar dua kali adalah kegagalan yang tidak terlihat sampai uangnya habis.
 *
 * Anggaran yang sudah terpotong TIDAK PERNAH dikembalikan di sini — kalau
 * transaksinya ternyata mendarat, pengembalian itu justru membuka jalan bayar
 * ganda yang sama.
 */
export function reconcilePendingRepay(state: ExecuteState, pos: Position): ExecuteState {
  const pending = state.pendingRepay;
  // `== null` bukan `=== null`: state bisa datang dari store versi lama yang
  // sama sekali tidak punya field ini, dan `undefined` di sini tidak boleh
  // membuat rekonsiliasi melempar.
  if (pending == null) return state;
  const landed =
    pos.blockNumber > pending.blockNumberBeforeSend && pos.debtBase < pending.debtBaseBeforeSend;
  if (!landed) return state;
  return { ...state, pendingRepay: null };
}

/**
 * Jalan keluar operator untuk `pendingRepay` yang tidak akan pernah bisa
 * dibuktikan mendarat. Sengaja eksplisit dan sengaja TIDAK otomatis: ia
 * menyatakan sebuah keputusan manusia ("saya sudah memeriksa rantai, transaksi
 * itu tidak ada"), bukan sebuah timeout.
 */
export function clearPendingRepay(state: ExecuteState): ExecuteState {
  return { ...state, pendingRepay: null };
}

export async function executeDecision(
  d: Decision,
  pos: Position,
  limits: ExecuteLimits,
  inputState: ExecuteState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.now();

  // 0. Rekonsiliasi dulu: kalau rantai sudah membuktikan repay sebelumnya
  // mendarat, catatan menggantungnya dibereskan sebelum aturan apa pun dibaca.
  const state = reconcilePendingRepay(inputState, pos);

  // 1. Kill switch mutlak — diperiksa paling awal, mengalahkan segalanya.
  if (state.killed) {
    return notSent("Kill switch aktif: eksekusi dihentikan total.", state);
  }

  // 2. Repay yang belum terbukti selesai menghalangi SEMUA pengiriman baru.
  if (state.pendingRepay != null) {
    const p = state.pendingRepay;
    return notSent(
      `Ada repay yang belum terbukti selesai (${p.amountUsd8} basis 8 desimal, dicoba pada ` +
        `${p.startedAt}, tx ${p.txHash ?? "tidak diketahui"}). Menahan diri sampai rantai ` +
        "menunjukkan hutang berkurang — mengirim ulang berisiko membayar dua kali.",
      state,
    );
  }

  // 3. Aksi yang tidak memerlukan pembayaran tidak pernah mengirim.
  if (!ACTIONS_REQUIRING_REPAY.has(d.action)) {
    return notSent(`Aksi ${d.action} tidak memerlukan eksekusi transaksi.`, state);
  }

  let amount = d.suggestedRepayBase;
  let cappedPerAction = false;
  let cappedPerDay = false;

  // 4. Potong ke batas per-aksi, jangan tolak.
  if (amount > limits.maxPerActionUsd8) {
    amount = limits.maxPerActionUsd8;
    cappedPerAction = true;
  }

  // 5. Potong ke sisa anggaran harian. Reset harian dievaluasi di sini agar
  // pemeriksaan batas memakai anggaran yang sudah segar.
  const dayElapsed = now - state.dayStartedAt >= SECONDS_PER_DAY;
  const effectiveSpentToday = dayElapsed ? 0n : state.spentTodayUsd8;
  const remainingToday = limits.maxPerDayUsd8 - effectiveSpentToday;

  if (remainingToday <= 0n) {
    return notSent("Sisa anggaran harian nol: eksekusi ditahan sampai hari berikutnya.", state);
  }
  if (amount > remainingToday) {
    amount = remainingToday;
    cappedPerDay = true;
  }

  if (amount <= 0n) {
    return notSent("Tidak ada jumlah tersisa untuk dieksekusi setelah pemotongan.", state);
  }

  // 6. Cooldown sejak aksi terakhir.
  const sinceLastAction = now - state.lastActionAt;
  if (sinceLastAction < limits.minIntervalSeconds) {
    return notSent(
      `Masih dalam cooldown: ${sinceLastAction}s sejak aksi terakhir, ` +
        `minimal ${limits.minIntervalSeconds}s.`,
      state,
    );
  }

  // 7. Anggaran, cooldown, dan catatan menggantung disusun SEBELUM kirim.
  // Inilah inti perbaikan C2: begitu `sendRepay` dipanggil, uangnya harus
  // dianggap sudah bergerak sampai rantai membuktikan sebaliknya.
  const stateAfterSend: ExecuteState = {
    spentTodayUsd8: effectiveSpentToday + amount,
    dayStartedAt: dayElapsed ? now : state.dayStartedAt,
    lastActionAt: now,
    killed: state.killed,
    pendingRepay: {
      asset: deps.repayAsset,
      amountUsd8: amount,
      startedAt: now,
      txHash: null,
      debtBaseBeforeSend: pos.debtBase,
      blockNumberBeforeSend: pos.blockNumber,
    },
  };

  let txHash: `0x${string}`;
  try {
    txHash = await deps.sendRepay(deps.repayAsset, amount);
  } catch (err) {
    if (wasNeverSent(err)) {
      // Satu-satunya jalan di mana "gagal" benar-benar berarti "tidak terjadi":
      // modul pengirim menyatakan sendiri bahwa jaringan belum tersentuh.
      throw err;
    }
    throw new RepaySendError(
      `Pengiriman repay gagal SETELAH mungkin menyentuh jaringan; anggaran dan cooldown ` +
        `tetap dipotong dan repay dicatat menggantung. Galat asli: ${messageOf(err)}`,
      stateAfterSend,
      { cause: err },
    );
  }

  // Hash di tangan berarti relay sudah mengonfirmasi inklusi (pengirim yang
  // menunggu receipt-nya), jadi tidak ada lagi yang menggantung.
  const newState: ExecuteState = { ...stateAfterSend, pendingRepay: null };

  return {
    sent: true,
    reason: `Terkirim untuk posisi ${pos.account}.`,
    amountSentUsd8: amount,
    cappedPerAction,
    cappedPerDay,
    txHash,
    state: newState,
  };
}
