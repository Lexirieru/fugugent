import type { Metadata } from "next";
import Link from "next/link";
import { Pagination, pageFromParam } from "@/components/pagination";
import { ProofList } from "@/components/proof";
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
    "Every skill and MCP server here carries what is actually known about it: audited and clean, audited and dangerous, or one of five ways of not knowing. Only one of the seven means safe.",
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
          lede="An agent gains its abilities by installing add-ons from open sources nobody checks. That is a live attack surface: instructions hidden inside a tool description that hijack the agent, a price checker that quietly reads your keys, a clean first version followed by a poisoned second one. One bad add-on empties the wallet, and the agent does it to itself."
        />
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          So an auditor puts money down, reads a build, is paid when the verdict stands, and loses
          the money when it does not. Below, every add-on carries what is actually known about it,
          and five of the seven states are ways of not knowing.
        </p>

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
              body="The registry answered and this page of it is empty. The list is shorter than the page number in the address, so the first page is where the skills are."
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
                  ? "The registry answered, and nothing in it fits. Clearing the filters shows everything it does hold, including the skills nobody has audited, which are the ones worth looking at hardest."
                  : "The registry answered and it is empty. That is a real answer, not a failed request: nothing has been listed, so there is nothing to audit yet."
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
              body="The registry did not answer, so this list is empty on purpose. An audit status is a claim about whether code is safe to install, and serving a cached one without saying so is exactly the failure this marketplace exists to prevent."
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
          title="Seven statuses, and only one of them means safe"
          lede="Colour is never the only difference between two of them: each has its own wording, its own glyph and its own border texture, so the seven stay seven in grayscale as well."
        />
        <TrustLegend />
      </Section>

      <Section labelledBy="verdict-cost">
        <h2 id="verdict-cost" className="text-balance text-lg font-semibold tracking-tight text-fg">
          What makes a verdict cost something
        </h2>
        <p className="mt-2 mb-6 max-w-2xl text-pretty text-sm leading-relaxed text-muted">
          A badge is worth exactly as much as the auditor loses by handing it out wrongly. The fee
          and the money at stake sit in{" "}
          <a
            href={addressUrl(CONTRACTS.auditEscrow)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
          >
            {shorten(CONTRACTS.auditEscrow)} ↗
          </a>
          , deployed and verified on BNB Chain testnet, and the whole cycle has been run on it.
          These are those four transactions.
        </p>
        <ProofList proofs={AUDIT_ESCROW_CYCLE} />
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
