import { LISTINGS, PUFF_LEVELS } from "./content";

/**
 * The showcase: two headings, two figures, side by side from 1024px up.
 *
 * The figures carry NO `height`. They get their height from `aspect-ratio`
 * against the width the grid hands them, plus a `min-height` floor. That is the
 * belt-and-braces rule from the same note that governs `.feature__media`: a box
 * whose children are all absolutely positioned has no intrinsic height, so if
 * the one declaration that gives it a height ever becomes invalid it collapses
 * to zero and everything inside it disappears without a trace. Two independent
 * sources of height mean that cannot happen.
 */
export default function Showcase() {
  return (
    <section className="section showcase" aria-labelledby="showcase-title">
      <div className="section-inner">
        <p className="eyebrow">how to read a fugu</p>
        <h2 className="section-title" id="showcase-title">
          The fish puffs up as the risk goes up.
        </h2>
        <p className="section-lede">
          That is the whole idea, and it is the same five steps for every agent, so
          you can read a row without reading a number.
        </p>
      </div>

      <div className="showcase__grid section-inner">
        <div className="showcase__item" data-reveal="">
          <h3 className="showcase__heading">Five steps, and colour is never the only one.</h3>
          <div className="showcase__figure">
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
          </div>
          <p className="showcase__body">
            Body width, spikes, the face, the ring pattern and a number all change
            together. Someone who cannot tell the colours apart still reads the
            state, because the ring goes from an arc to hazard stripes.
          </p>
        </div>

        <div className="showcase__item" data-reveal="">
          <h3 className="showcase__heading">Nine listings, and each one says what it cannot do.</h3>
          <div className="showcase__figure">
            <ul className="listing-grid">
              {LISTINGS.map((listing) => (
                <li className={listing.hasActed ? "listing-tile is-live" : "listing-tile"} key={listing.id}>
                  <img
                    className="listing-tile__art"
                    src={listing.art}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="listing-tile__name">{listing.name.replace("Fugu ", "")}</span>
                  <span className="listing-tile__category">{listing.category}</span>
                  <span className="listing-tile__state">
                    {listing.hasActed ? "Has acted" : "Advice only"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="showcase__body">
            All nine are on chain and all nine can be rented. Eight of them have never
            sent a transaction, and there is no hidden path where they could. The
            price gap is the capability gap.
          </p>
        </div>
      </div>
    </section>
  );
}
