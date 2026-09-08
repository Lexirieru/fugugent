/**
 * Persistence for `ExecuteState` — the daily budget, the cooldown, the kill switch, and
 * the pending-repay record.
 *
 * ## Why this exists
 *
 * Until the previous round all of that state lived only in one process's memory. From
 * inside any single module that was invisible, but from outside it was fatal: **a restart
 * reset every limit.** `spentTodayUsd8` went back to zero, `dayStartedAt` to now, and
 * `lastActionAt` to 0 — which means the cooldown is instantly satisfied because `now - 0`
 * is large. A process in a crash loop spends `maxPerDayUsd8` PER RESTART, not per day, and
 * a "$2,000/day limit" binds essentially nothing.
 *
 * ## The shape of the interface
 *
 * `ExecuteStateStore` deliberately has only `load`/`save` and knows nothing about files:
 * the JSON-file implementation here is enough for an agent running on its own, and the
 * backend can swap in Postgres without touching a single line in `execute.ts`/`guard.ts`.
 *
 * ## Why the serialization is hand-written
 *
 * `JSON.stringify` cannot write a `bigint` at all, and `JSON.parse` returns numbers as
 * floats — money values at this layer can exceed `Number.MAX_SAFE_INTEGER` and their last
 * digit (exactly the cents digit) is silently lost. Every bigint is therefore written as a
 * decimal string and read back through `BigInt(...)`.
 *
 * ## Why corrupt content FAILS HARD
 *
 * A corrupt state file, if read as "does not exist yet", would put the budget back to zero
 * and the cooldown back to satisfied — that is, RELEASING every limit with no warning at
 * all, at exactly the moment something is clearly already wrong. `load()` therefore
 * distinguishes "the file does not exist" (-> `null`, normal on a first run) from "the file
 * exists but cannot be trusted" (-> throws `StateStoreError`).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecuteState, PendingRepay } from "../execute.js";

/** The file format version. Bump it when the shape changes; an unknown version is rejected. */
const FORMAT_VERSION = 1;

export class StateStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateStoreError";
  }
}

export interface ExecuteStateStore {
  /** The stored state, or `null` when there genuinely never was one. Corrupt content THROWS. */
  load(): Promise<ExecuteState | null>;
  save(state: ExecuteState): Promise<void>;
}

/** A clean starting state. Used only when the store is genuinely empty. */
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
 * An in-memory store for tests and for callers that genuinely do not want persistence. It
 * stores a COPY, not a reference: state already saved must not be able to change because
 * the caller mutated its own object.
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
 * A JSON-file store. Its writes are atomic (write to a temporary file in the same
 * directory, then `rename`): a process that dies mid-`write` must not leave behind a
 * truncated state file, because a truncated file is rejected by `parseExecuteState` and
 * would stop Guardian until someone fixed it by hand.
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
