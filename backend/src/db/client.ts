/**
 * Postgres connection and schema creation.
 *
 * `FuguDb` is deliberately not tied to a single driver: the repo (`repo.ts`)
 * works just as well on top of `postgres-js` (production) as on PGlite (tests).
 * That is what makes the entire cache behaviour testable without a running
 * Postgres.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { SCHEMA_STATEMENTS } from "./schema.js";

/** Any Postgres database Drizzle understands. */
export type FuguDb = PgDatabase<PgQueryResultHKT, Record<string, never>>;

export interface DbHandle {
  db: FuguDb;
  close: () => Promise<void>;
}

/**
 * Opens a connection to Postgres.
 *
 * `max` is kept small on purpose: this backend serves a read cache, not a heavy
 * write load, and a wide connection pool only moves the queue into Postgres.
 */
export function connectDb(url: string, options: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: options.max ?? 10 });
  const db = drizzle(client) as unknown as FuguDb;
  return { db, close: () => client.end({ timeout: 5 }) };
}

export async function closeDb(handle: DbHandle): Promise<void> {
  await handle.close();
}

/**
 * Creates tables and indexes if they do not exist yet. Safe to call repeatedly
 * (`IF NOT EXISTS` on every statement), so the API boot needs no separate
 * migration step and tests can use exactly the same path.
 */
export async function ensureSchema(db: FuguDb): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
}
