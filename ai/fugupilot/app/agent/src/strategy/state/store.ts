/**
 * Keeping the limits across a restart: the daily budget, the waiting time, the stop switch
 * and the record of a send in flight.
 *
 * ## Why this has to exist
 *
 * If all of that lived only in one running process's memory, a restart would reset every
 * limit. Spent today would go back to zero, the day would start again now, and the mark of
 * the last send would go back to zero, which makes the waiting time instantly satisfied
 * because the gap since second zero is enormous. A process that keeps crashing and
 * restarting would then spend the whole daily limit PER RESTART instead of per day, and a
 * limit of two thousand dollars a day would bind nothing at all.
 *
 * ## Why the interface is this small
 *
 * Load and save, and no knowledge of files. The file version below is enough for an agent
 * running on its own, and a database version can be dropped in later without one line
 * changing in `execute.ts` or `guard.ts`.
 *
 * ## Why the writing is done by hand
 *
 * `JSON.stringify` cannot write a whole number of this size at all, and `JSON.parse` turns
 * numbers back into floating point, which silently drops the last digits. The last digits
 * of a money value are the cents. Every such number is therefore written as text and read
 * back exactly.
 *
 * ## Why damaged content stops the agent
 *
 * A damaged file read as "there is nothing stored yet" would put the budget back to zero
 * and the waiting time back to satisfied. That is releasing every limit, quietly, at the
 * exact moment something is already clearly wrong. So loading tells apart "the file is not
 * there", which is normal on a first run, from "the file is there and cannot be trusted",
 * which stops everything.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExecuteState, PendingSend } from "../execute.js";

/** The file format. Raise it when the shape changes; an unknown one is refused. */
const FORMAT_VERSION = 1;

export class StateStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateStoreError";
  }
}

export interface ExecuteStateStore {
  /** What was stored, or null when there genuinely never was anything. Damaged content throws. */
  load(): Promise<ExecuteState | null>;
  save(state: ExecuteState): Promise<void>;
}

export function serializeExecuteState(state: ExecuteState): string {
  return JSON.stringify(
    {
      version: FORMAT_VERSION,
      spentTodayUsd8: state.spentTodayUsd8.toString(),
      dayStartedAt: state.dayStartedAt,
      lastActionAt: state.lastActionAt,
      killed: state.killed,
      pendingSend:
        state.pendingSend === null
          ? null
          : {
              kind: state.pendingSend.kind,
              venueId: state.pendingSend.venueId,
              assetId: state.pendingSend.assetId,
              amountUsd8: state.pendingSend.amountUsd8.toString(),
              startedAt: state.pendingSend.startedAt,
              txHash: state.pendingSend.txHash,
              blockNumberBeforeSend: state.pendingSend.blockNumberBeforeSend.toString(),
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

function stringField(obj: Record<string, unknown>, key: string): string {
  const raw = obj[key];
  if (typeof raw !== "string") {
    throw new StateStoreError(
      `The field "${key}" has to be text, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function parsePendingSend(raw: unknown): PendingSend | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") {
    throw new StateStoreError('The field "pendingSend" has to be an object or nothing.');
  }
  const obj = raw as Record<string, unknown>;
  const txHash = obj.txHash;
  if (txHash !== null && (typeof txHash !== "string" || !txHash.startsWith("0x"))) {
    throw new StateStoreError(
      `The field "pendingSend.txHash" has to be nothing or start with 0x, and it is ${JSON.stringify(txHash)}.`,
    );
  }
  return {
    kind: stringField(obj, "kind"),
    venueId: stringField(obj, "venueId"),
    assetId: stringField(obj, "assetId"),
    amountUsd8: bigintField(obj, "amountUsd8"),
    startedAt: intField(obj, "startedAt"),
    txHash: txHash as `0x${string}` | null,
    blockNumberBeforeSend: bigintField(obj, "blockNumberBeforeSend"),
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
    lastActionAt: intField(obj, "lastActionAt"),
    killed: boolField(obj, "killed"),
    pendingSend: parsePendingSend(obj.pendingSend),
  };
}

/**
 * A store that lives in memory, for tests and for callers that genuinely do not want
 * anything written down. It keeps a copy rather than a reference: state already saved must
 * not be able to change because the caller changed its own object afterwards.
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
 * A store backed by a file. Writes go to a temporary file next to the real one and are then
 * renamed into place, so a process that dies half way through a write cannot leave a
 * truncated file behind. A truncated file would be refused on the next load and the agent
 * would stop until somebody fixed it by hand.
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
