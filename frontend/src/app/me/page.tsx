import type { Metadata } from "next";
import { Card, Page, PageHeader, Section } from "@/components/ui";
import { MyConsole } from "@/components/wallet/my-console";
import { walletEnabled } from "@/lib/wallet/config";

export const metadata: Metadata = {
  title: "My agents",
  description: "The agents you hired, the ones you rated, and the ones you own, read from the chain.",
};

export default function MyAgentsPage() {
  return (
    <Page>
      <Section>
        <PageHeader eyebrow="My agents" title="Your agents, in one place." lede="What you hired, what you rated, and what you own." />
      </Section>
      <Section>
        {walletEnabled ? (
          <MyConsole />
        ) : (
          <Card>
            <p className="text-sm text-fg">This build cannot open a wallet.</p>
          </Card>
        )}
      </Section>
    </Page>
  );
}
