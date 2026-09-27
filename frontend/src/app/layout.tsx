import type { Metadata } from "next";
import { Geist, Geist_Mono, Kalam } from "next/font/google";
import Image from "next/image";
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
    site: "@hellofuguai",
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
 * centre whatever the wallet button says. On a phone the network and wallet sit in a
 * bar above that scrolls away, and only the nav row stays pinned; nothing hides behind
 * a menu.
 */
function SiteHeader() {
  const network = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-strong">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      {CHAIN.name}
    </span>
  );
  return (
    <>
      {/* Phone: the network and the wallet sit in a slim bar that scrolls away, so the
          sticky header below is only the nav, not two rows eating the screen. */}
      <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
        {network}
        <ConnectControl />
      </div>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center px-4 py-2.5 sm:grid-cols-[1fr_auto_1fr] sm:px-8 sm:py-3">
          <span className="hidden justify-self-start sm:block">{network}</span>
          <PillNav className="justify-self-center" />
          <span className="hidden justify-self-end sm:block">
            <ConnectControl />
          </span>
        </div>
      </header>
    </>
  );
}

/**
 * The footer carries all five contract addresses, and not as decoration: anyone who
 * wants to check a claim on this site can start here without having to ask.
 */
function SiteFooter() {
  const link = "inline-block text-sm font-medium text-bg/85 transition hover:translate-x-0.5 hover:text-bg";
  return (
    <footer className="site-footer mt-16 bg-fg text-bg">
      <div className="footer-dots" aria-hidden />
      <div className="mx-auto w-full max-w-6xl px-5 pb-8 pt-10 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <h2 className="max-w-sm text-3xl font-light leading-tight tracking-tight text-bg sm:text-4xl">
            Every number, on chain.
          </h2>

          <nav aria-label="Product" className="flex flex-col items-start gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-bg/50">Product</span>
            <Link href="/agents" className={link}>Agents</Link>
            <Link href="/list" className={link}>List your agent</Link>
            <Link href="/skills" className={link}>Skills</Link>
            <Link href="/auditors" className={link}>Auditors</Link>
          </nav>

          {/* The contracts every page reads from, each one click from its source on BscScan. */}
          <nav aria-label={`Contracts on network ${CHAIN.id}`} className="flex min-w-0 flex-col items-start gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-bg/50">Contracts</span>
            {CONTRACT_LIST.map((c) => (
              <a
                key={c.address}
                href={addressUrl(c.address)}
                target="_blank"
                rel="noreferrer noopener"
                title={c.role}
                className="group min-w-0 text-sm text-bg/85 transition hover:text-bg"
              >
                <span className="font-medium">{c.name.replace("ERC-8004 ", "")}</span>{" "}
                <span className="font-mono text-[11px] text-bg/50 group-hover:text-bg/80">{shorten(c.address, 6, 4)} ↗</span>
              </a>
            ))}
          </nav>

          <nav aria-label="Help" className="flex flex-col items-start gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-bg/50">Help</span>
            <a href="https://github.com/Lexirieru/fugugent/issues/new" target="_blank" rel="noreferrer noopener" className={link}>
              Support ↗
            </a>
            <a href="https://github.com/Lexirieru/fugugent" target="_blank" rel="noreferrer noopener" className={link}>
              GitHub ↗
            </a>
            <a href="https://x.com/hellofuguai" target="_blank" rel="noreferrer noopener" className={link}>
              X ↗
            </a>
            <a href="https://hellofugu.xyz/hellofugu-brand-kit.zip" className={link}>
              Brand kit ↓
            </a>
            <a href="https://hellofugu.xyz" target="_blank" rel="noreferrer noopener" className={link}>
              About ↗
            </a>
          </nav>
        </div>

        <Link href="/" aria-label="HelloFugu home" className="mt-12 flex items-center gap-4 text-bg">
          <Image
            src="/logos/hellofugu-logo.webp"
            alt=""
            width={96}
            height={96}
            className="size-[clamp(40px,6vw,96px)] shrink-0 rounded-full"
          />
          <span className="min-w-0 truncate pb-[0.12em] text-[clamp(44px,11vw,150px)] font-bold leading-[0.9] tracking-[-0.055em]">
            HelloFugu
          </span>
        </Link>

        <p className="mt-6 text-[11px] text-bg/50">
          BSC testnet ({CHAIN.id}) only. Contracts verified on BscScan. Not financial advice.
        </p>
      </div>
    </footer>
  );
}
