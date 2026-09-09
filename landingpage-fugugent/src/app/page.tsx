import { Fugu } from "@/components/fugu";
import { BrandFugu } from "@/components/brand-fugu";
import { PuffMeter } from "@/components/puff-meter";
import { Eyebrow, H2, Lede, ProofList, Section } from "@/components/ui";
import {
  ALTANA,
  CHAIN,
  CONTRACTS,
  DEPLOYER_RESCUE,
  GUARDIAN_RESCUE,
  MARKETPLACE_CYCLE,
  SESSION_GRANT,
  VERIFY_COMMAND,
  addressUrl,
  txUrl,
} from "@/lib/chain";

/*
  Page language: English. The BNB Chain hackathon judges come from many countries, and
  every piece of evidence this page links to (BscScan, contract function names) is in
  English too. Code comments and commits are in English as well.
*/

const REPAY_TX = GUARDIAN_RESCUE.find((p) => p.id === "repay")!.hash!;

/* --------------------------------------------------------------------- nav */

const NAV = [
  { href: "#read", label: "How to read a fugu" },
  { href: "#agents", label: "Agents" },
  { href: "#proof", label: "Proof" },
  { href: "#limits", label: "Limits" },
  { href: "#status", label: "Status" },
];

function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-5 py-3 sm:px-8">
        <a href="#top" className="flex shrink-0 items-center gap-2">
          <Fugu puff={0.25} className="h-8 w-8" animated={false} />
          <span className="text-sm font-semibold tracking-tight">Fugugent</span>
        </a>
        <nav className="hidden flex-1 items-center justify-center gap-6 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[13px] text-muted transition hover:text-fg"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <a
          href={txUrl(REPAY_TX)}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto shrink-0 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-[#151004] transition hover:brightness-110 lg:ml-0"
        >
          Verify on BscScan ↗
        </a>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- hero */

function Hero() {
  return (
    <section id="top" className="relative w-full overflow-hidden px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
      <div
        aria-hidden
        className="fugu-drift pointer-events-none absolute left-1/2 top-[-14rem] -z-10 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full opacity-[0.22] blur-3xl"
        style={{ background: "radial-gradient(circle, #1e7f8c 0%, transparent 68%)" }}
      />
      <div className="mx-auto w-full max-w-5xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
          BNB Chain testnet · chainId {CHAIN.id} · The Smart Money Era
        </p>

        <h1 className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          The fish puffs up as your risk does.
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted">
          Fugugent is a marketplace for DeFi agents on BNB Chain. Every agent is a pufferfish, and
          its real risk metric is its size — so you read the state of a position in one glance
          instead of one spreadsheet. Every number below opens a transaction you can check yourself.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={txUrl(REPAY_TX)}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-[#151004] transition hover:brightness-110"
          >
            Open the rescue transaction ↗
          </a>
          <a
            href="#status"
            className="rounded-full border border-line px-5 py-2.5 text-sm text-fg transition hover:border-line-strong hover:bg-surface"
          >
            See what is not built yet
          </a>
        </div>

        <div className="mt-12">
          <PuffMeter />
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <HeroStat
            value="1.14 → 1.50"
            label="health factor, recovered by a real repay"
            href={txUrl(REPAY_TX)}
          />
          <HeroStat
            value="2 calls"
            label="everything the agent’s key is allowed to make"
            href="#limits"
            external={false}
          />
          <HeroStat
            value="4 contracts"
            label="UUPS, live on BSC testnet"
            href="#proof"
            external={false}
          />
        </dl>
      </div>
    </section>
  );
}

function HeroStat({
  value,
  label,
  href,
  external = true,
}: {
  value: string;
  label: string;
  href: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className="rounded-2xl border border-line bg-surface px-4 py-4 transition hover:border-line-strong hover:bg-surface-strong"
    >
      <dt className="font-mono text-lg tabular-nums text-fg">{value}</dt>
      <dd className="mt-1 text-[13px] leading-snug text-muted">
        {label} {external ? "↗" : "→"}
      </dd>
    </a>
  );
}

/* ------------------------------------------------------ how to read a fugu */

/*
 * Two scales, two questions. `state` is the puff level — how puffed the fish is, and
 * therefore how risky the position is. `name` is the action identifier taken verbatim
 * from the decision engine (decide.ts), so it cannot imply an action the code does not
 * have. Rendering them in different registers — prose for the state, a code token for
 * the action — is what keeps a reader from mistaking one for the other; two prose
 * scales cannot be told apart by careful word choice alone.
 */
const SCALE = [
  { puff: 0, band: "HF > 1.50", state: "Calm", name: "NONE", note: "Agent watches. Spends nothing." },
  { puff: 0.34, band: "1.20 – 1.50", state: "Watchful", name: "WARN", note: "Explains itself, touches nothing." },
  { puff: 0.62, band: "1.10 – 1.20", state: "Strained", name: "PARTIAL_REPAY", note: "Repays back up to 1.50. No further." },
  { puff: 0.86, band: "1.00 – 1.10", state: "Critical", name: "DELEVERAGE", note: "Collateral has to come down." },
  { puff: 1, band: "≤ 1.00", state: "Emergency", name: "EMERGENCY", note: "Past the point an agent can save." },
];

const PUFF_METRICS = [
  { agent: "Fugu Guardian", metric: "distance to liquidation", defined: true },
  { agent: "Fugu Grid", metric: "drawdown", defined: true },
  { agent: "Fugu Rebalancer", metric: "time spent out of range", defined: true },
  { agent: "Fugu Yield", metric: "not defined yet", defined: false },
];

function HowToRead() {
  return (
    <Section id="read" className="border-t border-line">
      <Eyebrow>The one idea</Eyebrow>
      <H2>One number decides the shape.</H2>
      <Lede>
        A pufferfish inflates when it is threatened. So does ours — driven by the agent’s own risk
        metric, not by decoration. The bands below are the literal thresholds in Guardian’s decision
        code: <span className="font-mono text-fg">1.50</span>,{" "}
        <span className="font-mono text-fg">1.20</span>,{" "}
        <span className="font-mono text-fg">1.10</span>. Nothing is rounded for looks.
      </Lede>

      <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SCALE.map((s) => (
          <li
            key={s.name}
            className="flex flex-col items-center rounded-2xl border border-line bg-surface px-3 py-5 text-center"
          >
            <Fugu puff={s.puff} className="h-20 w-20" animated={false} />
            <span className="mt-3 font-mono text-[11px] tabular-nums text-faint">{s.band}</span>
            <span className="mt-1 text-sm font-medium">{s.state}</span>
            <span className="mt-0.5 font-mono text-[11px] tracking-wide text-faint">{s.name}</span>
            <span className="mt-1 text-xs leading-snug text-muted">{s.note}</span>
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Each category inflates on its own metric</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          A health-factor agent and a grid bot do not share a risk number, so they do not share a
          formula. Forcing them onto one APR would be the easy lie.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {PUFF_METRICS.map((m) => (
            <li
              key={m.agent}
              className="flex flex-wrap items-baseline gap-x-2 rounded-xl border border-line px-3 py-2.5 text-sm"
            >
              <span className="font-medium">{m.agent}</span>
              <span className="text-faint">→</span>
              <span className={m.defined ? "text-muted" : "text-stress"}>{m.metric}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-faint">
          Fugu Yield has no puff metric yet, so we left it empty instead of inventing one. An empty
          field you can trust is worth more than a filled one you cannot.
        </p>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- four categories */

const AGENTS = [
  {
    name: "Fugu Guardian",
    slug: "guardian",
    category: "Health Factor",
    puff: 0.82,
    protocols: "Venus · Aave v3",
    trigger: "Health factor falls below the threshold",
    action: "Partial repay, top up collateral, or just warn",
    metric: "Puffs on: distance to liquidation",
    state: "proven" as const,
    stateLabel: "Strategy proven on-chain",
    caveat:
      "Proven against MockLendingPool — our own Aave-v3-shaped pool, whose collateral price we control. The read → decide → execute chain is real. The lending protocol is not: Guardian has never touched Venus or Aave.",
  },
  {
    name: "Fugu Rebalancer",
    slug: "rebalancer",
    category: "Rebalancing",
    puff: 0.45,
    protocols: "PancakeSwap v3",
    trigger: "Price leaves the range, drifts from centre, or the interval elapses",
    action: "Recompute the range, check it still pays after gas, slippage and IL, then move it",
    metric: "Puffs on: time spent out of range",
    state: "scaffold" as const,
    stateLabel: "Advises, cannot act yet",
    caveat: null,
  },
  {
    name: "Fugu Grid",
    slug: "grid",
    category: "Grid Trading",
    puff: 0.6,
    protocols: "PancakeSwap v3 swaps",
    trigger: "A keeper watches slot0(); price crosses a grid level",
    action: "Execute the swap at that level and record the fill",
    metric: "Puffs on: drawdown",
    state: "scaffold" as const,
    stateLabel: "Advises, cannot act yet",
    caveat:
      "Structurally mean-reverting: it loses money in trending markets. That sentence belongs on the product page, not in a footnote.",
  },
  {
    name: "Fugu Yield",
    slug: "yield",
    category: "Yield Optimisation",
    puff: 0.3,
    protocols: "Venus · Aave v3 · Lista",
    trigger: "APR gap exceeds the cost of moving the position",
    action: "Move into the best risk-weighted pool",
    metric: "Puff metric not defined yet",
    state: "scaffold" as const,
    stateLabel: "Advises, cannot act yet",
    caveat: null,
  },
];

function Agents() {
  return (
    <Section id="agents" className="border-t border-line">
      <Eyebrow>Four categories</Eyebrow>
      <H2>Four fugu. Four different ways to be at risk.</H2>
      <Lede>
        Each agent runs a deterministic, back-testable strategy. No financial decision ever passes
        through a language model — the model only explains, afterwards, in words.
      </Lede>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {AGENTS.map((a) => (
          <article
            key={a.slug}
            className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5"
          >
            <div className="flex items-start gap-4">
              <BrandFugu
                src={`/brand/fugu-${a.slug}.png`}
                puff={a.puff}
                alt={`${a.name} pufferfish`}
                className="h-16 w-16 shrink-0 object-contain"
              />
              <div className="min-w-0">
                <h3 className="text-base font-semibold leading-tight">{a.name}</h3>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-faint">{a.category}</p>
                <span
                  className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    a.state === "proven"
                      ? "bg-[color-mix(in_srgb,var(--calm)_16%,transparent)] text-calm"
                      : "border border-line text-faint"
                  }`}
                >
                  {a.stateLabel}
                </span>
              </div>
            </div>

            <dl className="mt-5 space-y-2.5 text-sm">
              <Row term="Target protocols" desc={a.protocols} />
              <Row term="Trigger" desc={a.trigger} />
              <Row term="Action" desc={a.action} />
            </dl>

            <p className="mt-4 font-mono text-xs text-faint">{a.metric}</p>

            {a.caveat ? (
              <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-muted">
                {a.caveat}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <p className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 text-sm leading-relaxed text-muted">
        Only Guardian has a strategy today. The other three exist as Agent Studio projects with their
        own wallet and a bounded session key — and nothing more. Four identical-looking cards would
        have been easy to write; this grid is what is actually true.
      </p>
    </Section>
  );
}

function Row({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-xs uppercase tracking-[0.1em] text-faint">{term}</dt>
      <dd className="text-[13px] leading-snug text-muted">{desc}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------- proof */

function Proof() {
  return (
    <Section id="proof" className="border-t border-line">
      <Eyebrow>On-chain proof</Eyebrow>
      <H2>A real position, actually rescued.</H2>
      <Lede>
        Not a unit test and not a diagram. One Guardian cycle ran against a live position on BSC
        testnet: it read the position, decided on its own, paid down debt, and the health factor came
        back — re-read from the chain at the transaction’s own block, not from a log we wrote.
      </Lede>

      <h3 className="mt-10 text-sm font-semibold uppercase tracking-[0.14em] text-faint">
        The rescue, step by step
      </h3>
      <div className="mt-3">
        <ProofList proofs={GUARDIAN_RESCUE} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        The proof script imports the strategy modules unchanged and exits non-zero the moment a
        single claim fails against the chain — including the claim of how much was repaid. Its
        failing path was run for real too: exit 1, and the testnet price restored anyway.
      </p>

      <h3 className="mt-12 text-sm font-semibold uppercase tracking-[0.14em] text-faint">
        The key that signed it
      </h3>
      <div className="mt-3">
        <ProofList proofs={[SESSION_GRANT, DEPLOYER_RESCUE]} numbered={false} />
      </div>

      <h3 className="mt-12 text-sm font-semibold uppercase tracking-[0.14em] text-faint">
        The marketplace lifecycle, run on the real network
      </h3>
      <div className="mt-3">
        <ProofList proofs={MARKETPLACE_CYCLE} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Whole cycle cost 0.0015 tBNB. 147 contract tests including a 256-run fuzz; 285 tests on the
        Guardian strategy layer.
      </p>

      <h3 className="mt-12 text-sm font-semibold uppercase tracking-[0.14em] text-faint">
        The contracts
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {CONTRACTS.map((c) => (
          <li key={c.address}>
            <a
              href={addressUrl(c.address)}
              target="_blank"
              rel="noreferrer noopener"
              className="block rounded-2xl border border-line bg-surface px-4 py-4 transition hover:border-line-strong hover:bg-surface-strong"
            >
              <span className="text-sm font-medium">{c.name} ↗</span>
              <span className="mt-1 block text-[13px] leading-snug text-muted">{c.role}</span>
              <span className="mt-2 block break-all font-mono text-[11px] text-faint">
                {c.address}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Upgradeable (UUPS), deployed, and source-verified on BscScan. Each proxy resolves to its
        implementation, so the Read/Write as Proxy tab works — you can call these contracts from a
        browser with no tooling at all.
      </p>
    </Section>
  );
}

/* ----------------------------------------------- a bounded session key */

const NOT_PROVEN = [
  "The receipt cannot tell an admin key apart from a session key. What closes that gap is the rejection above: an admin key would never have been refused.",
  "The rejection leaves no on-chain trace. It was stopped before broadcast, so there is nothing to link to — only the verbatim error.",
  "Altana permissions bind a contract and a selector, not argument values. A wide approve is held back by the spend cap and by third-party relay behaviour that zeroes the allowance at the end of the userOp — behaviour we found empirically, not a guarantee we control.",
];

function SessionKey() {
  return (
    <Section id="limits" className="border-t border-line">
      <Eyebrow>Bounded permission</Eyebrow>
      <H2>The agent holds a key that can do exactly two things.</H2>
      <Lede>
        Hiring an agent does not mean handing over your wallet. You grant it a session key on your
        own account, with a written list of what it may call, a daily spending cap and an expiry
        date. The account contract enforces that list — not our backend, and not our good intentions.
      </Lede>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold text-calm">Allowed — the whole list</h3>
          <ul className="mt-3 space-y-2 font-mono text-[13px] leading-relaxed">
            <li className="break-all rounded-xl border border-line px-3 py-2.5">
              MockLendingPool.repay(address,uint256)
            </li>
            <li className="break-all rounded-xl border border-line px-3 py-2.5">
              mUSD.approve(address,uint256)
            </li>
          </ul>
          <dl className="mt-4 space-y-2 text-[13px]">
            <Row term="Daily cap" desc={ALTANA.dailyCap} />
            <Row term="Expires" desc={ALTANA.expiry} />
            <Row term="Registered" desc="Publicly, in the Altana Keystore" />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-faint">
            An empty call list means unlimited permission in Altana. That is why this list is written
            out explicitly, every time.
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold text-critical">Refused — we attacked it ourselves</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Seconds after the successful repay, the same key tried to move one wei of your own
            tokens to somebody else. The Altana account contract refused it.
          </p>
          <pre className="mt-4 min-w-0 overflow-x-auto rounded-xl border border-line bg-bg-elev p-3 font-mono text-[11px] leading-relaxed text-muted">
{`Reason: UnauthorizedCall

Details: UnauthorizedCall(
  keyHash: 0x80c191a2…,
  target:  0x932e8263…,   // mUSD
  data:    0xa9059cbb…    // transfer(address,uint256)
)`}
          </pre>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Zero gas. Never broadcast. Balances did not move by a single wei.{" "}
            <span className="text-fg">mBNB.approve</span> was refused too — which proves the binding
            holds on the contract <em>and</em> the selector, not merely one of them.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            The test demands the error genuinely be UnauthorizedCall and name the contract it tried.
            A dead relay throws too — that is a broken test, not a proof, and it is treated as one.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold">Verify the key yourself. No API key, no account.</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The Keystore at{" "}
          <a
            href={addressUrl(ALTANA.keystore)}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all font-mono text-[13px] text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            {ALTANA.keystore}
          </a>{" "}
          will answer anyone.
        </p>
        <pre className="mt-4 min-w-0 overflow-x-auto rounded-xl border border-line bg-bg-elev p-3 font-mono text-[11px] leading-relaxed text-muted">
{VERIFY_COMMAND}
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          The permission list itself is hash-committed, so the chain proves the key exists and is
          valid, not what it may call. What proves the contents is the rejection above.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold">What this does not prove</h3>
        <ul className="mt-3 space-y-3">
          {NOT_PROVEN.map((item) => (
            <li key={item.slice(0, 24)} className="flex gap-3 text-sm leading-relaxed text-muted">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-stress" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ------------------------------------------ why everything is linked */

function WhyLinks() {
  return (
    <Section className="border-t border-line">
      <Eyebrow>Why every number is a link</Eyebrow>
      <H2>Trust in agent dashboards is already broken.</H2>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <p className="text-base leading-relaxed text-muted">
            In February 2026, Giza wound down ARMA and returned user funds. Its successor kept
            advertising large assets-under-agent while independent on-chain measurement showed
            positions close to zero. The dashboards were not wrong in an interesting way — they were
            simply unauditable, and nobody could check.
          </p>
          <p className="mt-4 text-base leading-relaxed text-muted">
            So we set one rule and let the page be shorter for it:{" "}
            <span className="text-fg">
              a number that cannot be clicked through to a transaction does not ship
            </span>
            . That is why this page shows a health factor and four transaction hashes rather than a
            TVL counter.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm font-medium">The rule, concretely</p>
          <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-muted">
            <li>Every metric resolves to a tx hash or a public call anyone can repeat.</li>
            <li>Anything unproven is labelled unproven, in the same size type.</li>
            <li>A missing link is stated as missing, with the reason.</li>
            <li>No AUM, no APY headline, no roadmap presented as a feature.</li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ status */

const LIVE = [
  "Four UUPS contracts deployed on BSC testnet, with the full list → hire → withdraw → review cycle run on the real network.",
  "Four agents, each with its own wallet and a bounded session key registered on-chain. Anyone can check validity with one eth_call.",
  "Guardian’s strategy layer, running inside the agent runtime we serve: pure health-factor maths rounded toward safety, a deterministic decision engine, spend cap, cooldown, and a kill switch whose state survives a restart. 285 tests.",
  "A repay executed by a bounded session key, and the same key refused the moment it stepped outside its allowlist.",
  "BNB Agent Studio running: bag doctor 14 PASS / 0 FAIL, serving A2A + MCP, answering negotiate with a wallet-signed quote.",
];

const NOT_LIVE = [
  "The marketplace app. There is no app.hellofugu.xyz to open yet — this page is the only thing that is live.",
  "A public deployment. The backend runs on Docker Compose with a four-level fallback proven live, but nothing is hosted anywhere yet.",
  "A repay sent through the runtime. The runtime now runs the strategy and serves it over A2A and MCP, but the one proven repay still came from the E2E script.",
  "On-chain execution for three of the four agents. Rebalancer, Grid and Yield have decision engines, backtests and live A2A/MCP tools — they can advise, they cannot act.",
  "The backtest has measured nothing. There is a harness and a synthetic price series, and not one historical price in the repo.",
  "Reads run on mainnet while execution runs on testnet, because Venus and Aave only exist on mainnet. That is a limitation, not a design.",
  "A kill switch button. The lever exists and an external MCP client can pull it; what it stops has only been proven in unit tests, and there is no UI for it.",
  "A signed hire. The Reown connect flow and the full signing path exist, but no wallet with tBNB has ever signed one here.",
];

function StatusHonest() {
  return (
    <Section id="status" className="border-t border-line">
      <Eyebrow>Status, in full</Eyebrow>
      <H2>What is live, and what is not.</H2>
      <Lede>
        Hackathon pages usually describe the plan. This one describes the repository. If something
        below reads as unfinished, that is because it is — and you should be able to tell in ten
        seconds, not after clicking a dead button.
      </Lede>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-calm">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-calm" />
            Live and provable today
          </h3>
          <ul className="mt-4 space-y-3">
            {LIVE.map((item) => (
              <li key={item.slice(0, 24)} className="text-[13px] leading-relaxed text-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-stress">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-stress" />
            Not built yet — so not claimed
          </h3>
          <ul className="mt-4 space-y-3">
            {NOT_LIVE.map((item) => (
              <li key={item.slice(0, 24)} className="text-[13px] leading-relaxed text-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* --------------------------------------------------------------------- cta */

function Closing() {
  return (
    <Section className="border-t border-line">
      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-10">
        <Eyebrow>Testnet only</Eyebrow>
        <H2>There is nothing to sign up for. There is plenty to check.</H2>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          Fugugent runs on BNB Smart Chain testnet, chainId {CHAIN.id}. No private key that touches
          mainnet is used anywhere in this project. The marketplace at app.hellofugu.xyz is not open —
          when it ships, this page will link to it, and not one day earlier.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={txUrl(REPAY_TX)}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-[#151004] transition hover:brightness-110"
          >
            Open the rescue transaction ↗
          </a>
          <a
            href={addressUrl(CONTRACTS[0].address)}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full border border-line px-5 py-2.5 text-sm text-fg transition hover:border-line-strong hover:bg-surface-strong"
          >
            Browse FuguRegistry ↗
          </a>
          <a
            href="#limits"
            className="rounded-full border border-line px-5 py-2.5 text-sm text-fg transition hover:border-line-strong hover:bg-surface-strong"
          >
            Verify the session key
          </a>
        </div>

        <p className="mt-8 max-w-2xl text-xs leading-relaxed text-faint">
          Automated DeFi strategies can lose money. Grid trading is mean-reverting by construction
          and loses in trending markets. Past performance of any run shown here does not predict
          anything, and nothing on this page is financial advice.
        </p>
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="w-full border-t border-line px-5 py-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Fugu puff={0.2} className="h-9 w-9" animated={false} />
          <div>
            <p className="text-sm font-semibold">Fugugent</p>
            <p className="text-xs text-faint">DeFi agent marketplace on BNB Chain</p>
          </div>
        </div>
        <div className="text-xs leading-relaxed text-faint">
          <p>
            {CHAIN.name} · chainId {CHAIN.id}
          </p>
          <p className="mt-1 break-all font-mono">RPC {CHAIN.rpc}</p>
          <p className="mt-3">Built for the BNB Chain hackathon, The Smart Money Era.</p>
        </div>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------- page */

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex w-full flex-1 flex-col">
        <Hero />
        <HowToRead />
        <Agents />
        <Proof />
        <SessionKey />
        <WhyLinks />
        <StatusHonest />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
