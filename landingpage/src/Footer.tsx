import { useEffect, useRef } from "react";
import {
  AGENTS_URL,
  API_HEALTH_URL,
  AUDITORS_URL,
  CONTRACTS,
  PLANE_VIDEO_URL,
  REPO_URL,
  SKILLS_URL,
  STATUS_DOC_URL,
  X_URL,
} from "./content";

/**
 * The footer: two cards side by side, a badge that overhangs the right one, and a
 * giant faded wordmark underneath.
 *
 * Two decisions in here are not stylistic.
 *
 * 1. There are two social icons, GitHub and X, and no others. Discord and
 *    LinkedIn are the obvious pair to add and we do not have either account.
 *    An icon that links to a page that does not exist is worse than no icon.
 *    The X account is the builder's own, and its label says so.
 *
 * 2. There is no email capture. The original composition ends with a subscribe
 *    field and a submit button, and there is no subscription endpoint behind it
 *    and no plan to build one. A box that swallows somebody's address and does
 *    nothing is exactly the small dishonesty this whole page argues against, so
 *    the row keeps its shape and is a link to the status document instead.
 */

/** The wordmark under the footer, fitted so its glyph edges meet the container. */
function Watermark() {
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const text = textRef.current;
    if (!svg || !text) return;

    /**
     * `viewBox` is set from the rendered glyph box rather than guessed, because
     * the wordmark is set in a webfont: until Geist has actually arrived the
     * fallback's metrics are different and a hard-coded viewBox leaves a visible
     * margin on one side. Measured after `fonts.ready`, and again on resize.
     */
    const fit = () => {
      try {
        const box = text.getBBox();
        if (box.width < 1 || box.height < 1) return;
        svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
      } catch {
        /* getBBox throws on a subtree that is not rendered. Keep the default. */
      }
    };

    fit();
    if (typeof document.fonts !== "undefined" && document.fonts.ready) {
      document.fonts.ready.then(fit).catch(() => undefined);
    }
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div className="footer-watermark" aria-hidden="true">
      <svg ref={svgRef} viewBox="62 95 876 175" preserveAspectRatio="xMidYMid meet">
        <text ref={textRef} x="500" y="240" textAnchor="middle" fontSize="320">
          HelloFugu
        </text>
      </svg>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12.6 1.5h2.34l-5.11 5.84L15.85 15h-4.7L7.47 10.2 3.25 15H.9l5.47-6.25L.35 1.5h4.82l3.33 4.4 3.9-4.4Zm-.82 12.1h1.3L4.28 2.83H2.89l8.89 10.77Z" />
    </svg>
  );
}

function LuckyArrow() {
  return (
    <svg
      className="lucky-arrow"
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 20 C 6 14, 10 9, 18 5" />
      <path d="M18 5 L 12 5" />
      <path d="M18 5 L 18 11" />
    </svg>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-wrapper">
        <div className="footer-left">
          {/* The same aircraft as the hero, and then a scrim over it. The
              composition this came from says no overlay, and that instruction
              assumes a dark video; ours is a cream sky, on which white text
              measures about 1.1:1 and simply is not there. The rule in
              index.css carries the measured numbers and the note to delete it
              if the video is ever replaced with a dark one. */}
          <video
            className="footer-video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
          >
            <source src={PLANE_VIDEO_URL} type="video/mp4" />
          </video>
          <span className="footer-scrim" aria-hidden="true" />

          <div className="footer-logo">
            <span className="footer-logo-mark">
              <img src="/logos/hellofugu-logo.webp" alt="" aria-hidden="true" width={20} height={20} />
            </span>
            <span className="footer-logo-name">HelloFugu</span>
          </div>

          <div className="footer-tagline-container">
            <p className="footer-tagline">
              Buy an agent like you buy an app.
              <span>Rent one, and the chain holds its spending limit.</span>
            </p>
          </div>

          <div className="footer-social-row">
            <span className="footer-social-label">say hello</span>
            <div className="footer-social-icons">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="HelloFugu source code on GitHub"
              >
                <GitHubIcon />
              </a>
              <a
                href={X_URL}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="The builder's account on X"
              >
                <XIcon />
              </a>
            </div>
          </div>
        </div>

        <div className="footer-right">
          <div className="footer-lucky-graphic" aria-hidden="true">
            <div className="lucky-cube">
              <img src="/logos/hellofugu-logo.webp" alt="" width={44} height={44} />
            </div>
            <div className="lucky-text-row">
              <LuckyArrow />
              <span className="lucky-text">nine listed, one has acted</span>
            </div>
          </div>

          <div className="footer-nav-cols">
            <div className="footer-nav-col">
              <h3>Explore</h3>
              <a href={AGENTS_URL} target="_blank" rel="noreferrer noopener">
                Agents
              </a>
              <a href={SKILLS_URL} target="_blank" rel="noreferrer noopener">
                Skills
              </a>
              <a href={AUDITORS_URL} target="_blank" rel="noreferrer noopener">
                Auditors
              </a>
              <a href={API_HEALTH_URL} target="_blank" rel="noreferrer noopener">
                API health
              </a>
            </div>
            <div className="footer-nav-col">
              <h3>Project</h3>
              <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
              <a href={CONTRACTS[0].url} target="_blank" rel="noreferrer noopener">
                Contracts on BscScan
              </a>
              <a href={STATUS_DOC_URL} target="_blank" rel="noreferrer noopener">
                What is not built
              </a>
            </div>
          </div>

          <div className="footer-bottom">
            <p className="footer-copyright">
              Built for the BNB Chain hackathon. Test network only, no real money has
              ever been at stake.
            </p>
            <div className="footer-cta-mini">
              <h4>
                Want the unflattering version?
                <strong>The status document lists what does not work.</strong>
              </h4>
              {/* Shaped like the subscribe row it replaces, and honest about it:
                  there is no mailing list, so this goes somewhere real instead. */}
              <a
                className="footer-subscribe-row"
                href={STATUS_DOC_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span className="footer-subscribe-text">No mailing list. Read it on GitHub.</span>
                <span className="footer-subscribe-button">Open</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      <Watermark />
    </footer>
  );
}
