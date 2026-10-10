"use client";

/**
 * The Set and Earn build checklist for one agent, from `/api/quest/agent/:id`.
 *
 * Shown on agents that are not ours: a builder who listed here wants to know whether
 * their agent would count, and every check names where it can be confirmed. "Check"
 * is a real third state, not a soft pass: it means public data cannot settle it.
 */
import { useQuery } from "@tanstack/react-query";
import { InfoTip } from "@/components/info-tip";

const API = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

type Status = "pass" | "fail" | "check";
interface Check {
  id: string;
  title: string;
  status: Status;
  detail: string;
  href: string | null;
}
interface Answer {
  checks: Check[];
  passed: number;
  complete?: boolean;
  checkedAt: string;
  note: string;
}

const MARK: Record<Status, { sign: string; className: string; label: string }> = {
  pass: { sign: "✓", className: "border-[var(--risk-1)] text-[var(--risk-1)]", label: "Passes" },
  fail: { sign: "✕", className: "border-[var(--risk-4)] text-[var(--risk-4)]", label: "Not yet" },
  check: { sign: "?", className: "border-[var(--risk-3)] text-[var(--risk-3)]", label: "Check yourself" },
};

async function load(agentId: string): Promise<Answer> {
  const res = await fetch(`${API}/api/quest/agent/${encodeURIComponent(agentId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Answer;
}

export function QuestReadiness({ agentId }: { agentId: string }) {
  const data = useQuery({ queryKey: ["quest-readiness", agentId], queryFn: () => load(agentId), enabled: API !== "", staleTime: 60_000 });

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6" data-testid="quest-readiness">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted">
          {data.data ? (
            <>
              <span className="font-mono text-base font-semibold text-fg">{data.data.passed} of 6</span> pass
            </>
          ) : data.isError ? (
            "Could not run the checks just now."
          ) : (
            "Running the checks…"
          )}
          <InfoTip label="About this checklist" align="start">
            {data.data?.note ?? "The six things BNB Chain checks about an agent you build for Set and Earn, read from public data."}
          </InfoTip>
        </p>
        <button
          type="button"
          onClick={() => void data.refetch()}
          disabled={data.isFetching}
          className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted transition hover:border-fg hover:text-fg disabled:opacity-50"
        >
          {data.isFetching ? "Checking…" : "Check again"}
        </button>
      </div>

      {data.data ? (
        <ul className="mt-4 divide-y divide-line">
          {data.data.checks.map((c) => (
            <li key={c.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span
                aria-label={MARK[c.status].label}
                title={MARK[c.status].label}
                className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${MARK[c.status].className}`}
              >
                {MARK[c.status].sign}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{c.title}</p>
                <p className="mt-1 text-xs leading-relaxed break-words text-muted">
                  {c.detail}{" "}
                  {c.href ? (
                    <a href={c.href} target="_blank" rel="noreferrer noopener" className="whitespace-nowrap text-accent-strong underline underline-offset-2">
                      Open ↗
                    </a>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
