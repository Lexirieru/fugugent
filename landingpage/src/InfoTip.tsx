import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * A small "i" that holds the longer explanation, so the page itself can stay short.
 * The same idea as the marketplace's InfoTip (frontend/src/components/info-tip.tsx),
 * rebuilt without Tailwind classes so it matches this page's stylesheet.
 *
 * - Hover or focus opens it on desktop, a tap toggles it on touch screens.
 * - The text is always in the DOM and tied to the button with `aria-describedby`,
 *   so a screen reader gets it without anyone opening anything.
 * - The button is a 44px tap target; the visible circle inside it is small.
 * - While closed the bubble is `display: none`, so it can never widen the page.
 *   While open it is nudged back inside the viewport, which is what keeps a tip
 *   near the right edge of a 390px screen from causing sideways scroll.
 */
export default function InfoTip({
  children,
  label = "More information",
  tone = "light",
}: {
  children: ReactNode;
  label?: string;
  tone?: "light" | "dark";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!open || !bubble) return;
    bubble.style.setProperty("--shift", "0px");
    const r = bubble.getBoundingClientRect();
    const gutter = 12;
    const vw = document.documentElement.clientWidth;
    let shift = 0;
    if (r.left < gutter) shift = gutter - r.left;
    else if (r.right > vw - gutter) shift = vw - gutter - r.right;
    bubble.style.setProperty("--shift", `${Math.round(shift)}px`);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      className={`tip tip--${tone}`}
      onMouseEnter={() => {
        // Touch devices fire a synthetic mouseenter before click; let the click decide.
        if (window.matchMedia?.("(hover: hover)").matches) setOpen(true);
      }}
      onMouseLeave={() => {
        if (window.matchMedia?.("(hover: hover)").matches) setOpen(false);
      }}
    >
      <button
        type="button"
        className="tip__btn"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => {
          // With a mouse, hover already opened it and a click should not close it.
          if (window.matchMedia?.("(hover: hover)").matches) setOpen(true);
          else setOpen((v) => !v);
        }}
        onFocus={(e) => {
          // Keyboard focus opens it; the focus that comes with a tap is left to onClick.
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        <span className="tip__i" aria-hidden="true">
          i
        </span>
      </button>
      <span id={id} role="tooltip" ref={bubbleRef} className="tip__bubble" data-open={open || undefined}>
        {children}
      </span>
    </span>
  );
}
