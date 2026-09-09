import Link from "next/link";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import type { Category } from "@/lib/agent-types";
import type { CategoryCount } from "@/lib/data/types";

/**
 * A first-class kind filter.
 *
 * These are links with URLs, not client state: `/agents?category=GRID` can be shared,
 * bookmarked, and rendered on the server. It also shows the counts exactly as they are,
 * zero included. Hiding an empty kind would be lying about the depth of the catalogue.
 *
 * The selected tab is marked by weight and by a filled dot as well as by colour, so it
 * is still the selected tab in grayscale.
 */
export function CategoryTabs({
  counts,
  active,
  total,
}: {
  counts: CategoryCount[];
  active: Category | null;
  total: number;
}) {
  const countOf = (c: Category) => counts.find((x) => x.category === c)?.count ?? 0;

  return (
    <nav aria-label="Filter by kind of agent" className="flex flex-wrap gap-2">
      <Tab href="/agents" label="All" count={total} active={active === null} />
      {CATEGORY_ORDER.map((c) => (
        <Tab
          key={c}
          href={`/agents?category=${c}`}
          label={CATEGORY_META[c].label}
          count={countOf(c)}
          active={active === c}
        />
      ))}
    </nav>
  );
}

function Tab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${
        active
          ? "border-accent/50 bg-accent-soft font-semibold text-accent-strong"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {active ? (
        <span aria-hidden className="inline-block size-1.5 rounded-full bg-accent" />
      ) : null}
      {label}
      <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
    </Link>
  );
}
