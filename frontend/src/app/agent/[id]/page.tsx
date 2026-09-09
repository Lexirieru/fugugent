import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionToken, SpendMarker } from "@/components/action-token";
import { DataProvenance } from "@/components/data-provenance";
import { Fugu } from "@/components/fugu";
import { HirePanel } from "@/components/hire-panel";
import { HiredBadge } from "@/components/hired-badge";
import { ProofList } from "@/components/proof";
import { RiskChip } from "@/components/risk-chip";
import { Badge, ButtonLink, Card, EmptyState, Page, Section, SectionHeader } from "@/components/ui";
import { ListAgent } from "@/components/wallet/list-agent";
import { PermissionCheck } from "@/components/wallet/permission-check";
import { CATEGORY_META, categoryOf, fuguKindFor, guardianHref } from "@/lib/agents";
import { addressUrl, shorten, txUrl } from "@/lib/chain";
import { source } from "@/lib/data";
import type { AgentView } from "@/lib/data/types";
import { formatPeriod, formatPricePerPeriod } from "@/lib/money";
import { SOURCE_LABEL, formatUtc, type Provenance } from "@/lib/provenance";
import { BLOAT, guardianActionFor, riskAriaLabel } from "@/lib/risk";

export async function generateMetadata({ params }: PageProps<"/agent/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { agent } = await source().getAgent(decodeURIComponent(id));
  if (!agent) return { title: "Agent not found" };
  return {
    title: agent.record.name,
    description: agent.record.description.slice(0, 200),
    openGraph: {
      title: `${agent.record.name} · HelloFugu`,
      description: agent.record.description.slice(0, 200),
    },
  };
}

export default async function AgentPage({ params }: PageProps<"/agent/[id]">) {
  const { id } = await params;
  const src = source();
  const result = await src.getAgent(decodeURIComponent(id));

  if (!result.provenance.healthy) {
    return (
      <Page>
        <Section>
          <EmptyState
            title="We could not read this agent"
            body={`The catalogue replied: ${result.provenance.reason ?? "no reason given"}. We are not showing a cached copy dressed up as live data.`}
            actions={
              <>
                <ButtonLink href="/agents">Back to all agents</ButtonLink>
                <ButtonLink href={`/agent/${encodeURIComponent(id)}`} variant="ghost">
                  Try again
                </ButtonLink>
              </>
            }
          />
        </Section>
      </Page>
    );
  }

  if (!result.agent) notFound();

  return (
    <AgentDetail
      view={result.agent}
      provenance={result.provenance}
      origin={src.origin}
      ourAgentHref={guardianHref(src.kind)}
    />
  );
}

function AgentDetail({
  view,
  provenance,
  origin,
  ourAgentHref,
}: {
  view: AgentView;
  provenance: Provenance;
  origin: string;
  /** Fugu Guardian, addressed by the id of whichever catalogue answered. */
  ourAgentHref: string;
}) {
  const { record, risk, session, proofs, outcomes, notShipped } = view;
  const kind = fuguKindFor(record);
  const category = categoryOf(record);
  const meta = category ? CATEGORY_META[category] : null;
  const listing = record.fuguListing;
  const spec = risk ? BLOAT[risk.level] : null;
  // The action band is Guardian's ladder. Showing it for another kind would put a
  // transaction name next to an agent that cannot send it. See `lib/risk.ts`.
  const action = risk && category === "HEALTH_FACTOR" ? guardianActionFor(risk.level) : null;
  // A record's own provenance can differ from the envelope's: one page may be served
  // from the cache while its contents came from 8004scan, or the other way round.
  // The relative age is already in the banner, computed by the backend. This one names
  // the time.
  const recordFetchedAt = formatUtc(record.fetchedAt);

  return (
    <Page>
      <Section>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg"
        >
          ← All agents
        </Link>
        <div className="mt-6">
          <DataProvenance provenance={provenance} origin={origin} />
        </div>

        {/* Page head */}
        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          <Fugu
            kind={kind}
            level={risk?.level ?? null}
            seed={record.id}
            label={riskAriaLabel(record.name, risk)}
            className="size-28 shrink-0 sm:size-32"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-balance text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
              {record.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {meta ? <Badge>{meta.label}</Badge> : <Badge tone="quiet">No kind set</Badge>}
              {listing?.curated ? <Badge tone="accent">Curated</Badge> : null}
              <RiskChip reading={risk} />
              <HiredBadge
                agentId={record.id}
                listingId={listing?.active ? listing.listingId.toString() : null}
              />
            </div>
            <p className="mt-4 max-w-3xl text-pretty text-base leading-relaxed text-muted">
              {record.description}
            </p>
            {record.tags.length > 0 ? (
              <p className="mt-4 flex flex-wrap gap-2">
                {record.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-faint"
                  >
                    {t}
                  </span>
                ))}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-faint">
              This record came from {SOURCE_LABEL[record.source]}
              {recordFetchedAt ? `, read ${recordFetchedAt}` : ""} · key{" "}
              <span className="font-mono">{record.id}</span>
            </p>
          </div>
        </div>
      </Section>

      {/* The limits of the claim, stated before anything that flatters. */}
      {notShipped ? (
        <Section>
          <div className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-faint">
              What this agent does not do yet
            </h2>
            <p className="mt-3 max-w-3xl text-pretty text-sm leading-relaxed text-fg">
              {notShipped}
            </p>
          </div>
        </Section>
      ) : null}

      {/* Risk. Two questions, two separately headed cards. See `components/risk-legend.tsx`
          for why they must never be read as one list. */}
      <Section labelledBy="risk">
        <SectionHeader id="risk" title="Risk right now" />
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Question 1: the state of the money. Prose name, pill, beside the fugu above. */}
          <Card className="flex flex-col">
            <p className="text-xs uppercase tracking-[0.14em] text-faint">
              Risk state, or how puffed the fish is
            </p>
            {risk && spec ? (
              <>
                <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-faint">
                  {risk.metricLabel}
                </p>
                <p className="mt-1 font-mono text-4xl tabular-nums text-fg">{risk.metricValue}</p>
                <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span
                    className="rounded-full border px-2.5 py-0.5 text-sm font-medium text-fg"
                    style={{ borderColor: spec.color }}
                  >
                    {spec.name}
                  </span>
                  <span>level {risk.level} of 5</span>
                </p>
                <p className="mt-4 text-pretty text-sm leading-relaxed text-muted">{spec.state}</p>
                {risk.companion ? (
                  <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
                    {risk.companion}
                  </p>
                ) : null}
                <div className="grow" />
                {risk.proofTxHash ? (
                  <a
                    href={txUrl(risk.proofTxHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-6 inline-block break-all font-mono text-xs text-accent-strong underline decoration-accent/40 underline-offset-4"
                  >
                    {shorten(risk.proofTxHash, 14, 8)} ↗
                  </a>
                ) : (
                  <p className="mt-6 text-xs text-faint">
                    No transaction backs this reading. It is a read of the blockchain, not a change
                    to it.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-4 text-sm font-medium text-fg">No fresh reading.</p>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
                  The fish is drawn hollow rather than at a guessed level. Working out a risk level
                  from stale numbers is the most expensive lie this product could tell, so we draw
                  the gap instead.
                </p>
              </>
            )}
          </Card>

          {/* Question 2: what the agent does. Code token, square box, no fugu.
              The square box and the monospace face are load-bearing: this string is
              the name the decision code branches on, and it must never be mistaken
              for the risk name beside it, which is a word we chose. */}
          <Card className="flex flex-col">
            <p className="text-xs uppercase tracking-[0.14em] text-faint">
              What the agent does about it
            </p>
            {action ? (
              <>
                <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-faint">
                  Action at this level
                </p>
                <p className="mt-2">
                  <ActionToken spec={action} />
                </p>
                <p className="mt-4 text-pretty text-sm leading-relaxed text-muted">{action.does}</p>
                <p className="mt-3">
                  <SpendMarker spends={action.spendsMoney} />
                </p>
                <div className="grow" />
                <p className="mt-6 text-xs leading-relaxed text-faint">
                  Taken from the agent&apos;s code, not written for this page.
                </p>
              </>
            ) : (
              <>
                <p className="mt-4 text-pretty text-sm leading-relaxed text-fg">
                  No action ladder is written for this kind of agent.
                </p>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
                  The risk scale on the left is measured and real. What this agent would <em>do</em>{" "}
                  at each level is not written yet, and we are not filling the gap with another
                  agent&apos;s ladder.
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="mt-6">
          <Card>
            <p className="text-xs uppercase tracking-[0.14em] text-faint">
              How this kind of agent is measured
            </p>
            <p className="mt-3 max-w-3xl text-pretty text-sm leading-relaxed text-fg">
              {meta
                ? `${meta.label}: ${meta.riskMetric}.`
                : "This agent has no kind set, so there is no matching number to compare it on."}
            </p>
            <p className="mt-3 max-w-3xl text-pretty text-sm leading-relaxed text-muted">
              Each kind is judged on the number that fits it. The fish swells on that number and
              nothing else: not on popularity, not on how much money it handles, not on how many
              people hired it.
            </p>
            <p className="mt-3 max-w-3xl text-xs leading-relaxed text-faint">
              The thresholds are read from the agent&apos;s own code, so this page cannot disagree
              with what the agent does.
            </p>
          </Card>
        </div>
      </Section>

      {/* Outcomes with numbers in them, past tense */}
      <Section labelledBy="done">
        <SectionHeader id="done" title="What it has actually done" />
        {outcomes.length > 0 ? (
          <ul className="space-y-3">
            {outcomes.map((o) => (
              <li
                key={o}
                className="rounded-xl border border-line bg-surface px-4 py-3 text-pretty text-sm leading-relaxed text-fg"
              >
                {o}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nothing to show, because it has not run"
            body="This agent has no completed runs, so there is no history to display. Fugu Guardian has run on the test network and its transactions are open to read."
            actions={
              <>
                <ButtonLink href={ourAgentHref}>Open Fugu Guardian</ButtonLink>
                <ButtonLink href="/agents" variant="ghost">
                  Back to all agents
                </ButtonLink>
              </>
            }
          />
        )}
      </Section>

      {/* The permissions panel, shown to a prospective buyer BEFORE hiring. */}
      <Section labelledBy="permissions">
        <SectionHeader
          id="permissions"
          title="What this agent is allowed to do with money"
          lede="Read from the Altana keystore contract, not from anything we claim. The limits are enforced by the account contract, so a call outside this list fails before it is sent: no fee spent, nothing moved."
        />
        {session ? (
          <Card>
            <h3 className="text-xs uppercase tracking-[0.14em] text-faint">
              The only calls it may make
            </h3>
            <ul className="mt-3 space-y-2">
              {session.calls.map((c) => (
                <li
                  key={`${c.contract}-${c.signature}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
                >
                  <span className="min-w-0 break-all font-mono text-fg">
                    {c.contract}.{c.signature}
                  </span>
                  {c.address ? (
                    <a
                      href={addressUrl(c.address)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="break-all font-mono text-xs text-accent-strong"
                    >
                      {shorten(c.address, 8, 6)} ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>

            <dl className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">
                  Most it may spend in a day
                </dt>
                <dd className="mt-1 text-sm text-fg">{session.dailyCap}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">
                  Permission runs out
                </dt>
                <dd className="mt-1 text-sm text-fg">{session.expiry}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Wallet</dt>
                <dd className="mt-1">
                  <a
                    href={addressUrl(session.wallet)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-xs text-accent-strong"
                  >
                    {shorten(session.wallet)} ↗
                  </a>
                </dd>
              </div>
            </dl>

            <PermissionCheck
              keystore={session.keystore}
              wallet={session.wallet}
              keyHash={session.keyHash}
            />

            <p className="mt-4 max-w-3xl text-xs leading-relaxed text-faint">
              One thing this does not cover, said plainly. The permission binds a contract and the
              name of a function, not the values passed to it. What keeps a spending approval from
              being abused is the daily limit and the account contract&apos;s own behaviour.
            </p>
          </Card>
        ) : (
          /*
           * Two very different things used to share this one sentence: "we do not read
           * this here" and "this agent has no permission". They are not the same claim,
           * and saying the second when the first is true is a lie in our own favour's
           * opposite direction, which is still a lie. Guardian's page said no permission
           * was wired directly underneath a paragraph describing the permission it signed
           * with.
           */
          <Card>
            <p className="text-pretty text-sm leading-relaxed text-fg">
              This page does not read this agent&apos;s permissions from the chain yet.
            </p>
            <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
              That is a gap in this page, not a statement about the agent. It may hold a
              limited key already, or none at all, and we are not going to guess which from
              here. When this panel reads them, it will list every call the agent may make
              before you can hire it, not after.
            </p>
          </Card>
        )}
      </Section>

      {/* Proof */}
      <Section labelledBy="proof">
        <SectionHeader
          id="proof"
          title="Recorded on the blockchain"
          lede="Every row here either opens a transaction on the explorer or says openly why there is none."
        />
        {proofs.length > 0 ? (
          <ProofList proofs={proofs} />
        ) : (
          <EmptyState
            title="No transactions listed here"
            /*
             * "This agent has never touched the blockchain" was an assertion about the
             * agent that this page has no way to make. All it knows is that nobody put a
             * transaction in this list. Guardian's own page carried that sentence while
             * quoting its on-chain repay two sections above.
             */
            body="Nobody has attached a transaction to this list. That is not the same as the agent never having sent one, and this page will not pretend to know the difference."
            actions={
              <>
                <ButtonLink href={ourAgentHref}>See an agent that has</ButtonLink>
                <ButtonLink href="/agents" variant="ghost">
                  Back to all agents
                </ButtonLink>
              </>
            }
          />
        )}
      </Section>

      {/* Hire */}
      <Section id="hire" labelledBy="hire-heading">
        <SectionHeader
          id="hire-heading"
          title="Hire"
          lede={
            listing && listing.active
              ? `Listing number ${listing.listingId.toString()}. ${formatPricePerPeriod(listing.priceUsd8PerPeriod, listing.periodSeconds)}, and one period is ${formatPeriod(listing.periodSeconds)}.`
              : "Nobody has put a price on this agent, so there is nothing to pay yet. Its owner can change that from this page."
          }
        />
        {listing && listing.active ? (
          <HirePanel
            agentId={record.id}
            agentName={record.name}
            listingId={listing.listingId.toString()}
            priceUsd8={listing.priceUsd8PerPeriod.toString()}
            periodSeconds={listing.periodSeconds}
            notShipped={notShipped}
          />
        ) : (
          /* Not "this agent cannot be hired", which was a dead end for 103 of the 112
             agents in the catalogue. It cannot be hired *yet*, the person who can change
             that is named, and if that person is the one reading, the form is right here. */
          <ListAgent
            agentName={record.name}
            agentDescription={record.description}
            tokenId={record.tokenId}
            ownerAddress={record.ownerAddress}
            agentWallet={record.agentWallet}
            classifiedCategory={category}
            classifierConfidence={record.classification?.confidence ?? null}
            classifierReason={record.classification?.reason ?? null}
            endpointVerified={record.isEndpointVerified}
            catalogueSource={record.source}
          />
        )}
      </Section>

      {/* Reviews */}
      <Section labelledBy="reviews">
        <SectionHeader id="reviews" title="Reviews" />
        {record.reputation.totalFeedbacks > 0 ? (
          <Card>
            <p className="font-mono text-2xl tabular-nums text-fg">
              {record.reputation.averageScore ?? "not read"}
            </p>
            <p className="mt-1 text-sm text-muted">
              from {record.reputation.totalFeedbacks} verified reviews
            </p>
          </Card>
        ) : (
          <EmptyState
            title="No verified reviews yet"
            body="Only a wallet that provably paid for this agent can review it, and that gate opens exactly when the agent gets paid. It makes reviews slow to appear and hard to fake, and we think that trade is worth it."
            actions={
              listing?.active ? (
                <>
                  <ButtonLink href="#hire">Hire it, then review it</ButtonLink>
                  <ButtonLink href="/agents" variant="ghost">
                    Back to all agents
                  </ButtonLink>
                </>
              ) : (
                <>
                  <ButtonLink href={ourAgentHref}>Open an agent you can hire</ButtonLink>
                  <ButtonLink href="/agents" variant="ghost">
                    Back to all agents
                  </ButtonLink>
                </>
              )
            }
          />
        )}
      </Section>
    </Page>
  );
}
