"use client";

/**
 * The builder's way in: connect, see the ERC-8004 agents you own, list one.
 *
 * Set and Earn asks every participant to build an agent and list it. Listing already
 * worked from an agent's own page, but getting there meant knowing its URL: an agent
 * the classifier puts in no category appears on no tab. This panel asks the one
 * question that finds it, "which identities does this wallet own?", from
 * `/api/tracking/agents`, which reads the ERC-8004 registry and FuguRegistry.
 */

import { useAppKit } from "@reown/appkit/react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { shorten } from "@/lib/chain";

interface OwnedIdentity {
  erc8004AgentId: string;
  agentKey: string;
  name: string;
  listingId: string | null;
}

interface Owned {
  identities: OwnedIdentity[];
  registryBlock: string | null;
}

const API = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

async function fetchOwned(owner: string): Promise<Owned> {
  const r = await fetch(`${API}/api/tracking/agents?owner=${owner}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await r.json()) as {
    identities?: OwnedIdentity[];
    identitiesBlockNumber?: string | null;
    message?: string;
  };
  if (!r.ok || !Array.isArray(body.identities)) throw new Error(body.message ?? `HTTP ${r.status}`);
  return { identities: body.identities, registryBlock: body.identitiesBlockNumber ?? null };
}

export function MyAgents() {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const owned = useQuery({
    queryKey: ["owned-agents", address],
    queryFn: () => fetchOwned(address!),
    enabled: Boolean(address) && API !== "",
    retry: 1,
  });

  if (!isConnected || !address) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
        <p className="text-pretty text-sm leading-relaxed text-fg">
          Connect the wallet that owns your agent&apos;s ERC-8004 identity. We read which identities it
          owns from the registry; nothing is signed until you choose to list one.
        </p>
        <button
          type="button"
          onClick={() => open()}
          className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover sm:w-auto"
        >
          Connect a wallet to find your agents
        </button>
      </div>
    );
  }

  if (owned.isError) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--risk-4)] p-5 sm:p-6">
        <p className="text-sm text-fg">We could not read the registry just now: {owned.error instanceof Error ? owned.error.message : "request failed"}.</p>
        <button
          type="button"
          onClick={() => void owned.refetch()}
          className="mt-3 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!owned.data) {
    return <p className="text-sm text-muted">Reading the identities {shorten(address)} owns…</p>;
  }

  const state = owned.data;
  if (state.identities.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6" data-testid="no-identities">
        <p className="text-sm font-medium text-fg">
          {shorten(address)} owns no ERC-8004 agent yet
          {state.registryBlock ? ` (registry read at block ${state.registryBlock})` : ""}.
        </p>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">
          Register your agent first, then come back: it shows up here within about five minutes,
          the time it takes us to re-read the registry. The steps are below.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3" data-testid="my-identities">
      {state.identities.map((identity) => {
        const href = `/agent/${encodeURIComponent(identity.agentKey)}`;
        return (
          <li
            key={identity.agentKey}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{identity.name}</p>
              <p className="font-mono text-xs text-faint">ERC-8004 #{identity.erc8004AgentId}</p>
            </div>
            {identity.listingId ? (
              <Link
                href={href}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
              >
                Listed as #{identity.listingId}, open it
              </Link>
            ) : (
              <Link
                href={`${href}#hire`}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover"
              >
                List {identity.name}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
