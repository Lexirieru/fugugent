import Link from "next/link";
import { ChainNotesCarousel } from "@/components/chain-notes-carousel";
import { Fugu } from "@/components/fugu";
import { InfoTip } from "@/components/info-tip";
import { ButtonLink, Page, Section, SectionHeader } from "@/components/ui";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import { txUrl } from "@/lib/chain";
import { readHireableCount } from "@/lib/chain-notes";
import { MARKETPLACE_CYCLE } from "@/lib/data/sample";

/**
 * Rendered per request, and the reason is one number.
 *
 * The card beside "What the chain says" quotes `listingCount()` from the registry and
 * tells the reader it was read just now. Statically prerendered, "just now" would mean
 * "whenever this was last deployed", and a count frozen at build time is the same stale
 * number this section was rebuilt to get rid of, only harder to notice. The read is one
 * `eth_call` behind a 4 second ceiling that degrades to no number at all, so the cost of
 * saying it honestly is small and bounded.
 *
 * The copy on this page is deliberately short: a title and at most one short line per
 * section. Anything longer lives in an `InfoTip` beside the thing it explains. Every
 * tx hash stays visible as a link.
 */
export const dynamic = "force-dynamic";

export default async function StartPage() {
  // The count beside "What the chain says" is read here, at request time: one `eth_call`
  // for the registry's listing count. It cannot throw, and it may come back unknown,
  // which the card then states rather than filling in from memory.
  const hireableCount = await readHireableCount();

  return (
    <Page>
      {/*
        Split hero, after MotionSites' "Crypto Vault": copy in a rounded pane on the left,
        a showcase pane on the right, lines blurring in one after another. Rebuilt in this
        site's light tokens; the showcase is our own fugu and live numbers, not stock art.
      */}
      <Section>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col justify-between rounded-[28px] border border-line bg-surface p-6 sm:p-10">
            <div>
              <p className="blur-in text-xs font-semibold uppercase tracking-[0.18em] text-accent-strong">
                HelloFugu
              </p>
              <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-6xl">
                <span className="blur-in block" style={{ animationDelay: "120ms" }}>Hire an agent.</span>
                <span className="blur-in block" style={{ animationDelay: "220ms" }}>Check its work</span>
                <span className="blur-in block text-accent-strong" style={{ animationDelay: "320ms" }}>on chain.</span>
              </h1>
              <p className="blur-in mt-6 max-w-md text-pretty text-base leading-relaxed text-muted" style={{ animationDelay: "440ms" }}>
                DeFi agents on BNB Chain. Every number links to its record.{" "}
                <InfoTip label="What an agent is" align="start">
                  An agent is a small program that watches something for you and acts on it.
                  Where there is no on-chain record, the page says so instead of filling the gap.
                </InfoTip>
              </p>
            </div>
            <div className="blur-in mt-10 flex flex-wrap gap-3" style={{ animationDelay: "540ms" }}>
              <ButtonLink href="/agents">Browse the agents</ButtonLink>
              <ButtonLink href="/list" variant="ghost">
                List your agent
              </ButtonLink>
            </div>
          </div>

          <div className="relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden rounded-[28px] bg-accent-soft p-6 sm:min-h-[420px]">
            <span className="absolute left-6 top-5 text-xs text-accent-strong/80">Live on BSC testnet</span>
            <Fugu
              kind="guardian"
              level={2}
              seed="hero"
              label="Fugu Guardian, the agent that has repaid a real loan on chain"
              className="bento-in size-40 sm:size-52"
            />
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                { value: hireableCount.hireable === null ? "Agents" : `${hireableCount.hireable} hireable`, href: hireableCount.href },
                { value: "ERC-8004 registry", href: "/agents" },
                { value: "No token approvals", href: "/agent/97:2480#hire" },
              ].map((pill, i) => (
                <Link
                  key={pill.value}
                  href={pill.href}
                  className="bento-in rounded-full border border-accent/30 bg-surface px-3 py-1.5 text-xs font-medium text-fg transition hover:border-accent"
                  style={{ animationDelay: `${600 + i * 90}ms` }}
                >
                  {pill.value}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/*
        The evidence goes directly under the claim. The line above promises that every
        number on this site links to its record, and this is that promise being kept
        before the reader has had to navigate anywhere: five things that happened on the
        chain, four of them one click from the block they happened in, and the fifth
        saying plainly why it has no block to point at.

        It sits on `/` because `/` is the door, and because the sentence it answers is
        on `/`. The band deliberately keeps the wider `max-w-7xl` measure and the
        right-hung column it was designed with, so it reads as a break in the page rather
        than as another card grid.
      */}
      <ChainNotesCarousel counts={hireableCount} />

      <Section labelledBy="where-to-go">
        <SectionHeader id="where-to-go" title="Where to go" />
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
          title={
            <>
              Nine kinds of agent{" "}
              <InfoTip label="How each kind is judged">
                Each kind is judged on the number that fits it; a loan is not judged by an
                interest rate. Every fish here is drawn at the same level: a cast, not a reading.
              </InfoTip>
            </>
          }
          lede="Each fish swells on its own risk number."
        />
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_ORDER.map((category) => {
            const meta = CATEGORY_META[category];
            // The whole card is one link, stretched from the title, so the tip can be its
            // own button without nesting a button inside a link. The tip sits on the card's
            // right edge and opens leftward, which keeps it on screen at 390px.
            return (
              <li
                key={category}
                className="relative flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 transition hover:border-line-strong hover:bg-surface-strong"
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
                      <Link
                        href={`/agents?category=${category}`}
                        className="after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
                      >
                        {meta.label}
                      </Link>
                    </h3>
                    <p className="mt-1 text-xs text-faint">{FISH_NAME[category]}</p>
                  </div>
                  <span className="relative z-10 shrink-0">
                    <InfoTip label={`What makes the ${meta.label} fish swell`} align="end">
                      It swells on {meta.riskMetric}.
                    </InfoTip>
                  </span>
                </div>
                <p className="mt-4 text-pretty text-sm leading-relaxed text-muted">{meta.blurb}</p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section labelledBy="cycle">
        <SectionHeader
          id="cycle"
          title={
            <>
              What happens when you hire{" "}
              <InfoTip label="About these records" align="end">
                Listed, hired, paid only for time served, reviewed only by a wallet that paid.
                The whole cycle ran on BNB Chain testnet.
              </InfoTip>
            </>
          }
          lede="Four steps, each a real testnet transaction."
        />
        {/* The cycle's own rows rather than `ProofList`: that list makes the whole row a
            link, and the detail tip is a button, which may not sit inside a link. The
            hash stays visible and opens BscScan. */}
        <ol className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {MARKETPLACE_CYCLE.map((p, i) => (
            <li
              key={p.hash}
              className="flex gap-4 border-t border-line px-4 py-4 first:border-t-0 sm:px-5"
            >
              <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium leading-snug text-fg">{p.label}</span>
                  <InfoTip label="The numbers behind this step" align="end">
                    {p.detail}
                  </InfoTip>
                </span>
                <a
                  href={txUrl(p.hash)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-2 block break-all font-mono text-xs text-accent-strong underline decoration-accent/40 underline-offset-4 transition hover:decoration-accent-strong"
                >
                  {p.hash} ↗
                </a>
              </span>
            </li>
          ))}
        </ol>
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
    body: "What each agent has done, what it costs, how risky it is now.",
    cta: "Browse the agents",
  },
  {
    href: "/skills",
    title: "Skills",
    question: "What can it install?",
    body: "Code agents install that nobody vets, and what is known about it.",
    cta: "Read the verdicts",
  },
  {
    href: "/auditors",
    title: "Auditors",
    question: "Who paid to be wrong?",
    body: "Auditors stake money on a verdict and lose it if overturned.",
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
