import type { Metadata } from "next";
import { Geist, Geist_Mono, Kalam } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { PillNav } from "@/components/pill-nav";
import { ConnectControl } from "@/components/wallet/connect-button";
import { WalletProvider } from "@/components/wallet/provider";
import { CHAIN, CONTRACT_LIST, addressUrl, shorten } from "@/lib/chain";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Kalam, the handwritten face the landing page uses for its eyebrows, and the reason
 * `globals.css` no longer says this app declines to load it.
 *
 * It is here for exactly one word: the emphasised word in the "What the chain says"
 * heading on the start page. That heading was ported with a second face built into it,
 * and the brand already owns a handwritten face, so the alternative was either to load
 * a foreign one or to drop the only thing that stops a 44px heading reading like every
 * other 44px heading in the hackathon.
 *
 * One weight, latin only, and `next/font` self-hosts it and preloads it only on the
 * routes that use it, so the pages that do not carry the word do not carry the file.
 */
const kalam = Kalam({
  variable: "--font-kalam",
  subsets: ["latin"],
  weight: "700",
  display: "swap",
});

const description =
  "Browse DeFi agents on BNB Chain, see the proof behind every number, and hire one with a subscription recorded on the blockchain. Each agent is a pufferfish that swells as its risk grows.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.hellofugu.xyz"),
  title: {
    default: "HelloFugu, hire a DeFi agent you can check",
    template: "%s · HelloFugu",
  },
  description,
  applicationName: "HelloFugu",
  openGraph: {
    type: "website",
    url: "https://app.hellofugu.xyz",
    siteName: "HelloFugu",
    title: "HelloFugu, hire a DeFi agent you can check",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "HelloFugu, hire a DeFi agent you can check",
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${kalam.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <WalletProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}

/**
 * The header carries the whole product in one line: which page you are on, which
 * network you are on, and whether a wallet is connected.
 *
 * `PillNav` sits in normal flow here rather than at the `position: absolute; top: 1em`
 * its stylesheet ships with, which would have covered the wallet control. The header
 * keeps its sticky behaviour and nothing ends up underneath anything.
 *
 * At 390px the nav takes a full-width row of its own below the wallet control and its
 * pills wrap inside their own track. Nothing is hidden behind a menu button at any
 * width, and the logo is the way back to the start page rather than a second link
 * with a second name for it.
 */
function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 sm:px-8">
        <PillNav className="order-last w-full sm:order-none sm:w-auto" />
        <span className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-strong">
            {CHAIN.name}
          </span>
          <ConnectControl />
        </span>
      </div>
    </header>
  );
}

/**
 * The footer carries all five contract addresses, and not as decoration: anyone who
 * wants to check a claim on this site can start here without having to ask.
 */
function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
        <h2 className="text-xs uppercase tracking-[0.16em] text-faint">
          Live contracts on network {CHAIN.id}
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {CONTRACT_LIST.map((c) => (
            <li key={c.address} className="flex">
              <a
                href={addressUrl(c.address)}
                target="_blank"
                rel="noreferrer noopener"
                className="flex w-full flex-col rounded-xl border border-line px-3 py-3 transition hover:border-line-strong hover:bg-surface"
              >
                <span className="block text-sm font-medium text-fg">{c.name}</span>
                <span className="mt-1 block font-mono text-[11px] text-accent-strong">
                  {shorten(c.address)} ↗
                </span>
                <span className="mt-2 block text-[11px] leading-snug text-faint">{c.role}</span>
              </a>
            </li>
          ))}
        </ul>

        <nav
          aria-label="Elsewhere"
          className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs"
        >
          <Link href="/agents" className="text-muted transition hover:text-fg">
            Agents
          </Link>
          <Link href="/skills" className="text-muted transition hover:text-fg">
            Skills
          </Link>
          <Link href="/auditors" className="text-muted transition hover:text-fg">
            Auditors
          </Link>
          <a
            href="https://hellofugu.xyz"
            className="text-muted transition hover:text-fg"
            target="_blank"
            rel="noreferrer noopener"
          >
            About HelloFugu ↗
          </a>
        </nav>

        <p className="mt-8 max-w-3xl text-xs leading-relaxed text-faint">
          Test network only. All five contracts are deployed, exercised end to end, and verified on
          BscScan, so the explorer shows the source code rather than raw bytes. The links above go
          straight to it. Nothing on this site is financial advice, and every strategy on it can
          lose money.
        </p>
      </div>
    </footer>
  );
}
