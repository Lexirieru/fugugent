import { useEffect } from "react";
import {
  AGENTS_URL,
  APP_URL,
  HF_AFTER,
  HF_BEFORE,
  LIST_URL,
  RENTABLE,
  RENTAL_AMOUNT,
  RENTAL_TX_URL,
  REPAY_TX_URL,
  UPGRADE_TX_URL,
} from "./content";
import SiteFooter from "./Footer";
import InfoTip from "./InfoTip";
import { Ext, d } from "./ui";
import { startReveal } from "./reveal";
import {
  AgentsSection,
  BuiltOn,
  ClosingCta,
  FishScale,
  HonestSection,
  NextSection,
  ProofBento,
} from "./Sections";

function Header() {
  return (
    <header className="topbar wrap">
      <a className="brand" href="#top" aria-label="HelloFugu home">
        <img src="/logos/hellofugu-logo.webp" alt="" width={28} height={28} decoding="async" />
        <span>HelloFugu</span>
      </a>
      <Ext href={APP_URL} className="btn btn--ink btn--sm">
        Open the app
      </Ext>
    </header>
  );
}

/*
 * Split hero, adapted from MotionSites "Crypto Vault" (premium): copy in a rounded
 * pane on the left, a showcase pane on the right, the headline lines blurring in one
 * after another, and a card that flips into place inside decorative rings with a
 * dot travelling round them. Rebuilt in our light tokens; the card is our own Fugu
 * Guardian plate from /brand, not the prompt's stock art or video. It mirrors the
 * marketplace hero at app.hellofugu.xyz, which was built from the same prompt.
 */
function Hero() {
  return (
    <section className="hero wrap" aria-labelledby="hero-title">
      <div className="hero__copy">
        <p className="eyebrow hero-in" style={d(0)}>
          an agent marketplace on BNB Chain
        </p>
        <h1 className="hero__title" id="hero-title">
          <span className="hero-in" style={d(90)}>
            Hire an agent.
          </span>
          <span className="hero-in" style={d(190)}>
            Check its work
          </span>
          <span className="hero-in hero__accent" style={d(290)}>
            on chain.
          </span>
        </h1>
        <p className="hero__lede hero-in" style={d(420)}>
          DeFi agents built on BNB Agent Studio. Rent one, and the chain enforces its spending
          limit.{" "}
          <InfoTip label="What an agent is">
            An agent is a small program that watches a position for you and acts on it. Its key
            may only call a short, written list of functions, up to a daily cap.
          </InfoTip>
        </p>
        <div className="hero__ctas hero-in" style={d(520)}>
          <Ext href={AGENTS_URL} className="btn btn--accent">
            Browse agents <span aria-hidden="true">&#8599;</span>
          </Ext>
          <Ext href={LIST_URL} className="btn btn--ghost">
            List your agent
          </Ext>
        </div>
      </div>

      <div className="hero__show">
        <span className="hero__live">
          <span className="live-dot" aria-hidden="true" /> Live on BSC testnet
        </span>
        <div className="orbit" aria-hidden="true">
          <svg className="orbit__rings" viewBox="0 0 400 400">
            <circle cx="200" cy="200" r="198" />
            <circle cx="200" cy="200" r="148" />
            <circle cx="200" cy="200" r="98" />
          </svg>
          <span className="orbit__arm">
            <span className="orbit__dot" />
          </span>
        </div>
        <div className="hero__card">
          <img
            src="/brand/guardian.svg"
            alt="Fugu Guardian, the one agent that has repaid a real loan on chain"
            width={512}
            height={512}
            decoding="async"
            fetchPriority="high"
          />
        </div>
        <ul className="hero__pills">
          <li className="hero-pop" style={d(700)}>
            <Ext href={REPAY_TX_URL} className="pill">
              Health factor {HF_BEFORE} <span aria-hidden="true">&#8594;</span> {HF_AFTER}
            </Ext>
          </li>
          <li className="hero-pop" style={d(790)}>
            <Ext href={UPGRADE_TX_URL} className="pill">
              {RENTABLE} listings on chain
            </Ext>
          </li>
          <li className="hero-pop" style={d(880)}>
            <Ext href={RENTAL_TX_URL} className="pill">
              First rental: {RENTAL_AMOUNT}
            </Ext>
          </li>
        </ul>
      </div>
    </section>
  );
}

export default function App() {
  /*
   * The scroll reveal fails OPEN: nothing is hidden until every target is being
   * observed, reduced motion skips it entirely, and a 3s safety timer reveals
   * everything regardless. The long argument is in reveal.ts.
   */
  useEffect(() => startReveal(), []);

  return (
    <div className="site" id="top">
      <Header />
      <main>
        <Hero />
        <BuiltOn />
        <ProofBento />
        <AgentsSection />
        <FishScale />
        <HonestSection />
        <NextSection />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
