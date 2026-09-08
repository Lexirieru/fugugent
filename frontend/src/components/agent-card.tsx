import Link from "next/link";
import { Fugu } from "@/components/fugu";
import { HiredBadge } from "@/components/hired-badge";
import { RiskChip } from "@/components/risk-chip";
import { CATEGORY_META, categoryOf, fuguKindFor } from "@/lib/agents";
import type { AgentView } from "@/lib/data/types";
import { formatPricePerPeriod } from "@/lib/money";
import { riskAriaLabel } from "@/lib/risk";

/**
 * The agent card.
 *
 * Four things must be readable before somebody decides to open the detail page: who the
 * agent is (silhouette + name + category), how heavy its risk is right now (the fugu +
 * the chip), what it has actually done (an outcome sentence with numbers in it), and what
 * it costs. What is **not** on this card is a metric we have not measured — an empty
 * field is more honest than a zero that looks like a result.
 */
export function AgentCard({ view }: { view: AgentView }) {
  const { record, risk, outcomes, notShipped } = view;
  const kind = fuguKindFor(record);
  const category = categoryOf(record);
  const meta = category ? CATEGORY_META[category] : null;
  const listing = record.fuguListing;

  return (
    <article className="group relative flex w-full flex-col rounded-2xl border border-line bg-surface p-5 transition hover:border-line-strong hover:bg-surface-strong">
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          <Fugu
            kind={kind}
            level={risk?.level ?? null}
            seed={record.id}
            label={riskAriaLabel(record.name, risk)}
            className="h-16 w-16"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-tight text-fg">
            <Link
              href={`/agent/${encodeURIComponent(record.id)}`}
              className="after:absolute after:inset-0 after:rounded-2xl"
            >
              {record.name}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-faint">
            {meta ? meta.label : "Uncategorised"}
            {listing?.curated ? " · curated" : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RiskChip reading={risk} size="sm" />
            <HiredBadge
              agentId={record.id}
              listingId={listing?.active ? listing.listingId.toString() : null}
            />
          </div>
        </div>
      </div>

      <p className="mt-4 line-clamp-3 text-sm leading-relaxed text-muted">{record.description}</p>

      {outcomes.length > 0 ? (
        <p className="mt-3 border-l-2 border-line pl-3 text-sm leading-relaxed text-fg">
          {outcomes[0]}
        </p>
      ) : null}

      {notShipped ? (
        <p className="mt-3 text-xs leading-relaxed text-faint">Not shipped: {notShipped}</p>
      ) : null}

      {/* Spacer: the price row always sits at the foot of the card, so card heights match. */}
      <div className="grow" />

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4">
        {listing?.active ? (
          <span className="font-mono text-sm tabular-nums text-fg">
            {formatPricePerPeriod(listing.priceUsd8PerPeriod, listing.periodSeconds)}
          </span>
        ) : (
          <span className="text-sm text-faint">Not listed — nothing to pay yet</span>
        )}
        <span className="text-xs text-faint transition group-hover:text-accent">
          Open the agent →
        </span>
      </div>
    </article>
  );
}
