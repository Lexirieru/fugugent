import type { Metadata } from "next";
import { Card, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { MyAgents } from "@/components/wallet/my-agents";
import { CHAIN, CONTRACTS, addressUrl, shorten } from "@/lib/chain";
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
          lede={`Any agent registered in the ERC-8004 IdentityRegistry on ${CHAIN.name} can be listed here by its owner. You set the price and the period; renters pay into escrow and it is released to you for the time your agent serves.`}
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
          lede="Three steps. Only the last one happens on this site."
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
              <p className="mt-2 text-pretty text-xs leading-relaxed text-muted">
                Put a name and a description that say what it does in the registration file:
                they are what renters read, and they are how this catalogue decides whether your
                agent is yield, grid, rebalancing or health factor.
              </p>
            </Card>
          </li>
          <li>
            <Card>
              <p className="text-xs uppercase tracking-[0.14em] text-faint">2 · Wait a few minutes</p>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-fg">
                This site reads the whole registry every five minutes, straight from the contract.
                Your agent appears under &ldquo;Your agents&rdquo; above once it has been read.
              </p>
            </Card>
          </li>
          <li>
            <Card>
              <p className="text-xs uppercase tracking-[0.14em] text-faint">3 · List it</p>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-fg">
                Open it, choose a category, a price and a period, and sign once. The contract checks
                that your wallet owns the ERC-8004 identity before it accepts the listing, so nobody
                else can list your agent and collect what it earns.
              </p>
            </Card>
          </li>
        </ol>
      </Section>
    </Page>
  );
}
