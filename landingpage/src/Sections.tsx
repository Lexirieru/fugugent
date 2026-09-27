import type { ReactNode } from "react";
import {
  AGENTS,
  AGENTS_URL,
  AGENT_WALLET_URL,
  ALLOWLIST,
  ALLOWLIST_CAP,
  ALLOWLIST_EXPIRY,
  APP_URL,
  CONTRACTS,
  EVER_ACTED,
  HF_AFTER,
  HF_BEFORE,
  LIST_URL,
  NEXT_BUILDS,
  NOT_YET,
  PUFF_LEVELS,
  RAILS,
  RENTABLE,
  RENTAL_AMOUNT,
  RENTAL_SUB_ID,
  RENTAL_TX_URL,
  REPAY_BLOCK,
  REPAY_COST,
  REPAY_TX_URL,
  REPO_URL,
  TEST_COUNTS,
  TEST_TOTAL,
  UPGRADE_TX_URL,
  VERIFIED_CONTRACTS,
} from "./content";
import InfoTip from "./InfoTip";
import { Ext, d } from "./ui";

/**
 * House rule for this page: a title and at most one short line per section. The
 * longer explanation lives in an InfoTip next to the thing it explains, and every
 * transaction hash and contract address stays one visible click away.
 */

function Head({
  id,
  eyebrow,
  title,
  lede,
  tip,
  tipLabel,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  tip?: ReactNode;
  tipLabel?: string;
}) {
  return (
    <div className="head" data-reveal="">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="h2" id={id}>
        {title}
        {tip ? (
          <>
            {" "}
            <InfoTip label={tipLabel}>{tip}</InfoTip>
          </>
        ) : null}
      </h2>
      {lede ? <p className="lede">{lede}</p> : null}
    </div>
  );
}

function TLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Ext href={href} className="tlink">
      {children} <span aria-hidden="true">&#8599;</span>
    </Ext>
  );
}

/* ── Built on ────────────────────────────────────────────────────── */

export function BuiltOn() {
  return (
    <section className="built wrap" aria-labelledby="built-title">
      <p className="built__label" id="built-title">
        Built on{" "}
        <InfoTip label="About these five">
          The five things the running code actually touches. None of them sponsor or endorse
          us; this is a parts list, not a wall of friends.
        </InfoTip>
      </p>
      <ul className="built__list">
        {RAILS.map((rail) => (
          <li key={rail.name} title={rail.note}>
            <img
              className={rail.tall ? "built__logo is-wide" : "built__logo"}
              src={rail.src}
              alt=""
              loading="lazy"
              decoding="async"
            />
            {/* A wordmark logo already says its name; the text is kept for screen readers. */}
            <span className={rail.tall ? "sr-only" : undefined}>{rail.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Proof, as a bento ──────────────────────────────────────────────
 *
 * Layout and motion adapted from MotionSites "Bento Grid Stats" (premium): an
 * explicit six-column grid on desktop that stacks to one column on a phone, big
 * light numerals over a short caption, one dark tile for contrast, a dot-matrix
 * chart in the lead tile, and each tile scaling in from 0.95 on a staggered delay
 * with the prompt's [0.22, 1, 0.36, 1] easing. The prompt's stock photo, its
 * invented stats and its black-and-white palette are not used: every figure here
 * comes from content.ts and opens on the block explorer.
 */

/** Decorative only. The same 24 bars the old triptych drew, as a dot matrix. */
const BARS = [74, 71, 76, 69, 72, 66, 61, 57, 60, 52, 49, 45, 38, 34, 30, 26, 22, 100, 88, 84, 87, 82, 85, 83];
const ACTIVE_BAR = 17;
const DOT_ROWS = 10;

function DotChart() {
  return (
    <div className="dots" aria-hidden="true">
      {BARS.map((h, c) => {
        const filled = Math.max(1, Math.round((h / 100) * DOT_ROWS));
        return (
          <span className={c === ACTIVE_BAR ? "dots__col is-act" : "dots__col"} key={c}>
            {Array.from({ length: DOT_ROWS }, (_, r) => (
              <i key={r} className={r < filled ? "on" : undefined} />
            ))}
          </span>
        );
      })}
    </div>
  );
}

export function ProofBento() {
  return (
    <section className="section wrap" aria-labelledby="proof-title">
      <Head
        id="proof-title"
        eyebrow="check it yourself"
        title="Every number opens a record."
        lede="Public records on BNB Chain testnet. The links go to the block explorer, not to us."
      />

      <div className="bento">
        <article className="tile tile--hf" data-reveal="" style={d(0)}>
          <p className="tile__label">
            Health factor{" "}
            <InfoTip label="What a health factor is">
              How much room a loan has before the lender sells the collateral.
            </InfoTip>
          </p>
          <p className="tile__stat">
            {HF_BEFORE} <span className="arrow" aria-hidden="true">&#8594;</span> {HF_AFTER}
          </p>
          <p className="tile__text">
            Fugu Guardian paid {REPAY_COST} of a loan down, block{" "}
            {REPAY_BLOCK.toLocaleString("en-GB")}.
          </p>
          <DotChart />
          <TLink href={REPAY_TX_URL}>See the transaction</TLink>
        </article>

        <article className="tile tile--ink" data-reveal="" style={d(80)}>
          <p className="tile__label">Off the list</p>
          <p className="tile__stat">Refused</p>
          <p className="tile__text">
            The same key tried a call it was not allowed. The wallet's own contract refused it
            before broadcast.
          </p>
          <p className="tile__note">No transaction exists to open, and that is the point.</p>
        </article>

        <article className="tile" data-reveal="" style={d(140)}>
          <p className="tile__label">
            One bounded key{" "}
            <InfoTip label="The full allowlist">
              {ALLOWLIST.join(" and ")}. Nothing else, and it expires {ALLOWLIST_EXPIRY}. An empty
              allowlist would mean unlimited.
            </InfoTip>
          </p>
          <p className="tile__stat">2 calls</p>
          <p className="tile__chips">
            <code>repay</code>
            <code>approve</code>
          </p>
          <p className="tile__text">Up to {ALLOWLIST_CAP}.</p>
          <TLink href={AGENT_WALLET_URL}>The agent's wallet</TLink>
        </article>

        <article className="tile" data-reveal="" style={d(200)}>
          <p className="tile__label">First rental</p>
          <p className="tile__stat">{RENTAL_AMOUNT}</p>
          <p className="tile__text">
            Held in escrow by the contract, not by us, as subscription {RENTAL_SUB_ID}.
          </p>
          <TLink href={RENTAL_TX_URL}>See the rental</TLink>
        </article>

        <article className="tile tile--soft" data-reveal="" style={d(260)}>
          <p className="tile__label">
            The catalogue{" "}
            <InfoTip label="About the nine listings">
              The registry answers listingCount() = {RENTABLE}: one listing per category. Widening
              it from four categories to nine left every existing listing byte for byte identical.
            </InfoTip>
          </p>
          <p className="tile__stat tile__stat--pair">
            <span>
              {RENTABLE} <span className="tile__of">listed</span>
            </span>
            <span>
              {EVER_ACTED} <span className="tile__of">has acted</span>
            </span>
          </p>
          <p className="tile__text">One per category. Only Guardian has moved money.</p>
          <TLink href={UPGRADE_TX_URL}>See the upgrade</TLink>
        </article>

        <article className="tile" data-reveal="" style={d(320)}>
          <p className="tile__label">
            Open source{" "}
            <InfoTip label="The test counts">
              {TEST_COUNTS.map((t) => `${t.name} ${t.count}`).join(", ")}. CI fails if any count
              drops.
            </InfoTip>
          </p>
          <p className="tile__stat tile__stat--pair">
            <span>
              {VERIFIED_CONTRACTS} <span className="tile__of">contracts</span>
            </span>
            <span>
              {TEST_TOTAL.toLocaleString("en-GB")} <span className="tile__of">tests</span>
            </span>
          </p>
          <p className="tile__text">Source published next to every address.</p>
          <div className="tile__links">
            <TLink href={CONTRACTS[0].url}>Registry</TLink>
            <TLink href={REPO_URL}>Repo</TLink>
          </div>
        </article>
      </div>
    </section>
  );
}

/* ── The four agents with code behind them ────────────────────────── */

export function AgentsSection() {
  return (
    <section className="section wrap" aria-labelledby="agents-title">
      <Head
        id="agents-title"
        eyebrow="four agents, honest labels"
        title="Four agents. One of them can act."
        lede="All four can be rented. Only one has ever moved money, and each card says which."
      />
      <ul className="agents">
        {AGENTS.map((agent, i) => (
          <li className="agent" key={agent.name} data-reveal="" style={d(i * 70)}>
            <img className="agent__art" src={agent.art} alt="" loading="lazy" decoding="async" />
            <div className="agent__body">
              <span className={`chip chip--${agent.status}`}>{agent.statusLabel}</span>
              <h3 className="agent__name">
                {agent.name}{" "}
                <InfoTip label={`More about ${agent.name}`}>{agent.detail}</InfoTip>
              </h3>
              <p className="agent__does">{agent.does}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="more">
        <Ext href={AGENTS_URL} className="btn btn--ghost">
          See all nine in the app <span aria-hidden="true">&#8599;</span>
        </Ext>
      </p>
    </section>
  );
}

/* ── How to read a fugu ──────────────────────────────────────────── */

export function FishScale() {
  return (
    <section className="section wrap" aria-labelledby="fish-title">
      <Head
        id="fish-title"
        eyebrow="how to read a fugu"
        title="The fish puffs up as risk goes up."
        tipLabel="Why colour is never the only signal"
        tip="Body width, spikes, the face, the ring pattern and a number all change together, so someone who cannot tell the colours apart still reads the state."
      />
      <ol className="puff" data-reveal="">
        {PUFF_LEVELS.map((level) => (
          <li className="puff__step" key={level.level}>
            <img
              src={level.src}
              alt={`Puff level ${level.level}, ${level.name}`}
              loading="lazy"
              decoding="async"
            />
            <span className="puff__name">{level.name}</span>
            <span className="puff__n">{level.level}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── What is not true yet ─────────────────────────────────────────── */

export function HonestSection() {
  return (
    <section className="section wrap" aria-labelledby="honest-title">
      <Head
        id="honest-title"
        eyebrow="what is not true yet"
        title="What we have not done."
        lede="A marketplace you can check cannot be vague about its own gaps."
      />
      <ul className="honest">
        {NOT_YET.map((item, i) => (
          <li className="honest__card" key={item.title} data-reveal="" style={d(i * 70)}>
            <span className="honest__n" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="honest__title">
              {item.title}
              {item.more ? (
                <>
                  {" "}
                  <InfoTip label={`More on: ${item.title}`}>{item.more}</InfoTip>
                </>
              ) : null}
            </h3>
            <p className="honest__body">{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── What comes next ─────────────────────────────────────────────── */

export function NextSection() {
  return (
    <section className="section wrap" aria-labelledby="next-title">
      <Head
        id="next-title"
        eyebrow="none of this is built"
        title="What comes next."
        lede="Planned, not shipped. Each one names the wallet feature it would use."
      />
      <ol className="next">
        {NEXT_BUILDS.map((build, i) => (
          <li className="next__row" key={build.title} data-reveal="" style={d(i * 60)}>
            <span className="next__n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="next__title">{build.title}</span>
            <InfoTip label={`About ${build.title}`}>
              {build.does}. Altana piece: {build.piece}.
            </InfoTip>
            <span className="chip chip--planned">Not built yet</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── Closing call to action ──────────────────────────────────────── */

export function ClosingCta() {
  return (
    <section className="section wrap" aria-labelledby="cta-title">
      <div className="cta" data-reveal="">
        <img className="cta__fish" src="/brand/maskot.svg" alt="" loading="lazy" decoding="async" />
        <div className="cta__copy">
          <h2 className="h2" id="cta-title">
            See it for yourself.
          </h2>
          <p className="lede">Rent an agent, or list your own.</p>
          <div className="cta__btns">
            <Ext href={APP_URL} className="btn btn--ink">
              Open the app <span aria-hidden="true">&#8599;</span>
            </Ext>
            <Ext href={LIST_URL} className="btn btn--ghost">
              List your agent
            </Ext>
          </div>
        </div>
      </div>
    </section>
  );
}
