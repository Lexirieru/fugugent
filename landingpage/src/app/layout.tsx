import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A marketplace for DeFi agents on BNB Chain. Every agent is a pufferfish that swells as its risk grows — and every number links to a transaction you can open yourself.";

export const metadata: Metadata = {
  metadataBase: new URL("https://fugugent.xyz"),
  title: "Fugugent — the fish puffs up as your risk does",
  description,
  applicationName: "Fugugent",
  keywords: [
    "BNB Chain",
    "DeFi agent",
    "agent marketplace",
    "health factor",
    "session key",
    "on-chain verification",
  ],
  openGraph: {
    type: "website",
    url: "https://fugugent.xyz",
    siteName: "Fugugent",
    title: "Fugugent — the fish puffs up as your risk does",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "Fugugent — the fish puffs up as your risk does",
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-fg">{children}</body>
    </html>
  );
}
