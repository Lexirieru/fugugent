import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ConnectControl } from "@/components/wallet/connect-button";
import { WalletProvider } from "@/components/wallet/provider";
import { CHAIN, CONTRACT_LIST, addressUrl, shorten } from "@/lib/chain";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description =
  "Browse DeFi agents on BNB Chain, see the proof behind every number, and hire one with an on-chain subscription. Each agent is a pufferfish that swells as its risk grows.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.hellofugu.xyz"),
  title: {
    default: "Fugugent — hire a DeFi agent you can check",
    template: "%s — Fugugent",
  },
  description,
  applicationName: "Fugugent",
  openGraph: {
    type: "website",
    url: "https://app.hellofugu.xyz",
    siteName: "Fugugent",
    title: "Fugugent — hire a DeFi agent you can check",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Fugugent — hire a DeFi agent you can check",
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <WalletProvider>
          <SiteHeader />
          <main className="flex-1 pb-20">{children}</main>
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-5 py-3 sm:px-8">
        <Link href="/" className="text-sm font-semibold tracking-tight text-fg">
          Fugugent
        </Link>
        <span className="hidden text-xs text-faint sm:inline">Marketplace</span>
        <span className="grow" />
        <span className="hidden items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent sm:inline-flex">
          {CHAIN.name}
        </span>
        <ConnectControl />
        <a
          href="https://hellofugu.xyz"
          className="hidden text-xs text-muted transition hover:text-fg sm:inline"
          target="_blank"
          rel="noreferrer noopener"
        >
          About ↗
        </a>
      </div>
    </header>
  );
}

/**
 * The footer carries all four contract addresses, and not as decoration: anyone who
 * wants to check a claim on this page can start here without having to ask.
 */
function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
        <p className="text-xs uppercase tracking-[0.16em] text-faint">
          Live contracts · chain id {CHAIN.id}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CONTRACT_LIST.map((c) => (
            <li key={c.address}>
              <a
                href={addressUrl(c.address)}
                target="_blank"
                rel="noreferrer noopener"
                className="block rounded-xl border border-line px-3 py-2.5 transition hover:border-line-strong hover:bg-surface"
              >
                <span className="block text-sm font-medium text-fg">{c.name}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-accent/80">
                  {shorten(c.address)} ↗
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-faint">{c.role}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-faint">
          Testnet only. All four implementations are deployed, exercised end to end, and verified
          on BscScan, so the explorer shows Solidity rather than bytecode — the links above go
          straight to the source. Nothing on this site is financial advice, and every strategy on it
          can lose money.
        </p>
      </div>
    </footer>
  );
}
