"use client";

/**
 * A small "i" that holds an explanation, so the page itself can stay short.
 *
 * Hover or keyboard focus shows it on desktop; a tap toggles it on touch screens,
 * where there is no hover. The text is always in the DOM and tied to the button with
 * `aria-describedby`, so a screen reader reads it without anyone having to open it.
 */

import { useId, useState, type ReactNode } from "react";

export function InfoTip({
  children,
  label = "More information",
  align = "center",
}: {
  children: ReactNode;
  label?: string;
  /** Which way the bubble opens, so a tip near a screen edge stays on screen. */
  align?: "center" | "start" | "end";
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const position =
    align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-4 items-center justify-center rounded-full border border-line-strong font-serif text-[10px] italic leading-none text-muted transition hover:border-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        i
      </button>
      <span
        id={id}
        role="tooltip"
        // `hidden` rather than transparent while closed: an invisible bubble still takes
        // up layout, and one near the right edge pushed a 390px page into sideways scroll.
        className={`pointer-events-none absolute top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface-strong px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-fg shadow-lg ${position} ${
          open ? "block" : "hidden group-hover:block group-focus-within:block"
        }`}
      >
        {children}
      </span>
    </span>
  );
}
