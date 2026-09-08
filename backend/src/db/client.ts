/**
 * Koneksi Postgres dan pembuatan skema.
 *
 * `FuguDb` sengaja tidak terikat pada satu driver: repo (`repo.ts`) bekerja sama
 * baiknya di atas `postgres-js` (produksi) maupun PGlite (test). Itulah yang
 * membuat seluruh perilaku cache bisa diuji tanpa Postgres yang berjalan.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { SCHEMA_STATEMENTS } from "./schema.js";

/** Database Postgres apa pun yang dipahami Drizzle. */
export type FuguDb = PgDatabase<PgQueryResultHKT, Record<string, never>>;

export interface DbHandle {
  db: FuguDb;
  close: () => Promise<void>;
}

/**
 * Membuka koneksi ke Postgres.
 *
 * `max` dibatasi kecil: backend ini melayani cache pembacaan, bukan beban tulis
 * besar, dan kolam koneksi yang lebar hanya memindahkan antrean ke Postgres.
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
 * Membuat tabel dan indeks bila belum ada. Aman dipanggil berulang kali
 * (`IF NOT EXISTS` di seluruh pernyataan), jadi boot API tidak butuh langkah
 * migrasi terpisah dan test bisa memakai jalur yang persis sama.
 */
export async function ensureSchema(db: FuguDb): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
}
