/**
 * Combined A2A-native + tunneled MCP seller entrypoint.
 *
 * This is the VALUABLE agent AND the SOLE key-holder/signer. It serves its
 * two ERC-8183 seller skills DIRECTLY over the A2A protocol on AWS Bedrock
 * AgentCore: an `@a2a-js/sdk` express app exposes the
 * agent card at `/.well-known/agent-card.json` + JSON-RPC `message/send` on
 * `0.0.0.0:9000` (`AGENT_PORT` overrides locally), plus `GET /ping` for the
 * AgentCore liveness contract. The same app also exposes stateful
 * streamable-HTTP MCP at `/mcp`; the platform gateway reaches that face
 * through the HTTP envelope-v1 tunnel.
 *
 * A2A is deliberately the one native AgentCore protocol in dual mode:
 * `HEALTHY_BUSY` on `/ping` is the only contract that keeps background A2A
 * delivery alive. AgentCore accepts one serverProtocol and one data-plane
 * port, so both faces share this A2A-native process and port.
 *
 * A2A skills (executor.ts):
 *
 *     negotiate     → read the FIXED list price → CLAMP to [min,max] → EIP-191 SIGN
 *                     the offer (no LLM, no tools) → return the signed offer (or reject)
 *     notify_funded → re-verify the funded job on-chain (fast) → ACK accepted at once,
 *                     then in the BACKGROUND: LLM work → manifest → storage →
 *                     submitResult (SIGN + broadcast). The buyer polls the chain for
 *                     the deliverable. Each notify also sweeps other FUNDED jobs
 *                     (buyer-push fallback). While background work is in flight the
 *                     `/ping` handler reports HEALTHY_BUSY so AgentCore keeps the
 *                     scale-to-zero runtime warm until it lands.
 *
 * Buyers reach this endpoint with an OAuth2 (Cognito) bearer — AgentCore A2A
 * mandates inbound auth (see agentCard.ts + `bag deploy provision-cognito`).
 *
 * ## Boundaries (do NOT cross — they are the whole point)
 *
 * - The agent does ALL deterministic SIGNING (quote-sign + submit + settle +
 *   automatic Pieverse LLM-credit auto-renew). ALL signing is FIXED code in
 *   `signing.ts` — NEVER an LLM-callable tool (money never in the LLM).
 * - The price is a FIXED list price from studio.toml (clamped before
 *   signing) — the LLM never prices; it only PRODUCES the work text in the
 *   delivery step.
 * - Chain access for the LLM is READ-ONLY tools only (`tools.ts`).
 * - `settle` (claim payment after the dispute window) is operator-driven —
 *   run `bag erc8183 settle <job_id>`; it is deliberately NOT an A2A skill.
 */

import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import {
  loadStudioToml,
  type TomlTable,
} from "@bnbagent/studio-runtime/config";
import {
  ensureAltanaSessionLoaded,
  ensureKeystoreMaterialized,
  ensureTwakMaterialized,
  getWallet,
} from "@bnbagent/studio-runtime/wallet";
import {
  createEnvelopeMiddleware,
  b402SellPath,
  type B402HttpRequest,
  type B402RunWork,
  B402Seller,
} from "@bnbagent/studio-runtime/b402";
import { generateText, stepCountIs } from "ai";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildAgentCard } from "./agentCard.js";
import { SellerAgentExecutor } from "./executor.js";
import { buildMcpServer } from "./mcpMain.js";
import { buildModel } from "./model.js";
import { requestLimitContext } from "./requestLimits.js";
import type { RunWork } from "./sellerCore.js";
import { LLM_READ_TOOLS } from "./tools.js";

const APP_NAME = "agent";

/**
 * Deliverable `generator` label: this seller's own name, read from
 * studio.toml `[project].name` (minus the `-agent` suffix) so each delivered
 * manifest is self-identifying. Best-effort — falls back to `APP_NAME` if
 * the config can't be read.
 */
function generatorTag(): string {
  let name = "";
  try {
    const cfg = loadStudioToml();
    name = String(((cfg.project ?? {}) as Record<string, unknown>).name ?? "");
  } catch {
    // a metadata label must never break delivery
    return APP_NAME;
  }
  return name.endsWith("-agent")
    ? name.slice(0, -"-agent".length)
    : name || APP_NAME;
}

// ── Runtime secrets ───────────────────────────────────────────────────────────
// Keep plaintext secrets OUT of agentcore.json. When BNBAGENT_RUNTIME_SECRET_ID
// is set (deployed runtime), pull a JSON {ENV_NAME: value} blob from AWS
// Secrets Manager into the process env BEFORE anything reads it (keystore
// unlock, provider key, buildModel, Cognito OAuth env). No-op locally, where
// .env.local already populated the environment. In a deployed runtime the
// managed secret bundle is authoritative and replaces any stale spec-level
// value left by an earlier runtime revision.
async function loadRuntimeSecrets(): Promise<void> {
  const secretId = process.env.BNBAGENT_RUNTIME_SECRET_ID;
  if (!secretId) {
    return;
  }
  const resp = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const bundle = JSON.parse(resp.SecretString ?? "{}") as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(bundle)) {
    process.env[key] = String(value);
  }
  const pieverseKey = process.env.PIEVERSE_LLM_API_KEY;
  if (pieverseKey) {
    const fingerprint = createHash("sha256")
      .update(pieverseKey, "utf-8")
      .digest("hex")
      .slice(0, 12);
    console.info(
      `[runtime-secrets] PIEVERSE_LLM_API_KEY source=secretsmanager sha256=${fingerprint}…`,
    );
  }
}

/** studio.toml `[network].default` (best-effort; used by the funded sweep). */
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

// ── One-shot LLM helper (the executor's delivery work hook) ──────────────────
// LLM credit auto-renew (Pieverse path): `buildModel()` (in model.ts) returns
// a model wrapped with a middleware that auto-tops up the active Pieverse key
// before each generate call when [llm.auto_renew] is enabled. That top-up is
// the ONLY automatic signing path outside signing.ts — it is budget-gated and
// is NOT an LLM tool. It rides transparently into the delivery step.
//
// The LLM runs only in an authorized value step: verified ERC-8183 delivery
// or x402 work after its payment/free gate. `negotiate` is rule-based and
// never touches the LLM. The read-only chain tools are
// attached so the work can read on-chain context if it needs to — drop them
// from `tools.ts` if your work doesn't read chain. Signing / settle are NEVER
// tools — they are fixed code in signing.ts, triggered by the A2A skills,
// never callable by the LLM. (The one deliberate exception: the x402-buyer
// recipe's PAID fetch tools — see the `tools:` note below — the LLM picks the
// URL, but who gets paid and the per-call/daily caps stay locked in
// studio.toml.)
export function buildRunWork(): RunWork {
  // The model is resolved LAZILY on first delivery, not at boot: a seller
  // with no provider key yet must still serve negotiate (which never calls
  // the LLM) — missing-key errors surface at notify_funded delivery time.
  let model: ReturnType<typeof buildModel> | undefined;
  return async (prompt, { abortSignal }) => {
    model ??= buildModel(); // managed model with the auto-renew hook (delivery only)
    const result = await generateText({
      model,
      system:
        "You are a seller agent. The runtime has already authorized this task " +
        "through its configured commerce rail. Complete the user's task now; " +
        "do not ask for a job ID or additional payment. " +
        "Be concrete and concise. Use the read-only chain tools when on-chain " +
        "context helps. If a paid-data tool such as `buy_with_x402` is available " +
        "to you, USE IT to fetch the data a task needs — those merchants (e.g. " +
        "CoinMarketCap) charge via on-chain wallet payment, NOT an API key; never " +
        "reply that you cannot complete the task for lack of an API key.",
      prompt,
      // LLM_READ_TOOLS = read-only chain tools (wallet, balances,
      // ERC-8004/8183 queries). Edit `tools.ts` to add/remove. These are
      // READ-ONLY — the agent never signs via a tool; all signing is in
      // signing.ts (fixed code).
      // To let the agent BUY paid data at work time (e.g. CMC market data
      // after `bag x402 trust cmc` + `bag recipe code x402-buyer`), spread
      // the emitted tool set — payee + per-call/daily caps stay locked in
      // studio.toml:
      //   import { X402_BUYER_TOOLS } from "./x402Buyer.js";
      //   tools: { ...LLM_READ_TOOLS, ...X402_BUYER_TOOLS },
      tools: LLM_READ_TOOLS,
      stopWhen: stepCountIs(8), // bounded tool-call loop, then final text
      abortSignal,
    });
    return result.text.trim();
  };
}

function hasErc8183Rail(cfg: TomlTable): boolean {
  const payments = asTable(cfg.payments);
  return asTable(payments?.erc8183) !== null;
}

function asTable(value: unknown): TomlTable | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as TomlTable)
    : null;
}

function flatHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") out[name] = value;
    else if (value !== undefined) out[name] = value[0] ?? "";
  }
  return out;
}

function flatQuery(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(query)) {
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

function b402Work(runWork: RunWork): B402RunWork {
  return ({ prompt }) => runWork(prompt, { sessionId: "b402" });
}

// ── serving ───────────────────────────────────────────────────────────────────

/**
 * Build the single-port dual-face app. Tests import this builder without
 * opening a listener; the runtime entrypoint calls it once and listens on
 * AgentCore's A2A port.
 */
export async function buildDualApp(): Promise<{
  app: express.Express;
  executor: SellerAgentExecutor;
}> {
  await loadRuntimeSecrets();

  // Wallet material is NEVER bundled into the deploy artifact. `bag deploy`
  // injects it via Secrets Manager and these calls (run once at cold start,
  // before any signing) materialize it on disk. Each is a no-op for the
  // other wallet kind and locally, where the wallet already lives on disk:
  //  - evm-local: WALLET_KEYSTORE_JSON → keystore file (unlocked with WALLET_PASSWORD)
  //  - twak:      TWAK_WALLET_JSON / TWAK_CREDENTIALS_JSON → $TMPDIR/twak-home/.twak
  //               (exported as TWAK_HOME_DIR; twak reads TWAK_WALLET_PASSWORD itself)
  ensureKeystoreMaterialized();
  ensureTwakMaterialized();
  await ensureAltanaSessionLoaded();

  const cfg = loadStudioToml();
  const rails = { erc8183: hasErc8183Rail(cfg) };
  const sellPath = b402SellPath(cfg);
  const port = Number(process.env.AGENT_PORT || "9000");
  const runWork = buildRunWork();

  // The executor backs the seller skills with signing.ts fixed code (NEVER an
  // LLM tool). The express app hosts the agent card + JSON-RPC message/send
  // on 0.0.0.0:9000 and GET /ping for AgentCore's liveness probe.
  const executor = new SellerAgentExecutor({
    runWork,
    generator: generatorTag(),
    network: defaultNetwork(),
    commerceSkills: rails.erc8183,
  });
  const agentCard = buildAgentCard({ commerceSkills: rails.erc8183 });
  const seller = await B402Seller.create({
    cfg,
    runWork: b402Work(runWork),
    walletAddress: getWallet().address,
    resourceUrl: `${
      process.env.AGENTCORE_RUNTIME_URL ?? `http://localhost:${port}`
    }${sellPath}`,
  });

  const handler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    executor,
  );

  const app = express();
  app.use(requestLimitContext);

  // GET /ping status fed to AgentCore: HEALTHY_BUSY while a background
  // delivery is in flight, else HEALTHY.
  //
  // notify_funded acks immediately and runs the slow work (LLM + on-chain
  // submit) in the background. Reporting HEALTHY_BUSY tells AgentCore the
  // runtime is still working, so the scale-to-zero runtime is NOT reaped on
  // idle before delivery lands (bounded by the session max-lifetime; ≤8h).
  app.get("/ping", (_req, res) => {
    res.json({ status: executor.isBusy() ? "HEALTHY_BUSY" : "HEALTHY" });
  });

  if (seller.state !== "disabled") {
    app.all(
      sellPath,
      express.text({ type: "*/*", limit: "1mb" }),
      async (req, res) => {
        const request: B402HttpRequest = {
          method: req.method,
          path: req.path,
          query: flatQuery(req.query),
          headers: flatHeaders(req.headers),
          body:
            typeof req.body === "string"
              ? req.body
              : JSON.stringify(req.body ?? ""),
        };
        const out = await seller.handle(request);
        res.status(out.status).set(out.headers).send(out.body);
      },
    );
  }

  app.use(express.json({ limit: "8mb" }));
  app.use(createEnvelopeMiddleware({ port }));

  app.use(
    "/.well-known/agent-card.json",
    agentCardHandler({ agentCardProvider: handler }),
  );

  const transports: Record<string, StreamableHTTPServerTransport> = {};
  app.all("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports[sessionId] : undefined;
    if (transport === undefined) {
      if (req.method !== "POST" || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session" },
          id: null,
        });
        return;
      }
      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => {
          transports[sid] = t;
        },
      });
      t.onclose = () => {
        if (t.sessionId !== undefined) {
          delete transports[t.sessionId];
        }
      };
      await buildMcpServer({ commerceSkills: rails.erc8183 }).connect(t);
      transport = t;
    }
    await transport.handleRequest(req, res, req.body);
  });

  app.use(
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );

  return { app, executor };
}

async function main(): Promise<void> {
  const host = process.env.AGENT_BIND_HOST || "0.0.0.0";
  const port = Number(process.env.AGENT_PORT || "9000");
  const { app } = await buildDualApp();

  // AgentCore's A2A contract is 0.0.0.0:9000. Do not honor the HTTP
  // protocol's $PORT=8080 convention here; AGENT_PORT is the local-dev /
  // rendered-container override.
  app.listen(port, host, () => {
    console.log(
      `[seller-agent] A2A native + MCP tunneled serving on ${host}:${port}`,
    );
  });
}

// Run only as an entrypoint (`node dualMain.js` / the AgentCore runtime), never
// on import — tests import the builders above without starting a server.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error("[seller-agent] fatal:", e);
    process.exit(1);
  });
}
