import type { Metadata } from "next";
import { SkillProvenanceRow } from "@/components/skills/skill-provenance";
import { ButtonLink, Card, EmptyState, Eyebrow, Section } from "@/components/ui";
import { CONTRACTS, addressUrl, shorten } from "@/lib/chain";
import { formatUsd8 } from "@/lib/money";
import { formatUtc } from "@/lib/provenance";
import { skillSource } from "@/lib/skills";
import type { AuditorRecord } from "@/lib/skills/types";

export const metadata: Metadata = {
  title: "Auditors",
  description:
    "Who audits the skills, what they have put at stake, how often they have been overruled, and where their reputation is read from on chain.",
};

export default async function AuditorsPage() {
  const src = skillSource();
  const list = await src.listAuditors();

  return (
    <>
      <Section className="pt-10 sm:pt-14">
        <Eyebrow>Auditors</Eyebrow>
        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          The people who lose money when a verdict is wrong.
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          Anyone can call a skill safe. What separates an audit from an opinion is the bond: an
          auditor posts one before starting, is paid when the verdict stands, and is slashed when
          it is overturned. The two numbers that matter on each row below are therefore the bond
          and the slash count — not the number of audits shipped.
        </p>

        <div className="mt-8">
          <SkillProvenanceRow
            provenance={list.provenance}
            origin={src.origin}
            action={<ButtonLink href="/skills" variant="ghost">What they are auditing</ButtonLink>}
          />
        </div>

        {Object.keys(list.reputationSources).length > 0 ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Reputation reads on this page:{" "}
            {Object.entries(list.reputationSources)
              .map(([source, count]) => `${count} ${source}`)
              .join(" · ")}
            . A row we could not read says so; it never shows a zero we invented.
          </p>
        ) : null}

        <div className="mt-8">
          {list.items.length > 0 ? (
            <ul className="grid gap-4 lg:grid-cols-2">
              {list.items.map((auditor) => (
                <li key={auditor.id} className="flex">
                  <AuditorCard auditor={auditor} />
                </li>
              ))}
            </ul>
          ) : list.provenance.healthy ? (
            <EmptyState
              title="No auditor has registered yet"
              body="The registry answered and holds nobody. Until an auditor posts a bond there is no one to run an audit, which is why every skill in the list is currently in one of the five states of not knowing."
              actions={
                <>
                  <ButtonLink href="/skills">See what is waiting to be audited</ButtonLink>
                  <ButtonLink href="/" variant="ghost">
                    Browse agents
                  </ButtonLink>
                </>
              }
            />
          ) : (
            <EmptyState
              title="We could not read the auditor roster"
              body="The registry did not answer. Rather than show a stale roster that might name an auditor who has since been slashed, this page shows nothing and says why."
              actions={
                <>
                  <ButtonLink href="/auditors">Try again</ButtonLink>
                  <ButtonLink href="/skills" variant="ghost">
                    Back to the skills
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Section>

      <Section className="pt-12">
        <Card>
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            Where the reputation number comes from
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            The score is read from{" "}
            <a
              href={addressUrl(CONTRACTS.reputation)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
            >
              FuguReputation {shorten(CONTRACTS.reputation)} ↗
            </a>{" "}
            — the same contract the agent marketplace uses, where a review can only be written by
            a wallet that provably paid. There is no second scoreboard for auditors, because a
            score kept in our own database would be a number only we can check.
          </p>
        </Card>
      </Section>
    </>
  );
}

function AuditorCard({ auditor }: { auditor: AuditorRecord }) {
  const { reputation } = auditor;
  const score =
    reputation.averageScoreX100 === null
      ? null
      : (reputation.averageScoreX100 / 100).toFixed(2);
  const reviews = reputation.reviewCount ?? 0;

  return (
    // The id is the anchor an audit report links to, so arriving from a skill page lands
    // on the auditor that gave the verdict rather than on the top of a list.
    <article
      id={auditor.id}
      className="flex w-full scroll-mt-28 flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight text-fg">{auditor.displayName}</h2>
        {auditor.example ? (
          <span className="inline-flex items-center rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] text-faint">
            example
          </span>
        ) : null}
      </div>

      <p className="mt-1 font-mono text-xs">
        {auditor.address ? (
          <a
            href={addressUrl(auditor.address)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-strong underline decoration-dotted underline-offset-4"
          >
            {shorten(auditor.address)} ↗
          </a>
        ) : (
          <span className="text-faint">no address on record</span>
        )}
      </p>

      {auditor.specialization.length > 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Audits for: {auditor.specialization.join(" · ")}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-faint">Bond at stake</dt>
          <dd className="tnum mt-1 font-mono text-lg text-fg">{formatUsd8(auditor.bondUsd8)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-faint">Slashed</dt>
          <dd
            className="tnum mt-1 font-mono text-lg"
            style={{ color: auditor.slashes > 0 ? "var(--risk-5)" : "var(--fg)" }}
          >
            {auditor.slashes}
            {auditor.slashes > 0 ? (
              <span className="ml-2 align-middle text-xs font-medium uppercase tracking-wide">
                overruled
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-faint">Audits completed</dt>
          <dd className="tnum mt-1 text-sm text-fg">{auditor.auditsCompleted}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-faint">Verdicts</dt>
          <dd className="tnum mt-1 text-sm text-fg">
            {auditor.verdictsSafe} safe · {auditor.verdictsDangerous} dangerous
          </dd>
        </div>
      </dl>

      <div className="grow" />

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-xs uppercase tracking-[0.14em] text-faint">On-chain reputation</p>
        {/* Three states, never collapsed into two. "Read it, and there are no reviews"
            is not "0.00 out of 5" — an average of nothing is not zero, and printing it
            as one would defame an auditor nobody has rated. */}
        {score === null ? (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Not read ({reputation.source}).{" "}
            {reputation.reason ?? "No reason was given, so no score is shown."}
          </p>
        ) : reviews === 0 ? (
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Read from chain, and there is nothing to average: no review has been written about
            this auditor yet.{" "}
            {reputation.fetchedAt ? (
              <span className="text-faint">Read {formatUtc(reputation.fetchedAt)}.</span>
            ) : null}
          </p>
        ) : (
          <p className="mt-1 text-sm leading-relaxed text-fg">
            <span className="tnum font-mono">{score}</span> out of 5 from{" "}
            <span className="tnum">{reviews}</span> {reviews === 1 ? "review" : "reviews"}.{" "}
            {reputation.fetchedAt ? (
              <span className="text-faint">Read {formatUtc(reputation.fetchedAt)}.</span>
            ) : null}
          </p>
        )}
      </div>
    </article>
  );
}
