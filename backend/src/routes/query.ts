/**
 * Pembacaan parameter kueri — **satu-satunya** tempat teks dari luar berubah
 * jadi angka dan kategori.
 *
 * Aturannya satu: parameter yang cacat **ditolak**, tidak diam-diam dijadikan
 * nilai bawaan dan tidak dibiarkan menjadi `NaN` yang muncul beberapa lapis
 * kemudian sebagai 500. `limit=abc` yang diam-diam menjadi 20 adalah kegagalan
 * yang lebih buruk daripada 400: pengguna melihat halaman yang bukan yang ia
 * minta dan tidak pernah diberi tahu.
 *
 * "Kosong" ≠ "cacat". `?category=&limit=&offset=` — bentuk yang benar-benar
 * dikirim `URLSearchParams` untuk field yang tidak diisi — berarti tidak diisi.
 */
import { MAX_PAGE_LIMIT } from "../service/agents.js";
import { CATEGORIES, type Category } from "../types.js";

/** Hanya digit. `1.5`, `1e3`, ` 7`, dan `+7` bukan bilangan bulat non-negatif. */
const UNSIGNED_INTEGER = /^\d+$/;

/** Kegagalan validasi yang tahu field mana yang salah — itu yang dilihat pemanggil. */
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

/** Nilai yang tidak diisi: absen atau string kosong/whitespace. */
function blank(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === "";
}

/**
 * `limit` — bilangan bulat 1..{@link MAX_PAGE_LIMIT}.
 *
 * Batas atas ditolak, bukan dipangkas: `limit=1000` yang diam-diam menjadi 100
 * membuat klien mengira ia sudah melihat seluruh hasil.
 */
export function parseLimit(raw: string | undefined, fallback: number): number {
  if (blank(raw)) return fallback;
  const value = raw as string;
  if (!UNSIGNED_INTEGER.test(value)) {
    throw new QueryError(
      "limit",
      `limit harus bilangan bulat antara 1 dan ${MAX_PAGE_LIMIT}, bukan ${JSON.stringify(value)}`,
    );
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > MAX_PAGE_LIMIT) {
    throw new QueryError("limit", `limit harus antara 1 dan ${MAX_PAGE_LIMIT}, bukan ${parsed}`);
  }
  return parsed;
}

/**
 * Batas atas `offset`.
 *
 * Tanpa ini `offset=9007199254740991` diteruskan apa adanya dan menjadi
 * `OFFSET 9007199254740991` di Postgres — permintaan tanpa autentikasi yang
 * tidak pernah bisa menghasilkan sesuatu yang berguna. 10.000 jauh di atas
 * apa pun yang bisa dijangkau UI hari ini.
 */
export const MAX_OFFSET = 10_000;

/** `offset` — bilangan bulat 0..{@link MAX_OFFSET}. `-1` ditolak, tidak dijadikan 0. */
export function parseOffset(raw: string | undefined): number {
  if (blank(raw)) return 0;
  const value = raw as string;
  if (!UNSIGNED_INTEGER.test(value)) {
    throw new QueryError(
      "offset",
      `offset harus bilangan bulat >= 0, bukan ${JSON.stringify(value)}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_OFFSET) {
    throw new QueryError("offset", `offset harus <= ${MAX_OFFSET}, bukan ${value}`);
  }
  return parsed;
}

/**
 * `category` — salah satu dari empat, persis huruf besarnya.
 *
 * `grid` ditolak alih-alih dinormalkan: kategori adalah enum yang sama dengan
 * enum Solidity, dan menerima ejaan bebas di sini berarti perbedaan ejaan baru
 * ketahuan jauh di dalam. `null` berarti "semua kategori".
 */
export function parseCategory(raw: string | undefined): Category | null {
  if (blank(raw)) return null;
  const value = raw as string;
  if (!(CATEGORIES as readonly string[]).includes(value)) {
    throw new QueryError(
      "category",
      `category tidak dikenal: ${JSON.stringify(value)}`,
      CATEGORIES,
    );
  }
  return value as Category;
}

/** `:id` dari path. Kosong ditolak — id kosong bukan permintaan yang bisa dilayani. */
export function parseAgentId(raw: string | undefined): string {
  if (blank(raw)) throw new QueryError("id", "id agent tidak boleh kosong");
  return (raw as string).trim();
}
