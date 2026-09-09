"use client";

/**
 * The wallet control in the header.
 *
 * Three states, and no silent fourth: not connected, wrong network (with the
 * switch button, not merely a warning), and connected. If this build has no Reown
 * project id, this component renders nothing — a Connect button that connects
 * nothing is worse than no button at all.
 */

import { useAppKit } from "@reown/appkit/react";
import { useAccount, useSwitchChain } from "wagmi";
import { CHAIN } from "@/lib/chain";
import { shorten } from "@/lib/chain";
import { walletEnabled } from "@/lib/wallet/config";

export function ConnectControl() {
  if (!walletEnabled) return null;
  return <Control />;
}

function Control() {
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || !address) {
    return (
      <button
        type="button"
        onClick={() => open()}
        className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover"
      >
        Connect wallet
      </button>
    );
  }

  if (chainId !== CHAIN.id) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId: CHAIN.id })}
        disabled={isPending}
        className="rounded-full border border-[var(--risk-3)] px-3 py-1.5 text-xs font-semibold text-[var(--risk-3)] transition hover:bg-[color-mix(in_srgb,var(--risk-3)_14%,transparent)] disabled:opacity-50"
      >
        {isPending ? (
          "Switching…"
        ) : (
          <>
            <span className="sm:hidden">Wrong network</span>
            {/* Wide screens name the destination; narrow ones still fit without
                forcing a horizontal scroll in the header. */}
            <span className="hidden sm:inline">Wrong network — switch to {CHAIN.name}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => open()}
      className="rounded-full border border-line px-3 py-1.5 font-mono text-xs text-fg transition hover:border-line-strong hover:bg-surface-strong"
      title="Open wallet, switch account, or disconnect"
    >
      {shorten(address, 6, 4)}
    </button>
  );
}
