import type { Metadata } from "next";
import { AgentCard } from "@/components/agent-card";
import { CategoryTabs } from "@/components/category-tabs";
import { DataProvenance } from "@/components/data-provenance";
import { RiskLegend } from "@/components/risk-legend";
import { ButtonLink, EmptyState, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { CATEGORY_META, isCategory } from "@/lib/agents";
import { source } from "@/lib/data";

export const metadata: Metadata = {
  title: "Agents",
  description:
    "Every agent listed on HelloFugu, what it has actually done, what it costs, and how much trouble the money it watches is in right now.",
};

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const sp = await searchParams;
  const raw = typeof sp.category === "string" ? sp.category : null;
  const category = isCategory(raw) ? raw : null;

  const src = source();
  const [page, cats] = await Promise.all([
    src.listAgents({ category, limit: 24, offset: 0 }),
    src.listCategories(),
  ]);
  const totalAll = cats.categories.reduce((sum, c) => sum + c.count, 0);
  const meta = category ? CATEGORY_META[category] : null;

  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="Agents"
          title="Hire an agent, then check its work yourself."
          lede="Every number on these pages links to its record on the blockchain. Where we have no record, the page says so instead of filling the gap: that failure is what closed Giza and ARMA in February 2026, and it is the one thing we refuse to repeat."
        />
        <div className="mt-8">
          <DataProvenance provenance={page.provenance} origin={src.origin} />
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
          {page.agents.length > 0 ? (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {page.agents.map((view) => (
                <li key={view.record.id} className="flex">
                  <AgentCard view={view} />
                </li>
              ))}
            </ul>
          ) : page.provenance.healthy ? (
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
                  <ButtonLink href={category ? `/agents?category=${category}` : "/agents"}>
                    Try again
                  </ButtonLink>
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
