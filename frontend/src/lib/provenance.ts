/**
 * Asal dan umur data, sebagaimana dilaporkan backend.
 *
 * Backend menempuh tangga jatuh: 8004scan -> cache Postgres -> baca on-chain ->
 * seed terkurasi, dan setiap jawaban membawa `source`, `ageSeconds`, `stale`,
 * `degraded`, serta `trail` berisi tiap tingkat yang ditempuh beserta alasannya.
 * Seluruh rantai itu dibangun supaya UI **bisa** jujur; berkas ini yang membuat
 * kejujuran itu benar-benar sampai ke layar.
 *
 * Aturannya sama dengan tingkat kembung: **frontend tidak menghitung ulang.**
 * `stale` berarti "tidak bisa dipastikan segar", bukan "lebih tua dari X" —
 * cache selalu stale karena kita hanya sampai ke sana setelah upstream gagal
 * menjawab. Yang memutuskan itu backend; kita menampilkannya.
 */

import type { AgentSource } from "@/lib/agent-types";

export type TrailOutcome = "ok" | "empty" | "unhealthy" | "threw" | "unavailable";

export interface TrailStep {
  source: AgentSource;
  outcome: TrailOutcome | string;
  reason: string | null;
  items: number | null;
}

export interface Provenance {
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
  /** Umur item tertua, detik. `null` bila tidak berlaku. */
  ageSeconds: number | null;
  /** "Tidak bisa dipastikan segar" — keputusan backend, bukan hitungan kita. */
  stale: boolean;
  /** Jawabannya datang dari tingkat di bawah sumber utama. */
  degraded: boolean;
  maxAgeSeconds: number | null;
  /** Tangga yang benar-benar ditempuh. Inilah yang membuat klaim bisa diperiksa. */
  trail: TrailStep[];
}

export const SOURCE_LABEL: Record<AgentSource, string> = {
  scan8004: "8004scan",
  cache: "our cache",
  onchain: "read from chain",
  seed: "bundled sample",
};

export const SOURCE_MEANING: Record<AgentSource, string> = {
  scan8004: "The live ERC-8004 index.",
  cache: "Our own copy, served because the live index did not answer in time.",
  onchain:
    "Read straight from the contracts, because neither the index nor the cache could answer.",
  seed: "A curated list bundled with this build — the last floor before an empty page.",
};

const OUTCOME_LABEL: Record<string, string> = {
  ok: "answered",
  empty: "answered, but empty",
  unhealthy: "unhealthy",
  threw: "threw",
  unavailable: "not wired up here",
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome;
}

/** Umur dalam kata. `null` masuk, `null` keluar — umur yang tidak berlaku tidak dikarang. */
export function formatAge(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s old`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m old`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h old`;
  return `${Math.round(seconds / 86_400)}d old`;
}

/**
 * Cap waktu UTC yang deterministik.
 *
 * Sengaja tidak memakai umur relatif di sini: "read 4m ago" menuntut `Date.now()`
 * saat render, yang tidak murni dan berbeda antara server dan klien. Umur relatif
 * datang dari `ageSeconds` yang dihitung backend; yang ini menyebut waktunya.
 */
export function formatUtc(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Seberapa keras baris asal-data harus berbicara. */
export type ProvenanceWeight = "quiet" | "attention" | "failure";

export function weightOf(p: Provenance): ProvenanceWeight {
  if (!p.healthy) return "failure";
  if (p.source === "seed") return "attention";
  if (p.stale || p.degraded) return "attention";
  return "quiet";
}

/** Amplop untuk sumber yang tidak melaporkan apa pun (mis. data contoh lokal). */
export function unknownProvenance(source: AgentSource, fetchedAt: string): Provenance {
  return {
    source,
    healthy: true,
    reason: null,
    fetchedAt,
    ageSeconds: null,
    stale: false,
    degraded: false,
    maxAgeSeconds: null,
    trail: [],
  };
}
