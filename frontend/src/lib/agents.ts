/**
 * Pemetaan tampilan untuk empat kategori Fugugent.
 *
 * Kategori terkunci di `contracts/src/types/FuguTypes.sol` dan `backend/src/types.ts`.
 * Yang ada di sini hanyalah cara menampilkannya — nama untuk manusia, karakter fugu,
 * dan **metrik risiko utama** kategori itu.
 *
 * Metrik yang berbeda per kategori adalah pilihan sadar, bukan kelalaian:
 * health factor tidak boleh dipaksa dinilai dengan APR. Inilah yang membuat empat
 * kategori benar-benar setara dalam, bukan sekadar empat tab (spec §7.5 poin 8).
 */

import type { AgentRecord, Category } from "@/lib/agent-types";
import type { FuguKind } from "@/lib/fugu";

export interface CategoryMeta {
  category: Category;
  label: string;
  kind: FuguKind;
  /** Apa yang dikerjakan agent kategori ini. */
  blurb: string;
  /** Metrik yang memetakan ke tingkat kembung. Sumber: docs/brand/puff-levels.md §3–4. */
  riskMetric: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  HEALTH_FACTOR: {
    category: "HEALTH_FACTOR",
    label: "Health factor",
    kind: "guardian",
    blurb: "Keeps a lending position away from liquidation.",
    riskMetric: "distance to liquidation",
  },
  REBALANCING: {
    category: "REBALANCING",
    label: "Rebalancing",
    kind: "rebalancer",
    blurb: "Keeps portfolio weights and LP ranges where you put them.",
    riskMetric: "time spent out of range, rolling 24h",
  },
  GRID: {
    category: "GRID",
    label: "Grid",
    kind: "grid",
    blurb: "Buys and sells at fixed levels. Loses in a trending market, and says so.",
    riskMetric: "drawdown from peak equity",
  },
  YIELD: {
    category: "YIELD",
    label: "Yield",
    kind: "yield",
    blurb: "Moves into the highest risk-adjusted APR pool it can verify.",
    riskMetric: "utilisation of the pool holding your funds",
  },
};

/** Urutan tab. Sama dengan urutan enum on-chain. */
export const CATEGORY_ORDER: Category[] = ["REBALANCING", "GRID", "YIELD", "HEALTH_FACTOR"];

/**
 * Id agent first-party kami. Hanya keempat ini yang boleh memakai properti khas
 * (perisai, visor, daun, lengan timbangan) — `docs/brand/characters.md` §7. Agent
 * pihak ketiga selalu mendapat siluet netral berwarna deterministik, supaya empat
 * agent kami terbaca sebagai lantai kualitas, bukan sekadar empat dari 309 ribu.
 */
export const FIRST_PARTY: Record<string, FuguKind> = {
  "97:1": "guardian",
  "97:2": "rebalancer",
  "97:3": "grid",
  "97:4": "yield",
};

export function fuguKindFor(record: AgentRecord): FuguKind {
  return FIRST_PARTY[record.id] ?? "fallback";
}

/** Kategori yang berlaku: listing on-chain lebih dulu, lalu hasil classifier. */
export function categoryOf(record: AgentRecord): Category | null {
  return record.fuguListing?.category ?? record.classification?.category ?? null;
}

export function isCategory(value: string | null | undefined): value is Category {
  return value === "REBALANCING" || value === "GRID" || value === "YIELD" || value === "HEALTH_FACTOR";
}
