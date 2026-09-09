"use client";

/**
 * This device's hire notes.
 *
 * Why local, and why the UI says so: the source of truth for a hire is
 * `FuguSubscription` on chain, and this note exists for a payment made where the app
 * cannot see it. Showing a `Hired` badge on a guess would be exactly the kind of
 * uncheckable number we promised never to display.
 *
 * The middle path: the user records the **real tx hash** after paying, and the badge
 * becomes a link to that transaction. The badge is then checkable by anyone, it still
 * stops a second payment, and the user can delete it themselves, every action in
 * Fugugent must be reversible.
 *
 * Read through `useSyncExternalStore`, not `useEffect`: `localStorage` is an external
 * store, and an empty server snapshot makes the first render always match the HTML the
 * server sent.
 */

import { useCallback, useSyncExternalStore } from "react";

const KEY = "fugugent.hires.v1";
const EVENT = "fugugent:hires";

export interface HireRecord {
  agentId: string;
  /** The tx hash the user entered. Always present, without it there is nothing to check. */
  txHash: string;
  periods: number;
  recordedAt: string;
}

const EMPTY: HireRecord[] = [];

/** A cache so `getSnapshot` returns a stable reference while the contents are unchanged. */
let cachedRaw: string | null = null;
let cachedRows: HireRecord[] = EMPTY;

function parse(raw: string | null): HireRecord[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(
      (r): r is HireRecord =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as HireRecord).agentId === "string" &&
        typeof (r as HireRecord).txHash === "string",
    );
  } catch {
    return EMPTY;
  }
}

function rawValue(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Storage can be refused (private mode). The badge disappears; nothing breaks.
    return null;
  }
}

function getSnapshot(): HireRecord[] {
  const raw = rawValue();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedRows = parse(raw);
  }
  return cachedRows;
}

function getServerSnapshot(): HireRecord[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function persist(rows: HireRecord[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function isTxHash(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

export function useHires() {
  const rows = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /** `false` on the server and on the first hydration render. */
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const add = useCallback((record: HireRecord) => {
    persist([...getSnapshot().filter((r) => r.agentId !== record.agentId), record]);
  }, []);

  const remove = useCallback((agentId: string) => {
    persist(getSnapshot().filter((r) => r.agentId !== agentId));
  }, []);

  const find = useCallback(
    (agentId: string) => rows.find((r) => r.agentId === agentId) ?? null,
    [rows],
  );

  return { rows, ready, add, remove, find };
}
