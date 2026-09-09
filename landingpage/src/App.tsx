import { useEffect } from "react";
import { PLANE_VIDEO_URL } from "./content";
import { startEntrance } from "./entrance";
import Features from "./Features";
import SiteFooter from "./Footer";
import RailMarquee from "./RailMarquee";
import { startReveal } from "./reveal";
import {
  AgentsSection,
  HonestSection,
  NextSection,
  ProofSection,
  RecordSection,
} from "./Sections";
import Showcase from "./Showcase";
import Triptych from "./Triptych";

function LogoMark() {
  return (
    <img
      className="logo-mark"
      src="/logos/hellofugu-logo.webp"
      alt=""
      aria-hidden="true"
      width={22}
      height={22}
      decoding="async"
    />
  );
}

/**
 * The marketplace lives on its own subdomain, so this is a link and not a button.
 * It was a `<button>` with no handler, which looked right and did nothing at all.
 *
 * `target="_blank"` because the two are separate products and a reader who opens
 * the app has not finished with this page. `rel="noopener"` goes with it: without
 * it the opened tab can reach back through `window.opener` and navigate this one.
 */
function LaunchButton() {
  return (
    <a
      href="https://app.hellofugu.xyz"
      className="download-btn"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Launch the HelloFugu app in a new tab"
    >
      <span className="download-btn-label">Launch app</span>
    </a>
  );
}

export default function App() {
  /*
   * Two controllers, and both of them are written to end in the page you would
   * get if they had never run.
   *
   * `startEntrance` plays the hero once and then removes every class it added,
   * so the finished hero is the stylesheet's hero and nothing else. That is not
   * a nicety: the composition below was calibrated against the aircraft video by
   * hand, `--video-offset-y` is a lever the repo owner set himself, and an
   * entrance that left a transform behind would move it by a hair.
   *
   * `startReveal` is the one that can silently destroy the page, so it is the
   * one with three separate ways to fail open. The long note in reveal.ts has
   * the argument.
   *
   * `useEffect` rather than `useLayoutEffect`: the hidden state comes from the
   * inline script in index.html, which has already run, so there is nothing to
   * flash. React's own render is not on the critical path for it.
   */
  useEffect(() => {
    const stopEntrance = startEntrance();
    const stopReveal = startReveal();
    return () => {
      stopEntrance();
      stopReveal();
    };
  }, []);

  return (
    <div className="site" id="top">
      <main className="site-main">
        <div className="page">
          {/* Background layer. It sits outside <main> on purpose: as a child of <main> an
          absolutely positioned video anchors to <main>, which is only as tall as the
          hero, so it collapses into a band and paints over the headline. */}
          <video
            className="media-placeholder"
            aria-label="HelloFugu product preview"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          >
            <source src={PLANE_VIDEO_URL} type="video/mp4" />
          </video>

          <header className="site-header">
            <a className="logo" href="#top" aria-label="HelloFugu home">
              <LogoMark />
              <span className="logo-word">HelloFugu</span>
            </a>
            <LaunchButton />
          </header>

          <div className="hero-body">
            <section className="hero" aria-labelledby="hero-title">
              <div className="hero-left">
                <p className="hero-eyebrow">
                  an agent marketplace on BNB Chain
                </p>
                <h1 className="hero-title" id="hero-title">
                  Buy an agent like you buy an app.
                </h1>
                <LaunchButton />
              </div>
              <p className="hero-desc">
                Built on BNB Agent Studio. Rent one, and the chain enforces its
                spending limit.
              </p>
            </section>
          </div>
        </div>

        <RailMarquee />

        {/*
         * The scaled part of the page. Everything inside measures itself against
         * this element with container query units rather than against the
         * viewport, because container units exclude the scrollbar and `vw` does
         * not: on Windows that difference is seventeen pixels of horizontal
         * overflow at every width. The `vw` form is still there as the fallback
         * for browsers without container queries.
         */}
        <div className="scale-root">
          <Features />
          <Showcase />
        </div>

        <Triptych />
        <AgentsSection />
        <RecordSection />
        <ProofSection />
        <NextSection />
        <HonestSection />
      </main>

      <SiteFooter />
    </div>
  );
}
