import type { ReactNode } from "react";
import { txUrl, type Proof } from "@/lib/chain";

/** The section wrapper — one consistent maximum width, no horizontal scroll. */
export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`w-full px-5 py-20 sm:px-8 sm:py-24 ${className}`}>
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">{children}</p>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-3 text-balance text-3xl font-semibold leading-[1.15] tracking-tight sm:text-4xl">
      {children}
    </h2>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">{children}</p>;
}

/**
 * One proof row. When there is a tx hash, the whole row becomes a link to BscScan.
 * When there is not, the reason is stated openly — never hidden.
 */
export function ProofRow({ proof, index }: { proof: Proof; index?: number }) {
  const num =
    typeof index === "number" ? (
      <span className="mt-0.5 shrink-0 font-mono text-xs text-faint">
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
        <ProofRow key={p.id} proof={p} index={numbered ? i : undefined} />
      ))}
    </ul>
  );
}
