/**
 * Read-only chain tools exposed to this agent's LLM (AI SDK `tool` wrap).
 *
 * Each entry in `LLM_READ_TOOLS` is a function from
 * `@bnbagent/studio-runtime/tools` wrapped as a Vercel AI SDK tool. The LLM
 * may call any tool in this set while producing the deliverable (the
 * `notify_funded` work step); the `description` is what the LLM sees.
 *
 * You own this file — edit `LLM_READ_TOOLS` to control exactly what your
 * agent can read on-chain. Entries for features your project doesn't use are
 * commented out by default; uncomment after you've added the dependency to
 * `studio.toml`.
 *
 * **All tools are read-only** by the studio definition: no on-chain state
 * change, no transferable authority, no transaction signing, no EIP-712
 * typed-data signing. The agent IS the sole on-chain signer, but ALL of its
 * signing — quote-sign, submitResult, settle, plus the automatic
 * budget-gated Pieverse LLM-credit auto-renew inside `buildModel()` — lives
 * in `signing.ts` / `model.ts` as FIXED entrypoint code and is NEVER a tool
 * the LLM can invoke. The LLM only produces work text after a job is
 * verified funded; it can never price, sign, spend, or mutate chain state.
 * Keep this set read-only.
 *
 * (`pieverseUsage` is the one exception in the underlying module: it does a
 * SIWE EIP-191 personal_sign, domain-locked to llm.pieverse.io, no on-chain
 * effect. It is commented out below.)
 */

import * as cr from "@bnbagent/studio-runtime/tools";
import { loadStudioToml } from "@bnbagent/studio-runtime/config";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  adviseYield,
  yieldAdvisoryInputSchema,
  yieldBreakevenInputSchema,
  yieldBreakevenSkill,
} from "./advisory.js";

/**
 * The project-wide default network (`[network].default`) — tool calls that
 * omit `network` fall back to it, never to a hardcoded name.
 */
function defaultNetwork(): string {
  try {
    const cfg = loadStudioToml();
    return String(
      ((cfg.network ?? {}) as Record<string, unknown>).default ?? "bsc-testnet",
    );
  } catch {
    return "bsc-testnet";
  }
}

const networkArg = z
  .string()
  .optional()
  .describe("studio network name (defaults to the project's [network].default)");

/**
 * The strategy tools — the reason this agent is worth renting.
 *
 * They read a position and its alternatives, run the DETERMINISTIC decision engine in
 * `src/strategy/`, and return the decision together with the reasoning behind it. The LLM
 * may call them and read the result out loud; it may not pick the pool, shift a threshold,
 * or recompute a spread. Every number came from `decide()`, which is pure, replayable and
 * backtested.
 *
 * They are ANALYSIS tools. This agent has no execution path at all — the descriptions say
 * so, because an LLM that thinks a tool moves money will tell a user it moved money.
 */
export const STRATEGY_TOOLS: ToolSet = {
  yield_advisory: tool({
    description:
      "ANALYSIS ONLY — recommends whether a yield position should move, and explains why. " +
      "Takes the current position and the candidate pools; returns STAY / MIGRATE / EXIT with a " +
      "reason code, the APY spread, the migration cost, the DERIVED spread threshold, and why each " +
      "rejected candidate was refused. A higher APY that does not clear the threshold is a real " +
      "answer, not a failure: the highest APY is not the right answer, because the threshold is " +
      "inversely proportional to the principal and the horizon. " +
      "THIS TOOL DOES NOT MOVE FUNDS. It signs nothing, withdraws nothing and deposits nothing; " +
      "this agent has no execution path (onchainExecution: false). Report its numbers exactly as " +
      "returned and never invent, adjust, or extrapolate them.",
    inputSchema: yieldAdvisoryInputSchema,
    execute: async (input) => adviseYield(input).payload,
  }),
  yield_breakeven: tool({
    description:
      "The APY spread a migration must clear for a given principal, and the thresholds that decide " +
      "it. Give it a principal and it returns the migration cost, the break-even spread over the " +
      "horizon, and the required spread after the safety multiple — derived, not chosen. Omit the " +
      "principal to read the thresholds alone. Read this instead of guessing why a higher APY was " +
      "or was not worth moving to. Analysis only; nothing is executed.",
    inputSchema: yieldBreakevenInputSchema,
    execute: async (input) => yieldBreakevenSkill(input),
  }),
};

export const LLM_READ_TOOLS: ToolSet = {
  // --- Strategy (the deliverable; pure code, never the LLM's judgement) ---
  ...STRATEGY_TOOLS,

  // --- Wallet & chain basics ---
  wallet_info: tool({
    description:
      "Describe the agent's active wallet (address, kind, key location).",
    inputSchema: z.object({}),
    execute: async () => cr.walletInfo(),
  }),
  balance_native: tool({
    description:
      "Native BNB balance of an address (defaults to the agent's own wallet).",
    inputSchema: z.object({
      address: z.string().optional().describe("0x address; omit for own wallet"),
      network: networkArg,
    }),
    execute: async ({ address, network }) =>
      cr.balanceNative(address ?? null, network ?? defaultNetwork()),
  }),
  balance_u: tool({
    // requires [u_token] in studio.toml
    description:
      "$U (payment token) balance of an address (defaults to the agent's own wallet).",
    inputSchema: z.object({
      address: z.string().optional().describe("0x address; omit for own wallet"),
      network: networkArg,
    }),
    execute: async ({ address, network }) =>
      cr.balanceU(address ?? null, network ?? defaultNetwork()),
  }),
  network_info: tool({
    description: "Chain id / RPC / token info for a studio network.",
    inputSchema: z.object({ network: networkArg }),
    execute: async ({ network }) => cr.networkInfo(network ?? defaultNetwork()),
  }),
  tx_status: tool({
    description: "Status + receipt summary of a transaction hash.",
    inputSchema: z.object({
      tx_hash: z.string().describe("0x transaction hash"),
      network: networkArg,
    }),
    execute: async ({ tx_hash, network }) =>
      cr.txStatus(tx_hash, network ?? defaultNetwork()),
  }),

  // --- LLM provider ---
  // pieverse_usage: tool({
  //   // SIWE personal_sign; requires [llm.provider=pieverse-llm]
  //   description: "Pieverse LLM usage/credit summary for the last N days.",
  //   inputSchema: z.object({ days: z.number().int().optional() }),
  //   execute: async ({ days }) => cr.pieverseUsage(days ?? 7),
  // }),

  // --- ERC-8004 identity (read-only lookups the LLM may want for context) ---
  agent_info: tool({
    // requires [erc8004] in studio.toml
    description: "ERC-8004 identity record for an agent id.",
    inputSchema: z.object({
      agent_id: z.number().int().describe("ERC-8004 agent id"),
      network: networkArg,
    }),
    execute: async ({ agent_id, network }) =>
      cr.agentInfo(agent_id, network ?? defaultNetwork()),
  }),
  agent_by_address: tool({
    // requires [erc8004] in studio.toml
    description: "Look up an ERC-8004 agent registration by wallet address.",
    inputSchema: z.object({
      address: z.string().describe("0x wallet address"),
      network: networkArg,
    }),
    execute: async ({ address, network }) =>
      cr.agentByAddress(address, network ?? defaultNetwork()),
  }),

  // --- ERC-8183 jobs (READ-ONLY status/list — writes live in signing.ts) ---
  job_status: tool({
    // requires [erc8183] in studio.toml
    description: "Read-only ERC-8183 job summary (status, budget, deliverable URL).",
    inputSchema: z.object({
      job_id: z.number().int().describe("on-chain job id"),
      network: networkArg,
    }),
    execute: async ({ job_id, network }) =>
      cr.jobStatus(job_id, network ?? defaultNetwork()),
  }),
  job_list: tool({
    // requires [erc8183] in studio.toml
    description: "List recent ERC-8183 jobs (optionally only this agent's).",
    inputSchema: z.object({
      limit: z.number().int().optional(),
      mine: z.boolean().optional().describe("only jobs assigned to this agent"),
      network: networkArg,
    }),
    execute: async ({ limit, mine, network }) =>
      cr.jobList({ limit, mine, network: network ?? defaultNetwork() }),
  }),
  // job_count: ...        // network-wide stat — usually noise

  // --- Advanced / footguns (commented by default) ---
  // contract_call_view: ...  // accepts any ABI — LLM-callable footgun
  // block_info: ...
  // wallet_list: ...          // multi-wallet management — dev concern
  // wallet_address: ...       // alias of wallet_info
};
