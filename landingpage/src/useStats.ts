import { useEffect, useState } from "react";
import { STATS_URL } from "./content";

/** `GET /api/stats`, read from FuguRegistry and FuguSubscription at one block. */
export interface Stats {
  listings: number;
  ourListings: number;
  otherListings: number;
  otherBuilders: number;
  hires: number;
  hiresByOthers: number;
  hirers: number;
  blockNumber: string;
}

/**
 * The catalogue's numbers, live. A number typed into a static build goes stale the day
 * an agent is listed (it did: the page said "9 listings" when there were 25), so the
 * page asks the API instead. `null` until it answers, and if it never does, callers
 * show the sentence without a number rather than an old one.
 */
let request: Promise<Stats | null> | null = null;

/** One request per page load, shared by every section that shows a number. */
function load(): Promise<Stats | null> {
  request ??= fetch(STATS_URL)
    .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
    .then((s) => (s && typeof s.listings === "number" ? s : null))
    .catch(() => null);
  return request;
}

export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((s) => {
      if (live) setStats(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return stats;
}
