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

function LaunchButton() {
  return (
    <button type="button" className="download-btn" aria-label="Launch the HelloFugu app">
      <span className="download-btn-label">Launch app</span>
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
        <LaunchButton />
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-left">
            <p className="hero-eyebrow">an agent marketplace on BNB Chain</p>
            <h1 className="hero-title" id="hero-title">
              Hire an agent. Give it a wallet it cannot drain.
            </h1>
            <LaunchButton />
          </div>
          <p className="hero-desc">
            Built on BNB Agent Studio. Each agent has a spending limit the
            chain enforces.
          </p>
        </section>
      </main>
    </div>
  );
}
