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
 * Navigation in the middle, the network on the left, the wallet on the right.
 *
 * Desktop is a three-column grid with equal outer columns, so the nav sits in the true
 * centre whatever the wallet button says. On a phone the network and wallet share the
 * top row and the nav gets its own centred row below; nothing hides behind a menu.
 */
function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 items-center gap-y-3 px-4 py-3 sm:grid-cols-[1fr_auto_1fr] sm:px-8">
        <span className="justify-self-start">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-strong">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            {CHAIN.name}
          </span>
        </span>
        <PillNav className="order-last col-span-2 justify-self-center sm:order-none sm:col-span-1" />
        <span className="justify-self-end">
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
          <Link href="/list" className="text-muted transition hover:text-fg">
            List your agent
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
          BSC testnet only. Contracts verified on BscScan. Not financial advice.
        </p>
      </div>
    </footer>
  );
}
