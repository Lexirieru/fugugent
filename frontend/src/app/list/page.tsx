import type { Metadata } from "next";
import { Card, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { InfoTip } from "@/components/info-tip";
import { MyAgents } from "@/components/wallet/my-agents";
import { CONTRACTS, addressUrl, shorten } from "@/lib/chain";
import { walletEnabled } from "@/lib/wallet/config";

export const metadata: Metadata = {
  title: "List your agent",
  description:
    "Register your agent in the ERC-8004 registry on BNB Chain, then put a price on it here. Every payment for it goes to you.",
};

export default function ListPage() {
  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="For builders"
          title="List your agent."
          lede="Register it on ERC-8004, then set a price here. Earnings go to you."
        />
      </Section>

      <Section labelledBy="mine">
        <SectionHeader id="mine" title="Your agents" />
        {walletEnabled ? (
          <MyAgents />
        ) : (
          <Card>
            <p className="text-sm text-fg">This build cannot open a wallet, so it cannot read which agents you own.</p>
          </Card>
        )}
      </Section>

      <Section labelledBy="how">
        <SectionHeader
          id="how"
          title="How it works"
          lede="Three steps."
        />
        <ol className="space-y-4">
          <li>
            <Card>
              <p className="text-xs uppercase tracking-[0.14em] text-faint">1 · Register the agent</p>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-fg">
                Give it an ERC-8004 identity in the registry at{" "}
                <a
                  href={addressUrl(CONTRACTS.identityRegistry)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-xs text-accent-strong underline decoration-accent/40 underline-offset-4"
                >
                  {shorten(CONTRACTS.identityRegistry)} ↗
                </a>
                . With BNB Agent Studio that is one command:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg-elev px-3 py-2 font-mono text-xs text-fg">
                bag erc8004 register --endpoint https://your-agent.example
              </pre>
              <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted">
                Describe what it does
                <InfoTip label="Why the description matters" align="start">
                  Renters read it, and it decides whether your agent is yield, grid, rebalancing or health factor.
                </InfoTip>
              </p>
            </Card>
          </li>
          <li>
            <Card>
              <p className="text-xs uppercase tracking-[0.14em] text-faint">2 · Wait a few minutes</p>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-fg">
                It appears under &ldquo;Your agents&rdquo; within five minutes.
              </p>
            </Card>
          </li>
          <li>
            <Card>
              <p className="text-xs uppercase tracking-[0.14em] text-faint">3 · List it</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-fg">
                Pick a category, price and period, then sign once.
                <InfoTip label="Who can list it" align="end">
                  The contract checks that your wallet owns the ERC-8004 identity, so nobody else can list your agent.
                </InfoTip>
              </p>
            </Card>
          </li>
        </ol>
      </Section>
    </Page>
  );
}
