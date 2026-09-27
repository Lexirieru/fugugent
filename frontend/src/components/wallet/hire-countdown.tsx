"use client";

/**
 * Time left on a running hire, ticking every second, with a bar for how much of the
 * paid period has been served. The deadline is the contract's `endsAt`; the clock is
 * the browser's, re-read each second inside an effect (never during render).
 */

import { useEffect, useState } from "react";

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function HireCountdown({ startedAt, endsAt }: { startedAt: string; endsAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const start = Date.parse(startedAt);
  const end = Date.parse(endsAt);
  if (now === null) return <span className="font-mono text-xs text-muted">--:--</span>;
  const left = (end - now) / 1000;
  const served = Math.min(1, Math.max(0, (now - start) / (end - start)));

  return (
    <span className="flex w-full min-w-40 flex-col gap-1 sm:w-44" data-testid="hire-countdown">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-faint">{left > 0 ? "Time left" : "Period over"}</span>
        <span className="font-mono tabular-nums text-fg">{fmt(left)}</span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-bg-elev" aria-hidden>
        <span className="block h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${served * 100}%` }} />
      </span>
    </span>
  );
}
