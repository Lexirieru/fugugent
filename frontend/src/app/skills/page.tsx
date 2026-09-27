import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, pageFromParam } from "@/components/pagination";
import { InfoTip } from "@/components/info-tip";
import { EscrowCycle } from "@/components/skills/escrow-cycle";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillProvenanceRow } from "@/components/skills/skill-provenance";
import { TrustFilter, TrustLegend } from "@/components/skills/trust-filter";
import { ButtonLink, EmptyState, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { AUDIT_ESCROW_CYCLE, CONTRACTS, addressUrl, shorten } from "@/lib/chain";
import { skillSource } from "@/lib/skills";
import { KIND_LABEL } from "@/lib/skills/format";
import {
  SKILL_KINDS,
  isSkillKind,
  isTrustStatus,
  type SkillKind,
  type TrustStatus,
} from "@/lib/skills/types";

export const metadata: Metadata = {
  title: "Audited skills",
  description:
    "Every skill and MCP server here shows what is known about it. Only one of seven statuses means safe.",
};

const LIMIT = 24;
/** The backend caps `limit` at 100; asking for exactly that is what makes a complete census possible. */
const CENSUS_LIMIT = 100;

export default async function SkillsPage({ searchParams }: PageProps<"/skills">) {
  const sp = await searchParams;
  const first = (key: string): string | null => {
    const v = sp[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return null;
  };

  const status: TrustStatus | null = isTrustStatus(first("status"))
    ? (first("status") as TrustStatus)
    : null;
  const kind: SkillKind | null = isSkillKind(first("kind")) ? (first("kind") as SkillKind) : null;
  const q = first("q");
  const pageNumber = pageFromParam(first("page"));
  const offset = (pageNumber - 1) * LIMIT;

  const src = skillSource();
  const result = await src.listSkills({ limit: LIMIT, offset, kind, status, q });

  /**
   * The census behind the status filter is asked for separately and without a status,
   * because the census that comes back with a filtered page only counts the status that
   * was filtered for, every other chip would read zero, which is a lie about how much of
   * the registry has been checked.
   *
   * It is also only shown when it is complete. The backend counts the statuses of the
   * items it returned, not of the whole registry, so once the result is longer than one
   * request the counts would be counts of a page. In that case the chips keep their
   * labels and drop their numbers: a filter with no number still works, a filter with the
   * wrong number misleads.
   */
  const censusPage =
    status === null && offset === 0
      ? result
      : await src.listSkills({
          limit: CENSUS_LIMIT,
          offset: 0,
          kind,
          status: null,
          q,
        });
  const censusComplete =
    censusPage.provenance.healthy && censusPage.total <= censusPage.items.length;
  const census = censusComplete ? censusPage.trustCensus : null;

  /** A URL builder that keeps every other filter intact. Filters compose; they do not reset each other. */
  const hrefWith = (patch: Record<string, string | null>): string => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      status,
      kind,
      q,
      page: pageNumber > 1 ? String(pageNumber) : null,
    };
    for (const [key, value] of Object.entries({ ...base, ...patch })) {
      if (value !== null && value !== "") params.set(key, value);
    }
    const text = params.toString();
    return text === "" ? "/skills" : `/skills?${text}`;
  };

  const filtered = status !== null || kind !== null || (q !== null && q.trim() !== "");
  /**
   * The skill registry is a single source with an exact count, unlike the agent
   * catalogue, so here the total can be printed and the next page can be derived
   * from it without promising anything.
   */
  const hasNext = result.provenance.healthy && offset + result.items.length < result.total;
  const hrefForPage = (n: number) => hrefWith({ page: n > 1 ? String(n) : null });

  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="Skills"
          title="Your agent installs code. Somebody should have read it first."
          lede={
            <>
              One bad add-on can empty an agent&apos;s wallet. Here is what is known about each.{" "}
              <InfoTip label="What the risk is" align="end">
                Real attacks: a tool description that hijacks the agent, a price checker that reads
                your keys, a clean v1 then a poisoned v2. An auditor stakes money on each verdict
                and loses it if the verdict is wrong.
              </InfoTip>
            </>
          }
        />

        <div className="mt-8">
          <SkillProvenanceRow provenance={result.provenance} origin={src.origin} />
        </div>
      </Section>

      <Section labelledBy="catalogue">
        <SectionHeader id="catalogue" title="Every skill on record" />
        <div className="space-y-4">
          <TrustFilter
            census={census}
            active={status}
            total={censusComplete ? censusPage.total : null}
            hrefFor={(s) => hrefWith({ status: s, offset: null })}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
              <KindTab
                href={hrefWith({ kind: null, offset: null })}
                label="Every kind"
                active={kind === null}
              />
              {SKILL_KINDS.map((k) => (
                <KindTab
                  key={k}
                  href={hrefWith({ kind: k, offset: null })}
                  label={KIND_LABEL[k] ?? k}
                  active={kind === k}
                />
              ))}
            </nav>

            {/* A plain GET form: the result is a URL, and it works with JavaScript switched off. */}
            <form action="/skills" method="get" className="flex flex-wrap items-center gap-2">
              {status ? <input type="hidden" name="status" value={status} /> : null}
              {kind ? <input type="hidden" name="kind" value={kind} /> : null}
              <label htmlFor="skill-search" className="sr-only">
                Search skills
              </label>
              <input
                id="skill-search"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder="Search name, description, tags"
                className="w-full min-w-0 rounded-full border border-line bg-bg-elev px-4 py-1.5 text-sm text-fg placeholder:text-faint sm:w-64"
              />
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-line px-3.5 py-1.5 text-sm text-fg transition hover:border-line-strong hover:bg-surface-strong"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        <div className="mt-8">
          {result.items.length > 0 ? (
            <>
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {result.items.map((skill) => (
                  <li key={skill.id} className="flex">
                    <SkillCard skill={skill} />
                  </li>
                ))}
              </ul>
              <Pagination
                page={pageNumber}
                offset={offset}
                shown={result.items.length}
                hasNext={hasNext}
                total={result.total}
                hrefForPage={hrefForPage}
                unit="skill"
              />
            </>
          ) : pageNumber > 1 ? (
            <EmptyState
              title="There is nothing on this page"
              body="The list is shorter than this page number. The skills are on page one."
              actions={
                <>
                  <ButtonLink href={hrefForPage(1)}>Back to the first page</ButtonLink>
                  <ButtonLink href={hrefForPage(pageNumber - 1)} variant="ghost">
                    ← The page before this one
                  </ButtonLink>
                </>
              }
            />
          ) : result.provenance.healthy ? (
            <EmptyState
              title={filtered ? "Nothing matches those filters" : "No skill has been listed yet"}
              body={
                filtered
                  ? "The registry answered, and nothing fits. Clear the filters to see everything."
                  : "The registry answered, and nothing has been listed yet."
              }
              actions={
                <>
                  <ButtonLink href="/skills">Show every skill</ButtonLink>
                  <ButtonLink href="/auditors" variant="ghost">
                    Meet the auditors
                  </ButtonLink>
                </>
              }
            />
          ) : (
            <EmptyState
              title="We have nothing we can stand behind"
              body="The registry did not answer, so this list is empty on purpose. We will not show an audit status we cannot confirm."
              actions={
                <>
                  <ButtonLink href={hrefWith({})}>Try again</ButtonLink>
                  <ButtonLink href="/agents" variant="ghost">
                    Browse agents instead
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Section>

      <Section labelledBy="legend">
        <SectionHeader
          id="legend"
          title="Seven statuses. Only one means safe."
          lede={
            <>
              Each has its own words, glyph and border, not only a colour.{" "}
              <InfoTip label="Where a status comes from" align="start">
                The status is worked out from the audits actually held. No publisher, auditor or
                this page can set it by hand.
              </InfoTip>
            </>
          }
        />
        <TrustLegend />
      </Section>

      <Section labelledBy="verdict-cost">
        <h2 id="verdict-cost" className="text-balance text-lg font-semibold tracking-tight text-fg">
          What makes a verdict cost something
        </h2>
        <p className="mt-2 mb-6 max-w-4xl text-pretty text-sm leading-relaxed text-muted">
          Fee and stake sit in{" "}
          <a
            href={addressUrl(CONTRACTS.auditEscrow)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
          >
            {shorten(CONTRACTS.auditEscrow)} ↗
          </a>
          . The whole cycle has run on it.{" "}
          <InfoTip label="Why money is at stake">
            A badge is worth what the auditor loses by handing it out wrongly.
          </InfoTip>
        </p>
        <EscrowCycle proofs={AUDIT_ESCROW_CYCLE} />
        <div className="mt-6">
          <ButtonLink href="/auditors" variant="ghost">
            Who is putting up the money →
          </ButtonLink>
        </div>
      </Section>
    </Page>
  );
}

function KindTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition ${
        active
          ? "border-accent/50 bg-accent-soft text-accent-strong"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}
