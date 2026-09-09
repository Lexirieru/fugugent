/**
 * The action band's label: the Guardian action identifier, exactly as the decision engine
 * spells it.
 *
 * This component exists so the *register* is defined in one place. The action band and the
 * puff level answer two different questions, and a user who cannot tell them apart will
 * answer one while believing they answered both. So the two never share a treatment:
 *
 *   - a puff level is title-case prose in a fully rounded pill, always beside a fugu;
 *   - an action is an UPPERCASE_SNAKE_CASE code token in monospace, in a square-cornered
 *     box, never beside a fugu.
 *
 * The difference is carried by wording, typeface, letter case and box shape, four
 * channels, none of them colour. In grayscale, at 48 px, with colour vision that does not
 * separate red from green, `PARTIAL_REPAY` still cannot be read as "Strained".
 *
 * `EMERGENCY` gets a filled block with white text, the same rule the risk chip uses for
 * level 5: `#A4210E` as text on a dark background is only 2.53:1, which would make the
 * gravest state the hardest to read. The filled block gives 7.49:1, and the all-caps
 * token inside it is still legible with the fill stripped away entirely.
 */

import { type GuardianActionSpec } from "@/lib/risk";

export function ActionToken({
  spec,
  size = "md",
}: {
  spec: GuardianActionSpec;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]";
  const base = `inline-flex items-center rounded-[3px] font-mono uppercase tracking-[0.08em] ${pad}`;

  if (spec.action === "EMERGENCY") {
    return (
      <span className={`${base} bg-[var(--risk-5)] font-semibold text-white`}>{spec.action}</span>
    );
  }

  return (
    <span className={`${base} border border-line-strong bg-bg-elev text-fg`}>{spec.action}</span>
  );
}

/**
 * "spends your money" is the single most consequential fact about an action, so it is
 * written out as words rather than encoded in the token's colour.
 */
export function SpendMarker({ spends }: { spends: boolean }) {
  return spends ? (
    <span className="text-[11px] leading-snug text-[var(--risk-4)]">spends your money</span>
  ) : (
    <span className="text-[11px] leading-snug text-faint">spends nothing</span>
  );
}
