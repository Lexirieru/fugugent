import type { ReactNode } from "react";
import {
  AGENTS,
  AGENT_WALLET,
  AGENT_WALLET_URL,
  CONTRACTS,
  NEXT_BUILDS,
  PUFF_LEVELS,
  REPAY_TX_URL,
  REPO_URL,
  STATUS_DOC_URL,
  TEST_COUNTS,
  TEST_TOTAL,
} from "./content";
import { BlurIn, StaggerItem, StaggerRow } from "./motion";

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="out" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/* ── The four agents that exist, plus the puff scale ─────────────── */

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

      <BlurIn className="section-inner puff">
        <h3 className="puff-title">A fish that puffs up as the risk goes up.</h3>
        <p className="section-lede">
          That is the whole idea. The heavier the load an agent is carrying, the more
          it swells — five steps, the same five for every agent, so you can read the
          state across a row without reading a single number.
        </p>
        <ol className="puff-row">
          {PUFF_LEVELS.map((level) => (
            <li className="puff-step" key={level.level}>
              <img
                className="puff-art"
                src={level.src}
                alt={`Puff level ${level.level}, ${level.name}`}
                loading="lazy"
                decoding="async"
              />
              <span className="puff-name">{level.name}</span>
              <span className="puff-index">{level.level} of 5</span>
            </li>
          ))}
        </ol>
      </BlurIn>
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
          <p className="proof-figure">1.14 → 1.50</p>
          <h3 className="proof-name">Guardian pulled a real loan back from the edge</h3>
          <p className="proof-body">
            The health factor is how much room a loan has before the lender sells the
            collateral. Guardian paid part of the debt down and the number moved.{" "}
            <Out href={REPAY_TX_URL}>See the transaction</Out>.
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
            , not an all-powerful owner key. It may call two things and spend up to a
            fixed daily amount.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">
            <code>UnauthorizedCall</code>
          </p>
          <h3 className="proof-name">Anything off the list is refused</h3>
          <p className="proof-body">
            The same key tried a call it was not allowed to make. The wallet's own
            contract refused it — not our code, and not a setting we can quietly
            change.
          </p>
        </StaggerItem>

        <StaggerItem className="proof-card">
          <p className="proof-figure">4 contracts</p>
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
          <p className="proof-figure">4 listings</p>
          <h3 className="proof-name">One per category, and no more</h3>
          <p className="proof-body">
            The registry answers <code>listingCount() = 4</code>: exactly one listing
            in each of the four categories.{" "}
            <Out href={CONTRACTS[0].url}>Read it from the explorer</Out>.
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

/* ── What is not true yet, and the footer ─────────────────────────── */

const NOT_YET = [
  {
    title: "Nothing is deployed",
    body: "A domain has been bought and there is nothing on it. No public site, no public API, no running agent you can reach from here.",
  },
  {
    title: "Three of the four cannot act",
    body: "Rebalancer, Grid and Yield answer questions. Not one of them has ever sent a transaction, and there is no hidden path where they could.",
  },
  {
    title: "The lending pool is our own mock",
    body: "The loan Guardian repaid sits in a pool we wrote and deployed ourselves. It copies a real one's interface closely enough to be a fair test of the machinery, and it is still not a real lending market.",
  },
  {
    title: "Nobody has ever signed a rental",
    body: "The renting flow is written and it simulates. A person has never put their name to one in a browser, so we will not tell you it works.",
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

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="section-inner footer-inner">
        <p className="footer-word">HelloFugu</p>
        <nav className="footer-links" aria-label="Elsewhere">
          <Out href={REPO_URL}>Source on GitHub</Out>
          <Out href={CONTRACTS[0].url}>Contracts on BscScan</Out>
          <Out href={STATUS_DOC_URL}>The full status document</Out>
        </nav>
        <p className="footer-note">
          Built for the BNB Chain hackathon. Test network only — no real money has
          ever been at stake.
        </p>
      </div>
    </footer>
  );
}
