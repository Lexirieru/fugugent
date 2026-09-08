/**
 * One proof row.
 *
 * When there is a tx hash, the whole row becomes a link to BscScan. When there is not,
 * the reason is stated openly — never hidden. This answers a real market failure:
 * Giza/ARMA shut down in February 2026 after its dashboard showed large numbers that
 * nobody could check.
 */

import { txUrl, type Proof } from "@/lib/chain";

export function ProofRow({ proof, index }: { proof: Proof; index?: number }) {
  const num =
    typeof index === "number" ? (
      <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-faint">
        {String(index + 1).padStart(2, "0")}
      </span>
    ) : null;

  const inner = (
    <>
      {num}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug text-fg">{proof.label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted">{proof.detail}</span>
        {proof.hash ? (
          <span className="mt-2 block break-all font-mono text-xs text-accent/85">
            {proof.hash} ↗
          </span>
        ) : (
          <span className="mt-2 block text-xs leading-relaxed text-faint">
            No link — {proof.noLinkReason}
          </span>
        )}
      </span>
    </>
  );

  if (!proof.hash) {
    return (
      <li className="flex gap-4 border-t border-line px-4 py-5 first:border-t-0 sm:px-5">{inner}</li>
    );
  }

  return (
    <li className="border-t border-line first:border-t-0">
      <a
        href={txUrl(proof.hash)}
        target="_blank"
        rel="noreferrer noopener"
        className="flex gap-4 px-4 py-5 transition hover:bg-surface-strong sm:px-5"
      >
        {inner}
      </a>
    </li>
  );
}

export function ProofList({ proofs, numbered = true }: { proofs: Proof[]; numbered?: boolean }) {
  return (
    <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
      {proofs.map((p, i) => (
        <ProofRow key={p.hash ?? p.label} proof={p} index={numbered ? i : undefined} />
      ))}
    </ul>
  );
}

/** A number + a link to the transaction that proves it. An unproven number is marked as such. */
export function VerifiableNumber({
  value,
  caption,
  hash,
  unproven,
}: {
  value: string;
  caption: string;
  hash?: string | null;
  /** Used when there genuinely is no proof. It must explain, not leave a blank. */
  unproven?: string;
}) {
  const body = (
    <>
      <span className="block font-mono text-xl tabular-nums text-fg sm:text-2xl">{value}</span>
      <span className="mt-1 block text-xs leading-relaxed text-faint">{caption}</span>
    </>
  );

  if (hash) {
    return (
      <a
        href={txUrl(hash)}
        target="_blank"
        rel="noreferrer noopener"
        className="block rounded-xl border border-line bg-surface px-4 py-3 transition hover:border-line-strong hover:bg-surface-strong"
      >
        {body}
        <span className="mt-2 block font-mono text-[11px] text-accent/85">open the tx ↗</span>
      </a>
    );
  }

  return (
    <div className="block rounded-xl border border-dashed border-line px-4 py-3">
      {body}
      <span className="mt-2 block text-[11px] leading-relaxed text-faint">
        {unproven ?? "no transaction backs this number yet"}
      </span>
    </div>
  );
}
