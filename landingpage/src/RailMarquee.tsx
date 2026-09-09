import { useEffect, useRef } from "react";
import { RAILS } from "./content";

/**
 * Motion pattern B — a marquee whose position is driven by the page scroll, with
 * no animation library involved at all.
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
  const sectionRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const row = rowRef.current;
    if (!section || !row) return;

    // A reader who asked for less motion gets a still row, and no listener at all.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    // Measured once per layout instead of once per scroll event: reading
    // scrollWidth inside the handler would force a reflow on every frame.
    let copyWidth = row.scrollWidth / 3;

    const apply = () => {
      const sectionTop = section.getBoundingClientRect().top + window.scrollY;
      const scrolled = window.scrollY - sectionTop + window.innerHeight;
      const offset = scrolled * 0.3 - 200;
      if (copyWidth <= 0) return;
      const wrapped = ((offset % copyWidth) + copyWidth) % copyWidth;
      row.style.transform = `translateX(${wrapped - copyWidth}px)`;
    };

    const onResize = () => {
      copyWidth = row.scrollWidth / 3;
      apply();
    };

    apply();
    window.addEventListener("scroll", apply, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", apply);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Tripled on purpose — see the note above.
  const items = [...RAILS, ...RAILS, ...RAILS];

  return (
    <section className="section rails" ref={sectionRef} aria-labelledby="rails-title">
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
        <div className="marquee-row" ref={rowRef} style={{ willChange: "transform" }}>
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
