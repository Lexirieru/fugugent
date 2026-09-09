"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The primary navigation.
 *
 * Four destinations, four routes, four URLs. None of them is an anchor into another
 * page, and no two of them lead to the same place under different names: the start
 * page explains the product, the agent list is its own route, and the two halves of
 * the skill side have a page each.
 *
 * It is a client component for one reason: `aria-current` needs the current path, and
 * a nav that does not say where you are is a nav that makes you guess.
 *
 * The current destination is marked three ways at once, because colour alone is not a
 * marker: `aria-current="page"` for a screen reader, heavier text, and a solid bar
 * under the label. Take the colour away and the bar still says which one you are on.
 *
 * At 390px the links take a full-width row of their own beneath the wallet control
 * rather than collapsing into a menu button. Four destinations do not need hiding, and
 * a menu that must be opened before it can be read is a worse answer at every width.
 */
const LINKS = [
  { href: "/", label: "Start", match: (p: string) => p === "/" },
  {
    href: "/agents",
    label: "Agents",
    match: (p: string) => p === "/agents" || p.startsWith("/agent/"),
  },
  {
    href: "/skills",
    label: "Skills",
    match: (p: string) => p.startsWith("/skills"),
  },
  {
    href: "/auditors",
    label: "Auditors",
    match: (p: string) => p.startsWith("/auditors"),
  },
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
                className={`relative inline-flex items-center rounded-md px-2.5 py-1.5 text-sm transition sm:px-3 ${
                  active ? "font-semibold text-fg" : "font-medium text-muted hover:text-fg"
                }`}
              >
                {link.label}
                <span
                  aria-hidden
                  className={`absolute inset-x-2.5 -bottom-0.5 h-0.5 rounded-full sm:inset-x-3 ${
                    active ? "bg-accent" : "bg-transparent"
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
