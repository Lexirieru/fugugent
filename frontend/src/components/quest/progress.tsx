"use client";

/**
 * A wallet's Set and Earn hire progress, as far as HelloFugu can see it: how many
 * different agents it has hired here. Hires on the other shortlisted marketplaces are
 * not visible from here, and the page says so rather than implying a total.
 */
import { useAppKit } from "@reown/appkit/react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";

const API = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

interface Hire {
  agentKey: string | null;
  agentName: string | null;
  status: "active" | "ended" | "cancelled";
}

async function load(wallet: string): Promise<Hire[]> {
  const res = await fetch(`${API}/api/tracking/hires?wallet=${wallet}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { hires: Hire[] }).hires;
}

export function QuestProgress() {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const data = useQuery({ queryKey: ["quest-progress", address], queryFn: () => load(address!), enabled: Boolean(address) && API !== "" });

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={() => open()}
        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
      >
        Connect to see your hires here
      </button>
    );
  }
  if (data.isError) return <p className="text-sm text-muted">Could not read your hires just now.</p>;
  if (!data.data) return <p className="text-sm text-muted">Reading your hires…</p>;

  const agents = new Map<string, string>();
  for (const h of data.data) if (h.agentKey) agents.set(h.agentKey, h.agentName ?? h.agentKey);
  const n = agents.size;
  return (
    <div data-testid="quest-progress">
      <p className="text-sm text-fg">
        <span className="font-mono text-lg font-semibold">{Math.min(n, 3)} of 3</span> different agents hired on HelloFugu
        {n > 0 ? `: ${[...agents.values()].slice(0, 5).join(", ")}` : ""}.
      </p>
      <p className="mt-1 text-xs text-muted">
        Your 3 hires must cover at least 2 marketplaces, so at least one has to be on another shortlisted marketplace. This page only sees HelloFugu.
      </p>
    </div>
  );
}
