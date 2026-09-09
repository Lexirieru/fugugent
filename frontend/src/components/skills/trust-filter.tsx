import Link from "next/link";
import { TrustBadge } from "@/components/skills/trust-badge";
import { BAND_HEADING, TRUST_DISPLAY_ORDER, TRUST_PRESENTATION } from "@/lib/skills/trust";
import type { TrustBand } from "@/lib/skills/trust";
import type { TrustStatus } from "@/lib/skills/types";

/**
 * The status filter, which is also the census, which is also the legend.
 *
 * These are links with URLs rather than client state, for the same reason the agent
 * category tabs are: `?status=STALE_AUDIT` can be shared, bookmarked and rendered on the
 * server. Counts are shown exactly as they are, zero included — hiding an empty status
 * would misrepresent how much of this registry has actually been checked, which is the
 * one number this page exists to be honest about.
 */
export function TrustFilter({
  census,
  active,
  total,
  hrefFor,
}: {
  /** `null` when the counts could not be established for the whole result. */
  census: Partial<Record<TrustStatus, number>> | null;
  active: TrustStatus | null;
  /** `null` for the same reason. A filter with no number still works. */
  total: number | null;
  hrefFor: (status: TrustStatus | null) => string;
}) {
  return (
    <nav aria-label="Filter by what we know" className="flex flex-wrap gap-2">
      <Link
        href={hrefFor(null)}
        aria-current={active === null ? "page" : undefined}
        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${
          active === null
            ? "border-accent/50 bg-accent-soft text-accent-strong"
            : "border-line text-muted hover:border-line-strong hover:text-fg"
        }`}
      >
        All
        {total === null ? null : (
          <span className="font-mono text-[11px] tabular-nums opacity-70">{total}</span>
        )}
      </Link>

      {TRUST_DISPLAY_ORDER.map((status) => {
        const spec = TRUST_PRESENTATION[status];
        const count = census === null ? null : (census[status] ?? 0);
        const isActive = active === status;
        return (
          <Link
            key={status}
            href={hrefFor(status)}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${
              isActive
                ? "border-accent/50 bg-accent-soft text-accent-strong"
                : "border-line text-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            {spec.label}
            {count === null ? null : (
              <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

const KNOWN_BANDS: TrustBand[] = ["verified", "dangerous"];

/**
 * What the seven statuses mean, grouped into the three bands.
 *
 * The grouping is the argument: one status means safe, one means dangerous, and five
 * mean we do not know. Laying them out in a single flat list would suggest a spectrum
 * with "quite safe" somewhere in the middle, and there is no such place.
 */
export function TrustLegend() {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight text-fg">
        Seven statuses, and only one of them means safe
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        The status is derived by the backend from the audits it actually holds — there is
        no column anywhere that a publisher, an auditor or this page could write. Colour is
        never the only difference between two of them: each has its own wording, its own
        glyph and its own border texture, so the seven stay seven in grayscale as well.
      </p>

      {/* Two columns rather than three: one status means safe and one means dangerous,
          against five ways of not knowing. A 2 : 5 split shows that proportion; three
          equal columns would imply the three bands are the same size. */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="space-y-5">
          {KNOWN_BANDS.map((band) => (
            <BandBlock key={band} band={band} />
          ))}
        </div>
        <BandBlock band="unknown" />
      </div>
    </div>
  );
}

function BandBlock({ band }: { band: TrustBand }) {
  const rows = TRUST_DISPLAY_ORDER.filter((status) => TRUST_PRESENTATION[status].band === band);
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-faint">
        {BAND_HEADING[band]}
        <span className="ml-2 font-mono normal-case tracking-normal">
          {rows.length} of 7
        </span>
      </h3>
      <ul className="mt-3 space-y-3">
        {rows.map((status) => (
          <li key={status}>
            <TrustBadge status={status} size="sm" />
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {TRUST_PRESENTATION[status].meaning}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
