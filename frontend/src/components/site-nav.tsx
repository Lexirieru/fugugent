"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The primary navigation.
 *
 * There are two marketplaces in this product and they answer two halves of the same
 * question: which agent do I hire, and which skills is that agent allowed to install.
 * Until this existed the second one was unreachable, which is its own kind of dead end.
 *
 * It is a client component for one reason — `aria-current` needs the current path, and
 * a nav that does not say where you are is a nav that makes you guess.
 *
 * At 390px the links wrap to their own full-width row beneath the wallet control rather
 * than collapsing into a hamburger: three destinations do not need to be hidden behind a
 * button, and a menu that must be opened before it can be read is a worse answer at every
 * width.
 */
const LINKS = [
  { href: "/", label: "Agents", match: (p: string) => p === "/" || p.startsWith("/agent") },
  { href: "/skills", label: "Skills", match: (p: string) => p.startsWith("/skills") },
  { href: "/auditors", label: "Auditors", match: (p: string) => p.startsWith("/auditors") },
] as const;

export function SiteNav({ className = "" }: { className?: string }) {
  const pathname = usePathname() ?? "/";

  return (
    <nav aria-label="Primary" className={className}>
      <ul className="flex items-center gap-1">
        {LINKS.map((link) => {
          const active = link.match(pathname);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-accent-soft font-medium text-accent-strong"
                    : "text-muted hover:bg-surface hover:text-fg"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
