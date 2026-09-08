/**
 * Persistensi `ExecuteState` — anggaran harian, cooldown, kill switch, dan
 * catatan repay yang menggantung.
 *
 * ## Kenapa ini ada
 *
 * Sampai putaran sebelumnya seluruh state itu hanya hidup di memori satu
 * proses. Akibatnya tidak terlihat dari dalam modul mana pun, tetapi fatal dari
 * luar: **restart mereset seluruh batas.** `spentTodayUsd8` kembali ke nol,
 * `dayStartedAt` ke sekarang, dan `lastActionAt` ke 0 — yang berarti cooldown
 * langsung terpenuhi karena `now - 0` besar. Proses yang crash-loop
 * membelanjakan `maxPerDayUsd8` PER RESTART, bukan per hari, dan "batas
 * $2.000/hari" praktis tidak mengikat apa pun.
 *
 * ## Bentuk antarmuka
 *
 * `ExecuteStateStore` sengaja hanya punya `load`/`save` dan tidak tahu apa pun
 * tentang file: implementasi file JSON di sini cukup untuk agent yang berjalan
 * sendiri, dan backend bisa menggantinya dengan Postgres tanpa menyentuh satu
 * baris pun di `execute.ts`/`guard.ts`.
 *
 * ## Kenapa serialisasinya ditulis tangan
 *
 * `JSON.stringify` tidak bisa menulis `bigint` sama sekali, dan `JSON.parse`
 * mengembalikan angka sebagai float — nilai uang di lapisan ini bisa melewati
 * `Number.MAX_SAFE_INTEGER` dan digit terakhirnya (persis digit sen) hilang
 * diam-diam. Semua bigint karena itu ditulis sebagai string desimal dan dibaca
 * kembali lewat `BigInt(...)`.
 *
 * ## Kenapa isi rusak GAGAL KERAS
 *
 * File state yang rusak, bila dibaca sebagai "belum ada", akan mengembalikan
 * anggaran ke nol dan cooldown ke terpenuhi — yaitu MELEPAS seluruh batas tanpa
 * satu pun peringatan, tepat pada saat sesuatu sudah jelas tidak beres. `load()`
 * karena itu membedakan "file tidak ada" (→ `null`, wajar pada jalan pertama)
 * dari "file ada tapi tidak bisa dipercaya" (→ melempar `StateStoreError`).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecuteState, PendingRepay } from "../execute.js";

/** Versi format berkas. Naikkan bila bentuknya berubah; versi asing ditolak. */
const FORMAT_VERSION = 1;

export class StateStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateStoreError";
  }
}

export interface ExecuteStateStore {
  /** State tersimpan, atau `null` bila memang belum pernah ada. Isi rusak MELEMPAR. */
  load(): Promise<ExecuteState | null>;
  save(state: ExecuteState): Promise<void>;
}

/** State awal yang bersih. Dipakai hanya bila store benar-benar kosong. */
export function initialExecuteState(nowSeconds: number): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: nowSeconds,
    lastActionAt: 0,
    killed: false,
    pendingRepay: null,
  };
}

export function serializeExecuteState(state: ExecuteState): string {
  return JSON.stringify(
    {
      version: FORMAT_VERSION,
      spentTodayUsd8: state.spentTodayUsd8.toString(),
      dayStartedAt: state.dayStartedAt,
      lastActionAt: state.lastActionAt,
      killed: state.killed,
      pendingRepay:
        state.pendingRepay === null
          ? null
          : {
              asset: state.pendingRepay.asset,
              amountUsd8: state.pendingRepay.amountUsd8.toString(),
              startedAt: state.pendingRepay.startedAt,
              txHash: state.pendingRepay.txHash,
              debtBaseBeforeSend: state.pendingRepay.debtBaseBeforeSend.toString(),
              blockNumberBeforeSend: state.pendingRepay.blockNumberBeforeSend.toString(),
            },
    },
    null,
    2,
  );
}

function bigintField(obj: Record<string, unknown>, key: string): bigint {
  const raw = obj[key];
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) {
    throw new StateStoreError(
      `Field "${key}" harus string desimal bigint, ditemukan ${JSON.stringify(raw)}.`,
    );
  }
  return BigInt(raw);
}

function intField(obj: Record<string, unknown>, key: string): number {
  const raw = obj[key];
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new StateStoreError(
      `Field "${key}" harus bilangan bulat, ditemukan ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function boolField(obj: Record<string, unknown>, key: string): boolean {
  const raw = obj[key];
  if (typeof raw !== "boolean") {
    throw new StateStoreError(`Field "${key}" harus boolean, ditemukan ${JSON.stringify(raw)}.`);
  }
  return raw;
}

function hexField(obj: Record<string, unknown>, key: string): `0x${string}` {
  const raw = obj[key];
  if (typeof raw !== "string" || !raw.startsWith("0x")) {
    throw new StateStoreError(
      `Field "${key}" harus string heksadesimal 0x…, ditemukan ${JSON.stringify(raw)}.`,
    );
  }
  return raw as `0x${string}`;
}

function parsePendingRepay(raw: unknown): PendingRepay | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") {
    throw new StateStoreError(`Field "pendingRepay" harus objek atau null.`);
  }
  const obj = raw as Record<string, unknown>;
  const txHash = obj.txHash;
  if (txHash !== null && (typeof txHash !== "string" || !txHash.startsWith("0x"))) {
    throw new StateStoreError(
      `Field "pendingRepay.txHash" harus null atau 0x…, ditemukan ${JSON.stringify(txHash)}.`,
    );
  }
  return {
    asset: hexField(obj, "asset"),
    amountUsd8: bigintField(obj, "amountUsd8"),
    startedAt: intField(obj, "startedAt"),
    txHash: txHash as `0x${string}` | null,
    debtBaseBeforeSend: bigintField(obj, "debtBaseBeforeSend"),
    blockNumberBeforeSend: bigintField(obj, "blockNumberBeforeSend"),
  };
}

export function parseExecuteState(raw: string): ExecuteState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StateStoreError(
      `Isi state bukan JSON yang sah: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StateStoreError("Isi state bukan objek JSON.");
  }
  const obj = parsed as Record<string, unknown>;
  const version = obj.version;
  if (version !== FORMAT_VERSION) {
    throw new StateStoreError(
      `Versi format state ${JSON.stringify(version)} tidak dikenal (yang didukung ${FORMAT_VERSION}).`,
    );
  }
  return {
    spentTodayUsd8: bigintField(obj, "spentTodayUsd8"),
    dayStartedAt: intField(obj, "dayStartedAt"),
    lastActionAt: intField(obj, "lastActionAt"),
    killed: boolField(obj, "killed"),
    pendingRepay: parsePendingRepay(obj.pendingRepay),
  };
}

/**
 * Store di memori untuk test dan untuk pemanggil yang memang tidak mau
 * persistensi. Menyimpan SALINAN, bukan referensi: state yang sudah tersimpan
 * tidak boleh bisa berubah karena pemanggil memutasi objeknya sendiri.
 */
export function createMemoryStateStore(initial: ExecuteState | null = null): ExecuteStateStore {
  let current: string | null = initial === null ? null : serializeExecuteState(initial);
  return {
    load: async () => (current === null ? null : parseExecuteState(current)),
    save: async (state) => {
      current = serializeExecuteState(state);
    },
  };
}

/**
 * Store berkas JSON. Penulisannya atomik (tulis ke berkas sementara di
 * direktori yang sama lalu `rename`): proses yang mati di tengah `write` tidak
 * boleh meninggalkan berkas state yang terpotong, karena berkas terpotong akan
 * ditolak `parseExecuteState` dan menghentikan Guardian sampai ada yang
 * memperbaikinya dengan tangan.
 */
export function createFileStateStore(filePath: string): ExecuteStateStore {
  return {
    load: async () => {
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new StateStoreError(
          `Gagal membaca state dari ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      return parseExecuteState(raw);
    },
    save: async (state) => {
      const dir = path.dirname(filePath);
      await mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
      await writeFile(tmp, serializeExecuteState(state), "utf8");
      await rename(tmp, filePath);
    },
  };
}
