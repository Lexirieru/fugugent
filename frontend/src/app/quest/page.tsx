import type { Metadata } from "next";
import Link from "next/link";
import { Fugu } from "@/components/fugu";
import { CheckAgent } from "@/components/quest/check-agent";
import { QuestProgress } from "@/components/quest/progress";
import { Card, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { FIRST_PARTY } from "@/lib/agents";
import { walletEnabled } from "@/lib/wallet/config";

export const metadata: Metadata = {
  title: "Set and Earn",
  description: "BNB Chain's Set and Earn campaign, step by step: register, get tBNB, hire 3 agents, build 1.",
};

const CAMPAIGN = "https://www.bnbchain.org/en/hackathons/smart-money-era-set-and-earn?tab=tracks";
const FAUCET = "https://www.bnbchain.org/en/testnet-faucet";

/** Cheap, and each one hands back something you can read on /me while it runs. */
const PICKS = [
  { id: "97:2513", name: "Fugu Watch", price: "$0.02", does: "Reads your loan's health factor and says how safe it is." },
  { id: "97:2517", name: "Fugu Quote", price: "$0.02", does: "Turns a dollar price into BNB at the live rate." },
  { id: "97:2514", name: "Fugu Tally", price: "$0.02", does: "Adds up what your wallet has spent hiring agents here." },
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="flex gap-4">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-fg font-mono text-sm font-semibold text-bg">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">{children}</div>
        </div>
      </div>
    </Card>
  );
}

const ext = "text-accent-strong underline underline-offset-4";

export default function QuestPage() {
  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="Set and Earn · Oct 1 to Nov 5"
          title="Do Set and Earn from here."
          lede="BNB Chain's campaign: hire 3 agents across 2 marketplaces and build 1 of your own. The first 100 wallets to do both get merch."
        />
      </Section>

      <Section labelledBy="steps">
        <SectionHeader id="steps" title="Four steps" />
        <div className="grid gap-4">
          <Step n={1} title="Register your wallet with BNB Chain">
            <p>
              Only registered wallets count, and only one wallet per person.{" "}
              <a href={CAMPAIGN} target="_blank" rel="noreferrer noopener" className={ext}>
                Register on the campaign page ↗
              </a>
            </p>
          </Step>

          <Step n={2} title="Get free testnet BNB">
            <p>
              Hiring here costs a few cents of testnet BNB, which is free.{" "}
              <a href={FAUCET} target="_blank" rel="noreferrer noopener" className={ext}>
                Open the faucet ↗
              </a>
            </p>
          </Step>

          <Step n={3} title="Hire 3 different agents, on at least 2 marketplaces">
            <p>Three cheap ones to start with. Each runs for 2 minutes, and while it runs, My agents shows what it found for you.</p>
            <ul className="grid gap-3 sm:grid-cols-3">
              {PICKS.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/agent/${encodeURIComponent(p.id)}#hire`}
                    className="flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-line bg-bg p-3 transition hover:border-line-strong hover:bg-surface-strong"
                  >
                    <Fugu kind={FIRST_PARTY[p.id] ?? "fallback"} level={null} seed={p.id} label={p.name} className="size-10 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg">{p.name}</span>
                      <span className="mt-0.5 block text-xs text-muted">{p.does}</span>
                      <span className="mt-1 block font-mono text-xs text-fg">{p.price} / 2 min</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {walletEnabled ? <QuestProgress /> : null}
            <p>
              Or <Link href="/agents" className={ext}>browse all agents</Link>.
            </p>
          </Step>

          <Step n={4} title="Build 1 agent and list it">
            <p>
              Register it on the ERC-8004 registry with your campaign wallet, then{" "}
              <Link href="/list" className={ext}>list it here</Link>. To count, it needs a working agent card, at least 3 completed hires from other people, and at least 5 real transactions on 3 different days.
            </p>
            <CheckAgent />
          </Step>
        </div>
      </Section>

      <Section labelledBy="fair">
        <SectionHeader id="fair" title="Play fair" />
        <Card>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>One wallet per person. Several wallets funded from one place are excluded.</li>
            <li>Hiring and cancelling straight away just to tick a box is excluded. Hire what you want to try.</li>
            <li>Nobody on the HelloFugu team can take part, and our own wallets are listed so BNB Chain can leave them out.</li>
          </ul>
          <p className="mt-4 text-xs text-faint">
            BNB Chain decides who qualifies.{" "}
            <a href={CAMPAIGN} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
              Full rules ↗
            </a>
          </p>
        </Card>
      </Section>
    </Page>
  );
}
