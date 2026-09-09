import Link from "next/link";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import type { Category } from "@/lib/agent-types";
import type { CategoryCount } from "@/lib/data/types";

/**
 * A first-class category filter.
 *
 * These are links with URLs, not client state: `?category=GRID` can be shared,
 * bookmarked, and rendered on the server. It also shows the counts exactly as they are,
 * zero included — an empty category is not hidden, because hiding it would be lying
 * about the depth of the catalogue.
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
    <nav aria-label="Filter by category" className="flex flex-wrap gap-2">
      <Tab href="/" label="All" count={total} active={active === null} />
      {CATEGORY_ORDER.map((c) => (
        <Tab
          key={c}
          href={`/?category=${c}`}
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
          ? "border-accent/50 bg-accent-soft text-accent-strong"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {label}
      <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
    </Link>
  );
}
