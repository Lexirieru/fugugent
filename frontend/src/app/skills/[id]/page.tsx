import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { ProofList } from "@/components/proof";
import { AuditReport, FindingList } from "@/components/skills/audit-report";
import { SkillProvenanceRow } from "@/components/skills/skill-provenance";
import { TrustBadge, TrustStatement } from "@/components/skills/trust-badge";
import { ButtonLink, Card, EmptyState, Section } from "@/components/ui";
import { AUDIT_ESCROW_CYCLE, addressUrl, shorten } from "@/lib/chain";
import { formatUsd8 } from "@/lib/money";
import { formatUtc } from "@/lib/provenance";
import { skillSource } from "@/lib/skills";
import {
  KIND_INSTALL_SURFACE,
  KIND_LABEL,
  formatDate,
  linkability,
  shortDigest,
} from "@/lib/skills/format";
import { TRUST_PRESENTATION, railBackground } from "@/lib/skills/trust";
import type { SkillRecord } from "@/lib/skills/types";

export async function generateMetadata({
  params,
}: PageProps<"/skills/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await skillSource().getSkill(decodeURIComponent(id));
  const skill = detail.skill;
  // The tab title has to keep the same distinction the page body does. "Not found" for a
  // registry that never answered would be the page telling one story and the tab another.
  if (!skill) {
    return detail.notFound
      ? { title: "Skill not found" }
      : {
          title: "Cannot confirm this skill",
          description:
            "The registry did not answer, so whether this skill exists — and whether it is safe — is unknown.",
        };
  }
  const spec = TRUST_PRESENTATION[skill.trust.status];
  // The title never says "safe" for a status that is not PASSED — a shared link is
  // read by people who never open it.
  return {
    title: `${skill.name} — ${spec.label}`,
    description: spec.verdictLine,
    openGraph: {
      title: `${skill.name} — ${spec.label}`,
      description: spec.verdictLine,
    },
  };
}

export default async function SkillPage({ params }: PageProps<"/skills/[id]">) {
  const { id } = await params;
  const src = skillSource();
  const detail = await src.getSkill(decodeURIComponent(id));

  // Two different failures, kept apart. A 404 is a fact the backend earned: every level
  // answered and none of them threw. An unhealthy registry is not knowing, and rendering
  // that as "this skill does not exist" would erase a real skill.
  if (detail.notFound) notFound();

  if (detail.skill === null) {
    return (
      <Section className="pt-10 sm:pt-14">
        <BackLink />
        <div className="mt-6">
          <SkillProvenanceRow provenance={detail.provenance} origin={src.origin} />
        </div>
        <div className="mt-6">
          <EmptyState
            title="We cannot tell you whether this skill exists"
            body={`The registry did not answer, so we do not know whether ${decodeURIComponent(id)} is listed, unlisted, or dangerous. That is different from "not found", and we will not print the one when we mean the other.`}
            actions={
              <>
                <ButtonLink href={`/skills/${encodeURIComponent(id)}`}>Try again</ButtonLink>
                <ButtonLink href="/skills" variant="ghost">
                  Back to the skill list
                </ButtonLink>
              </>
            }
          />
        </div>
      </Section>
    );
  }

  const skill = detail.skill;
  const spec = TRUST_PRESENTATION[skill.trust.status];
  const source = linkability(skill.sourceUri);
  const evidence = linkability(skill.trust.evidence.uri);

  return (
    <>
      <Section className="pt-10 sm:pt-14">
        <BackLink />

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <TrustBadge status={skill.trust.status} />
          {skill.example ? (
            <span className="inline-flex items-center rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-faint">
              curated example — not installable
            </span>
          ) : null}
        </div>

        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          {skill.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {KIND_LABEL[skill.kind] ?? skill.kind} · v{skill.version}
          {skill.authorName ? ` · published by ${skill.authorName}` : ""} ·{" "}
          {skill.priceUsd8PerVersion === 0n
            ? "free"
            : `${formatUsd8(skill.priceUsd8PerVersion)} per version`}
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-faint">
          Installing this gives the agent {KIND_INSTALL_SURFACE[skill.kind] ?? "new abilities"}.
        </p>

        <div className="mt-8">
          <SkillProvenanceRow provenance={detail.provenance} origin={src.origin} />
        </div>
      </Section>

      <Section className="pt-8">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <span
            aria-hidden
            className="block h-2 w-full"
            style={{ background: railBackground(spec.pattern, spec.color) }}
          />
          <div className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{spec.label}</h2>
            <TrustStatement status={skill.trust.status} className="mt-2" />

            <p className="mt-4 border-l-2 border-line pl-3 text-sm leading-relaxed text-fg">
              {skill.trust.reason}
            </p>

            <DigestComparison skill={skill} />

            <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-2">
              <Row label="Audits on record">
                <span className="tnum text-fg">{skill.trust.auditCount}</span>
                <span className="text-muted">
                  {skill.trust.auditCount === 0
                    ? " — nobody has ever asked for one"
                    : " · the full history is below, in whatever state each one is in"}
                </span>
              </Row>
              <Row label="Verdict completed">
                <span className="text-muted">
                  {formatDate(skill.trust.completedAt) ?? "no verdict has been completed"}
                </span>
              </Row>
              <Row label="Auditor">
                {skill.trust.auditorId ? (
                  <Link
                    href={`/auditors#${skill.trust.auditorId}`}
                    className="text-accent-strong underline decoration-dotted underline-offset-4"
                  >
                    {skill.trust.auditorId}
                  </Link>
                ) : (
                  <span className="text-muted">none — no auditor has taken this on</span>
                )}
              </Row>
              <Row label="Evidence held">
                {skill.trust.evidence.complete ? (
                  evidence.linkable ? (
                    <a
                      href={evidence.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all text-accent-strong underline decoration-dotted underline-offset-4"
                    >
                      the report ↗
                    </a>
                  ) : (
                    <span className="text-muted">
                      on record, but not openable from here — {evidence.reason}
                    </span>
                  )
                ) : (
                  <span className="text-muted">
                    no report is held. A safe verdict without one is reported as inconclusive,
                    because a badge is a claim and a claim needs evidence.
                  </span>
                )}
              </Row>
            </dl>
          </div>
        </div>
      </Section>

      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">What the author claims</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Quoted verbatim, and treated as untrusted. On a poisoned skill this text{" "}
          <em>is</em> the attack: it reads as documentation to a person and as an instruction to
          an agent.
        </p>
        <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-bg-elev p-5">
          <p className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-fg">
            {skill.declaredDescription || "The author supplied no description."}
          </p>
          {skill.declaredCapabilities.length > 0 ? (
            <ul className="mt-4 space-y-1 border-t border-line pt-4">
              {skill.declaredCapabilities.map((cap) => (
                <li key={cap} className="text-sm leading-relaxed text-muted">
                  claims: {cap}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {skill.intakeFindings.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-base font-semibold tracking-tight text-fg">
              The intake scan flagged that text
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              A deterministic scan of the declared text, run at submission with no model
              involved. It is <strong>not an audit</strong>: it can raise suspicion and it never
              clears anything, and the audit status above does not read it at all. A skill with a
              clean scan is still unaudited.
            </p>
            <FindingList findings={skill.intakeFindings} />
          </div>
        ) : null}
      </Section>

      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Builds</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          A verdict is bound to the exact bytes it examined. When a new version is published, the
          old verdict does not move with it — that is the whole defence against a clean v1
          followed by a malicious v2.
        </p>
        <ul className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {skill.versions.map((v) => {
            const serving = v.contentSha256 === skill.contentSha256;
            // Which audits examined *these* bytes. A factual join on the digest, not a
            // second opinion about the status: an audit record says which build it read,
            // and the version row must not claim "never audited" over the top of it.
            const examinedBy = Array.from(
              new Set([
                ...(v.auditId === null ? [] : [v.auditId]),
                ...detail.audits
                  .filter((a) => a.auditedSha256 === v.contentSha256)
                  .map((a) => a.id),
              ]),
            );
            return (
              <li
                key={`${v.version}-${v.contentSha256}`}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line px-4 py-3 first:border-t-0 sm:px-5"
              >
                <span className="text-sm font-medium text-fg">v{v.version}</span>
                <span className="font-mono text-xs text-muted">
                  {shortDigest(v.contentSha256, 16) ?? "no digest"}
                </span>
                <span className="tnum text-xs text-faint">
                  {formatDate(v.publishedAt) ?? "undated"}
                </span>
                <span className="text-xs text-faint">
                  {examinedBy.length > 0
                    ? `examined by ${examinedBy.join(", ")}`
                    : "no audit has examined these bytes"}
                </span>
                {serving ? (
                  <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[11px] text-fg">
                    served now
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          {detail.audits.length === 0
            ? "Audit history"
            : `Audit history — ${detail.audits.length} on record`}
        </h2>
        {detail.audits.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nobody has audited this"
              body="There is no audit to read, in any state: not requested, not funded, not running. That is not a small gap — it is the state most skills on an open registry are in when an agent installs them."
              actions={
                <>
                  <ButtonLink href="/skills?status=PASSED">Show skills that did pass</ButtonLink>
                  <ButtonLink href="/auditors" variant="ghost">
                    Who could audit it
                  </ButtonLink>
                </>
              }
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {detail.audits.map((audit) => (
              <AuditReport key={audit.id} audit={audit} />
            ))}
          </div>
        )}
      </Section>

      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Identity</h2>
        <Card className="mt-4">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Row label="Registry id">
              <span className="font-mono text-xs text-fg">{skill.id}</span>
            </Row>
            <Row label="Source">
              {source.linkable ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-accent-strong underline decoration-dotted underline-offset-4"
                >
                  {source.href} ↗
                </a>
              ) : (
                <span className="break-all text-muted">
                  <span className="font-mono text-xs">{skill.sourceUri || "none recorded"}</span> —{" "}
                  {source.reason}
                </span>
              )}
            </Row>
            <Row label="Author address">
              {skill.authorAddress ? (
                <a
                  href={addressUrl(skill.authorAddress)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
                >
                  {shorten(skill.authorAddress)} ↗
                </a>
              ) : (
                <span className="text-muted">no address on record</span>
              )}
            </Row>
            <Row label="Listed">
              <span className="tnum text-muted">
                {formatUtc(skill.createdAt) ?? "unknown"}
                {skill.updatedAt !== skill.createdAt
                  ? ` · updated ${formatUtc(skill.updatedAt) ?? "unknown"}`
                  : ""}
              </span>
            </Row>
          </dl>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs uppercase tracking-[0.14em] text-faint">
              Digest of the build being served
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="min-w-0 break-all font-mono text-xs text-fg">
                {skill.contentSha256 || "none recorded"}
              </code>
              {skill.contentSha256 ? (
                <CopyButton text={skill.contentSha256} label="Copy digest" />
              ) : null}
            </div>
          </div>
        </Card>
      </Section>

      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          What makes a verdict cost something
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Fee and bond live in FuguAuditEscrow on BNB Chain testnet, deployed and verified. The
          cycle below has been run on it end to end — job created, fee funded, bond posted,
          settled — so the mechanism behind every verdict on this page is a contract anybody can
          read, not a promise.
        </p>
        <div className="mt-5">
          <ProofList proofs={AUDIT_ESCROW_CYCLE} />
        </div>
      </Section>
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/skills"
      className="text-sm text-muted transition hover:text-fg"
    >
      ← All skills
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed">{children}</dd>
    </div>
  );
}

/**
 * The digest the auditor examined, next to the digest being served.
 *
 * Two rows, always both, so that "same bytes" is something the reader confirms rather
 * than something the page asserts. When they differ the page says so in words as well —
 * this is the rug-pull, and it is the one comparison that must never be subtle.
 */
function DigestComparison({ skill }: { skill: SkillRecord }) {
  const audited = shortDigest(skill.trust.auditedSha256, 20);
  const current = shortDigest(skill.trust.currentSha256 ?? skill.contentSha256, 20);

  if (audited === null) {
    return (
      <p className="mt-4 text-sm leading-relaxed text-muted">
        No build has been examined, so there is nothing to compare against the{" "}
        <span className="font-mono text-xs text-fg">{current ?? "unknown"}</span> being served.
      </p>
    );
  }

  return (
    <div
      className={`mt-4 rounded-xl border px-4 py-3 ${
        skill.trust.buildChanged ? "border-[var(--risk-4)]" : "border-line"
      }`}
    >
      <p className="text-xs uppercase tracking-[0.14em] text-faint">
        {skill.trust.buildChanged ? "The bytes changed after the audit" : "Same bytes, both sides"}
      </p>
      <dl className="mt-2 space-y-1 font-mono text-xs">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-faint">audited</dt>
          <dd className="text-fg">{audited}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-faint">serving</dt>
          <dd className={skill.trust.buildChanged ? "text-[var(--risk-4)]" : "text-fg"}>
            {current ?? "unknown"}
          </dd>
        </div>
      </dl>
      {skill.trust.buildChanged ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The verdict on record belongs to the first of those two digests. It does not carry over
          to the second, whatever it said.
        </p>
      ) : null}
    </div>
  );
}
