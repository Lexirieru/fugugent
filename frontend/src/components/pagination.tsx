import Link from "next/link";

/**
 * The pager. One component for every growing list in this app.
 *
 * ## The page number lives in the URL
 *
 * `?page=3` can be shared, bookmarked, and it makes the browser's back button do
 * what a reader expects. That is the same reason the category filter is a link and
 * not client state.
 *
 * ## What it will not print
 *
 * A total, unless the caller can stand behind it. The agent catalogue deliberately
 * reports "the agents we can genuinely account for" rather than an upstream count
 * (`backend/src/service/agents.ts`), and that number moves as you page: 97 on the
 * first window, 132 on the second, and a category can report 20 on a page that is
 * followed by a page with 2 more on it. Printing it as "of 132" would promise pages
 * that may not exist, and the reader finds that out by pressing Next.
 *
 * So `total` is optional. When a caller has an exact count, it is shown. When it does
 * not, the pager shows the range it is actually serving and says nothing more, and
 * `hasNext` is decided by the caller having *read* the next page rather than by
 * arithmetic on a number nobody can stand behind.
 */
export function Pagination({
  page,
  offset,
  shown,
  hasNext,
  total = null,
  hrefForPage,
  unit,
  note = null,
}: {
  /** 1-based. */
  page: number;
  /** The index this page starts at, so the range is right even when a page is short. */
  offset: number;
  /** How many rows this page actually rendered. */
  shown: number;
  /** True only when the next page has been read and found to hold something. */
  hasNext: boolean;
  /** An exact count, or `null` when there is no number worth printing. */
  total?: number | null;
  hrefForPage: (page: number) => string;
  /** "agents", "skills". Used in the labels a screen reader hears. */
  unit: string;
  /** One quiet line under the pager. Used to explain a missing total. */
  note?: string | null;
}) {
  const hasPrev = page > 1;
  if (!hasPrev && !hasNext) return null;

  const first = offset + 1;
  const last = offset + shown;

  return (
    <nav aria-label={`${unit} pages`} className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {hasPrev ? (
          <Link
            href={hrefForPage(page - 1)}
            rel="prev"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
          >
            ← Previous
          </Link>
        ) : (
          <span aria-hidden />
        )}

        <p className="tnum text-center text-xs text-faint">
          Page {page}
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          {shown === 0
            ? `no ${unit} on this page`
            : total === null
              ? `${first} to ${last}`
              : `${first} to ${last} of ${total}`}
        </p>

        {hasNext ? (
          <Link
            href={hrefForPage(page + 1)}
            rel="next"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
          >
            Next →
          </Link>
        ) : (
          <span aria-hidden />
        )}
      </div>

      {note ? (
        <p className="mt-3 text-pretty text-center text-xs leading-relaxed text-faint">{note}</p>
      ) : null}
    </nav>
  );
}

/** Read `?page=` without ever producing a negative offset or a silly one. */
export function pageFromParam(value: unknown, max = 400): number {
  const n = Number(typeof value === "string" ? value : Array.isArray(value) ? value[0] : 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, Math.floor(n)), max);
}
