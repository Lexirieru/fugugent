import type { Metadata } from "next";
import { AgentCard } from "@/components/agent-card";
import { CategoryTabs } from "@/components/category-tabs";
import { DataProvenance } from "@/components/data-provenance";
import { Pagination, pageFromParam } from "@/components/pagination";
import { RiskLegend } from "@/components/risk-legend";
import { ButtonLink, EmptyState, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { CATEGORY_META, isCategory } from "@/lib/agents";
import { source } from "@/lib/data";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "Every agent listed on HelloFugu, what it has actually done, what it costs, and how much trouble the money it watches is in right now.",
};

const PAGE_SIZE = 24;

/**
 * Why the next page is read before it is offered.
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
 */
export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const sp = await searchParams;
  const raw = typeof sp.category === "string" ? sp.category : null;
  const category = isCategory(raw) ? raw : null;
  const page = pageFromParam(sp.page);
  const offset = (page - 1) * PAGE_SIZE;

  const src = source();
  const [result, cats, lookahead] = await Promise.all([
    src.listAgents({ category, limit: PAGE_SIZE, offset }),
    src.listCategories(),
    src.listAgents({ category, limit: 1, offset: offset + PAGE_SIZE }),
  ]);
  const totalAll = cats.categories.reduce((sum, c) => sum + c.count, 0);
  const meta = category ? CATEGORY_META[category] : null;
  const hasNext = lookahead.provenance.healthy && lookahead.agents.length > 0;

  const hrefFor = (n: number) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (n > 1) params.set("page", String(n));
    const text = params.toString();
    return text === "" ? "/agents" : `/agents?${text}`;
  };

  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="Agents"
          title="Hire an agent, then check its work yourself."
          lede="Every number on these pages links to its record on the blockchain. Where we have no record, the page says so instead of filling the gap: that failure is what closed Giza and ARMA in February 2026, and it is the one thing we refuse to repeat."
        />
        <div className="mt-8">
          <DataProvenance provenance={result.provenance} origin={src.origin} />
        </div>
      </Section>

      <Section labelledBy="catalogue">
        <SectionHeader
          id="catalogue"
          title={meta ? `${meta.label} agents` : "Every agent"}
          lede={
            meta
              ? `${meta.blurb} Risk here is measured as ${meta.riskMetric}, because an interest rate is the wrong question for this kind.`
              : "Nine kinds of agent, each judged by the one number that fits it. A kind with nothing in it still shows, with its count at zero."
          }
        />

        <CategoryTabs counts={cats.categories} active={category} total={totalAll} />

        <div className="mt-8">
          {result.agents.length > 0 ? (
            <>
              <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {result.agents.map((view) => (
                  <li key={view.record.id} className="flex">
                    <AgentCard view={view} />
                  </li>
                ))}
              </ul>
              <Pagination
                page={page}
                offset={offset}
                shown={result.agents.length}
                hasNext={hasNext}
                hrefForPage={hrefFor}
                unit="agent"
                note="No total is printed here. The catalogue counts only the agents it can actually serve, and that number moves as you page, so a total would promise pages that may not exist. Next appears only after the next page has been read and found to hold something."
              />
            </>
          ) : page > 1 ? (
            <EmptyState
              title="There is nothing on this page"
              body="The catalogue answered and this page of it is empty. That usually means the list is shorter than the page number in the address, so the first page is where the agents are."
              actions={
                <>
                  <ButtonLink href={hrefFor(1)}>Back to the first page</ButtonLink>
                  <ButtonLink href={hrefFor(page - 1)} variant="ghost">
                    ← The page before this one
                  </ButtonLink>
                </>
              }
            />
          ) : result.provenance.healthy ? (
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
                  <ButtonLink href="/agent/97%3A1" variant="ghost">
                    Open Fugu Guardian
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
                  <ButtonLink href={hrefFor(page)}>Try again</ButtonLink>
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
