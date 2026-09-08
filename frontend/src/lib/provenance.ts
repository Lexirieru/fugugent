/**
 * Where the data came from and how old it is, as reported by the backend.
 *
 * The backend walks a fallback ladder: 8004scan -> the Postgres cache -> an on-chain
 * read -> the curated seed, and every answer carries `source`, `ageSeconds`, `stale`,
 * `degraded`, and a `trail` holding each rung it walked and why. That whole chain was
 * built so the UI **can** be honest; this file is what gets that honesty onto the screen.
 *
 * The rule is the same as for the puff level: **the frontend does not recompute.**
 * `stale` means "cannot be confirmed fresh", not "older than X" — the cache is always
 * stale because we only reach it after the upstream failed to answer. The backend
 * decides that; we display it.
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
  /** The age of the oldest item, in seconds. `null` when it does not apply. */
  ageSeconds: number | null;
  /** "Cannot be confirmed fresh" — the backend's decision, not our arithmetic. */
  stale: boolean;
  /** The answer came from a rung below the primary source. */
  degraded: boolean;
  maxAgeSeconds: number | null;
  /** The ladder actually walked. This is what makes the claim checkable. */
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

/** An age in words. `null` in, `null` out — an age that does not apply is not invented. */
export function formatAge(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.round(seconds)}s old`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m old`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h old`;
  return `${Math.round(seconds / 86_400)}d old`;
}

/**
 * A deterministic UTC stamp.
 *
 * Deliberately not a relative age: "read 4m ago" needs `Date.now()` at render time,
 * which is impure and differs between server and client. The relative age comes from
 * `ageSeconds`, computed by the backend; this one names the time.
 */
export function formatUtc(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** How loudly the provenance row has to speak. */
export type ProvenanceWeight = "quiet" | "attention" | "failure";

export function weightOf(p: Provenance): ProvenanceWeight {
  if (!p.healthy) return "failure";
  if (p.source === "seed") return "attention";
  if (p.stale || p.degraded) return "attention";
  return "quiet";
}

/** An envelope for a source that reports nothing (e.g. local sample data). */
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
