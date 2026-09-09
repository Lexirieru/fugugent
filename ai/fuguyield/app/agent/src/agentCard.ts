/**
 * A2A AgentCard — the seller agent's outward, discoverable identity.
 *
 * Built by `main.ts` and served at `/.well-known/agent-card.json`. When
 * deployed, `main.ts` overwrites `card.url` at boot with the deployed
 * AgentCore runtime URL (`$AGENTCORE_RUNTIME_URL`), so the `url` here is only
 * a local-dev placeholder.
 *
 * The card advertises exactly two skills — `negotiate` and `notify_funded` —
 * and the OAuth2 (Cognito) security scheme buyers must satisfy: AgentCore A2A
 * endpoints require an inbound OAuth2 bearer (there is no anonymous mode).
 * The token URL + scope come from the Cognito user pool
 * `bag deploy provision-cognito` creates (env `OAUTH_TOKEN_URL` /
 * `OAUTH_SCOPE`, injected at deploy); the runtime's inbound JWT authorizer
 * validates the same pool. Locally (no Cognito env) the card omits the scheme
 * so `bag dev` is reachable without a token.
 *
 * You own this file — edit the skill descriptions / card metadata for your
 * seller.
 */

import type { AgentCard, AgentSkill, SecurityScheme } from "@a2a-js/sdk";
import { loadStudioToml } from "@bnbagent/studio-runtime/config";
import { YIELD_ADVISORY_SKILL, YIELD_BREAKEVEN_SKILL } from "./advisory.js";

/**
 * The value skill. Advertised UNCONDITIONALLY — unlike the two commerce skills it needs no
 * payment rail, no wallet and no network, because it is a pure function of its input.
 *
 * The description says what this agent does NOT do, in the card itself, where a buyer reads
 * it BEFORE paying: it recommends and explains, it never executes. The on-chain listing
 * metadata says the same thing (`onchainExecution: false`), and the two must never drift.
 */
const YIELD_ADVISORY: AgentSkill = {
  id: YIELD_ADVISORY_SKILL,
  name: "Yield migration advice (analysis only — no execution)",
  description:
    'Send a data part {"skill": "' + YIELD_ADVISORY_SKILL + '", "position": {"principalBase": ' +
    '"1000000000000", "current": {"poolId": "...", "protocol": "...", "apyBps": "500", ' +
    '"tvlBase": "...", "riskScore": 20, "isActive": true, "apyAgeSeconds": 60}}, ' +
    '"candidates": [...], "consecutiveFavorable": 0} — money on the 8-decimal basis, APY in ' +
    "bps. The deterministic engine replies with STAY / MIGRATE / EXIT, a reason code, the APY " +
    "spread, the migration cost, the DERIVED threshold it was measured against, and why each " +
    "rejected candidate was refused before its APY was compared. A higher APY that does not " +
    "clear the threshold is a real answer: the threshold is inversely proportional to the " +
    "principal and the horizon, so the highest APY is not the answer. " +
    "THIS SKILL DOES NOT MOVE FUNDS. This agent has no execution path: it signs nothing, " +
    "withdraws nothing and deposits nothing. `consecutiveFavorable` is yours to count — this " +
    "agent keeps no memory and reads no clock.",
  tags: ["defi", "yield", "advisory", "no-execution", "bnb-chain"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

const YIELD_BREAKEVEN: AgentSkill = {
  id: YIELD_BREAKEVEN_SKILL,
  name: "The spread a migration has to clear, and the thresholds that decide it",
  description:
    'Send {"skill": "' + YIELD_BREAKEVEN_SKILL + '", "principalBase": "1000000000000"} to get ' +
    "the migration cost, the break-even APY spread over the horizon, and the required spread " +
    "after the safety multiple — derived from the cost, the principal and the horizon, not " +
    "chosen. Omit the principal to read the thresholds alone. Analysis only; nothing is executed.",
  tags: ["defi", "yield", "advisory", "no-execution"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

const NEGOTIATE: AgentSkill = {
  id: "negotiate",
  name: "Negotiate an ERC-8183 job",
  description:
    'Send a data part {"skill": "negotiate", "task_description": "...", ' +
    '"terms": {"deliverables": "...", "quality_standards": "..."}} (both ' +
    "terms keys are REQUIRED) and receive a " +
    "wallet-signed price quote (price, currency, negotiation_hash, provider_sig). " +
    "Anchor the returned envelope on-chain via createJob + fund, then send the " +
    "`notify_funded` skill with the job_id to request delivery.",
  tags: ["erc8183", "negotiation", "bnb-chain"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

const NOTIFY_FUNDED: AgentSkill = {
  id: "notify_funded",
  name: "Notify the seller a job is funded (request delivery)",
  description:
    'After you fund the job on-chain, send {"skill": "notify_funded", ' +
    '"job_id": <int>} to tell the seller "I funded job X — please deliver". ' +
    "The seller verifies the funded job carries its signed quote and replies " +
    'AT ONCE with {"status": "accepted"|"rejected", "job_id"}; delivery then ' +
    "runs in the background (work takes time). Do NOT wait on this call for " +
    "the result — read the deliverable back from the CHAIN once the job " +
    "reaches SUBMITTED (the `submit` tx carries the deliverable_url; " +
    "ERC-8183 `get_deliverable_url`). The agent serves no job-query endpoint.",
  tags: ["erc8183", "delivery", "bnb-chain"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

/** Card name from studio.toml `[project].name` (best-effort). */
function agentName(): string {
  let name = "";
  try {
    const cfg = loadStudioToml();
    name = String(
      ((cfg.project ?? {}) as Record<string, unknown>).name ?? "",
    );
  } catch {
    // a card label must never break boot
  }
  return name || "bnbagent-seller";
}

/**
 * OAuth2 (Cognito client-credentials) scheme from env, or null locally.
 *
 * `bag deploy provision-cognito` emits a Cognito user pool + app client and
 * injects `OAUTH_TOKEN_URL` + `OAUTH_SCOPE`; the AgentCore runtime's inbound
 * JWT authorizer is wired to the same pool. Absent (local `bag dev`) →
 * return null so the card advertises no auth requirement.
 */
function oauth2Scheme(): SecurityScheme | null {
  const tokenUrl = process.env.OAUTH_TOKEN_URL;
  const scope = process.env.OAUTH_SCOPE;
  if (!tokenUrl || !scope) {
    return null;
  }
  return {
    type: "oauth2",
    flows: {
      clientCredentials: {
        tokenUrl,
        scopes: { [scope]: "Invoke the seller agent" },
      },
    },
  };
}

/** Build the A2A AgentCard, gating ERC-8183 skills on the configured rail. */
export function buildAgentCard(
  opts: { commerceSkills?: boolean } = {},
): AgentCard {
  const name = agentName();
  const extra: Partial<AgentCard> = {};
  const scheme = oauth2Scheme();
  if (scheme !== null) {
    const scope = process.env.OAUTH_SCOPE as string;
    extra.securitySchemes = { oauth2: scheme };
    extra.security = [{ oauth2: [scope] }];
  }
  return {
    name,
    description:
      `ERC-8183 seller agent (${name}) — yield migration ADVICE over A2A: it reads a position ` +
      "and its alternatives, decides with deterministic code, and explains itself. It has no " +
      "execution path and sends no transactions (onchainExecution: false). Commerce: negotiate " +
      "+ notify_funded.",
    // main.ts overwrites this with $AGENTCORE_RUNTIME_URL at boot.
    // Local-dev fallback: a client-routable localhost URL (not the 0.0.0.0
    // bind address). Host via AGENT_HOST (default localhost); port via the
    // same AGENT_PORT → 9000 resolution main.ts serves on. Do not honor the
    // AgentCore HTTP $PORT=8080 convention for this A2A runtime.
    url:
      process.env.AGENTCORE_RUNTIME_URL ??
      `http://${process.env.AGENT_HOST ?? "localhost"}:${process.env.AGENT_PORT || "9000"}/`,
    version: "1.0.0",
    protocolVersion: "0.3.0",
    preferredTransport: "JSONRPC",
    // Non-streaming: negotiate / notify_funded are request/response
    // (message/send). Do NOT flip this on to satisfy the AgentCore
    // inspector's chat box — that box can't drive a seller agent (it can
    // only send plain text, never the {"skill": ...} DataPart these skills
    // require, and its streaming view expects Task events). Test locally
    // with curl / an A2A client sending a DataPart (see the operating skill).
    capabilities: { streaming: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    // The advisory skills stand first and are never gated: they are what the agent is FOR,
    // and they work with or without a payment rail configured.
    skills: [
      YIELD_ADVISORY,
      YIELD_BREAKEVEN,
      ...(opts.commerceSkills === false ? [] : [NEGOTIATE, NOTIFY_FUNDED]),
    ],
    ...extra,
  };
}
