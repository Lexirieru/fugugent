import { APP_URL, PLANE_VIDEO_URL } from "./content";

/*
 * The original hero, restored as the first screen: "Buy an agent like you buy an app."
 * over the aircraft video. Its markup and measurements are the pre-redesign ones
 * (commit a9c105e^), including `--ph-video-offset-y`, the offset the repo owner set by
 * hand against the video. Classes are prefixed `ph-` so they cannot collide with the
 * split hero that now follows it.
 */
export default function PlaneHero() {
  return (
    <section className="ph-page" aria-labelledby="ph-title">
      {/* The video is the stage's background layer; header and copy float above it. */}
      <video className="ph-video" aria-hidden="true" autoPlay loop muted playsInline preload="metadata">
        <source src={PLANE_VIDEO_URL} type="video/mp4" />
      </video>

      <header className="ph-header">
        <a className="ph-logo" href="#top" aria-label="HelloFugu home">
          <img src="/logos/hellofugu-logo.webp" alt="" width={22} height={22} decoding="async" />
          <span>HelloFugu</span>
        </a>
        <a
          href={APP_URL}
          className="ph-btn"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Launch the HelloFugu app in a new tab"
        >
          <span className="ph-btn-label">Launch app</span>
        </a>
      </header>

      <div className="ph-hero">
        <div className="ph-left">
          <p className="ph-eyebrow">an agent marketplace on BNB Chain</p>
          <h1 className="ph-title" id="ph-title">
            Buy an agent like you buy an app.
          </h1>
          <a href={APP_URL} className="ph-btn" target="_blank" rel="noopener noreferrer">
            <span className="ph-btn-label">Launch app</span>
          </a>
        </div>
        <p className="ph-desc">Built on BNB Agent Studio. Rent one, and the chain enforces its spending limit.</p>
      </div>
    </section>
  );
}
