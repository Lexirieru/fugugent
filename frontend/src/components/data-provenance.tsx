import { ButtonLink } from "@/components/ui";
import {
  SOURCE_LABEL,
  SOURCE_MEANING,
  formatAge,
  outcomeLabel,
  weightOf,
  type Provenance,
} from "@/lib/provenance";

/**
 * Where the numbers on this page came from, and how old they are.
 *
 * The backend walks a fallback ladder 8004scan -> cache -> on-chain -> seed, and every
 * answer carries the ladder it actually walked. Showing it is not decoration: when
 * 8004scan is down and we serve from the cache, a page that looks normal lets the user
 * misunderstand — and an uncheckable dashboard is what closed Giza/ARMA.
 *
 * The weight adapts to the situation, because a warning that always shouts stops being
 * heard: healthy and fresh = one dim line; not confirmed fresh or degraded = a visible
 * stripe; failed = a red block. The full ladder is always one click away, at all three
 * weights.
 */
export function DataProvenance({
  provenance,
  origin,
  className = "",
}: {
  provenance: Provenance;
  /** The backend address, or a description of the local source. */
  origin: string;
  className?: string;
}) {
  const weight = weightOf(provenance);
  const age = formatAge(provenance.ageSeconds);
  const label = SOURCE_LABEL[provenance.source];

  if (weight === "failure") {
    return (
      <div
        className={`rounded-xl border border-[var(--risk-4)]/50 bg-[color-mix(in_srgb,var(--risk-4)_10%,transparent)] px-4 py-3 ${className}`}
      >
        <p className="text-sm font-medium text-fg">The catalogue did not answer.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {origin} replied:{" "}
          <span className="font-mono text-xs">{provenance.reason ?? "no reason given"}</span>. Nothing
          below is stale data pretending to be live — the list is empty because we have nothing we
          can stand behind.
        </p>
        <Trail provenance={provenance} />
      </div>
    );
  }

  if (provenance.source === "seed") {
    return (
      <div className={`rounded-xl border border-line bg-surface px-4 py-3 ${className}`}>
        <p className="text-sm font-medium text-fg">
          The live catalogue is not connected yet.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {SOURCE_MEANING.seed} Each card says what that agent can actually do today, and every
          transaction link opens on BscScan.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ButtonLink href="https://hellofugu.xyz" variant="ghost" external>
            What is actually shipped ↗
          </ButtonLink>
        </div>
        <Trail provenance={provenance} />
      </div>
    );
  }

  if (weight === "attention") {
    return (
      <div
        className={`rounded-xl border border-line border-l-2 border-l-[var(--risk-3)] bg-surface px-4 py-3 ${className}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-fg">Served from {label}</span>
          {age ? <span className="tnum text-muted">· {age}</span> : null}
          {provenance.stale ? (
            <span className="text-[var(--risk-3)]">· not confirmed fresh</span>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {SOURCE_MEANING[provenance.source]}
          {provenance.reason ? ` ${provenance.reason}` : ""}
        </p>
        <Trail provenance={provenance} />
      </div>
    );
  }

  // `div`, not `p`: `Trail` renders a `<details>`, and `<details>` inside `<p>` is
  // invalid HTML — the browser hoists it out during parsing, so hydration fails and
  // React throws this whole tree away and redraws it.
  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-faint ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--risk-1)]"
        />
        Live from {label}
      </span>
      {age ? <span className="tnum">· {age}</span> : null}
      <Trail provenance={provenance} inline />
    </div>
  );
}

/**
 * The ladder that was walked, one click away. It is present at all three weights — an
 * uncheckable resilience claim is no better than an uncheckable AUM claim.
 */
function Trail({ provenance, inline = false }: { provenance: Provenance; inline?: boolean }) {
  if (provenance.trail.length === 0) return null;

  return (
    <details className={inline ? "inline" : "mt-2"}>
      <summary className="cursor-pointer list-none text-xs text-faint underline decoration-dotted underline-offset-4 transition hover:text-fg">
        {inline ? "· how it got here" : "How it got here"}
      </summary>
      <ol className="mt-2 space-y-1.5">
        {provenance.trail.map((step, i) => (
          <li key={`${step.source}-${i}`} className="flex gap-2 text-xs leading-relaxed">
            <span className="tnum shrink-0 text-faint">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-mono text-fg">{SOURCE_LABEL[step.source]}</span>
              <span className="text-faint"> — {outcomeLabel(step.outcome)}</span>
              {typeof step.items === "number" ? (
                <span className="tnum text-faint">
                  , {step.items} {step.items === 1 ? "item" : "items"}
                </span>
              ) : null}
              {step.reason ? <span className="block text-faint">{step.reason}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
