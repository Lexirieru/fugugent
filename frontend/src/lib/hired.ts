"use client";

/**
 * Catatan hire milik perangkat ini.
 *
 * Kenapa lokal, dan kenapa dinyatakan begitu di UI: sumber kebenaran hire adalah
 * `FuguSubscription` on-chain, dan aplikasi ini belum punya jalur baca wallet.
 * Menampilkan badge `Hired` berdasarkan tebakan akan menjadi persis jenis angka
 * tak-terperiksa yang kami janjikan untuk tidak pernah tampilkan.
 *
 * Jalan tengahnya: pengguna menyimpan **tx hash sungguhan** setelah membayar, dan
 * badge itu menjadi tautan ke transaksi tersebut. Badge-nya jadi bisa diperiksa
 * siapa pun, tetap mencegah bayar dua kali, dan bisa dihapus sendiri oleh
 * pengguna — setiap aksi di Fugugent harus reversibel.
 *
 * Dibaca lewat `useSyncExternalStore`, bukan `useEffect`: `localStorage` adalah
 * external store, dan snapshot server yang kosong membuat render pertama selalu
 * cocok dengan HTML yang dikirim server.
 */

import { useCallback, useSyncExternalStore } from "react";

const KEY = "fugugent.hires.v1";
const EVENT = "fugugent:hires";

export interface HireRecord {
  agentId: string;
  /** Tx hash yang dimasukkan pengguna. Selalu ada — tanpa itu tidak ada yang bisa diperiksa. */
  txHash: string;
  periods: number;
  recordedAt: string;
}

const EMPTY: HireRecord[] = [];

/** Cache supaya `getSnapshot` mengembalikan referensi stabil selama isinya sama. */
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
    // Penyimpanan bisa ditolak (mode privat). Badge hilang, tidak ada yang rusak.
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
  /** `false` di server dan pada render hidrasi pertama. */
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
