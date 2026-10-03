"use client";

/**
 * "My agents": everything a connected wallet has done on HelloFugu, in one place.
 *
 * Read from the backend's tracking endpoints, which read the contracts (every answer
 * names the block it was read at): hires from FuguSubscription, ratings from
 * FuguReputation, owned identities from the ERC-8004 registry and FuguRegistry.
 * A running hire can be cancelled right here with the same component the agent page
 * uses; everything else links to the agent page, where the hire, release and rating
 * flows live.
 */

import { useAppKit } from "@reown/appkit/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAccount, useBlock } from "wagmi";
import { InfoTip } from "@/components/info-tip";
import { CATEGORY_META, FIRST_PARTY } from "@/lib/agents";
import { Fugu } from "@/components/fugu";
import type { Category } from "@/lib/agent-types";
import { CHAIN, shorten, txUrl } from "@/lib/chain";
import { CancelSubscription, type CancelOutcome } from "@/components/wallet/cancel-subscription";
import { useState } from "react";
import { HireCountdown } from "@/components/wallet/hire-countdown";
import { formatTbnb } from "@/lib/wallet/format";

const API = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

interface Hire {
  subId: string;
  listingId: string;
  agentKey: string | null;
  agentName: string | null;
  category: Category | null;
  deposited: string;
  claimedByAgent: string;
  startedAt: string;
  endsAt: string;
  status: "active" | "ended" | "cancelled";
}
interface Reviewed {
  listingId: string;
  agentKey: string;
  category: Category | null;
}
interface Owned {
  erc8004AgentId: string;
  agentKey: string;
  name: string;
  listingId: string | null;
}
interface Console {
  blockNumber: string;
  hires: Hire[];
  reviewed: Reviewed[];
  owned: Owned[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(12_000) });
  const body = (await r.json()) as T & { message?: string };
  if (!r.ok) throw new Error(body.message ?? `HTTP ${r.status}`);
  return body;
}

async function load(wallet: string): Promise<Console> {
  const [hires, reviews, agents] = await Promise.all([
    get<{ blockNumber: string; hires: Hire[] }>(`/api/tracking/hires?wallet=${wallet}`),
    get<{ reviewedListings: Reviewed[] }>(`/api/tracking/reviews?wallet=${wallet}`),
    get<{ identities: Owned[] }>(`/api/tracking/agents?owner=${wallet}`),
  ]);
  return {
    blockNumber: hires.blockNumber,
    hires: [...hires.hires].reverse(),
    reviewed: reviews.reviewedListings,
    owned: agents.identities,
  };
}

const toSecs = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000));
const day = (iso: string) => iso.slice(0, 16).replace("T", " ");

function Panel({ title, tip, count, children }: { title: string; tip?: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-fg">
        {title}
        <span className="rounded-full bg-bg-elev px-2 py-0.5 font-mono text-xs tabular-nums text-muted">{count}</span>
        {tip ? <InfoTip label={`About ${title}`} align="start">{tip}</InfoTip> : null}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function AgentLine({ hire, stacked = false, children }: { hire: Hire; stacked?: boolean; children?: React.ReactNode }) {
  const href = hire.agentKey ? `/agent/${encodeURIComponent(hire.agentKey)}` : "/agents";
  // A running hire carries a chip, a countdown and a cancel button: side by side they
  // crush the name into one word per line inside a half-width panel, so they stack.
  return (
    <li
      className={`flex flex-col gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 ${
        stacked ? "" : "sm:flex-row sm:items-center sm:justify-between"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* The agent's own fish: Guardian as Guardian, Grid as Grid. Drawn hollow, as
            everywhere on this site when there is no live risk reading; a puff level
            here would claim a measurement nobody has made. */}
        <Fugu
          kind={(hire.agentKey && FIRST_PARTY[hire.agentKey]) || "fallback"}
          level={null}
          seed={hire.agentKey ?? hire.subId}
          label={`${hire.agentName ?? "Agent"}, no live risk reading`}
          className="size-12 shrink-0"
        />
        <div className="min-w-0">
        <Link href={href} className="font-medium text-fg underline-offset-4 hover:underline">
          {hire.agentName ?? `Listing #${hire.listingId}`}
        </Link>
        <p className="mt-0.5 text-xs text-faint">
          {hire.category ? CATEGORY_META[hire.category].label : "No kind"} · sub #{hire.subId} ·{" "}
          {formatTbnb(BigInt(hire.deposited))} tBNB
        </p>
        </div>
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${stacked ? "[&>*:nth-child(2)]:min-w-40 [&>*:nth-child(2)]:flex-1" : "shrink-0"}`}>{children}</div>
    </li>
  );
}

export function MyConsole() {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const data = useQuery({
    queryKey: ["my-console", address],
    queryFn: () => load(address!),
    enabled: Boolean(address) && API !== "",
    refetchInterval: 30_000,
  });
  // Cancels signed on this page, shown at once: the tracking API holds a snapshot for
  // up to 15 seconds, and a hire that was just stopped must not sit under "Running now".
  const [cancelled, setCancelled] = useState<CancelOutcome[]>([]);
  // Chain time, not the browser clock, for the refund estimate on a running hire.
  const block = useBlock({ chainId: CHAIN.id, query: { enabled: Boolean(address), refetchInterval: 20_000 } });

  if (!isConnected || !address) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        <p className="text-sm text-fg">Connect your wallet to see the agents you hired and rated.</p>
        <button
          type="button"
          onClick={() => open()}
          className="mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
        >
          Connect wallet
        </button>
      </div>
    );
  }
  if (data.isError) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--risk-4)] p-5">
        <p className="text-sm text-fg">Could not read your activity: {data.error instanceof Error ? data.error.message : "request failed"}.</p>
        <button type="button" onClick={() => void data.refetch()} className="mt-3 text-xs text-muted underline">
          Try again
        </button>
      </div>
    );
  }
  if (!data.data) return <p className="text-sm text-muted">Reading your activity from the chain…</p>;

  const { hires, reviewed, owned, blockNumber } = data.data;
  const stopped = new Set(cancelled.map((c) => c.subId.toString()));
  const active = hires.filter((h) => h.status === "active" && !stopped.has(h.subId));
  const past = hires.filter((h) => h.status !== "active");
  const rated = new Set(reviewed.map((r) => r.listingId));
  const nowSecs = block.data?.timestamp ?? null;

  return (
    <div className="space-y-4" data-testid="my-console">
      <p className="text-xs text-faint">
        {shorten(address)} · read at block {blockNumber}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Running now" count={active.length} tip="Paid into escrow and still running. Cancel returns the unused part to you.">
          {cancelled.length > 0 ? (
            <ul className="mb-3 space-y-1" data-testid="console-cancelled">
              {cancelled.map((c) => (
                <li key={c.subId.toString()} className="text-xs text-[var(--risk-1)]">
                  Cancelled sub #{c.subId.toString()}
                  {c.refunded === null ? "" : `, ${formatTbnb(c.refunded)} tBNB refunded`}.{" "}
                  <a href={txUrl(c.hash)} target="_blank" rel="noreferrer noopener" className="font-mono underline">
                    {c.hash.slice(0, 10)}… ↗
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {active.length === 0 ? (
            <Empty>
              Nothing running. <Link href="/agents" className="text-accent-strong underline underline-offset-4">Find an agent</Link>
            </Empty>
          ) : (
            <ul>
              {active.map((h) => (
                <AgentLine key={h.subId} hire={h} stacked>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--risk-1)] px-2 py-0.5 text-[11px] font-semibold text-[var(--risk-1)]">
                    <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-[var(--risk-1)] motion-reduce:animate-none" />
                    Running
                  </span>
                  <HireCountdown startedAt={h.startedAt} endsAt={h.endsAt} />
                  <CancelSubscription
                    sub={{
                      subId: BigInt(h.subId),
                      deposited: BigInt(h.deposited),
                      claimed: BigInt(h.claimedByAgent),
                      startedAt: toSecs(h.startedAt),
                      endsAt: toSecs(h.endsAt),
                      cancelled: false,
                    }}
                    agentName={h.agentName ?? `listing #${h.listingId}`}
                    chainNow={nowSecs}
                    account={address}
                    onCancelled={(outcome) => {
                      setCancelled((list) => [...list, outcome]);
                      void data.refetch();
                    }}
                  />
                </AgentLine>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Hired before" count={past.length} tip="Ended or cancelled hires. Rate an agent once it has been paid for at least half a period.">
          {past.length === 0 ? (
            <Empty>No past hires yet.</Empty>
          ) : (
            <ul>
              {past.map((h) => (
                <AgentLine key={h.subId} hire={h}>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      h.status === "cancelled" ? "border-line text-muted" : "border-[var(--risk-1)] text-[var(--risk-1)]"
                    }`}
                  >
                    {h.status === "cancelled" ? "Cancelled" : "Ended"}
                  </span>
                  <span className="text-xs text-faint">{day(h.endsAt)} UTC</span>
                  {rated.has(h.listingId) ? (
                    <span className="text-xs text-muted">Rated ★</span>
                  ) : h.agentKey ? (
                    <Link
                      href={`/agent/${encodeURIComponent(h.agentKey)}#reviews`}
                      className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover"
                    >
                      Rate it
                    </Link>
                  ) : null}
                </AgentLine>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Rated" count={reviewed.length}>
          {reviewed.length === 0 ? (
            <Empty>You have not rated an agent yet.</Empty>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {reviewed.map((r) => {
                const name = hires.find((h) => h.listingId === r.listingId)?.agentName ?? `Agent ${r.agentKey}`;
                return (
                  <li key={r.listingId}>
                    <Link
                      href={`/agent/${encodeURIComponent(r.agentKey)}#reviews`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-fg transition hover:border-line-strong"
                    >
                      ★ {name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Your agents" count={owned.length} tip="ERC-8004 identities this wallet owns. List one to let others hire it; earnings go to you.">
          {owned.length === 0 ? (
            <Empty>
              None yet. <Link href="/list" className="text-accent-strong underline underline-offset-4">List your agent</Link>
            </Empty>
          ) : (
            <ul className="space-y-2">
              {owned.slice(0, 12).map((o) => (
                <li key={o.agentKey} className="flex items-center justify-between gap-3">
                  <Link href={`/agent/${encodeURIComponent(o.agentKey)}`} className="min-w-0 truncate text-sm text-fg hover:underline">
                    {o.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {o.listingId ? `Listed #${o.listingId}` : "Not listed"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
