/**
 * The hero entrance. Runs once, then removes itself completely.
 *
 * The hard requirement on this file is not the animation, it is what is left
 * behind: the finished hero has to be pixel-identical to the hero that shipped
 * before any of this existed. The repo owner calibrated that composition against
 * the aircraft video, `--video-offset-y: 290px` is a lever he set himself, and an
 * entrance that leaves a stray `transform` or a compositing layer behind would
 * move it by a hair and nobody would notice until it was live.
 *
 * So the finished state is not "animate to the right value". It is "no class, no
 * inline style, no transform" — the element falls back to the stylesheet it
 * always had. `entrance-playing` carries both the transition and the final
 * values, and when it is removed at the end there is nothing left to fall off.
 *
 * Three ways out, all of which end in the same visible hero:
 *   - reduced motion, or no `document.fonts`: complete immediately, never play.
 *   - the controller runs: play, then complete at 1700ms.
 *   - the controller never runs at all: the inline script in index.html strips
 *     the classes at 3500ms.
 */

const COMPLETE_AFTER_MS = 1700;
const FONT_GATE_MS = 250;

declare global {
  interface Window {
    __fuguEntranceFallback?: ReturnType<typeof setTimeout>;
  }
}

export function startEntrance(): () => void {
  const root = document.documentElement;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  let done = false;

  /**
   * Idempotent on purpose: it is called by the completion timer, by the reduced
   * motion path, and by React's cleanup, and any of the three can win.
   */
  function completeEntrance() {
    if (done) return;
    done = true;
    if (completionTimer !== undefined) clearTimeout(completionTimer);
    if (window.__fuguEntranceFallback !== undefined) {
      clearTimeout(window.__fuguEntranceFallback);
      window.__fuguEntranceFallback = undefined;
    }
    root.classList.remove("entrance-pending", "entrance-playing");
    root.dataset.entrance = "complete";
    root.dispatchEvent(new CustomEvent("fugu:entrance-complete", { bubbles: true }));
  }

  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced) {
    // A reader who asked for less motion gets the finished hero, not a fast one.
    completeEntrance();
    return completeEntrance;
  }

  // Wait for the fonts, but never longer than a quarter second: Kalam and Geist
  // come off a CDN and a slow one must not hold the hero hostage.
  const fontsReady: Promise<unknown> =
    typeof document.fonts !== "undefined" && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();

  Promise.race([fontsReady, new Promise((r) => setTimeout(r, FONT_GATE_MS))]).then(() => {
    if (done) return;
    // Double rAF: the first lands us in a frame, the second guarantees the
    // browser has taken the pending state as a style it already painted, so the
    // transition has something to move away from.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (done) return;
        root.classList.add("entrance-playing");
        root.classList.remove("entrance-pending");
        completionTimer = setTimeout(completeEntrance, COMPLETE_AFTER_MS);
      });
    });
  });

  return completeEntrance;
}
