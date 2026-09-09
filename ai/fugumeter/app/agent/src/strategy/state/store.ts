/**
 * Keeping the limits and the billing mark across a restart.
 *
 * ## Why this has to exist
 *
 * Two separate reasons, and the second one is the one specific to a meter.
 *
 * First, the limits. If the daily budget lived only in one running process's memory, a
 * restart would reset it, and a process that keeps crashing would spend its whole daily
 * limit PER RESTART rather than per day. A limit like that binds nothing.
 *
 * Second, the mark of what has already been billed. That one is worse, because the failure
 * is invisible. Lose the mark and the next start counts the same seconds again, prices them
 * again, and pays for them again, and every single check downstream is satisfied because the
 * second bill is a perfectly valid bill for use that really did happen. Nothing catches it
 * except this file.
 *
 * ## Why the writing is done by hand
 *
 * `JSON.stringify` cannot write a whole number of this size at all, and `JSON.parse` turns
 * numbers back into floating point, which silently drops the last digits. The last digits of
 * a money value are the cents. Every such number is therefore written as text.
 *
 * ## Why damaged content stops the agent
 *
 * Reading damage as "nothing stored yet" would put the budget back to zero AND move the
 * billing mark back to now, quietly, at the moment something is already clearly wrong.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecuteState, PendingPayment } from "../execute.js";

const FORMAT_VERSION = 1;

export class StateStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateStoreError";
  }
}

export interface ExecuteStateStore {
  /** What was stored, or null when there genuinely never was anything. Damage throws. */
  load(): Promise<ExecuteState | null>;
  save(state: ExecuteState): Promise<void>;
}

export function serializeExecuteState(state: ExecuteState): string {
  return JSON.stringify(
    {
      version: FORMAT_VERSION,
      spentTodayUsd8: state.spentTodayUsd8.toString(),
      dayStartedAt: state.dayStartedAt,
      lastPaymentAt: state.lastPaymentAt,
      killed: state.killed,
      billedThroughSeconds: state.billedThroughSeconds,
      pendingPayment:
        state.pendingPayment === null
          ? null
          : {
              amountUsd8: state.pendingPayment.amountUsd8.toString(),
              windowFromSeconds: state.pendingPayment.windowFromSeconds,
              windowToSeconds: state.pendingPayment.windowToSeconds,
              startedAt: state.pendingPayment.startedAt,
              txHash: state.pendingPayment.txHash,
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
      `The field "${key}" has to be a whole number written as text, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return BigInt(raw);
}

function intField(obj: Record<string, unknown>, key: string): number {
  const raw = obj[key];
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new StateStoreError(
      `The field "${key}" has to be a whole number, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function boolField(obj: Record<string, unknown>, key: string): boolean {
  const raw = obj[key];
  if (typeof raw !== "boolean") {
    throw new StateStoreError(
      `The field "${key}" has to be true or false, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function parsePendingPayment(raw: unknown): PendingPayment | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") {
    throw new StateStoreError('The field "pendingPayment" has to be an object or nothing.');
  }
  const obj = raw as Record<string, unknown>;
  const txHash = obj.txHash;
  if (txHash !== null && (typeof txHash !== "string" || !txHash.startsWith("0x"))) {
    throw new StateStoreError(
      `The field "pendingPayment.txHash" has to be nothing or start with 0x, and it is ${JSON.stringify(txHash)}.`,
    );
  }
  return {
    amountUsd8: bigintField(obj, "amountUsd8"),
    windowFromSeconds: intField(obj, "windowFromSeconds"),
    windowToSeconds: intField(obj, "windowToSeconds"),
    startedAt: intField(obj, "startedAt"),
    txHash: txHash as `0x${string}` | null,
  };
}

export function parseExecuteState(raw: string): ExecuteState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StateStoreError(
      `The stored content is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StateStoreError("The stored content is not an object.");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== FORMAT_VERSION) {
    throw new StateStoreError(
      `The stored format ${JSON.stringify(obj.version)} is not one this agent knows ` +
        `(it knows ${FORMAT_VERSION}).`,
    );
  }
  return {
    spentTodayUsd8: bigintField(obj, "spentTodayUsd8"),
    dayStartedAt: intField(obj, "dayStartedAt"),
    lastPaymentAt: intField(obj, "lastPaymentAt"),
    killed: boolField(obj, "killed"),
    // Read strictly, and never given a default. A missing billing mark quietly filled in
    // with "now" would let the seconds before it be counted and paid for a second time.
    billedThroughSeconds: intField(obj, "billedThroughSeconds"),
    pendingPayment: parsePendingPayment(obj.pendingPayment),
  };
}

/** A store that lives in memory. It keeps a copy, not a reference. */
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
 * A store backed by a file. Writes go to a temporary file next to the real one and are then
 * renamed into place, so a process that dies half way through cannot leave a truncated file
 * behind.
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
          `The state at ${filePath} could not be read: ${err instanceof Error ? err.message : String(err)}`,
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
