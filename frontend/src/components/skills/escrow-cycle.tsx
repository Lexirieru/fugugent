import { InfoTip } from "@/components/info-tip";
import { shorten, txUrl, type Proof } from "@/lib/chain";

/**
 * The audit escrow's on-chain cycle, in its short form for the skill pages.
 *
 * The same proofs as `ProofList`, with one difference: the sentence explaining each step
 * sits behind an info tip, so the page shows the step and its transaction and nothing
 * else. The transaction link is never folded away, because it is the part a reader can
 * check. `ProofList` could not simply take the tip, since its whole row is a link and a
 * button cannot live inside one.
 */
export function EscrowCycle({ proofs }: { proofs: Proof[] }) {
  return (
    <ol className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {proofs.map((proof, i) => (
        <li
          key={proof.hash ?? proof.label}
          className="flex gap-4 border-t border-line px-4 py-4 first:border-t-0 sm:px-5"
        >
          <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-faint">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug text-fg">{proof.label}</p>
            {proof.hash ? (
              <a
                href={txUrl(proof.hash)}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-block break-all font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
              >
                {shorten(proof.hash)} ↗
              </a>
            ) : (
              <p className="mt-1.5 text-xs leading-relaxed text-faint">
                No link: {proof.noLinkReason}
              </p>
            )}
          </div>
          {/* Pinned to the right edge of the row so the bubble opens leftwards and stays
              on a 390px screen, wherever the label happens to wrap. */}
          <span className="shrink-0 pt-0.5">
            <InfoTip label="Why this step matters" align="end">
              {proof.detail}
            </InfoTip>
          </span>
        </li>
      ))}
    </ol>
  );
}
