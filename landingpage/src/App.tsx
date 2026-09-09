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

function AppleIcon() {
  return (
    <svg
      width="15"
      height="18"
      viewBox="0 0 15 18"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.398 9.548c-.02-2.05 1.674-3.033 1.75-3.08-.953-1.394-2.436-1.585-2.964-1.606-1.262-.128-2.463.743-3.104.743-.64 0-1.628-.724-2.678-.704-1.377.02-2.647.8-3.356 2.032-1.431 2.48-.366 6.152 1.028 8.164.68.985 1.492 2.092 2.556 2.052 1.026-.041 1.414-.664 2.654-.664 1.24 0 1.589.664 2.674.644 1.104-.02 1.804-1.004 2.48-1.993.782-1.142 1.104-2.248 1.123-2.305-.025-.01-2.156-.827-2.178-3.283zM10.36 3.526C10.927 2.84 11.309 1.885 11.205.935c-.816.033-1.804.543-2.39 1.228-.526.607-.986 1.579-.862 2.51.91.07 1.84-.462 2.407-1.147z" />
    </svg>
  );
}

function DownloadButton() {
  return (
    <button type="button" className="download-btn" aria-label="Download HelloFugu">
      <AppleIcon />
      <span className="download-btn-label">Download</span>
    </button>
  );
}

export default function App() {
  return (
    <div className="page" id="top">
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
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260801_022931_e13cbef4-690a-42d2-b5ee-5b3b1f483c83.mp4"
          type="video/mp4"
        />
      </video>

      <header className="site-header">
        <a className="logo" href="#top" aria-label="HelloFugu home">
          <LogoMark />
          <span className="logo-word">HelloFugu</span>
        </a>
        <DownloadButton />
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-left">
            <p className="hero-eyebrow">AI agents to work for you</p>
            <h1 className="hero-title" id="hero-title">
              Let professional AI agents do the work for you.
            </h1>
            <DownloadButton />
          </div>
          <p className="hero-desc">
            Choose from a growing team of AI agents, each built to solve a
            specific problem professionally.
          </p>
        </section>
      </main>
    </div>
  );
}
