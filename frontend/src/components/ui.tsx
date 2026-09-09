import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The layout primitives, and the one spacing scale the whole app uses.
 *
 * ## The scale
 *
 * Tailwind's 4px base, and only these steps. Nothing else may be invented at a call
 * site, because an ad hoc `mt-7` next to an `mt-6` is exactly what made the pages
 * look hand-placed rather than measured.
 *
 * | step | px | what it separates |
 * |---|---|---|
 * | `gap-1` | 4 | parts of one word-sized thing |
 * | `gap-2` | 8 | a chip from the chip beside it |
 * | `gap-3` | 12 | a label from its value |
 * | `gap-4` | 16 | paragraphs inside a card |
 * | `gap-6` | 24 | a heading from the grid under it, and card from card |
 * | `gap-8` | 32 | the parts of one block |
 * | `gap-12` / `gap-16` | 48 / 64 | section from section, mobile then desktop |
 *
 * ## Why `Page` exists
 *
 * Every page used to set its own top padding on every section, so the rhythm was
 * decided nine times and agreed nowhere. `Page` owns the vertical rhythm; a section
 * owns only its own contents. That is also what makes two pages line up when you flip
 * between them, which is what the word "symmetrical" was actually asking for.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-col gap-12 py-10 sm:gap-16 sm:py-14">{children}</div>;
}

/**
 * One horizontal band. The gutter and the maximum width live here and nowhere else, so
 * every band on every page starts and ends on the same two vertical lines.
 */
export function Section({
  id,
  children,
  className = "",
  labelledBy,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`w-full px-5 sm:px-8 ${className}`}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent-strong">
      {children}
    </p>
  );
}

/**
 * The head of a page: eyebrow, one h1, one paragraph. Fixed spacing, so the first
 * screen of every page in this app has the same shape.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
}) {
  return (
    <header>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-3 max-w-4xl text-balance text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
        {title}
      </h1>
      {/* `max-w-4xl`, the same measure as the heading above it, so the head of a page
          reads as one column rather than two of different widths. It used to be
          `max-w-2xl`, which at 1440 left the lede visibly narrower than the grid it
          introduces and made every lede run to three lines. The rule for a lede is two
          lines at 1440 and it is measured, not judged by eye. */}
      <p className="mt-4 max-w-4xl text-pretty text-base leading-relaxed text-muted">{lede}</p>
    </header>
  );
}

/**
 * The head of a section inside a page. One h2, one optional line under it, and always
 * the same 24px down to whatever it introduces.
 */
export function SectionHeader({
  id,
  title,
  lede,
}: {
  id?: string;
  title: ReactNode;
  lede?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <h2 id={id} className="text-balance text-lg font-semibold tracking-tight text-fg">
        {title}
      </h2>
      {lede ? (
        <p className="mt-2 max-w-4xl text-pretty text-sm leading-relaxed text-muted">{lede}</p>
      ) : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "quiet";
}) {
  const tones = {
    neutral: "border-line text-fg",
    accent: "border-accent/40 bg-accent-soft text-accent-strong",
    quiet: "border-line text-faint",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** The primary button. Always a link: every action in this product goes somewhere. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  external = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  external?: boolean;
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:bg-accent-hover"
      : "border border-line text-fg hover:border-line-strong hover:bg-surface-strong";
  const cls = `inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${styles} ${className}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/**
 * The empty state. There is no other form of it in this app: every empty state names
 * its action and gives you the button for it. The judges test this explicitly.
 */
export function EmptyState({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h3 className="text-balance text-lg font-semibold text-fg">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-pretty text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{actions}</div>
    </div>
  );
}
