/**
 * Eksekusi ber-batas: pertahanan kedua sebelum transaksi repay dikirim
 * lewat session key Altana. Session key membatasi belanja di sisi rantai,
 * tetapi keselamatan dana user tidak boleh bergantung pada satu lapisan
 * saja — batas di modul ini adalah lapisan kedua, dan kill switch adalah
 * jalan keluar user.
 *
 * Modul ini sendiri bebas I/O: waktu sekarang dan pengiriman transaksi
 * disuntikkan lewat `deps`, sehingga seluruh aturan bisa diuji tanpa
 * menyentuh jaringan sama sekali.
 *
 * Keenam aturan berikut ditegakkan SEBELUM transaksi dikirim, tepat dalam
 * urutan ini:
 *   1. `state.killed` → tidak pernah mengirim apa pun. Mutlak, diperiksa
 *      paling awal, mengalahkan segalanya.
 *   2. Aksi `NONE`/`WARN` → tidak mengirim (tidak memerlukan eksekusi).
 *   3. Jumlah melebihi `maxPerActionUsd8` → dipotong ke batas itu, bukan
 *      ditolak; dicatat lewat `cappedPerAction`.
 *   4. Jumlah melebihi sisa `maxPerDayUsd8` → dipotong ke sisa lewat
 *      `cappedPerDay`; bila sisa nol, tidak mengirim.
 *   5. Masih dalam `minIntervalSeconds` sejak `lastActionAt` → tidak
 *      mengirim (cooldown).
 *   6. Setelah kirim berhasil, `spentTodayUsd8` dan `lastActionAt`
 *      diperbarui; anggaran harian direset bila sudah lewat 24 jam sejak
 *      `dayStartedAt`.
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
  /** Mengirim transaksi repay sungguhan; disuntikkan agar modul ini tidak menyentuh jaringan. */
  sendRepay: (asset: `0x${string}`, amount: bigint) => Promise<`0x${string}`>;
  /** Jam sekarang dalam detik epoch; disuntikkan agar waktu bisa dikontrol penuh saat test. */
  now: () => number;
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
 * Alamat token hutang yang didukung eksekusi ini: `MockTokenUSD` (mUSD) di
 * BSC testnet — satu-satunya aset hutang pada `MockLendingPool` yang
 * disambungkan Guardian saat ini (lihat `chain/testnet.ts`).
 */
export const REPAY_ASSET_ADDRESS = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

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

export async function executeDecision(
  d: Decision,
  pos: Position,
  limits: ExecuteLimits,
  state: ExecuteState,
  deps: ExecuteDeps,
): Promise<ExecuteResult> {
  const now = deps.now();

  // 1. Kill switch mutlak — diperiksa paling awal, mengalahkan segalanya.
  if (state.killed) {
    return notSent("Kill switch aktif: eksekusi dihentikan total.", state);
  }

  // 2. Aksi yang tidak memerlukan pembayaran tidak pernah mengirim.
  if (!ACTIONS_REQUIRING_REPAY.has(d.action)) {
    return notSent(`Aksi ${d.action} tidak memerlukan eksekusi transaksi.`, state);
  }

  let amount = d.suggestedRepayBase;
  let cappedPerAction = false;
  let cappedPerDay = false;

  // 3. Potong ke batas per-aksi, jangan tolak.
  if (amount > limits.maxPerActionUsd8) {
    amount = limits.maxPerActionUsd8;
    cappedPerAction = true;
  }

  // 4. Potong ke sisa anggaran harian. Reset harian dievaluasi di sini agar
  // pemeriksaan batas memakai anggaran yang sudah segar, tetapi baru
  // ditulis ke state pada langkah 6 setelah kirim benar-benar berhasil.
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

  // 5. Cooldown sejak aksi terakhir.
  const sinceLastAction = now - state.lastActionAt;
  if (sinceLastAction < limits.minIntervalSeconds) {
    return notSent(
      `Masih dalam cooldown: ${sinceLastAction}s sejak aksi terakhir, ` +
        `minimal ${limits.minIntervalSeconds}s.`,
      state,
    );
  }

  // Kirim lewat dependency yang disuntikkan — modul ini sendiri tidak
  // pernah memanggil jaringan secara langsung.
  const txHash = await deps.sendRepay(REPAY_ASSET_ADDRESS, amount);

  // 6. Perbarui state hanya setelah kirim berhasil.
  const newState: ExecuteState = {
    spentTodayUsd8: effectiveSpentToday + amount,
    dayStartedAt: dayElapsed ? now : state.dayStartedAt,
    lastActionAt: now,
    killed: state.killed,
  };

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
