"use client";

/**
 * Keeps a server-rendered page from quietly going stale, without moving it to the
 * client.
 *
 * ## What it does
 *
 * A TanStack Query polls `/api/catalogue-status`, which is this app's own route and
 * therefore needs no CORS and carries no API key to the browser. When the catalogue
 * is answering **and** the page on screen has passed the maximum age the backend
 * itself declared for that data, it calls `router.refresh()`. Next re-runs the server
 * render and streams the new HTML in; scroll position and client state survive.
 *
 * ## What it deliberately does not do
 *
 * It does not fetch the agent list into the browser and re-render it there. The list
 * is server-rendered on purpose: it is the thing search engines and link previews
 * read, it is the first paint, and every one of its failure states ("the catalogue
 * did not answer", "served from our cache", the whole ladder) is decided by the
 * backend and shown exactly as it came. Rebuilding that in the client would mean
 * rebuilding those states too, and the second copy is the one that drifts.
 *
 * It also never refreshes on a failed poll. If the catalogue stops answering, the
 * page keeps the last thing it could stand behind and says the check is failing.
 * Refreshing into a failure the reader did not ask for would replace real data with
 * an error banner while they were reading it.
 *
 * ## The age on screen
 *
 * The server renders "6s old" once and it is wrong a minute later. The age here is
 * counted in the browser from the timestamp the server sent, so the number moves
 * with the clock instead of freezing at whatever it was when the HTML was built.
 */

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

interface CatalogueStatus {
  source: string;
  healthy: boolean;
  reason: string | null;
  checkedAt: string;
}

/** How often the freshness of the catalogue is checked. */
const POLL_MS = 30_000;

/**
 * The clock, as an external store.
 *
 * `useSyncExternalStore` rather than a `useState` set from inside an effect: the
 * wall clock genuinely is an external source, the server snapshot is `null` so the
 * first client render matches the HTML the server sent, and the value is cached
 * between ticks so a render never sees a number that changed underneath it.
 */
let clockNow = Date.now();

function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(() => {
    clockNow = Date.now();
    onChange();
  }, 1_000);
  return () => clearInterval(timer);
}
/** Used when the backend declares no maximum age of its own. */
const FALLBACK_MAX_AGE_SECONDS = 120;

export function LiveData({
  fetchedAt,
  maxAgeSeconds,
  className = "",
}: {
  /** ISO 8601, from the provenance the server rendered. */
  fetchedAt: string;
  /** The backend's own declared maximum age. `null` when it does not declare one. */
  maxAgeSeconds: number | null;
  className?: string;
}) {
  const router = useRouter();
  // `null` on the server and on the first hydration render, so the HTML matches.
  const now = useSyncExternalStore(
    subscribeToClock,
    () => clockNow,
    () => null,
  );

  const status = useQuery<CatalogueStatus>({
    queryKey: ["catalogue-status"],
    queryFn: async () => {
      const res = await fetch("/api/catalogue-status", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as CatalogueStatus;
    },
    refetchInterval: POLL_MS,
  });

  const renderedAt = Date.parse(fetchedAt);
  const ageSeconds =
    now === null || Number.isNaN(renderedAt) ? null : Math.max(0, Math.round((now - renderedAt) / 1000));
  const limit = maxAgeSeconds ?? FALLBACK_MAX_AGE_SECONDS;
  const past = ageSeconds !== null && ageSeconds > limit;

  useEffect(() => {
    if (!past) return;
    if (!status.data?.healthy) return;
    router.refresh();
    // `past` and the poll result are what decide this. Re-running on every tick of
    // the clock would call refresh once a second once the page went past its age.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, status.data?.healthy, status.dataUpdatedAt]);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {ageSeconds === null ? null : <span className="tnum">· {formatAgeSeconds(ageSeconds)} old</span>}
      {status.isError ? (
        <span className="text-[var(--risk-3)]">· the freshness check is not answering</span>
      ) : status.data && !status.data.healthy ? (
        <span className="text-[var(--risk-3)]">· the catalogue is not answering</span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void status.refetch();
          router.refresh();
        }}
        className="underline decoration-dotted underline-offset-4 transition hover:text-fg"
      >
        · refresh now
      </button>
    </span>
  );
}

function formatAgeSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
