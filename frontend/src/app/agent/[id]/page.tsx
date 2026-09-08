import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { Fugu } from "@/components/fugu";
import { HirePanel } from "@/components/hire-panel";
import { HiredBadge } from "@/components/hired-badge";
import { ProofList } from "@/components/proof";
import { RiskChip } from "@/components/risk-chip";
import { Badge, ButtonLink, Card, EmptyState, Section } from "@/components/ui";
import { CATEGORY_META, categoryOf, fuguKindFor } from "@/lib/agents";
import { addressUrl, shorten, txUrl } from "@/lib/chain";
import { source } from "@/lib/data";
import type { AgentView } from "@/lib/data/types";
import { formatPeriod, formatPricePerPeriod } from "@/lib/money";
import { BLOAT, riskAriaLabel } from "@/lib/risk";

export async function generateMetadata({
  params,
}: PageProps<"/agent/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { agent } = await source().getAgent(decodeURIComponent(id));
  if (!agent) return { title: "Agent not found" };
  return {
    title: agent.record.name,
    description: agent.record.description.slice(0, 200),
    openGraph: {
      title: `${agent.record.name} — Fugugent`,
      description: agent.record.description.slice(0, 200),
    },
  };
}

export default async function AgentPage({ params }: PageProps<"/agent/[id]">) {
  const { id } = await params;
  const result = await source().getAgent(decodeURIComponent(id));

  if (!result.healthy) {
    return (
      <Section className="pt-12">
        <EmptyState
          title="We could not read this agent"
          body={`The catalogue replied: ${result.reason ?? "no reason given"}. We are not showing a cached copy dressed up as live data.`}
          actions={
            <>
              <ButtonLink href="/">Back to all agents</ButtonLink>
              <ButtonLink href={`/agent/${encodeURIComponent(id)}`} variant="ghost">
                Try again
              </ButtonLink>
            </>
          }
        />
      </Section>
    );
  }

  if (!result.agent) notFound();

  return <AgentDetail view={result.agent} />;
}

function AgentDetail({ view }: { view: AgentView }) {
  const { record, risk, session, proofs, outcomes, notShipped } = view;
  const kind = fuguKindFor(record);
  const category = categoryOf(record);
  const meta = category ? CATEGORY_META[category] : null;
  const listing = record.fuguListing;
  const spec = risk ? BLOAT[risk.level] : null;

  return (
    <>
      <Section className="pt-8">
        <Link href="/" className="text-sm text-muted transition hover:text-fg">
          ← All agents
        </Link>
      </Section>

      {/* Kepala halaman */}
      <Section className="pt-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="shrink-0">
            <Fugu
              kind={kind}
              level={risk?.level ?? null}
              seed={record.id}
              label={riskAriaLabel(record.name, risk)}
              className="h-28 w-28 sm:h-32 sm:w-32"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              {record.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {meta ? <Badge>{meta.label}</Badge> : <Badge tone="quiet">Uncategorised</Badge>}
              {listing?.curated ? <Badge tone="accent">Curated</Badge> : null}
              <RiskChip reading={risk} />
              <HiredBadge agentId={record.id} />
            </div>
            <p className="mt-4 max-w-3xl text-pretty text-base leading-relaxed text-muted">
              {record.description}
            </p>
            {record.tags.length > 0 ? (
              <p className="mt-3 flex flex-wrap gap-2">
                {record.tags.map((t) => (
                  <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-faint">
                    {t}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </div>
      </Section>

      {/* Batas klaim, dinyatakan lebih dulu daripada apa pun yang menyanjung. */}
      {notShipped ? (
        <Section className="pt-8">
          <div className="rounded-2xl border border-line bg-surface px-5 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              What this agent does not do yet
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg">{notShipped}</p>
          </div>
        </Section>
      ) : null}

      {/* Risiko */}
      <Section className="pt-8">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Risk right now</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card>
            {risk && spec ? (
              <>
                <p className="text-xs uppercase tracking-[0.14em] text-faint">
                  {risk.metricLabel}
                </p>
                <p className="mt-1 font-mono text-4xl tabular-nums text-fg">{risk.metricValue}</p>
                <p className="mt-3 text-sm font-medium text-fg">
                  Level {risk.level} of 5 — {spec.name}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{spec.meaning}</p>
                {risk.companion ? (
                  <p className="mt-3 text-sm leading-relaxed text-fg">{risk.companion}</p>
                ) : null}
                {risk.proofTxHash ? (
                  <a
                    href={txUrl(risk.proofTxHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-4 inline-block break-all font-mono text-xs text-accent underline decoration-accent/40 underline-offset-4"
                  >
                    {shorten(risk.proofTxHash, 14, 8)} ↗
                  </a>
                ) : (
                  <p className="mt-4 text-xs text-faint">
                    No transaction backs this reading — it is a chain read, not a state change.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-fg">No fresh reading.</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  The fish is drawn hollow rather than at a guessed level. Inferring a risk level
                  from stale numbers is the most expensive lie this product could tell, so we draw
                  the gap instead.
                </p>
              </>
            )}
          </Card>

          <Card>
            <p className="text-xs uppercase tracking-[0.14em] text-faint">
              How this category is measured
            </p>
            <p className="mt-2 text-sm leading-relaxed text-fg">
              {meta
                ? `${meta.label}: ${meta.riskMetric}.`
                : "This agent has no category, so there is no equivalent metric to compare it on."}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Each of the four categories gets the risk metric that fits it, rather than being
              forced onto a shared APR number that would mean four different things. The fish
              swells on that metric and on nothing else — never on popularity, never on funds
              under management, never on how many people hired it.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              Thresholds come from the same decision engine that runs the agent. This page never
              recomputes them, so the picture can never disagree with what the agent is doing.
            </p>
          </Card>
        </div>
      </Section>

      {/* Hasil berangka, past tense */}
      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">What it has actually done</h2>
        {outcomes.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {outcomes.map((o) => (
              <li
                key={o}
                className="rounded-xl border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-fg"
              >
                {o}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="Nothing to show — it has not run"
              body="This agent has no completed runs, so there is no history to display. Fugu Guardian has run on testnet and its transactions are open to read."
              actions={
                <>
                  <ButtonLink href="/agent/97%3A1">Open Fugu Guardian</ButtonLink>
                  <ButtonLink href="/" variant="ghost">
                    Back to all agents
                  </ButtonLink>
                </>
              }
            />
          </div>
        )}
      </Section>

      {/* Panel izin — ditampilkan ke calon pembeli SEBELUM hire. */}
      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          What this agent is allowed to do with money
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Read from the Altana Keystore on chain, not from anything we claim. The limits are
          enforced by the account contract, so a call outside this list fails before it is
          broadcast — no gas spent, nothing moved.
        </p>
        <div className="mt-4">
          {session ? (
            <Card>
              <ul className="space-y-2">
                {session.calls.map((c) => (
                  <li key={`${c.contract}-${c.signature}`} className="text-sm">
                    <span className="font-mono text-fg">
                      {c.contract}.{c.signature}
                    </span>
                    {c.address ? (
                      <a
                        href={addressUrl(c.address)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-2 font-mono text-xs text-accent/85"
                      >
                        {shorten(c.address, 8, 6)} ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              <dl className="mt-5 grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Spend cap</dt>
                  <dd className="mt-1 text-sm text-fg">{session.dailyCap}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Expires</dt>
                  <dd className="mt-1 text-sm text-fg">{session.expiry}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Wallet</dt>
                  <dd className="mt-1">
                    <a
                      href={addressUrl(session.wallet)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-xs text-accent/85"
                    >
                      {shorten(session.wallet)} ↗
                    </a>
                  </dd>
                </div>
              </dl>

              <div className="mt-5 rounded-xl border border-line bg-bg-elev">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                  <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
                    Check it yourself — one eth_call, no API key
                  </span>
                  <CopyButton text={session.verifyCommand} />
                </div>
                <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
                  {session.verifyCommand}
                </pre>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-faint">
                One thing this does not cover, said plainly: Altana permissions bind a contract and
                a function selector, not the argument values. A spend cap and the account
                contract&apos;s own behaviour are what keep an approve from being abused.
              </p>
            </Card>
          ) : (
            <Card>
              <p className="text-sm leading-relaxed text-fg">
                No session key is wired into this page for this agent.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                It is not hireable either, so nothing can spend on your behalf today. When it does
                get a session, this panel will list every call it may make before you can hire it —
                not after.
              </p>
            </Card>
          )}
        </div>
      </Section>

      {/* Bukti */}
      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">On-chain proof</h2>
        {proofs.length > 0 ? (
          <div className="mt-4">
            <ProofList proofs={proofs} />
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No transactions yet"
              body="This agent has never touched the chain, so there is nothing to link to. An empty list is the honest answer here."
              actions={
                <>
                  <ButtonLink href="/agent/97%3A1">See an agent that has</ButtonLink>
                  <ButtonLink href="/" variant="ghost">
                    Back to all agents
                  </ButtonLink>
                </>
              }
            />
          </div>
        )}
      </Section>

      {/* Hire */}
      <Section id="hire" className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Hire</h2>
        <div className="mt-4">
          {listing && listing.active ? (
            <>
              <p className="mb-4 text-sm text-muted">
                Listing #{listing.listingId.toString()} ·{" "}
                {formatPricePerPeriod(listing.priceUsd8PerPeriod, listing.periodSeconds)} · one
                period is {formatPeriod(listing.periodSeconds)}.
              </p>
              <HirePanel
                agentId={record.id}
                agentName={record.name}
                listingId={listing.listingId.toString()}
                priceUsd8={listing.priceUsd8PerPeriod.toString()}
                periodSeconds={listing.periodSeconds}
              />
            </>
          ) : (
            <EmptyState
              title="This agent cannot be hired"
              body="It is not listed on FuguRegistry, so there is no price and no escrow to pay into. We would rather leave the button out than ship one that takes your money and does nothing."
              actions={
                <>
                  <ButtonLink href="/agent/97%3A1">Hire Fugu Guardian instead</ButtonLink>
                  <ButtonLink href="/" variant="ghost">
                    Compare the four categories
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Section>

      {/* Review */}
      <Section className="pt-10">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Reviews</h2>
        <div className="mt-4">
          {record.reputation.totalFeedbacks > 0 ? (
            <Card>
              <p className="font-mono text-2xl tabular-nums text-fg">
                {record.reputation.averageScore ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted">
                from {record.reputation.totalFeedbacks} verified reviews
              </p>
            </Card>
          ) : (
            <EmptyState
              title="No verified reviews yet"
              body="Only a wallet that provably paid for this agent can review it, and the gate opens exactly when the agent gets paid. That makes reviews slow to appear and hard to fake — we think that trade is worth it."
              actions={
                listing?.active ? (
                  <>
                    <ButtonLink href="#hire">Hire it, then review it</ButtonLink>
                    <ButtonLink href="/" variant="ghost">
                      Back to all agents
                    </ButtonLink>
                  </>
                ) : (
                  <>
                    <ButtonLink href="/agent/97%3A1">Open an agent you can hire</ButtonLink>
                    <ButtonLink href="/" variant="ghost">
                      Back to all agents
                    </ButtonLink>
                  </>
                )
              }
            />
          )}
        </div>
      </Section>
    </>
  );
}
