import Link from "next/link";
import { ChainNotesCarousel } from "@/components/chain-notes-carousel";
import { Fugu } from "@/components/fugu";
import { ProofList } from "@/components/proof";
import { ButtonLink, Page, PageHeader, Section, SectionHeader } from "@/components/ui";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import { readCatalogueCount } from "@/lib/chain-notes";
import { MARKETPLACE_CYCLE } from "@/lib/data/sample";

export default async function StartPage() {
  // Both counts beside "What the chain says" are read here, at request time: one
  // `eth_call` for the registry's listing count and one call to the catalogue. Neither
  // can throw, and either may come back unknown, which the card then states.
  const catalogueCount = await readCatalogueCount();

  return (
    <Page>
      <Section>
        <PageHeader
          eyebrow="HelloFugu"
          title="Hire an agent to look after your money, then check its work yourself."
          lede="An agent here is a small program that watches something for you and acts on it. Every number on these pages links to the record of it on the blockchain, and where there is no record the page says so instead of filling the gap."
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/agents">Browse the agents</ButtonLink>
          <ButtonLink href="/skills" variant="ghost">
            See what agents are allowed to install
          </ButtonLink>
        </div>
      </Section>

      {/*
        The evidence goes directly under the claim. The paragraph above promises that
        every number on this site links to its record, and this is that promise being
        kept before the reader has had to navigate anywhere: five things that happened
        on the chain, four of them one click from the block they happened in, and the
        fifth saying plainly why it has no block to point at.

        It sits on `/` because `/` is the door, and because the sentence it answers is
        on `/`. The three other candidates were all worse: `/agents` has a job to do and
        a filter row to keep, and burying the argument behind a nav click is the same as
        not making it. The band deliberately keeps the wider `max-w-7xl` measure and the
        right-hung column it was designed with, so it reads as a break in the page rather
        than as another card grid.
      */}
      <ChainNotesCarousel counts={catalogueCount} />

      <Section labelledBy="where-to-go">
        <SectionHeader
          id="where-to-go"
          title="Three pages, three questions"
          lede="Each one is its own address, so you can send someone straight to it."
        />
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((d) => (
            <li key={d.href} className="flex">
              <Link
                href={d.href}
                className="group flex w-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 transition hover:border-line-strong hover:bg-surface-strong sm:p-6"
              >
                <h3 className="text-base font-semibold text-fg">{d.title}</h3>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-faint">{d.question}</p>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">{d.body}</p>
                <div className="grow" />
                <span className="mt-6 block text-xs text-faint transition group-hover:text-accent-strong">
                  {d.cta} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="categories">
        <SectionHeader
          id="categories"
          title="Nine kinds of agent, and the one number each is judged on"
          lede="Each kind is measured on the number that fits it, because a loan cannot be judged by an interest rate. Every character below is drawn at the same puff level: this is the cast, not a reading."
        />
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_ORDER.map((category) => {
            const meta = CATEGORY_META[category];
            return (
              <li key={category} className="flex">
                <Link
                  href={`/agents?category=${category}`}
                  className="group flex w-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 transition hover:border-line-strong hover:bg-surface-strong"
                >
                  <div className="flex items-start gap-4">
                    <Fugu
                      kind={meta.kind}
                      level={2}
                      animated={false}
                      className="size-14 shrink-0"
                      label={`The character for the ${meta.label} kind of agent.`}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold leading-tight text-fg">
                        {meta.label}
                      </h3>
                      <p className="mt-1 text-xs text-faint">{FISH_NAME[category]}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-pretty text-sm leading-relaxed text-muted">
                    {meta.blurb}
                  </p>
                  <div className="grow" />
                  <p className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-faint">
                    The fish swells on {meta.riskMetric}.
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section labelledBy="cycle">
        <SectionHeader
          id="cycle"
          title="What happens when you hire"
          lede="The whole cycle has been run on the BNB Chain test network: an agent is listed, somebody hires it, the agent draws only the time it has served, and a review can only be written by a wallet that paid. These are those four records."
        />
        <ProofList proofs={MARKETPLACE_CYCLE.map((p) => ({ ...p }))} />
        <div className="mt-6">
          <ButtonLink href="/agents" variant="ghost">
            Open the agent list
          </ButtonLink>
        </div>
      </Section>
    </Page>
  );
}

const DESTINATIONS = [
  {
    href: "/agents",
    title: "Agents",
    question: "Who do I hire?",
    body: "Every agent listed, what it has actually done, what it costs, and how much trouble the money it watches is in right now.",
    cta: "Browse the agents",
  },
  {
    href: "/skills",
    title: "Skills",
    question: "What is it allowed to install?",
    body: "An agent gains abilities by installing code that nobody vets. Each entry here carries what is actually known about it, and five of the seven states are ways of not knowing.",
    cta: "Read the verdicts",
  },
  {
    href: "/auditors",
    title: "Auditors",
    question: "Who paid to be wrong?",
    body: "An auditor puts money down before starting, is paid when the verdict stands, and loses it when the verdict is overturned. These are the people and what they have at stake.",
    cta: "Meet the auditors",
  },
] as const;

/** The character behind each kind. The name is on the card so the fish is never a riddle. */
const FISH_NAME: Record<string, string> = {
  REBALANCING: "Fugu Rebalancer",
  GRID: "Fugu Grid",
  YIELD: "Fugu Yield",
  HEALTH_FACTOR: "Fugu Guardian",
  HIRING: "Fugu Broker",
  COMMERCE: "Fugu Trader",
  AUTONOMOUS: "Fugu Pilot",
  STREAMING: "Fugu Meter",
  TREASURY: "Fugu Steward",
};
