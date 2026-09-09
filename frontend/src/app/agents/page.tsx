import type { Metadata } from "next";
import Link from "next/link";
import { AgentCard } from "@/components/agent-card";
import { CategoryTabs } from "@/components/category-tabs";
import { DataProvenance } from "@/components/data-provenance";
import { Pagination, pageFromParam } from "@/components/pagination";
import { RiskLegend } from "@/components/risk-legend";
import { ButtonLink, EmptyState, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { CATEGORY_META, isCategory } from "@/lib/agents";
import type { Category } from "@/lib/agent-types";
import { source } from "@/lib/data";
import type { AgentView, MarketplaceSource } from "@/lib/data/types";
import type { Provenance } from "@/lib/provenance";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "Every agent listed on HelloFugu, what it has actually done, what it costs, and how much trouble the money it watches is in right now.",
};

const PAGE_SIZE = 24;
/** The backend caps `limit` at 100, and this is what a whole-catalogue scan asks for. */
const SCAN_SIZE = 100;
/** At most this many requests per scan, so a catalogue that grows cannot hang a page. */
const SCAN_REQUESTS = 4;

interface ListedScan {
  agents: AgentView[];
  /** How many records the scan actually looked at, after removing duplicates. */
  scanned: number;
  /** True only when a request came back empty, which is the catalogue saying it ended. */
  complete: boolean;
  healthy: boolean;
  /** The first request's provenance, so this view says where its data came from too. */
  provenance: Provenance | null;
}

/**
 * Every agent that carries a price, found by walking the catalogue rather than by
 * asking a question the backend cannot answer.
 *
 * `GET /api/agents` has no "only the listed ones" filter, so the choice was to slice a
 * single page in the browser and call it a filter, or to walk the catalogue and be able
 * to say what was walked. This walks it: up to four requests of 100, stopping the
 * moment a request comes back empty, and de-duplicating by id because first-party
 * listings are merged into every window and can appear twice.
 *
 * `complete` is the honest part. It is true only when the catalogue itself said it had
 * run out. If the scan hits its request cap first, the page says the count is of what
 * was scanned rather than of everything.
 */
async function scanListed(src: MarketplaceSource, category: Category | null): Promise<ListedScan> {
  const seen = new Set<string>();
  const agents: AgentView[] = [];
  let scanned = 0;
  let complete = false;
  let provenance: Provenance | null = null;

  for (let i = 0; i < SCAN_REQUESTS; i += 1) {
    const page = await src.listAgents({ category, limit: SCAN_SIZE, offset: i * SCAN_SIZE });
    provenance ??= page.provenance;
    if (!page.provenance.healthy) {
      return { agents, scanned, complete: false, healthy: false, provenance };
    }
    if (page.agents.length === 0) {
      complete = true;
      break;
    }
    for (const view of page.agents) {
      if (seen.has(view.record.id)) continue;
      seen.add(view.record.id);
      scanned += 1;
      if (view.record.fuguListing?.active) agents.push(view);
    }
  }

  return { agents, scanned, complete, healthy: true, provenance };
}

/**
 * Why the next page is read before it is offered, in the default view.
 *
 * The catalogue reports the agents it can genuinely account for, not an upstream
 * count, and that number moves as you page. Worse for a pager: a category can return
 * 20 agents on a page of 24 and still have 2 more waiting at the next offset, so
 * neither "the page came back full" nor "offset plus shown is under the total" tells
 * the truth about whether Next exists.
 *
 * So the page is read. One extra request for a single row at the next offset, and
 * Next appears only if that row came back. A pager that offers a page it has not seen
 * is the same lie as a dashboard printing a number nobody can check.
 *
 * The "ready to hire" view does not need any of that, because it holds the whole
 * filtered set and its total is a number it counted itself.
 */
export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const sp = await searchParams;
  const raw = typeof sp.category === "string" ? sp.category : null;
  const category = isCategory(raw) ? raw : null;
  const onlyListed = sp.available === "yes";
  const page = pageFromParam(sp.page);
  const offset = (page - 1) * PAGE_SIZE;

  const src = source();

  const hrefFor = (patch: { category?: Category | null; available?: boolean; page?: number }) => {
    const nextCategory = patch.category === undefined ? category : patch.category;
    const nextAvailable = patch.available === undefined ? onlyListed : patch.available;
    const nextPage = patch.page ?? 1;
    const params = new URLSearchParams();
    if (nextCategory) params.set("category", nextCategory);
    if (nextAvailable) params.set("available", "yes");
    if (nextPage > 1) params.set("page", String(nextPage));
    const text = params.toString();
    return text === "" ? "/agents" : `/agents?${text}`;
  };

  const [cats, listed, windowed, lookahead] = await Promise.all([
    src.listCategories(),
    onlyListed ? scanListed(src, category) : Promise.resolve(null),
    onlyListed ? Promise.resolve(null) : src.listAgents({ category, limit: PAGE_SIZE, offset }),
    onlyListed
      ? Promise.resolve(null)
      : src.listAgents({ category, limit: 1, offset: offset + PAGE_SIZE }),
  ]);

  const totalAll = cats.categories.reduce((sum, c) => sum + c.count, 0);
  const meta = category ? CATEGORY_META[category] : null;

  // The default view keeps the catalogue's order but floats the agents that already
  // carry a price to the top of the page being shown. That is a true statement about
  // one page, and the line under the grid says exactly that rather than implying the
  // whole catalogue is sorted.
  const shown: AgentView[] = listed
    ? listed.agents.slice(offset, offset + PAGE_SIZE)
    : [...(windowed?.agents ?? [])].sort(
        (a, b) =>
          Number(Boolean(b.record.fuguListing?.active)) -
          Number(Boolean(a.record.fuguListing?.active)),
      );

  const provenance = (listed ? listed.provenance : windowed?.provenance) ?? null;
  const healthy = listed ? listed.healthy : (windowed?.provenance.healthy ?? false);
  const hasNext = listed
    ? offset + shown.length < listed.agents.length
    : Boolean(lookahead?.provenance.healthy) && (lookahead?.agents.length ?? 0) > 0;

  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="Agents"
          title="Hire an agent, then check its work yourself."
          lede="Every number here links to its record on the blockchain, and where there is no record this page says so instead of filling the gap."
        />
        {provenance ? (
          <div className="mt-8">
            <DataProvenance provenance={provenance} origin={src.origin} />
          </div>
        ) : null}
      </Section>

      <Section labelledBy="catalogue">
        <SectionHeader
          id="catalogue"
          title={meta ? `${meta.label} agents` : "Every agent"}
          lede={
            meta
              ? `${meta.blurb} Risk here is measured as ${meta.riskMetric}, because an interest rate is the wrong question for this kind.`
              : "Nine kinds of agent, each judged by the one number that fits it. Most of them carry no price yet, and the filter below is how you see only the ones that do."
          }
        />

        <CategoryTabs
          counts={cats.categories}
          active={category}
          total={totalAll}
          hrefFor={(c) => hrefFor({ category: c })}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            href={hrefFor({ available: !onlyListed })}
            aria-current={onlyListed ? "true" : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${
              onlyListed
                ? "border-accent/50 bg-accent-soft font-semibold text-accent-strong"
                : "border-line text-muted hover:border-line-strong hover:text-fg"
            }`}
          >
            {onlyListed ? (
              <span aria-hidden className="inline-block size-1.5 rounded-full bg-accent" />
            ) : null}
            Ready to hire
            {listed ? (
              <span className="font-mono text-[11px] tabular-nums opacity-70">
                {listed.agents.length}
              </span>
            ) : null}
          </Link>
          <p className="text-pretty text-xs leading-relaxed text-faint">
            {onlyListed
              ? listed?.complete
                ? `Every agent here carries a price and can be paid today. ${listed.agents.length} of the ${listed.scanned} in the catalogue.`
                : `${listed?.agents.length ?? 0} found in the first ${listed?.scanned ?? 0} agents. The scan stopped before the end of the catalogue, so there may be more.`
              : "Most agents in this catalogue have no price on them yet. On each page, the ones that do are shown first."}
          </p>
        </div>

        <div className="mt-8">
          {shown.length > 0 ? (
            <>
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((view) => (
                  <li key={view.record.id} className="flex">
                    <AgentCard view={view} />
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                offset={offset}
                shown={shown.length}
                hasNext={hasNext}
                total={listed?.complete ? listed.agents.length : null}
                hrefForPage={(n) => hrefFor({ page: n })}
                unit="agent"
                note={
                  listed
                    ? undefined
                    : "No total is printed here. The catalogue counts only the agents it can actually serve, and that number moves as you page, so a total would promise pages that may not exist. Next appears only after the next page has been read and found to hold something."
                }
              />
            </>
          ) : page > 1 ? (
            <EmptyState
              title="There is nothing on this page"
              body="The catalogue answered and this page of it is empty. That usually means the list is shorter than the page number in the address, so the first page is where the agents are."
              actions={
                <>
                  <ButtonLink href={hrefFor({ page: 1 })}>Back to the first page</ButtonLink>
                  <ButtonLink href={hrefFor({ page: page - 1 })} variant="ghost">
                    ← The page before this one
                  </ButtonLink>
                </>
              }
            />
          ) : healthy && onlyListed ? (
            <EmptyState
              title={`Nothing in ${meta ? meta.label : "the catalogue"} carries a price yet`}
              body="An agent can be hired only once its own owner has put a price on it, and none of these has. Every agent still has a page, and each one names the wallet that can change that."
              actions={
                <>
                  <ButtonLink href={hrefFor({ available: false })}>
                    Show every agent instead
                  </ButtonLink>
                  <ButtonLink href={hrefFor({ category: null, available: true })} variant="ghost">
                    Ready to hire, any kind
                  </ButtonLink>
                </>
              }
            />
          ) : healthy ? (
            <EmptyState
              title={`Nothing in ${meta ? meta.label : "this filter"} yet`}
              body={
                meta
                  ? `${meta.blurb} No agent of this kind is listed today. The other kinds have agents you can open right now.`
                  : "No agent matched. The other kinds have agents you can open right now."
              }
              actions={
                <>
                  <ButtonLink href="/agents">Show every agent</ButtonLink>
                  <ButtonLink href="/agents?category=HEALTH_FACTOR" variant="ghost">
                    Show the Health factor agents
                  </ButtonLink>
                </>
              }
            />
          ) : (
            <EmptyState
              title="We have nothing we can stand behind"
              body="The catalogue did not answer, so this list is empty on purpose. Showing a cached copy without saying so would be exactly the kind of uncheckable number this marketplace exists to stop."
              actions={
                <>
                  <ButtonLink href={hrefFor({ page })}>Try again</ButtonLink>
                  <ButtonLink href="/" variant="ghost">
                    Back to the start page
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Section>

      <Section labelledBy="how-to-read">
        <SectionHeader
          id="how-to-read"
          title="How to read the fish"
          lede="Two questions with two different answers, kept visibly apart so that answering one is never mistaken for answering both."
        />
        <RiskLegend />
      </Section>
    </Page>
  );
}
