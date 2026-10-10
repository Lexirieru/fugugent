import Link from "next/link";
import { Section } from "@/components/ui";

/** A one-line way into /quest while BNB Chain's Set and Earn is running. */
export function QuestBanner() {
  return (
    <Section>
      <Link
        href="/quest"
        className="group flex flex-wrap items-center justify-between gap-2 rounded-full border border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-4 py-2 text-sm text-fg transition hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] sm:px-5"
      >
        <span>
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-accent align-middle motion-reduce:animate-none" aria-hidden />
          <span className="font-semibold">Set and Earn is live.</span> Hire 3 agents, build 1, get BNB Chain merch.
        </span>
        <span className="text-accent-strong transition group-hover:translate-x-0.5">How to join →</span>
      </Link>
    </Section>
  );
}
