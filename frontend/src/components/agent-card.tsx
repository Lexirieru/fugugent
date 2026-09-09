import Link from "next/link";
import { Fugu } from "@/components/fugu";
import { HiredBadge } from "@/components/hired-badge";
import { OwnerBadge } from "@/components/wallet/owner-badge";
import { RiskChip } from "@/components/risk-chip";
import { CATEGORY_META, FIRST_PARTY, categoryOf, fuguKindFor } from "@/lib/agents";
import { addressUrl, shorten } from "@/lib/chain";
import type { AgentView } from "@/lib/data/types";
import { formatPricePerPeriod } from "@/lib/money";
import { riskAriaLabel } from "@/lib/risk";

/**
 * The agent card.
 *
 * Four things must be readable before somebody decides to open the detail page: who the
 * agent is (silhouette + name + category), how heavy its risk is right now (the fugu +
 * the chip), what it has actually done (an outcome sentence with numbers in it), and what
 * it costs. What is **not** on this card is a metric we have not measured, an empty
 * field is more honest than a zero that looks like a result.
 */
export function AgentCard({ view }: { view: AgentView }) {
  const { record, risk, outcomes, notShipped } = view;
  const kind = fuguKindFor(record);
  const category = categoryOf(record);
  const meta = category ? CATEGORY_META[category] : null;
  const listing = record.fuguListing;
  const hireable = Boolean(listing?.active);
  /**
   * Two badges, two meanings, and they are kept apart on purpose.
   *
   * "Ready to hire" is about **availability**: there is a price and somebody can pay
   * it. "By HelloFugu" is about **who wrote it**. Today those two sets happen to be
   * the same nine agents, and the moment a third party lists their own agent they stop
   * being the same. One badge doing both jobs would be wrong on that day and nobody
   * would notice, so they are separate from the start.
   *
   * Neither of them says an agent works. Not one third-party agent in this catalogue
   * has a checked address, and listing does not change that.
   */
  const ours = Boolean(FIRST_PARTY[record.id]);

  return (
    <article className="group relative flex w-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 transition hover:border-line-strong hover:bg-surface-strong">
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
          {/*
            Two lines are reserved whether or not the name needs them.
            Agent names come from a public registry and run from "Ranger" to
            "AgentCensus Rebalance Planner", so within one row some wrap and some do
            not. Without a reservation the category, the badges and the description
            below start at a different height in every card, and a tidy grid reads as
            a broken one. `line-clamp-2` caps the other direction: a third line would
            push the same rhythm out again.
          */}
          <h3 className="line-clamp-2 min-h-[2.5rem] text-base font-semibold leading-tight text-fg">
            <Link
              href={`/agent/${encodeURIComponent(record.id)}`}
              className="after:absolute after:inset-0 after:rounded-[var(--radius-card)]"
            >
              {record.name}
            </Link>
          </h3>
          <p className="mt-1 text-xs text-faint">{meta ? meta.label : "Uncategorised"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hireable ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--risk-1)] px-2.5 py-0.5 text-[11px] font-semibold leading-5 text-[var(--risk-1)]"
                title="This agent has a price on the blockchain and can be paid today."
              >
                <span aria-hidden className="inline-block size-1.5 rounded-full bg-[var(--risk-1)]" />
                Ready to hire
              </span>
            ) : (
              <OwnerBadge ownerAddress={record.ownerAddress} />
            )}
            {ours ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-[11px] font-medium leading-5 text-muted"
                title="Written by the HelloFugu team. That says who wrote it, not that it works."
              >
                By HelloFugu
              </span>
            ) : null}
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

      {/* The foot of the card. When there is no listing this used to say "Nothing to pay
          yet" and stop, which is a dead end for 103 of the 112 agents in the catalogue.
          It now names the one wallet that can change that, as a link anybody can open. */}
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4">
        {listing?.active ? (
          <span className="font-mono text-sm tabular-nums text-fg">
            {formatPricePerPeriod(listing.priceUsd8PerPeriod, listing.periodSeconds)}
          </span>
        ) : record.ownerAddress ? (
          <span className="text-sm text-faint">
            No price yet, only{" "}
            <a
              href={addressUrl(record.ownerAddress)}
              target="_blank"
              rel="noreferrer noopener"
              className="relative z-10 font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
              title="The wallet that owns this agent. Only it can put a price on this agent."
            >
              {shorten(record.ownerAddress, 6, 4)} ↗
            </a>{" "}
            can set one
          </span>
        ) : (
          <span className="text-sm text-faint">No price, and no owner on record</span>
        )}
        <span className="text-xs text-faint transition group-hover:text-accent-strong">
          Open the agent →
        </span>
      </div>
    </article>
  );
}
