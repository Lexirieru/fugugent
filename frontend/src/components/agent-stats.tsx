/**
 * The five numbers a renter looks for first, as a bento grid under the agent's name.
 *
 * Layout adapted from MotionSites' "Bento Grid Stats" (one dark lead tile, the rest
 * light, a staggered scale-in), rebuilt in this site's tokens and without Framer
 * Motion: the entrance is a CSS keyframe, off under prefers-reduced-motion.
 *
 * Every tile is either read from a contract or says it has nothing. The rating tile
 * reads FuguReputation in the browser, so it only renders where a wallet provider is
 * mounted.
 */

import type { AgentRecord } from "@/lib/agent-types";
import { CHAIN, CONTRACTS } from "@/lib/chain";
import { formatPricePerPeriod } from "@/lib/money";
import { walletEnabled } from "@/lib/wallet/config";
import { RatingStat } from "@/components/wallet/rating-stat";

function Tile({
  label,
  children,
  dark = false,
  index,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  dark?: boolean;
  index: number;
  className?: string;
}) {
  return (
    <div
      className={`bento-in flex min-w-0 flex-col justify-between rounded-[var(--radius-card)] border p-4 sm:p-5 ${
        dark ? "border-transparent bg-fg text-bg" : "border-line bg-surface text-fg"
      } ${className}`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <span className={`text-[11px] uppercase tracking-[0.14em] ${dark ? "text-bg/60" : "text-faint"}`}>{label}</span>
      <span className="mt-3 block min-w-0 break-words font-mono text-lg leading-tight tabular-nums sm:text-xl">
        {children}
      </span>
    </div>
  );
}

export function AgentStats({ record }: { record: AgentRecord }) {
  const listing = record.fuguListing;
  const meta = record.listingMetadata;
  const registeredAt = record.evidence?.registration?.registeredAt ?? null;
  const status =
    listing === null || !listing.active
      ? "Not listed"
      : meta?.onchainExecution === true
        ? "Has acted on chain"
        : "Advice only";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Key facts">
      <Tile label="Price" dark index={0} className="col-span-2 sm:col-span-1">
        {listing?.active ? formatPricePerPeriod(listing.priceUsd8PerPeriod, listing.periodSeconds) : "No price yet"}
      </Tile>
      <Tile label="Rating" index={1}>
        {walletEnabled && listing ? <RatingStat listingId={listing.listingId.toString()} /> : "None yet"}
      </Tile>
      <Tile label="Status" index={2}>
        {status}
      </Tile>
      <Tile label="Registry ID" index={3}>
        <a
          href={`${CHAIN.explorer}/nft/${record.evidence?.registryAddress ?? CONTRACTS.identityRegistry}/${record.tokenId}`}
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-accent/40 underline-offset-4 hover:decoration-accent-strong"
        >
          #{record.tokenId} ↗
        </a>
      </Tile>
      <Tile label="Registered" index={4}>
        {registeredAt ? registeredAt.slice(0, 10) : "Not proved yet"}
      </Tile>
    </div>
  );
}
