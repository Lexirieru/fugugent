import {
  AGENTS_URL,
  API_HEALTH_URL,
  AUDITORS_URL,
  CONTRACTS,
  LIST_URL,
  REPO_URL,
  SKILLS_URL,
  STATUS_DOC_URL,
  SUPPORT_URL,
  X_URL,
} from "./content";
import { Ext } from "./ui";

/**
 * The footer, in the marketplace's dark ink so the two read as one product: a band
 * of slowly drifting dots, link columns, and an oversized wordmark.
 *
 * The drifting dots and the wordmark follow the marketplace footer (itself after
 * MotionSites "Stark Minimal Footer"). The rest is adapted from MotionSites
 * "Playful Idea": a small pill badge over a heavy two-line headline, a character
 * sitting in the corner (our own fugu plate, not the prompt's video), and on a
 * phone the links fall into a two-column grid where every row is at least 44px
 * tall and each social icon sits in a 44px box.
 *
 * Two honest omissions carried over from the old footer: only GitHub and X, because
 * those are the only accounts that exist (X is the builder's own), and no email
 * capture, because there is no mailing list behind one.
 */

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

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function SiteFooter() {
  return (
    <footer className="foot">
      <div className="foot__dots" aria-hidden="true" />
      <div className="wrap foot__inner">
        <div className="foot__top">
          <div className="foot__hello">
            <span className="foot__badge">say hello</span>
            <p className="foot__headline">
              Every number,
              <br />
              on chain.
            </p>
            <div className="foot__social">
              <Ext href={REPO_URL} label="HelloFugu source code on GitHub">
                <GitHubIcon />
              </Ext>
              <Ext href={X_URL} label="HelloFugu on X">
                <XIcon />
              </Ext>
            </div>
          </div>

          <nav className="foot__col" aria-label="Product">
            <span className="foot__h">Product</span>
            <Ext href={AGENTS_URL}>Agents</Ext>
            <Ext href={LIST_URL}>List your agent</Ext>
            <Ext href={SKILLS_URL}>Skills</Ext>
            <Ext href={AUDITORS_URL}>Auditors</Ext>
            <Ext href={API_HEALTH_URL}>API health</Ext>
          </nav>

          <nav className="foot__col foot__col--contracts" aria-label="Contracts on BscScan">
            <span className="foot__h">Contracts</span>
            {CONTRACTS.map((c) => (
              <Ext key={c.address} href={c.url}>
                {c.name} <span className="foot__addr">{short(c.address)}</span>
              </Ext>
            ))}
          </nav>

          <nav className="foot__col" aria-label="Project">
            <span className="foot__h">Project</span>
            <Ext href={REPO_URL}>GitHub</Ext>
            <Ext href={STATUS_DOC_URL}>What is not built</Ext>
            <Ext href={SUPPORT_URL}>Support</Ext>
            {/* Served from this site, so `download` applies and it saves instead of opening. */}
            <a href="/hellofugu-brand-kit.zip" download>
              Brand kit ↓
            </a>
          </nav>
        </div>

        <a className="foot__mark" href="#top" aria-label="Back to the top">
          <img src="/logos/hellofugu-logo.webp" alt="" width={96} height={96} loading="lazy" />
          <span aria-hidden="true">HelloFugu</span>
        </a>

        <div className="foot__fine">
          <p>
            Built for the BNB Chain hackathon. Test network only, no real money has ever been at
            stake.
          </p>
          <img className="foot__fish" src="/brand/guardian-kembung-2.svg" alt="" loading="lazy" />
        </div>
      </div>
    </footer>
  );
}
