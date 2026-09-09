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
import { HIRE_ADVISORY_SKILL, HIRE_POLICY_SKILL } from "./hiring.js";

/**
 * The skill this agent exists for. Advertised whatever else is configured, because it
 * needs no payment rail, no wallet and no network: it is a function of its input.
 *
 * The description says what this agent does NOT do, in the card, where a buyer reads it
 * BEFORE paying. It chooses and it explains. Paying is a separate step with its own
 * evidence, and that evidence is a transaction, not a sentence.
 */
const HIRE_ADVISORY: AgentSkill = {
  id: HIRE_ADVISORY_SKILL,
  name: "Choose which agent to rent, and say what it costs",
  description:
    'Send a data part {"skill": "' + HIRE_ADVISORY_SKILL + '", "category": "YIELD", ' +
    '"workSeconds": "3600", "budgetUsd8": "50000000", "catalog": [...]}. Money is on the ' +
    "8-decimal basis, so 100000000 is one dollar, and time is in whole seconds. The engine " +
    "replies with HIRE, NO_MATCH, OVER_BUDGET, BLOCKED_BY_POLICY or WINDOW_EXHAUSTED, the " +
    "listing it chose, the one it chose against, and the rule that put every other listing " +
    "aside. The refusals are told apart on purpose: nobody offers this capability, somebody " +
    "does and a rule refused them, the price is above the limit, or this agent has already " +
    "spent what it is allowed to spend. " +
    "THIS SKILL DOES NOT PAY. It signs nothing and sends no transaction. A malformed catalog " +
    "comes back as a rejection with the reason, never as a guess.",
  tags: ["hiring", "agent-marketplace", "decision", "no-payment", "bnb-chain"],
  inputModes: ["application/json"],
  outputModes: ["application/json"],
};

const HIRE_POLICY: AgentSkill = {
  id: HIRE_POLICY_SKILL,
  name: "The limits this agent spends within",
  description:
    'Send {"skill": "' + HIRE_POLICY_SKILL + '"} to read the ceiling for one rental, the ' +
    "ceiling across a window, the most this agent pays for one block of time, the longest " +
    "prepayment it will make, the block lengths it rents by, and how far a price may move " +
    "between the decision and the payment. Each comes with the reason it is the value it is. " +
    "Nothing is paid by asking.",
  tags: ["hiring", "limits", "decision", "no-payment"],
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
      `Fugu Broker (${name}). It reads the catalog of agents for rent, chooses one by rules ` +
      "that are written down and tested, works out what the rental costs, and can pay for it " +
      "through a delegated key whose permitted-method list holds one entry. Deciding and paying " +
      "are separate steps: this card describes the deciding, and a payment is only ever proven " +
      "by a transaction. Commerce: negotiate and notify_funded.",
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
    // The hiring skills stand first and are never gated: they are what the agent is for,
    // and they work with or without a payment rail configured.
    skills: [
      HIRE_ADVISORY,
      HIRE_POLICY,
      ...(opts.commerceSkills === false ? [] : [NEGOTIATE, NOTIFY_FUNDED]),
    ],
    ...extra,
  };
}
