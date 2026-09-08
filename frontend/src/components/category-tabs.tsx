import Link from "next/link";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import type { Category } from "@/lib/agent-types";
import type { CategoryCount } from "@/lib/data/types";

/**
 * Penyaring kategori kelas satu.
 *
 * Ini tautan ber-URL, bukan state klien: `?category=GRID` bisa dibagikan,
 * di-bookmark, dan dirender di server. Ia juga menampilkan jumlahnya apa adanya,
 * termasuk nol — kategori yang kosong tidak disembunyikan, karena menyembunyikannya
 * berarti berbohong soal kedalaman katalog.
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
          ? "border-accent/50 bg-accent-soft text-accent"
          : "border-line text-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      {label}
      <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
    </Link>
  );
}
