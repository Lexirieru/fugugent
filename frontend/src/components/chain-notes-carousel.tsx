"use client";

/**
 * "What the chain says" — the record carousel on the start page.
 *
 * ## Where it came from, and the one thing that had to change
 *
 * The mechanics are a port and they are deliberately unmodified: the in-view reveal,
 * the 0.8s `fadeInUp` and its four staggered delays, the 3000ms auto-advance, the
 * 427.5px card, the 24px gap, the tripled item list, and the per-card exit fade are all
 * exactly the values that were handed over. They are calibrated; they are not opinions
 * and they were not "improved" here.
 *
 * What is not a port is the content. The original five slides were named people with
 * stock photographs praising a product. None of those people ever said anything about
 * this one, and a single invented testimonial would undo the only claim this product
 * makes, which is that every number on it can be checked. So the five slides carry five
 * things that actually happened on BNB Chain testnet, each one a link to the block it
 * happened in.
 *
 * The second slide has no link. A call that a wallet contract refuses is refused before
 * it is broadcast, so it is never written into a block and there is no page on BscScan
 * to open. Giving it a link for the sake of a tidy row would be the exact failure this
 * component exists to argue against, so it says why instead. `lib/chain-notes.ts` holds
 * the five records and their sources.
 *
 * ## What was added on top of the port, and why
 *
 * Three things, none of which touch a number:
 *
 * 1. **Off-screen cards are removed from the tab order and from the accessibility
 *    tree.** The track renders the five records three times over to fake an endless
 *    loop, so without this a keyboard user tabs into fifteen links, most of them
 *    invisible and eleven of them duplicates. A card is exposed only while it is
 *    actually inside the window.
 * 2. **The auto-advance pauses on focus as well as on hover**, so a card cannot slide
 *    out from under the link you are about to press.
 * 3. **Auto-advance does not start at all under `prefers-reduced-motion`.** The global
 *    stylesheet reduces every transition to nothing for those readers, which would turn
 *    a slide into a jump-cut every three seconds. The buttons still work, so nothing is
 *    lost except the motion that was asked not to happen.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Fugu } from "@/components/fugu";
import { CHAIN_NOTES, type ChainNote, type HireableCount } from "@/lib/chain-notes";

/** Ported unchanged: threshold 0.1, and once it has fired it never unfires. */
function useInViewAnimation<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

const GAP = 24;
const DESKTOP_CARD_WIDTH = 427.5;
const AUTO_ADVANCE_MS = 3000;
/**
 * How far the first card sits from the left wall of the window it slides inside. It is
 * 24px at every width, and by two different routes: below 768 the track carries `pl-6`,
 * from 768 up the window carries `md:pl-6`. `clientWidth` counts padding, so the lane a
 * card is actually visible in is the measured width minus this.
 */
const LANE_INSET = 24;

export function ChainNotesCarousel({ counts }: { counts: HireableCount }) {
  const { ref, isVisible } = useInViewAnimation<HTMLElement>();

  const [offset, setOffset] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(DESKTOP_CARD_WIDTH * 2);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastWidth = useRef(-1);

  // `innerWidth` does not exist while this renders on the server, so the first paint is
  // the desktop measurement and the effect corrects it before anything moves.
  //
  // The width guard is not a micro-optimisation. A card is measured in pixels, so a
  // width change invalidates the current offset and the track has to go back to the
  // start; but `resize` also fires when only the height moved, which on a phone is what
  // the address bar sliding away does. Without the guard, scrolling a phone would send
  // the reader back to the first card.
  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      setIsMobile(width < 768);
      setViewportWidth(viewportRef.current?.clientWidth ?? width);
      setOffset(0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const cardWidth = isMobile ? Math.max(240, viewportWidth - 48) : DESKTOP_CARD_WIDTH;
  const cardWithGap = cardWidth + GAP;
  const loopWidth = cardWithGap * CHAIN_NOTES.length;

  const goNext = useCallback(() => {
    setOffset((current) => {
      const next = current + cardWithGap;
      return next >= loopWidth ? 0 : next;
    });
  }, [cardWithGap, loopWidth]);

  const goPrev = useCallback(() => {
    setOffset((current) => {
      const next = current - cardWithGap;
      return next < 0 ? loopWidth - cardWithGap : next;
    });
  }, [cardWithGap, loopWidth]);

  useEffect(() => {
    if (isPaused || reduceMotion) return;
    const timer = setInterval(goNext, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [goNext, isPaused, reduceMotion]);

  const tripled = [...CHAIN_NOTES, ...CHAIN_NOTES, ...CHAIN_NOTES];
  const distanceFromEdge = offset % loopWidth;

  /** The four staggered entrances. `extra` carries whatever layout the slot also needs. */
  const reveal = (delay: string, extra = "") => ({
    className: `fugu-reveal${isVisible ? " is-in" : ""}${extra ? ` ${extra}` : ""}`,
    style: { animationDelay: delay },
  });

  return (
    <section ref={ref} className="w-full py-20" aria-labelledby="chain-notes-heading">
      {/* Without this the section is invisible to a reader whose scripts did not run,
          because the reveal starts at zero opacity and only JavaScript ends it. */}
      <noscript>
        <style>{".fugu-reveal{opacity:1!important;animation:none!important}"}</style>
      </noscript>

      <div className="mx-auto max-w-7xl px-6">
        <div className="w-full md:pr-6">
          <div className="mb-16 flex flex-col gap-6 md:ml-auto md:max-w-4xl md:flex-row md:items-start md:justify-between md:gap-0">
            <div {...reveal("0.1s")}>
              <h2
                id="chain-notes-heading"
                className="text-[32px] font-normal leading-[1.1] tracking-tight md:text-[40px] lg:text-[44px]"
              >
                What the <span className="font-hand text-accent-strong">chain</span> says
              </h2>
              <p className="mt-4 max-w-md text-pretty text-sm leading-relaxed text-muted">
                Nobody is quoted here. These are five things that happened on the test
                network, and each one opens the record of itself on the block explorer.
              </p>
            </div>

            <div {...reveal("0.2s", "md:pl-8")}>
              <CatalogueCard counts={counts} />
            </div>
          </div>

          <div {...reveal("0.3s", "-mx-6 md:mx-0")}>
            <div
              ref={viewportRef}
              className="relative overflow-hidden py-6 md:ml-auto md:max-w-4xl md:pl-6"
              onMouseEnter={() => setIsPaused(true)}
              onMouseLeave={() => setIsPaused(false)}
              onFocusCapture={() => setIsPaused(true)}
              onBlurCapture={() => setIsPaused(false)}
            >
              <div
                className="flex gap-6 pl-6 md:pl-0"
                style={{
                  transform: `translateX(-${offset}px)`,
                  transition: "transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {tripled.map((note, index) => (
                  <NoteCard
                    key={`${note.id}-${index}`}
                    note={note}
                    index={index}
                    cardWidth={cardWidth}
                    cardWithGap={cardWithGap}
                    distanceFromEdge={distanceFromEdge}
                    laneWidth={viewportWidth - LANE_INSET}
                  />
                ))}
              </div>
            </div>
          </div>

          <div {...reveal("0.4s", "mt-8 flex gap-4 md:ml-auto md:max-w-4xl md:pl-6")}>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Show the previous record"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-fg transition-colors hover:border-line-strong hover:bg-surface-strong"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Show the next record"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-line text-fg transition-colors hover:border-line-strong hover:bg-surface-strong"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The count beside the heading. It replaces a five-star rating badge from a review site,
 * which is the one thing that could not be ported: there is no rating, and a product
 * whose argument is "check the number yourself" cannot open by inventing one.
 *
 * One number, from the chain, because a second number from the upstream catalogue index
 * does not hold still between two reloads. `lib/chain-notes.ts` carries the measurement
 * that settled it.
 *
 * Both shapes below keep the link, because the link is what makes the claim checkable
 * and it works whether or not the read succeeded. A number that could not be read is
 * absent and named as absent; it is never a dash standing in for a value.
 */
function CatalogueCard({ counts }: { counts: HireableCount }) {
  return (
    <Link
      href={counts.href}
      className="group block rounded-2xl border border-line bg-surface px-5 py-4 transition hover:border-line-strong hover:bg-surface-strong md:text-right"
    >
      {counts.hireable !== null ? (
        <span className="block font-mono text-3xl leading-none tabular-nums text-fg">
          {counts.hireable}
        </span>
      ) : null}
      <span className="mt-2 block max-w-[16rem] text-xs leading-relaxed text-faint md:ml-auto">
        {counts.hireable !== null
          ? "agents carry a price and can be hired today. Read from listingCount() on the registry contract just now, so it is the same number for you as for anyone else."
          : "The registry contract did not answer just now, so no count is shown rather than a remembered one. The list still works."}
      </span>
      <span className="mt-2 block text-xs text-accent-strong">
        Open the list and count them →
      </span>
    </Link>
  );
}

/**
 * One record.
 *
 * The exit maths is the port's, to the digit: a card starts fading once its left edge is
 * more than half a card past the left wall, reaches nothing at a full card past it, and
 * shrinks to 0.85 on the way.
 */
function NoteCard({
  note,
  index,
  cardWidth,
  cardWithGap,
  distanceFromEdge,
  laneWidth,
}: {
  note: ChainNote;
  index: number;
  cardWidth: number;
  cardWithGap: number;
  distanceFromEdge: number;
  /** The visible lane, already reduced by `LANE_INSET`. */
  laneWidth: number;
}) {
  const cardPosition = index * cardWithGap;
  const relativePosition = cardPosition - distanceFromEdge;

  let opacity = 1;
  let scale = 1;
  if (relativePosition < -cardWidth / 2) {
    const exitProgress = Math.min(1, Math.abs(relativePosition) / cardWidth);
    opacity = Math.max(0, 1 - exitProgress * 2);
    scale = Math.max(0.85, 1 - exitProgress * 0.15);
  }

  // Anything the reader cannot see is not offered to a pointer, to the tab key, or to a
  // screen reader. The track holds three copies of every record, so this is what keeps
  // one visible row of five from reading as fifteen.
  const onScreen = relativePosition > -cardWidth / 2 && relativePosition < laneWidth;

  return (
    <article
      aria-hidden={onScreen ? undefined : true}
      className="flex flex-shrink-0 flex-col justify-between rounded-[32px] bg-surface px-6 py-8 shadow-[0_4px_16px_rgba(0,0,0,0.08)] md:rounded-[40px] md:pb-[2.63rem] md:pl-10 md:pr-24 md:pt-[2.36rem]"
      style={{
        width: `${cardWidth}px`,
        opacity,
        transform: `scale(${scale})`,
        transition: "opacity 0.4s ease-out, transform 0.4s ease-out",
        pointerEvents: onScreen ? undefined : "none",
      }}
    >
      <div>
        <svg
          className="mb-6 h-8 w-8 text-accent"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
        </svg>

        <p className="text-pretty text-[15px] leading-relaxed text-fg">{note.fact}</p>

        {note.link ? (
          <a
            href={note.link.href}
            target="_blank"
            rel="noreferrer noopener"
            tabIndex={onScreen ? undefined : -1}
            className="mt-4 inline-block break-all font-mono text-xs text-accent-strong underline decoration-accent/40 underline-offset-4 transition hover:decoration-accent-strong"
          >
            {note.link.text} ↗
          </a>
        ) : (
          <p className="mt-4 text-xs leading-relaxed text-faint">{note.noLinkReason}</p>
        )}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-bg-elev">
          <Fugu
            kind={note.kind}
            seed={note.seed}
            level={2}
            animated={false}
            className="h-10 w-10"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-fg">{note.actor}</span>
          <span className="flex items-center gap-1 text-sm text-muted">
            <span className="text-xs" aria-hidden="true">
              ↳
            </span>
            {note.category}
          </span>
        </span>
      </div>
    </article>
  );
}
