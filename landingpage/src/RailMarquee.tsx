import { RAILS } from "./content";

/**
 * The rails marquee. It loops on its own, forever, and the page scroll has no say
 * in it — a rail that only moves while you happen to be scrolling reads as broken
 * the moment you stop.
 *
 * This is a CSS animation rather than a rAF loop on purpose: the compositor runs it
 * off the main thread, it cannot drift out of sync with itself, and it stops for a
 * reader who asked for less motion through a media query rather than a JS branch
 * that has to remember to exist.
 *
 * The row holds nine copies of the same list and the keyframe travels exactly one
 * third of it — three whole copies — so at the end of a cycle the picture is
 * identical to the start and the reset cannot be seen. Nine and not three: the
 * travel distance comes out of the row's coverage, and three copies leave a blank
 * gap at the right-hand edge on anything wider than a small laptop. The count and
 * the keyframe's 33.3333% are a matched pair — change one and you must change the
 * other, or the seam becomes visible.
 */
export default function RailMarquee() {
  // Nine copies on purpose, matched to the keyframe's 33.3333% — see the note above.
  const items = Array.from({ length: 9 }, () => RAILS).flat();

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
