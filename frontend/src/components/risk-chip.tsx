/**
 * The numeric risk chip — the sixth channel from `docs/brand/puff-levels.md` §0, and the
 * only unambiguous one. That is why it is required on both the card and the detail page,
 * and must never be dropped at any size that shows levels 4–5.
 *
 * Level 5 is always a filled block + white text + uppercase, in light mode and dark
 * alike: `#A4210E` as text on a dark background is only 2.53:1 — which would make the
 * gravest state the hardest one to read. The filled block gives 7.49:1.
 */

import { BLOAT, type RiskReading } from "@/lib/risk";
import { txUrl } from "@/lib/chain";

export function RiskChip({ reading, size = "md" }: { reading: RiskReading | null; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  if (!reading) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong font-medium text-faint ${pad}`}
      >
        no live reading
      </span>
    );
  }

  const spec = BLOAT[reading.level];

  const inner =
    reading.level === 5 ? (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--risk-5)] font-semibold uppercase tracking-wide text-white ${pad}`}
      >
        <span className="tabular-nums">
          {reading.metricLabel} {reading.metricValue}
        </span>
        <span aria-hidden>·</span>
        <span>{spec.name}</span>
      </span>
    ) : (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad}`}
        style={{ borderColor: spec.color, color: spec.color }}
      >
        <span className="tabular-nums">
          {reading.metricLabel} {reading.metricValue}
        </span>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <span>{spec.name}</span>
      </span>
    );

  if (!reading.proofTxHash) return inner;

  return (
    <a
      href={txUrl(reading.proofTxHash)}
      target="_blank"
      rel="noreferrer noopener"
      className="relative z-10 inline-flex rounded-full transition hover:opacity-80"
      title="Open the transaction this reading came from"
    >
      {inner}
    </a>
  );
}
