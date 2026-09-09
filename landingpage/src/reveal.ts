/**
 * Scroll reveal, written to fail OPEN.
 *
 * This is the single most expensive bug this page can have, and it is invisible
 * while you are looking straight at it: the hero is above the fold and never
 * hidden, so it looks perfect, and everything underneath is blank. You do not
 * find out by loading the page. You find out from someone else.
 *
 * Three rules make that impossible, and all three live here rather than in the
 * stylesheet:
 *
 *   a) The hidden state is never a bare selector. Every rule in index.css is
 *      prefixed `html.scroll-reveal-ready [data-reveal]:not(.is-revealed)`, so
 *      the hidden state cannot exist without the class.
 *   b) `scroll-reveal-ready` is added by this file ONLY, and only after the
 *      observer has been constructed AND `.observe()` has been called on every
 *      target. There is no path where something is hidden but unobserved.
 *   c) There is an unconditional 3000ms safety timer. Whatever the observer did
 *      or did not do, at three seconds everything is revealed and the class is
 *      dropped. It is cleared on the normal path, so it costs nothing.
 *
 * And the two exits, taken before anything is hidden: no IntersectionObserver, or
 * reduced motion. Both return without adding the class, which leaves the page in
 * its default state, which is fully visible.
 */

const SAFETY_MS = 3000;

export type RevealOptions = {
  /** Called once, when a target first becomes visible. Used by the triptych. */
  onReveal?: (el: Element) => void;
};

export function startReveal(options: RevealOptions = {}): () => void {
  const root = document.documentElement;
  const noop = () => {};

  if (typeof IntersectionObserver === "undefined") return noop;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return noop;
  }

  const targets = Array.from(document.querySelectorAll("[data-reveal]"));
  if (targets.length === 0) return noop;

  let safety: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  let remaining = targets.length;

  function revealAll() {
    for (const el of targets) reveal(el);
  }

  function reveal(el: Element) {
    if (el.classList.contains("is-revealed")) return;
    el.classList.add("is-revealed");
    remaining -= 1;
    options.onReveal?.(el);
    if (remaining <= 0) finish();
  }

  /** Once everything is out, the class has no job left; dropping it is free. */
  function finish() {
    if (safety !== undefined) {
      clearTimeout(safety);
      safety = undefined;
    }
    root.classList.remove("scroll-reveal-ready");
    observer?.disconnect();
  }

  try {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of targets) observer.observe(el);
  } catch {
    // Constructing or observing threw. Nothing was hidden yet, and nothing will
    // be: leaving without the class is the fully visible page.
    observer?.disconnect();
    return noop;
  }

  // Only now, with every target observed, is it safe to let the CSS hide them.
  root.classList.add("scroll-reveal-ready");

  safety = setTimeout(() => {
    revealAll();
    finish();
  }, SAFETY_MS);

  return () => {
    revealAll();
    finish();
  };
}
