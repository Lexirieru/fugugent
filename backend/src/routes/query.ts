/**
 * Query parameter parsing — the **only** place where text from outside turns
 * into numbers and categories.
 *
 * There is one rule: a malformed parameter is **rejected**, never silently
 * turned into a default value and never allowed to become a `NaN` that surfaces
 * a few layers later as a 500. A `limit=abc` that silently becomes 20 is a
 * worse failure than a 400: the user sees a page other than the one they asked
 * for and is never told.
 *
 * "Empty" ≠ "malformed". `?category=&limit=&offset=` — exactly what
 * `URLSearchParams` sends for fields that were left blank — means not set.
 */
import { MAX_PAGE_LIMIT } from "../service/agents.js";
import { CATEGORIES, type Category } from "../types.js";

/** Digits only. `1.5`, `1e3`, ` 7`, and `+7` are not non-negative integers. */
const UNSIGNED_INTEGER = /^\d+$/;

/** A validation failure that knows which field was wrong — that is what the caller sees. */
export class QueryError extends Error {
  readonly field: string;
  readonly allowed?: readonly string[];

  constructor(field: string, message: string, allowed?: readonly string[]) {
    super(message);
    this.name = "QueryError";
    this.field = field;
    this.allowed = allowed;
  }
}

/** An unset value: absent, or an empty/whitespace string. */
function blank(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === "";
}

/**
 * `limit` — an integer in 1..{@link MAX_PAGE_LIMIT}.
 *
 * The upper bound is rejected, not clamped: a `limit=1000` that silently
 * becomes 100 makes the client believe it has already seen every result.
 */
export function parseLimit(raw: string | undefined, fallback: number): number {
  if (blank(raw)) return fallback;
  const value = raw as string;
  if (!UNSIGNED_INTEGER.test(value)) {
    throw new QueryError(
      "limit",
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}, not ${JSON.stringify(value)}`,
    );
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > MAX_PAGE_LIMIT) {
    throw new QueryError("limit", `limit must be between 1 and ${MAX_PAGE_LIMIT}, not ${parsed}`);
  }
  return parsed;
}

/**
 * Upper bound for `offset`.
 *
 * Without it an `offset=9007199254740991` is passed through as-is and becomes
 * `OFFSET 9007199254740991` in Postgres — an unauthenticated request that can
 * never produce anything useful. 10,000 is far above anything the UI can reach
 * today.
 */
export const MAX_OFFSET = 10_000;

/** `offset` — an integer in 0..{@link MAX_OFFSET}. `-1` is rejected, not turned into 0. */
export function parseOffset(raw: string | undefined): number {
  if (blank(raw)) return 0;
  const value = raw as string;
  if (!UNSIGNED_INTEGER.test(value)) {
    throw new QueryError(
      "offset",
      `offset must be an integer >= 0, not ${JSON.stringify(value)}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_OFFSET) {
    throw new QueryError("offset", `offset must be <= ${MAX_OFFSET}, not ${value}`);
  }
  return parsed;
}

/**
 * `category` — one of the four, with exactly that capitalization.
 *
 * `grid` is rejected rather than normalized: the category is the same enum as
 * the Solidity one, and accepting free spelling here means a new spelling
 * discrepancy is only discovered much deeper in. `null` means "all categories".
 */
export function parseCategory(raw: string | undefined): Category | null {
  if (blank(raw)) return null;
  const value = raw as string;
  if (!(CATEGORIES as readonly string[]).includes(value)) {
    throw new QueryError(
      "category",
      `unknown category: ${JSON.stringify(value)}`,
      CATEGORIES,
    );
  }
  return value as Category;
}

/** The `:id` from the path. Empty is rejected — an empty id is not a request that can be served. */
export function parseAgentId(raw: string | undefined): string {
  if (blank(raw)) throw new QueryError("id", "agent id must not be empty");
  return (raw as string).trim();
}
