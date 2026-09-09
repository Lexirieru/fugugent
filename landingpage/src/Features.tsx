import type { CSSProperties, ReactNode } from "react";
import {
  ALLOWLIST_CAP,
  ALLOWLIST_EXPIRY,
  CATEGORY_COUNT,
  HF_AFTER,
  HF_BEFORE,
  LISTINGS,
  PRICE_PERIOD,
  RENTABLE,
  RENTAL_AMOUNT,
  VERIFIED_CONTRACTS,
} from "./content";

/**
 * The features grid: two rows of two cards.
 *
 * ## Why every length here is `calc(<number> * var(--k))`
 *
 * The composition was drawn on a 1685px canvas and it is a COMPOSITION, not a
 * document: a chip that points at a mini-card, a connector that has to land on
 * the right edge, artwork that is deliberately cropped. Reflowing that with
 * ordinary responsive rules pulls the pieces apart from each other. So instead
 * the whole thing scales as one drawing: `--k` is the ratio between the width
 * the page actually has and that 1685px canvas, every desktop length is a figma
 * number multiplied by it, and at exactly 1685px `--k` is 1px and the render is
 * pixel-identical to the drawing.
 *
 * `--k` MUST be a length, not a bare number. See the long note in index.css
 * above the token block: a bare `--k` makes every `calc()` below invalid and the
 * whole section collapses to nothing while the hero above it still looks
 * perfect. That failure mode is why the artwork boxes below carry an
 * `aspect-ratio` as well as a `height`.
 *
 * ## Positions
 *
 * Interior pieces are absolutely positioned inside a fixed 1060.28 x 577.97
 * stage, in the drawing's own units, passed as `--x` / `--y` / `--w` / `--h`
 * custom properties. The stage is wider than the card and is cropped by it, on
 * purpose: the artwork runs off the edge rather than shrinking to fit.
 */

/** Positions one interior piece in the drawing's coordinates. */
function at(x: number, y: number, w?: number, h?: number): CSSProperties {
  const style: Record<string, string | number> = { "--x": x, "--y": y };
  if (w !== undefined) style["--w"] = w;
  if (h !== undefined) style["--h"] = h;
  return style as CSSProperties;
}

function CheckBadge() {
  return (
    <svg className="check-badge" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.9 8.2 L7 10.3 L11.1 5.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg className="finder-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.4 10.4 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Feature({
  index,
  eyebrow,
  title,
  body,
  children,
}: {
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    /*
     * `data-reveal` is the only hook the reveal controller knows about, and the
     * hidden state in the stylesheet is gated behind a class that controller
     * adds. With JavaScript off there is no class, so there is no hidden state,
     * so this card is simply visible. That is the intended default, not a
     * fallback.
     *
     * `--inside-delay` staggers the interior pieces behind the card itself, so
     * the artwork assembles rather than arriving in one block.
     */
    <article
      className="feature"
      data-reveal=""
      style={{ "--inside-delay": `${90 + index * 55}ms` } as CSSProperties}
    >
      <div className="feature__media">
        <div className="feature__stage">{children}</div>
      </div>
      <div className="feature__copy">
        <p className="feature__eyebrow">{eyebrow}</p>
        <h3 className="feature__title">{title}</h3>
        <p className="feature__body">{body}</p>
      </div>
    </article>
  );
}

export default function Features() {
  const [guardian, rebalancer, grid] = LISTINGS;

  return (
    <section className="section features" aria-labelledby="features-title">
      <div className="section-inner">
        <p className="eyebrow">what you actually get</p>
        <h2 className="section-title" id="features-title">
          Four things you can check before you pay.
        </h2>
        <p className="section-lede">
          None of these is a promise about the future. Each one is a thing that has
          already happened, on a public test network, with a link that opens on
          somebody else's website.
        </p>
      </div>

      <div className="features__grid">
        {/* ── 1. The spending limit, and who holds it ─────────────── */}
        <Feature
          index={0}
          eyebrow="Renting"
          title="Rent one, and the chain holds the limit."
          body="You do not hand an agent your wallet. It gets a key that may call two functions, spend up to a fixed amount a day, and stop working on a date you set."
        >
          <div className="chip chip-key" style={at(56, 48)}>
            <span className="chip-dot" aria-hidden="true" />
            Session key
          </div>
          <p className="stage-note" style={at(56, 108, 420)}>
            {ALLOWLIST_CAP}. Expires {ALLOWLIST_EXPIRY}.
          </p>

          {/*
            The connector: one trunk down from the chip, a bus across, and a drop
            onto the centre of each mini-card.

            The three x values below are not decoration. The cards start at 56,
            382 and 708 and are 302 wide, so their centres are at 207, 533 and
            859 in stage coordinates; this svg starts at x=56, so in its own
            space those centres are 151, 477 and 803. Move a card and these move
            with it, or the line lands on nothing.

            `preserveAspectRatio="none"` is deliberate: the svg is stretched to
            the drawing's units by its width and height, so its internal
            coordinates and the stage's stay one to one.
          */}
          <svg
            className="connector"
            style={at(56, 168, 948, 92)}
            viewBox="0 0 948 92"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M30 0 V46 Q30 56 40 56 H793 Q803 56 803 66 V92 M151 56 V92 M477 56 V92"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          {[guardian, rebalancer, grid].map((listing, i) => (
            <div className="mini-card" key={listing.id} style={at(56 + i * 326, 260, 302, 262)}>
              <img className="mini-card__art" src={listing.art} alt="" loading="lazy" decoding="async" />
              <p className="mini-card__name">{listing.name}</p>
              <p className="mini-card__category">{listing.category}</p>
              <p className="mini-card__price">
                <strong>{listing.price}</strong> {PRICE_PERIOD}
              </p>
            </div>
          ))}
        </Feature>

        {/* ── 2. Proof you can click ──────────────────────────────── */}
        <Feature
          index={1}
          eyebrow="Evidence"
          title="Every number opens on the explorer."
          body="Not a screenshot of a dashboard we control. The links below go to a public block explorer that has never heard of us."
        >
          <div className="chip chip-record" style={at(56, 48)}>
            <span className="chip-dot" aria-hidden="true" />
            On-chain record
          </div>

          {[
            `Health factor ${HF_BEFORE} to ${HF_AFTER}, paid by the agent`,
            `First rental signed, ${RENTAL_AMOUNT} into escrow`,
            `${VERIFIED_CONTRACTS} contracts live with their source published`,
          ].map((line, i) => (
            <div className="check-row" key={line} style={at(56, 150 + i * 130, 948, 108)}>
              <CheckBadge />
              <span className="check-row__text">{line}</span>
              <span className="check-row__go" aria-hidden="true">
                Open
              </span>
            </div>
          ))}
        </Feature>

        {/* ── 3. The catalogue ────────────────────────────────────── */}
        <Feature
          index={2}
          eyebrow="The catalogue"
          title={`${CATEGORY_COUNT} categories, and only ${RENTABLE} you can rent.`}
          body={`Most agents in the catalogue have no price yet. Nine are ours and can be rented today. Exactly one has ever sent a transaction, and the page says which.`}
        >
          <div className="benefit-card" style={at(56, 48, 560, 474)}>
            <img
              className="benefit-card__art"
              src={guardian.art}
              alt=""
              loading="lazy"
              decoding="async"
            />
            <p className="benefit-card__name">{guardian.name}</p>
            <p className="benefit-card__category">{guardian.category}</p>
            <p className="benefit-card__body">
              The only one of the nine that has ever moved money. It repaid part of a
              real loan and the health factor moved with it.
            </p>
            <div className="benefit-card__foot">
              <span className="chip chip-live-sm">Has acted</span>
              <span className="mini-card__price">
                <strong>{guardian.price}</strong> {PRICE_PERIOD}
              </span>
            </div>
          </div>

          <div className="chip chip-count" style={at(660, 96)}>
            {CATEGORY_COUNT} categories
          </div>
          <div className="chip chip-count" style={at(660, 172)}>
            {RENTABLE} you can rent today
          </div>
          <div className="chip chip-plain" style={at(660, 248)}>
            1 has ever acted
          </div>
          <p className="stage-note" style={at(660, 330, 344)}>
            The other eight answer questions and cannot move money. Their price is
            half of Guardian's, deliberately.
          </p>
        </Feature>

        {/* ── 4. Skills you can audit ─────────────────────────────── */}
        <Feature
          index={3}
          eyebrow="Auditing"
          title="Every skill is a named function, not a mood."
          body="A strategy here is deterministic code with a backtest. No model decides how your money moves, and the allowlist is written out rather than left empty."
        >
          <div className="mini-finder" style={at(56, 48, 948, 474)}>
            <div className="mini-finder__field">
              <SearchGlyph />
              <span className="mini-finder__query">repay</span>
              <span className="mini-finder__caret" aria-hidden="true" />
              <span className="mini-finder__scope">Allowed calls</span>
            </div>
            <ul className="mini-finder__results">
              <li className="mini-finder__row is-allowed">
                <CheckBadge />
                <code>MockLendingPool.repay(address,uint256)</code>
                <span className="mini-finder__tag">Allowed</span>
              </li>
              <li className="mini-finder__row is-allowed">
                <CheckBadge />
                <code>mUSD.approve(address,uint256)</code>
                <span className="mini-finder__tag">Allowed</span>
              </li>
              <li className="mini-finder__row is-refused">
                <span className="cross-badge" aria-hidden="true">
                  ×
                </span>
                <code>everything else</code>
                <span className="mini-finder__tag">Refused on chain</span>
              </li>
            </ul>
            <p className="mini-finder__foot">
              An empty allowlist would mean unlimited. This one is two lines long.
            </p>
          </div>
        </Feature>
      </div>
    </section>
  );
}
