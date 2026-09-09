"use client";

/**
 * "Yours to list", on a card for an agent that has no price yet.
 *
 * The third of the three states a card can be in, and the only one that depends on who
 * is looking:
 *
 *   a. it has a price, so anybody can hire it now;
 *   b. it has no price, and the wallet you have connected is the one that can give it
 *      one;
 *   c. it has no price, and that is somebody else's to fix.
 *
 * Collapsing b into c is what made 103 cards read as a wall of dead ends. This badge is
 * the smallest thing that separates them, and it renders nothing at all unless the
 * connected wallet really is the owner the catalogue records, so it can never tell
 * somebody they own an agent they do not.
 *
 * It is a badge and not a button on purpose: the form that does the work lives on the
 * agent's own page, where there is room to say what listing means and what it does not
 * promise. A one-click list from a card would skip all of that.
 */

import { useAccount } from "wagmi";
import { sameAddress } from "@/lib/listing-metadata";
import { walletEnabled } from "@/lib/wallet/config";

export function OwnerBadge({ ownerAddress }: { ownerAddress: string | null }) {
  if (!walletEnabled || !ownerAddress) return null;
  return <Badge ownerAddress={ownerAddress} />;
}

function Badge({ ownerAddress }: { ownerAddress: string }) {
  const { address, isConnected } = useAccount();
  if (!isConnected || !sameAddress(address, ownerAddress)) return null;

  return (
    <span
      className="relative z-10 inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold leading-5 text-accent-strong"
      title="The catalogue records your wallet as this agent's owner, so you are the one who can put a price on it."
    >
      <span aria-hidden>+</span>
      Yours to list
    </span>
  );
}
