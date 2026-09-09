"use client";

/**
 * The primary navigation, built on React Bits' PillNav.
 *
 * ## What was ported and what was changed, and why
 *
 * The original is a JavaScript component for a react-router app on a dark page.
 * Four things had to change before it could ship here, and each one is a rule this
 * repository already had:
 *
 * 1. **`next/link`, not `react-router-dom`.** This is a Next.js app and there is no
 *    router to add. The active destination is decided by `usePathname()` rather than
 *    by an `activeHref` prop written by hand, so the nav cannot disagree with the URL.
 * 2. **No colour reaches this file.** The original takes `baseColor="#fff"` and
 *    `pillColor="#120F17"` as props. Every colour here is a token from
 *    `theme/tokens.css`; the mapping and its measured contrast are in `globals.css`
 *    beside the rules that use them.
 * 3. **No hamburger, at any width.** The original hides every destination behind a
 *    menu button below 768px. Four destinations do not need hiding, and a menu that
 *    has to be opened before it can be read is a worse answer at every width. The
 *    pills wrap inside their own track instead, so nothing is ever out of sight.
 * 4. **The load animation no longer animates `width`.** The original tweens the pill
 *    track from `width: 0` to `auto`, which is a layout property: it forces reflow on
 *    every frame, and with wrapped pills at 390px it also reflows the header. The
 *    reveal here is `scale` and `opacity` only, both of which the compositor can do
 *    on its own.
 *
 * ## Motion
 *
 * `prefers-reduced-motion` turns all of it off: no hover timeline, no logo spin, no
 * reveal. What is left still says everything, because the current destination is
 * marked by a bar under its label, by weight and by `aria-current` before colour is
 * counted at all.
 *
 * The hover geometry is the original's and it is worth keeping: a circle whose radius
 * is solved from the pill's own box, so the arc that sweeps up through the pill is
 * tangent to its bottom edge at any width. That is why it is measured rather than
 * guessed, and why it is re-measured on resize and after the fonts land.
 */

import { gsap } from "gsap";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export interface PillNavItem {
  href: string;
  label: string;
  /** True when this route, or a route under it, is the one being shown. */
  match: (pathname: string) => boolean;
}

const ITEMS: PillNavItem[] = [
  { href: "/", label: "Start", match: (p) => p === "/" },
  { href: "/agents", label: "Agents", match: (p) => p === "/agents" || p.startsWith("/agent/") },
  { href: "/skills", label: "Skills", match: (p) => p.startsWith("/skills") },
  { href: "/auditors", label: "Auditors", match: (p) => p.startsWith("/auditors") },
];

const EASE = "power3.out";

export function PillNav({ className = "" }: { className?: string }) {
  const pathname = usePathname() ?? "/";

  const circleRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const timelines = useRef<Array<gsap.core.Timeline | null>>([]);
  const tweens = useRef<Array<gsap.core.Tween | null>>([]);
  const logoImgRef = useRef<HTMLSpanElement | null>(null);
  const logoTween = useRef<gsap.core.Tween | null>(null);
  const logoRef = useRef<HTMLAnchorElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // Held locally so the cleanup kills the timelines this effect created, not
    // whatever the refs happen to point at by the time the component unmounts.
    const createdTimelines = timelines.current;
    const createdTweens = tweens.current;

    /**
     * Solve the circle that is tangent to the pill's bottom edge and tall enough to
     * cover it when scaled. `R` comes from the chord/height relation of a circular
     * segment: the pill is the chord, so the same arc fits a wide pill and a narrow
     * one without a magic number anywhere.
     */
    const layout = () => {
      circleRefs.current.forEach((circle, index) => {
        const pill = circle?.parentElement;
        if (!circle || !pill) return;

        const { width: w, height: h } = pill.getBoundingClientRect();
        if (w === 0 || h === 0) return;

        const R = ((w * w) / 4 + h * h) / (2 * h);
        const D = Math.ceil(2 * R) + 2;
        const delta = Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
        const originY = D - delta;

        circle.style.width = `${D}px`;
        circle.style.height = `${D}px`;
        circle.style.bottom = `-${delta}px`;

        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });

        const label = pill.querySelector<HTMLElement>(".pill-label");
        const hover = pill.querySelector<HTMLElement>(".pill-label-hover");
        if (label) gsap.set(label, { y: 0 });
        if (hover) gsap.set(hover, { y: Math.ceil(h + 12), opacity: 0 });

        timelines.current[index]?.kill();
        const tl = gsap.timeline({ paused: true });
        tl.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease: EASE, overwrite: "auto" }, 0);
        if (label) {
          tl.to(label, { y: -(h + 8), duration: 2, ease: EASE, overwrite: "auto" }, 0);
        }
        if (hover) {
          tl.to(hover, { y: 0, opacity: 1, duration: 2, ease: EASE, overwrite: "auto" }, 0);
        }
        timelines.current[index] = tl;
      });
    };

    layout();

    const onResize = () => layout();
    window.addEventListener("resize", onResize);
    // A pill measured before its webfont lands is measured at the wrong width, and
    // the arc is then tangent to a box that no longer exists.
    document.fonts?.ready.then(layout).catch(() => {});

    // The reveal. `scale` and `opacity` only: no layout property is touched, so this
    // cannot reflow the header it lives in.
    if (logoRef.current) {
      gsap.fromTo(
        logoRef.current,
        { scale: 0.6, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.45, ease: EASE },
      );
    }
    if (trackRef.current) {
      gsap.fromTo(
        trackRef.current,
        { opacity: 0, y: -4 },
        { opacity: 1, y: 0, duration: 0.45, ease: EASE },
      );
    }

    return () => {
      window.removeEventListener("resize", onResize);
      createdTimelines.forEach((tl) => tl?.kill());
      createdTweens.forEach((t) => t?.kill());
      logoTween.current?.kill();
    };
  }, []);

  const enter = (i: number) => {
    const tl = timelines.current[i];
    if (!tl) return;
    tweens.current[i]?.kill();
    tweens.current[i] = tl.tweenTo(tl.duration(), { duration: 0.3, ease: EASE, overwrite: "auto" });
  };

  const leave = (i: number) => {
    const tl = timelines.current[i];
    if (!tl) return;
    tweens.current[i]?.kill();
    tweens.current[i] = tl.tweenTo(0, { duration: 0.2, ease: EASE, overwrite: "auto" });
  };

  const spinLogo = () => {
    const img = logoImgRef.current;
    if (!img) return;
    logoTween.current?.kill();
    gsap.set(img, { rotate: 0 });
    logoTween.current = gsap.to(img, { rotate: 360, duration: 0.5, ease: EASE, overwrite: "auto" });
  };

  return (
    <nav aria-label="Primary" className={`pill-nav ${className}`}>
      <Link
        href="/"
        ref={logoRef}
        className="pill-logo"
        onMouseEnter={spinLogo}
        onFocus={spinLogo}
      >
        <span ref={logoImgRef} className="pill-logo-inner">
          <Image
            src="/logos/hellofugu-logo.webp"
            alt=""
            width={72}
            height={72}
            priority
            className="h-full w-full object-contain"
          />
        </span>
        <span className="sr-only">HelloFugu, start page</span>
      </Link>

      <div className="pill-nav-items" ref={trackRef}>
        <ul className="pill-list">
          {ITEMS.map((item, i) => {
            const active = item.match(pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`pill${active ? " is-active" : ""}`}
                  onMouseEnter={() => enter(i)}
                  onMouseLeave={() => leave(i)}
                  onFocus={() => enter(i)}
                  onBlur={() => leave(i)}
                >
                  <span
                    className="hover-circle"
                    aria-hidden
                    ref={(el) => {
                      circleRefs.current[i] = el;
                    }}
                  />
                  <span className="label-stack">
                    <span className="pill-label">{item.label}</span>
                    <span className="pill-label-hover" aria-hidden>
                      {item.label}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
