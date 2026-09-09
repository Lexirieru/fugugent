import type { Metadata } from "next";
import Link from "next/link";
import { ProofList } from "@/components/proof";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillProvenanceRow } from "@/components/skills/skill-provenance";
import { TrustFilter, TrustLegend } from "@/components/skills/trust-filter";
import { ButtonLink, EmptyState, Eyebrow, Section } from "@/components/ui";
import { AUDIT_ESCROW_CYCLE, CONTRACTS, addressUrl, shorten } from "@/lib/chain";
import { skillSource } from "@/lib/skills";
import { KIND_LABEL } from "@/lib/skills/format";
import {
  SKILL_KINDS,
  isSkillKind,
  isTrustStatus,
  type SkillKind,
  type TrustStatus,
} from "@/lib/skills/types";

export const metadata: Metadata = {
  title: "Audited skills",
  description:
    "Every skill and MCP server here carries what is actually known about it: audited and clean, audited and dangerous, or one of five ways of not knowing. Only one of the seven means safe.",
};

const LIMIT = 24;
/** The backend caps `limit` at 100; asking for exactly that is what makes a complete census possible. */
const CENSUS_LIMIT = 100;

export default async function SkillsPage({ searchParams }: PageProps<"/skills">) {
  const sp = await searchParams;
  const first = (key: string): string | null => {
    const v = sp[key];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    return null;
  };

  const status: TrustStatus | null = isTrustStatus(first("status")) ? (first("status") as TrustStatus) : null;
  const kind: SkillKind | null = isSkillKind(first("kind")) ? (first("kind") as SkillKind) : null;
  const q = first("q");
  const offsetRaw = Number(first("offset") ?? "0");
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

  const src = skillSource();
  const page = await src.listSkills({ limit: LIMIT, offset, kind, status, q });

  /**
   * The census behind the status filter is asked for separately and without a status,
   * because the census that comes back with a filtered page only counts the status that
   * was filtered for — every other chip would read zero, which is a lie about how much of
   * the registry has been checked.
   *
   * It is also only shown when it is complete. The backend counts the statuses of the
   * items it returned, not of the whole registry, so once the result is longer than one
   * request the counts would be counts of a page. In that case the chips keep their
   * labels and drop their numbers: a filter with no number still works, a filter with the
   * wrong number misleads.
   */
  const censusPage =
    status === null && offset === 0
      ? page
      : await src.listSkills({ limit: CENSUS_LIMIT, offset: 0, kind, status: null, q });
  const censusComplete =
    censusPage.provenance.healthy && censusPage.total <= censusPage.items.length;
  const census = censusComplete ? censusPage.trustCensus : null;

  /** A URL builder that keeps every other filter intact. Filters compose; they do not reset each other. */
  const hrefWith = (patch: Record<string, string | null>): string => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = { status, kind, q, offset: offset > 0 ? String(offset) : null };
    for (const [key, value] of Object.entries({ ...base, ...patch })) {
      if (value !== null && value !== "") params.set(key, value);
    }
    const text = params.toString();
    return text === "" ? "/skills" : `/skills?${text}`;
  };

  const filtered = status !== null || kind !== null || (q !== null && q.trim() !== "");
  const hasMore = offset + page.items.length < page.total;

  return (
    <>
      <Section className="pt-10 sm:pt-14">
        <Eyebrow>Audited skill marketplace</Eyebrow>
        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
          Your agent installs code. Somebody should have read it first.
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          An agent gains its abilities by installing skills and MCP servers, and it installs them
          from open sources nobody vets. That is a live attack surface with CVEs against it:
          instructions hidden inside a tool description that hijack the agent, a &ldquo;price
          checker&rdquo; that quietly reads keys, a clean v1 followed by a malicious v2. One
          poisoned skill drains the wallet, and the agent does it to itself.
        </p>
        <p className="mt-3 max-w-2xl text-pretty text-base leading-relaxed text-muted">
          So an auditor posts a bond, audits a build, is paid when the verdict stands, and loses
          the bond when it does not. Below, every skill carries what is actually known about it —
          and five of the seven states are ways of not knowing.
        </p>

        <div className="mt-8">
          <SkillProvenanceRow provenance={page.provenance} origin={src.origin} />
        </div>

        <div className="mt-8 space-y-4">
          <TrustFilter
            census={census}
            active={status}
            total={censusComplete ? censusPage.total : null}
            hrefFor={(s) => hrefWith({ status: s, offset: null })}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
              <KindTab href={hrefWith({ kind: null, offset: null })} label="Every kind" active={kind === null} />
              {SKILL_KINDS.map((k) => (
                <KindTab
                  key={k}
                  href={hrefWith({ kind: k, offset: null })}
                  label={KIND_LABEL[k] ?? k}
                  active={kind === k}
                />
              ))}
            </nav>

            {/* A plain GET form: the result is a URL, and it works with JavaScript switched off. */}
            <form action="/skills" method="get" className="flex flex-wrap items-center gap-2">
              {status ? <input type="hidden" name="status" value={status} /> : null}
              {kind ? <input type="hidden" name="kind" value={kind} /> : null}
              <label htmlFor="skill-search" className="sr-only">
                Search skills
              </label>
              <input
                id="skill-search"
                name="q"
                type="search"
                defaultValue={q ?? ""}
                placeholder="Search name, description, tags"
                className="w-full min-w-0 rounded-full border border-line bg-bg-elev px-4 py-1.5 text-sm text-fg placeholder:text-faint sm:w-64"
              />
              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-line px-3.5 py-1.5 text-sm text-fg transition hover:border-line-strong hover:bg-surface-strong"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        <div className="mt-8">
          {page.items.length > 0 ? (
            <>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {page.items.map((skill) => (
                  <li key={skill.id} className="flex">
                    <SkillCard skill={skill} />
                  </li>
                ))}
              </ul>
              {offset > 0 || hasMore ? (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  {offset > 0 ? (
                    <ButtonLink
                      href={hrefWith({ offset: offset - LIMIT > 0 ? String(offset - LIMIT) : null })}
                      variant="ghost"
                    >
                      ← Previous
                    </ButtonLink>
                  ) : (
                    <span />
                  )}
                  <span className="tnum text-xs text-faint">
                    {offset + 1}–{offset + page.items.length} of {page.total}
                  </span>
                  {hasMore ? (
                    <ButtonLink href={hrefWith({ offset: String(offset + LIMIT) })} variant="ghost">
                      Next →
                    </ButtonLink>
                  ) : (
                    <span />
                  )}
                </div>
              ) : null}
            </>
          ) : page.provenance.healthy ? (
            <EmptyState
              title={filtered ? "Nothing matches those filters" : "No skill has been listed yet"}
              body={
                filtered
                  ? "The registry answered, and nothing in it fits. Clearing the filters shows everything it does hold — including the skills nobody has audited, which are the ones worth looking at hardest."
                  : "The registry answered and it is empty. That is a real answer, not a failed request: nothing has been listed, so there is nothing to audit yet."
              }
              actions={
                <>
                  <ButtonLink href="/skills">Show every skill</ButtonLink>
                  <ButtonLink href="/auditors" variant="ghost">
                    Meet the auditors
                  </ButtonLink>
                </>
              }
            />
          ) : (
            <EmptyState
              title="We have nothing we can stand behind"
              body="The registry did not answer, so this list is empty on purpose. An audit status is a claim about whether code is safe to install, and serving a cached one without saying so is exactly the failure this marketplace exists to prevent."
              actions={
                <>
                  <ButtonLink href={hrefWith({})}>Try again</ButtonLink>
                  <ButtonLink href="/" variant="ghost">
                    Browse agents instead
                  </ButtonLink>
                </>
              }
            />
          )}
        </div>
      </Section>

      <Section className="pt-12">
        <TrustLegend />
      </Section>

      <Section className="pt-12">
        <h2 className="text-lg font-semibold tracking-tight text-fg">
          What makes a verdict cost something
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          A badge is worth exactly as much as the auditor loses by handing it out wrongly. The
          fee and the bond sit in{" "}
          <a
            href={addressUrl(CONTRACTS.auditEscrow)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
          >
            {shorten(CONTRACTS.auditEscrow)} ↗
          </a>
          , deployed and verified on BNB Chain testnet, and the whole cycle has been run on it.
          These are those four transactions.
        </p>
        <div className="mt-5">
          <ProofList proofs={AUDIT_ESCROW_CYCLE} />
        </div>
        <div className="mt-5">
          <ButtonLink href="/auditors" variant="ghost">
            Who is putting up the bond →
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}

function KindTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm transition ${
        active
          ? "border-accent/50 bg-accent-soft text-accent-strong"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}
