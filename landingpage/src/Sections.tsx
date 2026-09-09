import type { ReactNode } from "react";
import {
  AGENTS,
  AGENT_WALLET,
  AGENT_WALLET_URL,
  ALLOWLIST,
  ALLOWLIST_CAP,
  CONTRACTS,
  HF_AFTER,
  HF_BEFORE,
  NEXT_BUILDS,
  RECORDS,
  RENTABLE,
  RENTAL_AMOUNT,
  RENTAL_SUB_ID,
  REPAY_COST,
  REPAY_TX_URL,
  REPO_URL,
  TEST_COUNTS,
  TEST_TOTAL,
  UPGRADE_TX_URL,
  VERIFIED_CONTRACTS,
} from "./content";
import { BlurIn, StaggerItem, StaggerRow } from "./motion";

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="out" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/* ── The four agents that have code behind them ─────────────────── */

export function AgentsSection() {
  return (
    <section className="section agents" aria-labelledby="agents-title">
      <BlurIn className="section-inner">
        <p className="eyebrow">four agents, four honest labels</p>
        <h2 className="section-title" id="agents-title">
          Four agents. One of them can act.
        </h2>
        <p className="section-lede">
          All four are listed on chain and can be rented. Only one has ever moved
          money. The label on each card is the difference, and it is the difference
          that decides whether you feel cheated after paying.
        </p>
      </BlurIn>

      {/* Card heights are deliberately uneven and the row is bottom-aligned, so the
          tops step up and down instead of drawing one flat line. */}
      <StaggerRow className="agent-row section-inner">
        {AGENTS.map((agent) => (
          <StaggerItem
            key={agent.name}
            className={agent.tall ? "agent-card agent-card-tall" : "agent-card"}
          >
            <img className="agent-art" src={agent.art} alt="" loading="lazy" decoding="async" />
            <span className={`chip chip-${agent.status}`}>{agent.statusLabel}</span>
            <h3 className="agent-name">{agent.name}</h3>
            <p className="agent-category">{agent.category}</p>
            <p className="agent-does">{agent.does}</p>
            <p className="agent-detail">{agent.detail}</p>
          </StaggerItem>
        ))}
      </StaggerRow>
    </section>
  );
}

/* ── The record ───────────────────────────────────────────────────
 *
 * This is where a page like this would carry testimonials. There are none, and
 * there will not be any invented ones: nobody has said anything about this
 * product, and one fabricated quote would destroy the only argument the page
 * makes. So the shape stays and the content is things that happened, each with
 * a link to the public record.
 *
 * The second row has no link, and says why in its own words. That is the row
 * that proves the rest are real.
 */
export function RecordSection() {
  return (
    <section className="section records" aria-labelledby="records-title">
      <BlurIn className="section-inner">
        <p className="eyebrow">no testimonials, no stars</p>
        <h2 className="section-title" id="records-title">
          Nobody has said anything about us yet.
        </h2>
        <p className="section-lede">
          So here is the record instead. Five things that happened on the test
          network, four of which open on a block explorer, and one that cannot,
          for a reason worth reading.
        </p>
      </BlurIn>

      <StaggerRow className="record-row section-inner">
        {RECORDS.map((record) => (
          <StaggerItem className="record-card" key={record.who + record.kind}>
            <svg className="record-quote" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
            </svg>
            <p className="record-fact">{record.fact}</p>
            {record.url ? (
              <p className="record-link">
                <Out href={record.url}>Open it on BscScan</Out>
              </p>
            ) : (
              <p className="record-nolink">{record.noLinkReason}</p>
            )}
            <div className="record-author">
              <img className="record-avatar" src={record.art} alt="" loading="lazy" decoding="async" />
              <div>
                <span className="record-who">{record.who}</span>
                <span className="record-kind">
                  <span aria-hidden="true">&#8627;</span> {record.kind}
                </span>
              </div>
            </div>
          </StaggerItem>
        ))}
      </StaggerRow>
    </section>
  );
}

/* ── What comes next ──────────────────────────────────────────────── */

export function NextSection() {
  return (
    <section className="section next" aria-labelledby="next-title">
      <BlurIn className="section-inner">
        <p className="eyebrow">none of this is built</p>
        <h2 className="section-title" id="next-title">
          What comes next.
        </h2>
        <p className="section-lede">
          The five below do not exist. They are the next things to build, written
          down here so the plan is as checkable as the parts that already work. Each
          one lists the wallet feature it would be built on.
        </p>
      </BlurIn>

      <StaggerRow className="next-row section-inner">
        {NEXT_BUILDS.map((build) => (
          <StaggerItem className="next-card" key={build.title}>
            <span className="chip chip-planned">Not built yet</span>
            <h3 className="next-name">{build.title}</h3>
            <p className="next-does">{build.does}</p>
            <p className="next-piece">
              <span className="next-piece-label">Altana piece</span>
              {build.piece}
            </p>
          </StaggerItem>
        ))}
      </StaggerRow>
    </section>
  );
}

/* ── Proof ────────────────────────────────────────────────────────── */

export function ProofSection() {
  return (
    <section className="section proof" aria-labelledby="proof-title">
      <BlurIn className="section-inner">
        <p className="eyebrow">check it yourself</p>
        <h2 className="section-title" id="proof-title">
          Every number here opens a link.
        </h2>
        <p className="section-lede">
          Nothing on this page is a screenshot of a dashboard we control. These are
          public records on the BNB Chain test network; the links go to the block
          explorer, not to us.
        </p>
      </BlurIn>

      <StaggerRow className="proof-row section-inner">
        <StaggerItem className="proof-card">
          <p className="proof-figure">
            {HF_BEFORE} <span aria-hidden="true">&#8594;</span> {HF_AFTER}
          </p>
          <h3 className="proof-name">Guardian pulled a real loan back from the edge</h3>
          <p className="proof-body">
            The health factor is how much room a loan has before the lender sells the
            collateral. Guardian paid {REPAY_COST} of the debt down and the number
            moved. <Out href={REPAY_TX_URL}>See the transaction</Out>.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">One bounded key</p>
          <h3 className="proof-name">Signed by a key that cannot do everything</h3>
          <p className="proof-body">
            The payer on the receipt is the agent's own wallet{" "}
            <Out href={AGENT_WALLET_URL}>
              <code>{AGENT_WALLET.slice(0, 10)}…</code>
            </Out>
            , not an all-powerful owner key. It may call two functions,{" "}
            {ALLOWLIST.map((call, i) => (
              <span key={call}>
                {i > 0 ? " and " : ""}
                <code>{call.split("(")[0]}</code>
              </span>
            ))}
            , and spend up to {ALLOWLIST_CAP}. Nothing else.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">
            <code>UnauthorizedCall</code>
          </p>
          <h3 className="proof-name">Anything off the list is refused</h3>
          <p className="proof-body">
            The same key tried a call it was not allowed to make. The wallet's own
            contract refused it, so it was never broadcast. There is no transaction to
            show you, and that is the point: it never reached the chain.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">{VERIFIED_CONTRACTS} contracts</p>
          <h3 className="proof-name">Live on the test network, source published</h3>
          <p className="proof-body">
            Every implementation is source-verified on the explorer, so you can read
            the code next to the address:
          </p>
          <ul className="proof-links">
            {CONTRACTS.map((c) => (
              <li key={c.name}>
                <Out href={c.url}>{c.name}</Out>
              </li>
            ))}
          </ul>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">{RENTABLE} listings</p>
          <h3 className="proof-name">One per category, and no more</h3>
          <p className="proof-body">
            The registry answers <code>listingCount() = {RENTABLE}</code>: exactly one
            listing in each of the nine categories. Widening it from four to nine left
            every existing listing byte for byte identical.{" "}
            <Out href={UPGRADE_TX_URL}>See the upgrade</Out>.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">{RENTAL_AMOUNT} in escrow</p>
          <h3 className="proof-name">The first rental was signed and paid</h3>
          <p className="proof-body">
            Subscription {RENTAL_SUB_ID} exists on chain and the money is held by the
            contract, not by us. The renting flow has still never been driven by a
            person in a browser, which is why it is also in the list further down.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">{TEST_TOTAL.toLocaleString("en-GB")} tests</p>
          <h3 className="proof-name">Green, and counted rather than remembered</h3>
          <p className="proof-body">
            {TEST_COUNTS.map((t, i) => (
              <span key={t.name}>
                {i > 0 ? " · " : ""}
                {t.name} {t.count}
              </span>
            ))}
            . <Out href={REPO_URL}>The commands are in the repo</Out>.
          </p>
        </StaggerItem>
      </StaggerRow>
    </section>
  );
}

/* ── What is not true yet ─────────────────────────────────────────── */

const NOT_YET = [
  {
    title: "Nothing is deployed",
    body: "A domain has been bought and there is nothing on it. No public site, no public API, no running agent you can reach from here.",
  },
  {
    title: "Eight of the nine cannot act",
    body: "Eight of the nine listings answer questions and nothing more. Not one of them has ever sent a transaction, and there is no hidden path where they could.",
  },
  {
    title: "The lending pool is our own mock",
    body: "The loan Guardian repaid sits in a pool we wrote and deployed ourselves. It copies a real one's interface closely enough to be a fair test of the machinery, and it is still not a real lending market.",
  },
  {
    title: "Nobody has ever signed a rental in a browser",
    body: "The first rental was signed by a script, not by a person clicking. The flow is written and it simulates, and until somebody drives it by hand we will not tell you it works.",
  },
];

export function HonestSection() {
  return (
    <section className="section honest" aria-labelledby="honest-title">
      <BlurIn className="section-inner">
        <p className="eyebrow">what is not true yet</p>
        <h2 className="section-title" id="honest-title">
          What we have not done.
        </h2>
        <p className="section-lede">
          This list is the argument, not the small print. A marketplace whose selling
          point is that you can check everything cannot be vague about its own gaps.
        </p>
      </BlurIn>

      <StaggerRow className="honest-row section-inner">
        {NOT_YET.map((item) => (
          <StaggerItem className="honest-card" key={item.title}>
            <h3 className="honest-name">{item.title}</h3>
            <p className="honest-body">{item.body}</p>
          </StaggerItem>
        ))}
      </StaggerRow>
    </section>
  );
}
