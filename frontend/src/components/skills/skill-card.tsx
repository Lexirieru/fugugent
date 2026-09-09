import Link from "next/link";
import { TrustBadge } from "@/components/skills/trust-badge";
import { formatUsd8 } from "@/lib/money";
import { KIND_LABEL, highestSeverity, shortDigest } from "@/lib/skills/format";
import { TRUST_PRESENTATION, railBackground } from "@/lib/skills/trust";
import type { SkillRecord } from "@/lib/skills/types";

/**
 * One skill in the list.
 *
 * The order of the card is the order of the decision. What we know about it comes
 * first, the rail across the top, then the badge, then a sentence, and only after
 * that does the card say what the skill claims to do. The author's own description sits
 * below the verdict on purpose: it is the text an attacker controls, and on a poisoned
 * skill it is the payload.
 *
 * There is no install button anywhere on this card. We do not have an install endpoint,
 * and a control that cannot do what it says is worse than no control at all.
 */
export function SkillCard({ skill }: { skill: SkillRecord }) {
  const spec = TRUST_PRESENTATION[skill.trust.status];
  const intake = highestSeverity(skill.intakeFindings);
  const audited = shortDigest(skill.trust.auditedSha256);
  const current = shortDigest(skill.trust.currentSha256 ?? skill.contentSha256);

  return (
    <article className="group relative flex w-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition hover:border-line-strong hover:bg-surface-strong">
      {/* The rail is a texture, not a tint: it still separates the seven in grayscale. */}
      <span
        aria-hidden
        className="block h-1.5 w-full"
        style={{ background: railBackground(spec.pattern, spec.color) }}
      />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TrustBadge status={skill.trust.status} size="sm" />
          {skill.example ? (
            <span className="inline-flex items-center rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] text-faint">
              example
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-base font-semibold leading-tight text-fg">
          <Link
            href={`/skills/${encodeURIComponent(skill.id)}`}
            className="after:absolute after:inset-0 after:rounded-[var(--radius-card)]"
          >
            {skill.name}
          </Link>
        </h3>
        <p className="mt-1 text-xs text-faint">
          {KIND_LABEL[skill.kind] ?? skill.kind} · v{skill.version}
          {skill.authorName ? ` · ${skill.authorName}` : ""}
        </p>

        <p className="mt-3 text-sm leading-relaxed text-muted">{spec.verdictLine}</p>

        {skill.trust.buildChanged && audited && current ? (
          <p className="mt-3 border-l-2 border-[var(--risk-4)] pl-3 font-mono text-xs leading-relaxed text-fg">
            audited {audited}
            <br />
            serving {current}
          </p>
        ) : null}

        {intake !== null ? (
          <p className="mt-3 text-xs leading-relaxed text-fg">
            <span className="font-medium">Intake scan:</span> {skill.intakeFindings.length}{" "}
            {skill.intakeFindings.length === 1 ? "hit" : "hits"} in the declared text, worst{" "}
            {intake}. A scan raises suspicion; it never clears anything.
          </p>
        ) : null}

        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-faint">
          Declares: {skill.declaredDescription}
        </p>

        <div className="grow" />

        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-4">
          <span className="font-mono text-sm tabular-nums text-fg">
            {skill.priceUsd8PerVersion === 0n
              ? "Free"
              : `${formatUsd8(skill.priceUsd8PerVersion)} / version`}
          </span>
          <span className="text-xs text-faint transition group-hover:text-accent-strong">
            {skill.trust.auditCount > 0
              ? `Read the audit${skill.trust.auditCount === 1 ? "" : "s"} →`
              : "See what we know →"}
          </span>
        </div>
      </div>
    </article>
  );
}
