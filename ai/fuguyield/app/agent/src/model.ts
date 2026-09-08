import { loadStudioToml, type TomlTable } from "@bnbagent/studio-runtime/config";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * The Fugu Yield brain runs on dGrid — an OpenAI-compatible gateway to 200+ models.
 *
 * The three points below are MANDATORY and each one took real time to find; do not
 * simplify any of them without testing first (see docs/research/07-gate-teknis.md):
 *
 * 1. `.chat()` — without it @ai-sdk/openai uses the Responses API, and dGrid answers
 *    correctly but in a leaner format, so the SDK throws AI_APICallError.
 * 2. A browser User-Agent header — without it dGrid replies HTTP 403.
 * 3. `@ai-sdk/openai` must be an explicit dependency; it is only a transitive dep of
 *    `ai`, and pnpm strict refuses a direct import.
 *
 * This model NEVER makes a financial decision. Every decision this agent makes —
 * routing liquidity to the highest risk-weighted APR across Venus, Aave v3, and Lista — is deterministic, backtestable code in
 * src/strategy/. The LLM only explains decisions already taken, asynchronously. dGrid
 * latency measures 3–46 seconds; putting it on the critical path means the user's
 * position can be damaged while waiting for a sentence of explanation.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const DEFAULT_BASE_URL = "https://api.dgrid.ai/v1";
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

export function buildModel(): LanguageModel {
  const cfg = loadStudioToml();
  const llmCfg = (cfg.llm ?? {}) as TomlTable;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY belum diisi di .studio/.env.local. " +
        "Isi dengan API key dGrid — nama variabelnya mengikuti konvensi provider 'openai' " +
        "di studio.toml, tetapi endpoint-nya diarahkan ke dGrid.",
    );
  }

  const dgrid = createOpenAI({
    baseURL: String(llmCfg.base_url ?? DEFAULT_BASE_URL),
    apiKey,
    headers: { "User-Agent": BROWSER_UA },
  });

  return dgrid.chat(String(llmCfg.model ?? DEFAULT_MODEL));
}
