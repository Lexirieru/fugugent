/**
 * The four Guardian tools, exposed on both public faces — A2A (through the agent's tool set
 * in `dualMain.ts`) and MCP (through `buildMcpServer` in `mcpMain.ts`).
 *
 *     guardian_position        read the monitored position + the deterministic assessment
 *     guardian_execute_state   the daily budget, the cooldown, the kill switch, a pending repay
 *     guardian_run_cycle       run ONE monitoring cycle now
 *     guardian_kill_switch     pull the kill switch — one-way, no way back
 *
 * ## Why the handlers live here and not in each face
 *
 * The two faces must not answer the same question differently. Every payload below is built
 * ONCE, by a plain function, and both faces serialize the same object — so a `curl` against
 * `/mcp` and an A2A conversation cannot disagree about whether the kill switch is on.
 * The handlers are also what the unit tests call, so what is tested is what ships.
 *
 * ## The line that must not be crossed (CLAUDE.md #1)
 *
 * The LLM may ask for a READ, or ask for a CYCLE to be run. It can never say how much to
 * repay, when a position counts as unhealthy, or whether to pay at all: `guardian_run_cycle`
 * takes NO parameters, and every number inside a cycle comes from `decide.ts` (thresholds)
 * and `execute.ts` (caps, cooldown), both deterministic and both already under test. The
 * only thing a caller controls is the moment a deterministic evaluation happens.
 *
 * `guardian_kill_switch` is likewise safe to expose in full: it only ever moves toward not
 * spending, and it cannot be reversed by anything on this surface.
 *
 * ## Numbers
 *
 * Every USD value is on the 8-decimal basis internally and leaves this module ONLY through
 * `formatUsd8` / `formatHf` (`format.ts`). A raw `403063169` reads to a human as four
 * hundred million; it means $4.03. No payload here carries a raw basis value.
 */
import { tool, type ToolSet } from "ai";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GuardianBusyError, type GuardianRuntime } from "./guardianRuntime.js";
import { decide } from "./strategy/decide.js";
import { formatHf, formatPercentFromBps, formatUsd8 } from "./strategy/format.js";
import type { CycleResult } from "./strategy/guard.js";
import type { ExecuteState } from "./strategy/execute.js";
import type { Position } from "./strategy/types.js";

/** A tool payload. Always a plain JSON-able object; both faces serialize it verbatim. */
export type GuardianToolPayload = Record<string, unknown>;

/** What a caller is told when the runtime is switched off in this process. */
export const GUARDIAN_DISABLED_PAYLOAD: GuardianToolPayload = {
  status: "unavailable",
  reason:
    "The Fugu Guardian monitoring loop is not running in this process. Start the agent with " +
    "FUGU_GUARDIAN_ENABLED=1 (and a bounded Altana session file) to enable it.",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function positionPayload(pos: Position): GuardianToolPayload {
  // `decide` is pure deterministic code and is what the cycle itself uses. Reporting it
  // here is a READ of the same verdict, not a second opinion: no execution happens.
  const decision = decide(pos);
  return {
    status: "ok",
    protocol: pos.protocol,
    account: pos.account,
    blockNumber: pos.blockNumber.toString(),
    collateral: formatUsd8(pos.collateralBase),
    debt: formatUsd8(pos.debtBase),
    liquidationThresholdPercent: formatPercentFromBps(pos.liquidationThresholdBps),
    healthFactor: pos.healthFactor === null ? "no debt" : formatHf(pos.healthFactor),
    assessment: {
      action: decision.action,
      reason: decision.reason,
      suggestedRepay: formatUsd8(decision.suggestedRepayBase),
      collateralDropToLiquidationPercent:
        decision.dropToLiquidationBps === null ? null : formatPercentFromBps(decision.dropToLiquidationBps),
    },
  };
}

export function executeStatePayload(state: ExecuteState, extra: { intervalMs: number; cycleActive: boolean }): GuardianToolPayload {
  return {
    status: "ok",
    killSwitchEngaged: state.killed,
    spentToday: formatUsd8(state.spentTodayUsd8),
    dayStartedAt: state.dayStartedAt,
    lastActionAt: state.lastActionAt,
    monitorIntervalMs: extra.intervalMs,
    cycleRunningNow: extra.cycleActive,
    pendingRepay:
      state.pendingRepay === null
        ? null
        : {
            asset: state.pendingRepay.asset,
            amount: formatUsd8(state.pendingRepay.amountUsd8),
            startedAt: state.pendingRepay.startedAt,
            txHash: state.pendingRepay.txHash,
            note:
              "No new repay is sent while this stands. It clears only when the chain shows the " +
              "debt fall by exactly this amount, or when an operator calls clearPendingRepay.",
          },
  };
}

export function cycleResultPayload(result: CycleResult): GuardianToolPayload {
  if (!result.ok) {
    return {
      status: "cycle_failed",
      timestamp: result.timestamp,
      account: result.account,
      error: result.error,
      note: "The monitoring loop is still running; a failed cycle never stops it.",
    };
  }
  return {
    status: "ok",
    timestamp: result.timestamp,
    account: result.account,
    healthFactor: result.healthFactor === null ? "no debt" : formatHf(result.healthFactor),
    action: result.action,
    sent: result.sent,
    amountSent: formatUsd8(result.amountSentUsd8),
    cappedPerAction: result.cappedPerAction,
    cappedPerDay: result.cappedPerDay,
    txHash: result.txHash,
    decisionReason: result.reason,
    executeReason: result.executeReason,
    explanation: result.explanation,
  };
}

export interface GuardianToolHandlers {
  position(): Promise<GuardianToolPayload>;
  executeState(): Promise<GuardianToolPayload>;
  runCycle(): Promise<GuardianToolPayload>;
  killSwitch(): Promise<GuardianToolPayload>;
}

/**
 * Builds the handlers over a runtime, or over "no runtime at all" (`null`) — in which case
 * every tool answers `unavailable` with the variable that turns it on. The tools stay
 * REGISTERED either way: a caller must be able to see that Guardian exists and learn why it
 * is not running, rather than find a tool missing and guess.
 *
 * A read that fails (an RPC hiccup, a malformed position) is reported to the caller as an
 * `error` payload. That is the opposite of swallowing it: the caller is told, the logger is
 * told, and the monitoring loop — which is what protects the money — keeps running either
 * way.
 */
export function guardianToolHandlers(runtime: GuardianRuntime | null): GuardianToolHandlers {
  if (runtime === null) {
    const unavailable = async (): Promise<GuardianToolPayload> => GUARDIAN_DISABLED_PAYLOAD;
    return { position: unavailable, executeState: unavailable, runCycle: unavailable, killSwitch: unavailable };
  }

  return {
    position: async () => {
      try {
        return positionPayload(await runtime.readPosition());
      } catch (err) {
        return { status: "error", error: messageOf(err) };
      }
    },

    executeState: async () => {
      try {
        return executeStatePayload(runtime.getExecuteState(), {
          intervalMs: runtime.config.intervalMs,
          cycleActive: runtime.isCycleActive(),
        });
      } catch (err) {
        return { status: "error", error: messageOf(err) };
      }
    },

    runCycle: async () => {
      try {
        const outcome = await runtime.runCycleNow();
        return cycleResultPayload(outcome.result);
      } catch (err) {
        if (err instanceof GuardianBusyError) {
          return { status: "busy", reason: err.message };
        }
        return { status: "error", error: messageOf(err) };
      }
    },

    killSwitch: async () => {
      runtime.kill();
      // Read the state back rather than asserting success: what is reported is what
      // `executeDecision` will actually see on its first rule next cycle.
      const state = runtime.getExecuteState();
      return {
        status: "ok",
        killSwitchEngaged: state.killed,
        note:
          "One-way. No new repay will be sent by any following cycle. Monitoring and logging " +
          "continue. A cycle already in flight is left to finish and cannot undo this.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The A2A face: the agent's own tool set
// ---------------------------------------------------------------------------

const NO_INPUT = z.object({});

/**
 * The AI SDK tool set, in the same shape as `LLM_READ_TOOLS` in `tools.ts`. Spread it
 * alongside that set — the descriptions are what the model reads, so each one states plainly
 * what the model does NOT control.
 */
export function guardianLlmTools(handlers: GuardianToolHandlers): ToolSet {
  return {
    guardian_position: tool({
      description:
        "Read the borrow position Fugu Guardian monitors: collateral, debt, health factor, and " +
        "the deterministic assessment (action + reason) for it. Read-only, no transaction.",
      inputSchema: NO_INPUT,
      execute: async () => handlers.position(),
    }),
    guardian_execute_state: tool({
      description:
        "Read Guardian's execution state: how much of the daily budget is spent, the cooldown, " +
        "whether the kill switch is engaged, and whether a repay is still unproven. Read-only.",
      inputSchema: NO_INPUT,
      execute: async () => handlers.executeState(),
    }),
    guardian_run_cycle: tool({
      description:
        "Run ONE Guardian monitoring cycle now, on top of the interval loop that is already " +
        "running. The cycle may send a repay, but you do not decide that: the action, the " +
        "amount, the thresholds, the daily cap, and the cooldown are all fixed deterministic " +
        "code. This tool takes no parameters and you cannot influence any number in it. " +
        "Refused with status \"busy\" if a cycle is already running.",
      inputSchema: NO_INPUT,
      execute: async () => handlers.runCycle(),
    }),
    guardian_kill_switch: tool({
      description:
        "Pull Guardian's kill switch: from the next cycle on, no repay is ever sent. ONE-WAY — " +
        "there is no tool that turns it back on. Monitoring and logging continue. Use it when " +
        "the user asks Guardian to stop spending.",
      inputSchema: NO_INPUT,
      execute: async () => handlers.killSwitch(),
    }),
  };
}

// ---------------------------------------------------------------------------
// The MCP face
// ---------------------------------------------------------------------------

/** MCP tool result: the JSON payload as text content (matching `mcpMain.ts`'s `toolResult`). */
function mcpResult(payload: GuardianToolPayload) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

/**
 * Registers the four tools on an MCP server.
 *
 * `guardian_run_cycle` and `guardian_kill_switch` are marked `readOnlyHint: false` on
 * purpose: one can move money, the other changes durable state. Mislabelling either as
 * read-only would tell an MCP client it is free to retry them at will.
 */
export function registerGuardianMcpTools(server: McpServer, handlers: GuardianToolHandlers): void {
  server.registerTool(
    "guardian_position",
    {
      description:
        "Read the borrow position Fugu Guardian monitors (collateral, debt, health factor) plus " +
        "the deterministic assessment for it. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => mcpResult(await handlers.position()),
  );

  server.registerTool(
    "guardian_execute_state",
    {
      description:
        "Read Guardian's execution state: daily budget spent, cooldown, kill switch, and any " +
        "repay that is not yet proven complete. Read-only.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => mcpResult(await handlers.executeState()),
  );

  server.registerTool(
    "guardian_run_cycle",
    {
      description:
        "Run ONE Guardian monitoring cycle now: read the position, decide, and execute if the " +
        "deterministic rules call for it. Takes no parameters — the action, amount, thresholds, " +
        "daily cap, and cooldown are all fixed code and cannot be influenced from here. " +
        'Returns status "busy" when a cycle is already in flight.',
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async () => mcpResult(await handlers.runCycle()),
  );

  server.registerTool(
    "guardian_kill_switch",
    {
      description:
        "Pull Guardian's kill switch. From the next cycle on, no repay is sent, whatever the " +
        "position looks like. ONE-WAY: there is no tool that clears it. Monitoring continues.",
      inputSchema: {},
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: true },
    },
    async () => mcpResult(await handlers.killSwitch()),
  );
}
