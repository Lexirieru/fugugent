"use client";

/**
 * What a running read-only agent found for the wallet that hired it, shown on /me.
 *
 * Fugu Watch, Tally, Quote and Scout are endpoints under `/api/run`. While one is hired,
 * this calls it for the renter and shows the answer with the block it was read at, so a
 * hire hands back something you can read rather than only a status.
 */
import { useQuery } from "@tanstack/react-query";

const API = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

type Slug = "watch" | "tally" | "quote" | "scout";
/** ERC-8004 ids of the read-only agents (contracts/deployments/agents-10-20.json). */
export const RUNNABLE: Record<string, Slug> = {
  "97:2513": "watch",
  "97:2514": "tally",
  "97:2517": "quote",
  "97:2515": "scout",
};

const QUEST = ["HEALTH_FACTOR", "YIELD", "GRID", "REBALANCING"] as const;
const QUEST_LABEL: Record<(typeof QUEST)[number], string> = {
  HEALTH_FACTOR: "health factor",
  YIELD: "yield",
  GRID: "grid",
  REBALANCING: "rebalancing",
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/api/run/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function run(slug: Slug, wallet: string): Promise<{ text: string; block: string | null }> {
  switch (slug) {
    case "watch": {
      const r = await get<{ healthFactor: string | null; says: string; blockNumber: string }>(`watch?wallet=${wallet}`);
      return { text: r.healthFactor === null ? r.says : `Health factor ${r.healthFactor}. ${r.says}`, block: r.blockNumber };
    }
    case "tally": {
      const r = await get<{ hires: number; spentTbnb: string; blockNumber: string }>(`tally?wallet=${wallet}`);
      return { text: `You have spent ${r.spentTbnb} tBNB on ${r.hires} hire${r.hires === 1 ? "" : "s"} here.`, block: r.blockNumber };
    }
    case "quote": {
      const r = await get<{ amountTbnb: string; blockNumber: string }>("quote?usd=1");
      return { text: `$1.00 is ${r.amountTbnb} tBNB right now.`, block: r.blockNumber };
    }
    case "scout": {
      const picks = await Promise.all(
        QUEST.map((c) => get<{ picks: { name: string }[] }>(`scout?category=${c}&limit=1`).then((r) => `${r.picks[0]?.name ?? "none"} (${QUEST_LABEL[c]})`)),
      );
      return { text: `One pick per quest category: ${picks.join(", ")}.`, block: null };
    }
  }
}

export function AgentResult({ agentKey, wallet }: { agentKey: string | null; wallet: string }) {
  const slug = agentKey ? RUNNABLE[agentKey] : undefined;
  const data = useQuery({
    queryKey: ["agent-result", slug, wallet],
    queryFn: () => run(slug!, wallet),
    enabled: slug !== undefined && API !== "",
    refetchInterval: 30_000,
  });
  if (slug === undefined) return null;
  return (
    <p className="w-full rounded-lg bg-bg-elev px-3 py-2 text-xs leading-relaxed text-fg" data-testid="agent-result">
      <span className="font-semibold">Found for you: </span>
      {data.data ? data.data.text : data.isError ? "it did not answer just now." : "asking it…"}
      {data.data?.block ? <span className="text-faint"> · block {data.data.block}</span> : null}
    </p>
  );
}
