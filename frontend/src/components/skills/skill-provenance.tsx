import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui";
import { formatAge, outcomeLabel } from "@/lib/provenance";
import {
  SKILL_SOURCE_LABEL,
  SKILL_SOURCE_MEANING,
  skillWeightOf,
  type SkillProvenance,
} from "@/lib/skills/provenance";

/**
 * Where the skill records on this page came from, and how old they are.
 *
 * The same three weights as the agent marketplace's row, for the same reason: a warning
 * that always shouts stops being heard. Healthy registry = one dim line; examples or a
 * degraded answer = a visible stripe; a failure = a block. The ladder that was actually
 * walked is one click away at all three weights, because an unverifiable claim about our
 * own resilience is no better than an unverifiable claim about a skill.
 */
export function SkillProvenanceRow({
  provenance,
  origin,
  action,
  className = "",
}: {
  provenance: SkillProvenance;
  origin: string;
  /** Where to go next from the examples notice. Defaults to the auditor roster. */
  action?: ReactNode;
  className?: string;
}) {
  const weight = skillWeightOf(provenance);
  const age = formatAge(provenance.ageSeconds);
  const label = SKILL_SOURCE_LABEL[provenance.source];

  if (weight === "failure") {
    return (
      <div
        className={`rounded-xl border border-[var(--risk-4)]/50 bg-[color-mix(in_srgb,var(--risk-4)_10%,transparent)] px-4 py-3 ${className}`}
      >
        <p className="text-sm font-medium text-fg">The skill registry did not answer.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {origin} replied:{" "}
          <span className="font-mono text-xs">{provenance.reason ?? "no reason given"}</span>.
          Nothing below is a cached copy pretending to be live. An audit status is a claim about
          safety, and we will not serve one we cannot currently stand behind.
        </p>
        <Trail provenance={provenance} />
      </div>
    );
  }

  if (provenance.source === "seed") {
    return (
      <div className={`rounded-xl border border-line bg-surface px-4 py-3 ${className}`}>
        <p className="text-sm font-medium text-fg">{exampleHeadline(provenance)}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {provenance.notice ?? SKILL_SOURCE_MEANING.seed} Every record below carries an{" "}
          <span className="font-mono text-xs">example</span> tag and an id beginning{" "}
          <span className="font-mono text-xs">example-</span>. Nothing here is installable, and
          no author or auditor named below is a real one.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {action ?? (
            <ButtonLink href="/auditors" variant="ghost">
              Who the auditors are
            </ButtonLink>
          )}
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
          {SKILL_SOURCE_MEANING[provenance.source]}
          {provenance.reason ? ` ${provenance.reason}` : ""}
        </p>
        {provenance.notice ? (
          <p className="mt-1 text-sm leading-relaxed text-muted">{provenance.notice}</p>
        ) : null}
        <Trail provenance={provenance} />
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-faint ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--risk-1)]" />
        Live from {label}
      </span>
      {age ? <span className="tnum">· {age}</span> : null}
      <Trail provenance={provenance} inline />
    </div>
  );
}

function Trail({
  provenance,
  inline = false,
}: {
  provenance: SkillProvenance;
  inline?: boolean;
}) {
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
              <span className="font-mono text-fg">{SKILL_SOURCE_LABEL[step.source]}</span>
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

/**
 * Why examples are being shown, taken from the rung the registry actually reported.
 *
 * "No registry is connected" and "the registry answered and had nothing" are different
 * facts, and the first was being printed for both. A page that explains its own
 * fallback wrongly is exactly the kind of small dishonesty this component exists to
 * prevent.
 */
function exampleHeadline(provenance: SkillProvenance): string {
  const registry = provenance.trail.find((step) => step.source === "registry");
  switch (registry?.outcome) {
    case "unavailable":
      return "Curated examples — no skill registry is connected.";
    case "empty":
      return "Curated examples — the registry answered, and it holds nothing that matches.";
    case "unhealthy":
    case "threw":
      return "Curated examples — the registry could not answer, so nothing below is a live listing.";
    default:
      return "Curated examples — nothing below is a live listing.";
  }
}
