"use client";

/**
 * Rate before you hire again.
 *
 * A wallet that has a finished hire on HelloFugu and has not rated that agent gets the
 * rating in place of the hire button, on every agent page, until it rates. The rule is
 * this marketplace's, enforced here in the UI; the contracts would accept the hire
 * either way, and the page does not pretend otherwise.
 *
 * Only finished hires count: a cancelled one may have paid too little for the
 * contract to accept a rating at all (`hasSubscribed` needs half of one period), and
 * a rule nobody can satisfy would lock a wallet out for good. If the tracking API
 * cannot be read, nothing is blocked.
 */
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ReviewPanel } from "@/components/wallet/review-panel";

const API = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

export interface PendingRating {
  listingId: string;
  agentName: string;
  agentKey: string | null;
}

interface HiresBody {
  hires: { listingId: string; agentName: string | null; agentKey: string | null; status: "active" | "ended" | "cancelled" }[];
}
interface ReviewsBody {
  reviewedListings: { listingId: string }[];
}

/** Finished hires of listings this wallet has not rated, one per listing, oldest first. */
export function pendingRatings(hires: HiresBody["hires"], reviewed: ReviewsBody["reviewedListings"]): PendingRating[] {
  const done = new Set(reviewed.map((r) => r.listingId));
  const seen = new Set<string>();
  const out: PendingRating[] = [];
  for (const h of hires) {
    if (h.status !== "ended" || done.has(h.listingId) || seen.has(h.listingId)) continue;
    seen.add(h.listingId);
    out.push({ listingId: h.listingId, agentName: h.agentName ?? `listing #${h.listingId}`, agentKey: h.agentKey });
  }
  return out;
}

async function load(wallet: string): Promise<PendingRating[]> {
  const [h, r] = await Promise.all([
    fetch(`${API}/api/tracking/hires?wallet=${wallet}`).then((x) => (x.ok ? (x.json() as Promise<HiresBody>) : Promise.reject(new Error(`HTTP ${x.status}`)))),
    fetch(`${API}/api/tracking/reviews?wallet=${wallet}`).then((x) => (x.ok ? (x.json() as Promise<ReviewsBody>) : Promise.reject(new Error(`HTTP ${x.status}`)))),
  ]);
  return pendingRatings(h.hires, r.reviewedListings);
}

export function usePendingRatings() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["pending-ratings", address],
    queryFn: () => load(address!),
    enabled: Boolean(address) && API !== "",
    // Keep reading: a hire that ends while the page is open must close the gate, and a
    // rating just signed must open it. The tracking API holds a snapshot for 15 s, so
    // a first read straight after either can still show the old state.
    refetchInterval: (q) => ((q.state.data?.length ?? 0) > 0 ? 10_000 : 20_000),
  });
}

/**
 * `listingId` is the listing of the page this sits on, if any: when the rating owed is
 * for that same agent, its Ratings section further down already holds the panel, so
 * this points there instead of drawing a second one.
 */
export function RatingGate({ children, listingId }: { children: React.ReactNode; listingId?: string }) {
  const pending = usePendingRatings();
  const list = pending.data ?? [];
  if (list.length === 0) return <>{children}</>;
  const first = list.find((p) => p.listingId === listingId) ?? list[0]!;
  if (first.listingId === listingId) {
    return (
      <div className="mt-6 rounded-xl border border-accent p-4 sm:p-5" data-testid="rating-gate">
        <p className="text-sm font-semibold text-fg">Rate {first.agentName} before you hire it again</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Your last hire of it has finished. On HelloFugu every finished hire gets a rating.{" "}
          <a href="#reviews" className="font-semibold text-accent-strong underline underline-offset-2">
            Rate it below
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-xl border border-accent p-4 sm:p-5" data-testid="rating-gate">
      <p className="text-sm font-semibold text-fg">Rate {first.agentName} before your next hire</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Your hire of {first.agentName} has finished. On HelloFugu every finished hire gets a rating, so the next person can choose well.
        {list.length > 1 ? ` ${list.length - 1} more after this one.` : ""}
      </p>
      <div className="mt-4">
        <ReviewPanel listingId={first.listingId} agentName={first.agentName} />
      </div>
    </div>
  );
}
