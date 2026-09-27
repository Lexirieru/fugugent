/**
 * `/api/run/*` — the five read-only HelloFugu agents, each one an endpoint.
 *
 * - `GET /api/run` — which agents answer here and what each one takes.
 * - `GET /api/run/watch?wallet=0x…` — Fugu Watch
 * - `GET /api/run/tally?wallet=0x…` — Fugu Tally
 * - `GET /api/run/scout?category=GRID&limit=5` — Fugu Scout
 * - `GET /api/run/keycheck?account=0x…&keyHash=0x…` — Fugu Keycheck
 * - `GET /api/run/quote?usd=0.10` — Fugu Quote
 *
 * A malformed input is a 400 naming the field. A failed chain read is a 503 with the
 * reason, never an empty 200.
 */
import { Hono, type Context } from "hono";
import { redact } from "../service/agents.js";
import type { Tools } from "../sources/tools.js";
import { CATEGORIES, type Address, type Category } from "../types.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const USD = /^\d{1,9}(\.\d{1,8})?$/;

export const RUN_AGENTS = [
  { slug: "watch", name: "Fugu Watch", category: "HEALTH_FACTOR", takes: "wallet=0x…", does: "Reads a loan's health factor on the HelloFugu test pool and says which of Fugu Guardian's bands it is in." },
  { slug: "tally", name: "Fugu Tally", category: "TREASURY", takes: "wallet=0x…", does: "Adds up what a wallet has spent hiring agents on HelloFugu, per agent." },
  { slug: "scout", name: "Fugu Scout", category: "HIRING", takes: "category=GRID&limit=5", does: "Names the agents on offer in one category, read from the ERC-8004 registry." },
  { slug: "keycheck", name: "Fugu Keycheck", category: "AUTONOMOUS", takes: "account=0x…&keyHash=0x…", does: "Checks whether an agent's Altana session key is still valid on chain." },
  { slug: "quote", name: "Fugu Quote", category: "COMMERCE", takes: "usd=0.10", does: "Turns a dollar amount into tBNB at the FuguPriceOracle's live price." },
] as const;

function bad(c: Context, field: string, message: string) {
  return c.json({ error: "bad_request", field, message }, 400);
}

async function answer<T>(c: Context, run: () => Promise<T>) {
  try {
    return c.json(await run());
  } catch (err) {
    return c.json({ error: "chain_unavailable", message: redact(err instanceof Error ? err.message : String(err)) }, 503);
  }
}

/** `0.10` dollars as an 8-decimal integer, without floats. */
export function usdToUsd8(text: string): bigint {
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
}

export function createToolRoutes(tools: Tools): Hono {
  const app = new Hono();

  app.get("/run", (c) =>
    c.json({ agents: RUN_AGENTS.map((a) => ({ ...a, endpoint: `https://api.hellofugu.xyz/api/run/${a.slug}?${a.takes}` })) }),
  );

  app.get("/run/watch", (c) => {
    const wallet = c.req.query("wallet") ?? "";
    if (!ADDRESS.test(wallet)) return bad(c, "wallet", "wallet must be a 0x address");
    return answer(c, () => tools.watch(wallet as Address));
  });

  app.get("/run/tally", (c) => {
    const wallet = c.req.query("wallet") ?? "";
    if (!ADDRESS.test(wallet)) return bad(c, "wallet", "wallet must be a 0x address");
    return answer(c, () => tools.tally(wallet as Address));
  });

  app.get("/run/scout", (c) => {
    const category = (c.req.query("category") ?? "").toUpperCase();
    if (!(CATEGORIES as readonly string[]).includes(category)) return bad(c, "category", `category must be one of ${CATEGORIES.join(", ")}`);
    const limit = Number(c.req.query("limit") ?? "5");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) return bad(c, "limit", "limit must be 1 to 20");
    return answer(c, () => tools.scout(category as Category, limit));
  });

  app.get("/run/keycheck", (c) => {
    const account = c.req.query("account") ?? "";
    const keyHash = c.req.query("keyHash") ?? "";
    if (!ADDRESS.test(account)) return bad(c, "account", "account must be a 0x address");
    if (!HASH.test(keyHash)) return bad(c, "keyHash", "keyHash must be a 32-byte 0x hash");
    return answer(c, () => tools.keycheck(account as Address, keyHash as `0x${string}`));
  });

  app.get("/run/quote", (c) => {
    const usd = c.req.query("usd") ?? "";
    if (!USD.test(usd)) return bad(c, "usd", "usd must be a positive dollar amount, e.g. 0.10");
    const usd8 = usdToUsd8(usd);
    if (usd8 === 0n) return bad(c, "usd", "usd must be more than zero");
    return answer(c, () => tools.quote(usd8));
  });

  return app;
}
