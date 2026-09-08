"use client";

import { txUrl } from "@/lib/chain";
import { useHires } from "@/lib/hired";

/**
 * Badge `Hired` — mencegah pengguna membayar dua kali untuk hal yang sama.
 * Selalu menautkan ke transaksi yang membuktikannya; badge tanpa bukti tidak
 * pernah dirender.
 */
export function HiredBadge({ agentId }: { agentId: string }) {
  const { ready, find } = useHires();
  const hire = ready ? find(agentId) : null;
  if (!hire) return null;

  return (
    <a
      href={txUrl(hire.txHash)}
      target="_blank"
      rel="noreferrer noopener"
      className="relative z-10 inline-flex items-center gap-1 rounded-full border border-[var(--risk-1)] px-2.5 py-0.5 text-[11px] font-semibold leading-5 text-[var(--risk-1)] transition hover:bg-[color-mix(in_srgb,var(--risk-1)_14%,transparent)]"
      title="You recorded a hire for this agent on this device"
    >
      Hired ↗
    </a>
  );
}
