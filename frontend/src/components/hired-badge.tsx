"use client";

/**
 * The `Hired` badge, it exists to stop someone paying twice for the same thing.
 *
 * Its source of truth is the **contract**: with a wallet connected to BSC testnet,
 * this badge comes from `FuguSubscription.getSub`, a subscription belonging to
 * that address on this listing, not cancelled and not yet ended according to the
 * block timestamp. The `localStorage` note is only a second layer, for a payment
 * made from a terminal or another device, and both forms of the badge always link
 * to something anyone can check, the transaction, or the contract. A badge without
 * proof is never rendered.
 */

import { addressUrl, txUrl, CONTRACTS } from "@/lib/chain";
import { useHires } from "@/lib/hired";
import { walletEnabled } from "@/lib/wallet/config";
import { formatChainTime } from "@/lib/wallet/format";
import { useSubscription } from "@/lib/wallet/subscription";

export function HiredBadge({
  agentId,
  listingId = null,
}: {
  agentId: string;
  /** `null` when the agent has no listing, there is nothing to read from chain. */
  listingId?: string | null;
}) {
  if (walletEnabled && listingId !== null) {
    return <ChainBadge agentId={agentId} listingId={listingId} />;
  }
  return <DeviceBadge agentId={agentId} />;
}

function ChainBadge({ agentId, listingId }: { agentId: string; listingId: string }) {
  const subscription = useSubscription(BigInt(listingId));

  if (subscription.active) {
    return (
      <a
        href={addressUrl(CONTRACTS.subscription)}
        target="_blank"
        rel="noreferrer noopener"
        className="relative z-10 inline-flex items-center gap-1 rounded-full border border-[var(--risk-1)] px-2.5 py-0.5 text-[11px] font-semibold leading-5 text-[var(--risk-1)] transition hover:bg-[color-mix(in_srgb,var(--risk-1)_14%,transparent)]"
        title={`Subscription #${subscription.active.subId} on FuguSubscription, active until ${formatChainTime(subscription.active.endsAt)}`}
      >
        Hired ↗
      </a>
    );
  }

  // No active subscription on chain. The device note may still speak, because it
  // points at a real transaction, an expired subscription, for instance.
  return <DeviceBadge agentId={agentId} />;
}

function DeviceBadge({ agentId }: { agentId: string }) {
  const { ready, find } = useHires();
  const hire = ready ? find(agentId) : null;
  if (!hire) return null;

  return (
    <a
      href={txUrl(hire.txHash)}
      target="_blank"
      rel="noreferrer noopener"
      className="relative z-10 inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-[11px] font-semibold leading-5 text-muted transition hover:text-fg"
      title="A hire you recorded on this device. Connect your wallet to read the live subscription from the contract."
    >
      Hired once ↗
    </a>
  );
}
