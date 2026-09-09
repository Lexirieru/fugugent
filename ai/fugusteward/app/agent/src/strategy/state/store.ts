/**
 * Keeping the record of what has been paid, and each agent's own budget, across a restart.
 *
 * ## Why this has to exist
 *
 * This is the file that makes "the process died in the middle of a payment" survivable. The
 * record of a payment in flight is written here BEFORE the payment goes out, so a process
 * that comes back up already knows something might be in the air and refuses to try again.
 * Lose this file and the next start sees an unpaid period, pays it, and every other check in
 * the system is satisfied, because the second payment is a perfectly valid payment.
 *
 * The per agent budgets matter for the same reason in a smaller way: if they lived only in
 * memory, a process that kept crashing would give every agent its whole daily allowance
 * again on every restart.
 *
 * ## Why the writing is done by hand
 *
 * `JSON.stringify` cannot write a whole number of this size at all, and `JSON.parse` turns
 * numbers back into floating point, which silently drops the last digits. The last digits of
 * a money value are the cents.
 *
 * ## Why damaged content stops the agent
 *
 * Reading damage as "nothing stored yet" would empty the record of what has been paid, which
 * means every period in the backlog becomes due again at once. That is the worst possible
 * thing to do at the exact moment something is already clearly wrong.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBudget, ExecuteState } from "../execute.js";
import type { Ledger, LedgerEntry, LedgerStatus } from "../ledger.js";

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
  const agents: Record<string, unknown> = {};
  // Sorted, so the same state always produces the same bytes and a difference between two
  // saved files is a real difference rather than a reordering.
  for (const agentId of Object.keys(state.agents).sort()) {
    const budget = state.agents[agentId]!;
    agents[agentId] = {
      spentTodayUsd8: budget.spentTodayUsd8.toString(),
      dayStartedAt: budget.dayStartedAt,
      lastPaymentAt: budget.lastPaymentAt,
    };
  }
  const ledger: Record<string, unknown> = {};
  for (const key of Object.keys(state.ledger).sort()) {
    const entry = state.ledger[key]!;
    ledger[key] = {
      subscriptionId: entry.subscriptionId,
      periodIndex: entry.periodIndex,
      status: entry.status,
      amountUsd8: entry.amountUsd8.toString(),
      agentId: entry.agentId,
      startedAt: entry.startedAt,
      txHash: entry.txHash,
    };
  }
  return JSON.stringify({ version: FORMAT_VERSION, killed: state.killed, agents, ledger }, null, 2);
}

function asObject(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StateStoreError(`The field "${label}" has to be an object.`);
  }
  return raw as Record<string, unknown>;
}

function bigintField(obj: Record<string, unknown>, key: string, label: string): bigint {
  const raw = obj[key];
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) {
    throw new StateStoreError(
      `The field "${label}.${key}" has to be a whole number written as text, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return BigInt(raw);
}

function intField(obj: Record<string, unknown>, key: string, label: string): number {
  const raw = obj[key];
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new StateStoreError(
      `The field "${label}.${key}" has to be a whole number, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function stringField(obj: Record<string, unknown>, key: string, label: string): string {
  const raw = obj[key];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new StateStoreError(
      `The field "${label}.${key}" has to be text, and it is ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function statusField(obj: Record<string, unknown>, label: string): LedgerStatus {
  const raw = obj.status;
  if (raw !== "IN_FLIGHT" && raw !== "PAID") {
    throw new StateStoreError(
      `The field "${label}.status" has to be IN_FLIGHT or PAID, and it is ${JSON.stringify(raw)}. ` +
        "A record whose state cannot be read is a record that cannot hold back a second payment.",
    );
  }
  return raw;
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
  const obj = asObject(parsed, "the stored content");
  if (obj.version !== FORMAT_VERSION) {
    throw new StateStoreError(
      `The stored format ${JSON.stringify(obj.version)} is not one this agent knows ` +
        `(it knows ${FORMAT_VERSION}).`,
    );
  }
  if (typeof obj.killed !== "boolean") {
    throw new StateStoreError(
      `The field "killed" has to be true or false, and it is ${JSON.stringify(obj.killed)}.`,
    );
  }

  const agentsRaw = asObject(obj.agents, "agents");
  const agents: Record<string, AgentBudget> = {};
  for (const [agentId, value] of Object.entries(agentsRaw)) {
    const entry = asObject(value, `agents.${agentId}`);
    agents[agentId] = {
      spentTodayUsd8: bigintField(entry, "spentTodayUsd8", `agents.${agentId}`),
      dayStartedAt: intField(entry, "dayStartedAt", `agents.${agentId}`),
      lastPaymentAt: intField(entry, "lastPaymentAt", `agents.${agentId}`),
    };
  }

  const ledgerRaw = asObject(obj.ledger, "ledger");
  const ledger: Record<string, LedgerEntry> = {};
  for (const [key, value] of Object.entries(ledgerRaw)) {
    const entry = asObject(value, `ledger.${key}`);
    const txHash = entry.txHash;
    if (txHash !== null && (typeof txHash !== "string" || !txHash.startsWith("0x"))) {
      throw new StateStoreError(
        `The field "ledger.${key}.txHash" has to be nothing or start with 0x, and it is ${JSON.stringify(txHash)}.`,
      );
    }
    ledger[key] = {
      subscriptionId: stringField(entry, "subscriptionId", `ledger.${key}`),
      periodIndex: intField(entry, "periodIndex", `ledger.${key}`),
      status: statusField(entry, `ledger.${key}`),
      amountUsd8: bigintField(entry, "amountUsd8", `ledger.${key}`),
      agentId: stringField(entry, "agentId", `ledger.${key}`),
      startedAt: intField(entry, "startedAt", `ledger.${key}`),
      txHash: txHash as `0x${string}` | null,
    };
  }

  return { killed: obj.killed, agents, ledger: ledger as Ledger };
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
 * renamed into place, so a process that dies half way through a write cannot leave a
 * truncated file behind. A truncated record of what has been paid would be read as damage on
 * the next start, which stops the agent, which is the right outcome: the alternative is
 * paying a month of subscriptions again.
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
