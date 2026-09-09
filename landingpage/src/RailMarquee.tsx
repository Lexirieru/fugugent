import { RAILS } from "./content";

/**
 * The rails marquee. It loops on its own, forever, and the page scroll has no say
 * in it — a rail that only moves while you happen to be scrolling reads as broken
 * the moment you stop.
 *
 * This is a CSS animation rather than a rAF loop on purpose: the compositor runs it
 * off the main thread, it cannot drift out of sync with itself, and it stops for a
 * reader who asked for less motion through a media query rather than a JS branch
 * that has to remember to exist. The list is tripled and the keyframe travels
 * exactly one third, so the wrap is invisible.
 *
 * How it works: on every scroll event we take the section's top relative to the
 * document, work out how far the page has scrolled past the moment the section
 * first entered the viewport, and multiply by 0.3 so the row drifts slower than
 * the page. The transform is written straight onto the node through a ref rather
 * than through React state, because state would queue a render per scroll event
 * and drop the frame rate.
 *
 * The row holds three copies of the same list, and the offset is wrapped modulo
 * the width of one copy. That wrap is what makes it endless: after exactly one
 * copy's width the picture is identical to where it started, so resetting there
 * cannot be seen.
 */
export default function RailMarquee() {
  // Tripled on purpose — see the note above.
  const items = [...RAILS, ...RAILS, ...RAILS];

  return (
    <section className="section rails" aria-labelledby="rails-title">
      <div className="section-inner">
        <p className="eyebrow">the rails this runs on</p>
        <h2 className="section-title" id="rails-title">
          What it is built on.
        </h2>
        <p className="section-lede">
          Five things the running code actually touches. None of them sponsor us and
          none of them have endorsed us; this is a parts list, not a wall of friends.
        </p>
      </div>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-row">
          {items.map((rail, i) => (
            <span className="marquee-item" key={`${rail.name}-${i}`}>
              <img
                className={rail.tall ? "marquee-logo marquee-logo-wide" : "marquee-logo"}
                src={rail.src}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </span>
          ))}
        </div>
      </div>

      {/* The marquee itself is decoration; this is the same list as text, so a
          screen reader gets the parts list without the scrolling copy. */}
      <ul className="rails-list section-inner">
        {RAILS.map((rail) => (
          <li key={rail.name}>
            <strong>{rail.name}</strong>
            {rail.note}
          </li>
        ))}
      </ul>
    </section>
  );
}
