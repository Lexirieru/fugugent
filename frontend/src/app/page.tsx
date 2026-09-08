import { AgentCard } from "@/components/agent-card";
import { CategoryTabs } from "@/components/category-tabs";
import { DataProvenance } from "@/components/data-provenance";
import { ProofList } from "@/components/proof";
import { RiskLegend } from "@/components/risk-legend";
import { ButtonLink, EmptyState, Eyebrow, Section } from "@/components/ui";
import { CATEGORY_META, isCategory } from "@/lib/agents";
import { source } from "@/lib/data";
import { MARKETPLACE_CYCLE } from "@/lib/data/sample";

export default async function MarketplacePage({ searchParams }: PageProps<"/">) {
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
    <>
      <Section className="pt-10 sm:pt-14">
        <Eyebrow>Agent marketplace</Eyebrow>
        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          Hire an agent, then check its work yourself.
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          Every number on these pages links to a transaction on BscScan. Where we have no proof,
          the page says so instead of filling the gap — that failure mode is what closed
          Giza/ARMA in February 2026, and it is the one thing we refuse to repeat.
        </p>

        <div className="mt-8">
          <DataProvenance provenance={page.provenance} origin={src.origin} />
        </div>

        <div className="mt-8">
          <CategoryTabs counts={cats.categories} active={category} total={totalAll} />
          {meta ? (
            <p className="mt-3 text-sm text-muted">
              {meta.blurb}{" "}
              <span className="text-faint">
                Risk here is measured as {meta.riskMetric} — not as APR, because APR is the wrong
                question for this category.
              </span>
            </p>
          ) : (
            <p className="mt-3 text-sm text-faint">
              Four categories, each judged by the risk metric that actually fits it.
            </p>
          )}
        </div>

        <div className="mt-8">
          {page.agents.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  ? `${meta.blurb} No agent in this category is listed on FuguRegistry today. The other categories have agents you can open right now.`
                  : "No agents matched. The other categories have agents you can open right now."
              }
              actions={
                <>
                  <ButtonLink href="/">Show all agents</ButtonLink>
                  <ButtonLink href="/agent/97%3A1" variant="ghost">
                    Open Fugu Guardian
                  </ButtonLink>
                </>
              }
            />
          ) : (
            <EmptyState
              title="We have nothing we can stand behind"
              body="The catalogue did not answer, so this list is empty on purpose. Showing a cached copy without saying so would be exactly the kind of unverifiable number this marketplace exists to stop."
              actions={
                <>
                  <ButtonLink href={category ? `/?category=${category}` : "/"}>
                    Try again
                  </ButtonLink>
                  <ButtonLink href="https://fugugent.xyz" variant="ghost" external>
                    What is actually shipped ↗
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Section>

      <Section className="pt-12">
        <RiskLegend />
      </Section>

      <Section className="pt-12">
        <h2 className="text-lg font-semibold tracking-tight text-fg">What happens when you hire</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          The full cycle — list, hire, the agent draws only the time it served, review gated by
          proof of payment — has been run on BNB Chain testnet. These are those transactions.
        </p>
        <div className="mt-5">
          <ProofList proofs={MARKETPLACE_CYCLE.map((p) => ({ ...p }))} />
        </div>
      </Section>
    </>
  );
}
