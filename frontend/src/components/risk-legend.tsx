import { Fugu } from "@/components/fugu";
import { BLOAT, BLOAT_LEVELS } from "@/lib/risk";

/**
 * How to read the fish.
 *
 * This is a legend, not a claim: there is not a single agent number in it. It exists
 * because the puff level is the core mechanic of the product, and a mechanic that has to
 * be explained in a separate paragraph has already lost before it starts.
 *
 * What carries the message is the **ring pattern and the body width**, not the colour —
 * which is why this legend stays readable on a monochrome screen, in a black-and-white
 * print, and for a reader who does not distinguish red from green.
 */
export function RiskLegend() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
          How to read the fish
        </h2>
        <p className="text-xs text-faint">
          Body colour says which agent. Body shape says how much risk.
        </p>
      </div>

      <ol className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {BLOAT_LEVELS.map((level) => {
          const spec = BLOAT[level];
          return (
            <li key={level} className="flex flex-col items-center text-center">
              <Fugu
                kind="guardian"
                level={level}
                className="h-14 w-14"
                animated={false}
                label={`Level ${level} of 5, ${spec.name}: ${spec.ring}.`}
              />
              <span className="mt-2 text-sm font-medium text-fg">{spec.name}</span>
              <span className="mt-0.5 text-[11px] leading-snug text-faint">{spec.ring}</span>
              {spec.spendsMoney ? (
                <span className="mt-1 text-[11px] leading-snug text-[var(--risk-4)]">
                  spends money
                </span>
              ) : (
                <span className="mt-1 text-[11px] leading-snug text-faint">watches only</span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-5 text-xs leading-relaxed text-faint">
        Level 5 is the only one that holds still, and the only one whose ring is a black-and-white
        pattern rather than a colour — so it stays unmistakable with the colour taken away, and for
        anyone who turns animation off. A hollow, dashed fish means there is no fresh reading; we
        draw the gap rather than guess a level.
      </p>
    </div>
  );
}
