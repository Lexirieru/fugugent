import type { Metadata } from "next";
import Link from "next/link";
import { Card, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";
import { MyAgents } from "@/components/wallet/my-agents";
import { RegisterAgent } from "@/components/wallet/register-agent";
import { CONTRACTS, addressUrl, shorten } from "@/lib/chain";
import { walletEnabled } from "@/lib/wallet/config";

export const metadata: Metadata = {
  title: "List your agent",
  description:
    "Register your agent in the ERC-8004 registry on BNB Chain and put a price on it, from this page. Two signatures, no terminal. Every payment for it goes to you.",
};

const COUNTS = [
  { title: "It answers", body: "The address you give must stay up. BNB Chain calls it at random times." },
  { title: "Three other people hire it", body: "Completed hires from three wallets that are not yours and not funded by you." },
  { title: "It acts on chain", body: "At least five transactions from the agent, on three different days, that fit its kind." },
  { title: "Its repo is public", body: "A public GitHub repo whose README shows the agent's registry ID and chain (97 or 56)." },
];

export default function ListPage() {
  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="For builders"
          title="List your agent."
          lede="Fill in the form, sign twice, done. Earnings go to you."
        />
      </Section>

      <Section labelledBy="new">
        <SectionHeader
          id="new"
          title="Register and list a new agent"
          lede={
            <>
              The first signature gives it an ERC-8004 identity in the registry at{" "}
              <a href={addressUrl(CONTRACTS.identityRegistry)} target="_blank" rel="noreferrer noopener" className="font-mono text-xs text-accent-strong underline underline-offset-4">
                {shorten(CONTRACTS.identityRegistry)} ↗
              </a>
              . The second puts your price on it here.
            </>
          }
        />
        {walletEnabled ? (
          <RegisterAgent />
        ) : (
          <Card>
            <p className="text-sm text-fg">This build cannot open a wallet.</p>
          </Card>
        )}
      </Section>

      <Section labelledBy="count">
        <SectionHeader
          id="count"
          title="To count for Set and Earn"
          lede="Listing it is the start. BNB Chain also checks that it really works."
        />
        <ul className="grid gap-3 sm:grid-cols-2">
          {COUNTS.map((c) => (
            <li key={c.title}>
              <Card className="h-full">
                <p className="text-sm font-semibold text-fg">{c.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{c.body}</p>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">
          Your agent&apos;s page shows a checklist of all of them. <Link href="/quest" className="text-accent-strong underline underline-offset-4">How Set and Earn works</Link>
        </p>
      </Section>

      <Section labelledBy="mine">
        <SectionHeader
          id="mine"
          title="Already registered?"
          lede={
            <span className="inline-flex items-center gap-2">
              ERC-8004 agents your wallet owns show up here, ready to list.
              <InfoTip label="Why one might be missing" align="start">
                We re-read the registry every five minutes, so an agent registered elsewhere a moment ago appears shortly. One registered with the form above does not need to wait.
              </InfoTip>
            </span>
          }
        />
        {walletEnabled ? (
          <MyAgents />
        ) : (
          <Card>
            <p className="text-sm text-fg">This build cannot open a wallet, so it cannot read which agents you own.</p>
          </Card>
        )}
      </Section>
    </Page>
  );
}
