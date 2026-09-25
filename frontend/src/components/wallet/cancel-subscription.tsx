"use client";

/**
 * The revoke path: `FuguSubscription.cancel(subId)`, signed from this page.
 *
 * The hire panel used to say "Cancelling returns the rest to you" and offer no way to
 * do it. A stop that is described and not reachable is not a stop, and the Phase 2
 * brief says so in as many words: spend caps and a revoke path must work.
 *
 * What the button does, precisely, because this is money coming back:
 *
 * - The contract pays the agent by the second. Cancelling freezes that at the current
 *   block: whatever the agent has earned up to now stays earned, the rest of the
 *   deposit is sent back to the wallet that paid, in the same transaction.
 * - The refund shown before signing is an estimate from the latest block's clock. The
 *   figure shown after is read from the `Cancelled` event in the receipt, which is
 *   what the contract actually paid, not what we expected it to.
 * - It is simulated first, like the hire, so "not your subscription" or "already
 *   cancelled" is caught before the wallet opens.
 */

import { useEffect, useState } from "react";
import { decodeEventLog } from "viem";
import { usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { CHAIN, CONTRACTS, txUrl } from "@/lib/chain";
import { SUBSCRIPTION_ABI } from "@/lib/wallet/abi";
import { explainWriteError, formatTbnb } from "@/lib/wallet/format";
import type { OnchainSub } from "@/lib/wallet/subscription";

/** What a finished cancel reports upwards, so the card can stop calling the sub "running". */
export interface CancelOutcome {
  subId: bigint;
  hash: `0x${string}`;
  /** Read from the `Cancelled` event in the receipt. `null` if the log could not be decoded. */
  refunded: bigint | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirming"; now: bigint | null }
  | { kind: "signing" }
  | { kind: "sent"; hash: `0x${string}` }
  | { kind: "failed"; message: string };

/** What the agent has earned at `now`, the same arithmetic as `FuguSubscription._earned`. */
export function earnedAt(sub: OnchainSub, now: bigint): bigint {
  const duration = sub.endsAt - sub.startedAt;
  if (duration <= 0n) return sub.deposited;
  const until = now < sub.endsAt ? now : sub.endsAt;
  const elapsed = until > sub.startedAt ? until - sub.startedAt : 0n;
  return (sub.deposited * elapsed) / duration;
}

export function CancelSubscription({
  sub,
  agentName,
  chainNow,
  account,
  onCancelled,
}: {
  sub: OnchainSub;
  agentName: string;
  chainNow: bigint | null;
  account: `0x${string}`;
  /** Called once, when the cancel is in a block. The parent re-reads the chain. */
  onCancelled: (outcome: CancelOutcome) => void;
}) {
  const publicClient = usePublicClient({ chainId: CHAIN.id });
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const receipt = useWaitForTransactionReceipt({
    hash: phase.kind === "sent" ? phase.hash : undefined,
    chainId: CHAIN.id,
  });

  // The estimate uses the block read when the question was asked, not the one the
  // page last polled: the card polls every 20 seconds and a stale clock understates
  // what the agent has earned.
  const estimateNow = phase.kind === "confirming" ? (phase.now ?? chainNow) : chainNow;
  const earned = estimateNow === null ? null : earnedAt(sub, estimateNow);
  const refundEstimate = earned === null ? null : sub.deposited - earned;

  /** The refund the contract actually paid, read off the receipt. */
  const refunded = (() => {
    if (receipt.data?.status !== "success") return null;
    for (const log of receipt.data.logs) {
      if (log.address.toLowerCase() !== CONTRACTS.subscription.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: SUBSCRIPTION_ABI, data: log.data, topics: log.topics });
        if (event.eventName === "Cancelled") return (event.args as { refunded: bigint }).refunded;
      } catch {
        // Not one of ours; keep looking.
      }
    }
    return null;
  })();

  useEffect(() => {
    if (phase.kind !== "sent" || receipt.data?.status !== "success") return;
    onCancelled({ subId: sub.subId, hash: phase.hash, refunded });
    // Fires once per receipt; `onCancelled` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, receipt.data?.status]);

  async function ask() {
    setPhase({ kind: "confirming", now: null });
    const block = await publicClient?.getBlock().catch(() => null);
    setPhase((p) => (p.kind === "confirming" ? { kind: "confirming", now: block?.timestamp ?? null } : p));
  }

  async function cancel() {
    if (!publicClient) return;
    setPhase({ kind: "signing" });
    try {
      await publicClient.simulateContract({
        address: CONTRACTS.subscription,
        abi: SUBSCRIPTION_ABI,
        functionName: "cancel",
        args: [sub.subId],
        account,
      });
      const hash = await writeContractAsync({
        address: CONTRACTS.subscription,
        abi: SUBSCRIPTION_ABI,
        functionName: "cancel",
        args: [sub.subId],
        chainId: CHAIN.id,
      });
      setPhase({ kind: "sent", hash });
    } catch (err) {
      setPhase({ kind: "failed", message: explainWriteError(err) });
    }
  }

  if (phase.kind === "sent") {
    // Only the in-flight and reverted states are drawn here. Success is reported
    // upwards (`onCancelled`) and drawn by the card, outside the "running" box, since
    // a subscription that has just been cancelled is no longer running.
    const reverted = receipt.data?.status === "reverted";
    return (
      <div className="mt-3 rounded-lg border border-line px-3 py-2.5">
        <p className="text-sm font-medium text-fg">
          {reverted
            ? "The cancel transaction was mined but reverted. Nothing moved."
            : "Signed. Waiting for the block."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={txUrl(phase.hash)}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-full border border-line px-3 py-1.5 font-mono text-xs text-accent-strong transition hover:border-line-strong"
          >
            {phase.hash.slice(0, 14)}… ↗
          </a>
          {reverted ? (
            <button
              type="button"
              onClick={() => setPhase({ kind: "idle" })}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
            >
              Done
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {phase.kind === "confirming" ? (
        <div className="rounded-lg border border-[var(--risk-3)] px-3 py-2.5">
          <p className="text-sm text-fg">
            Stop {agentName} now and take back the unused part of your payment?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {refundEstimate === null
              ? "The refund is worked out from the next block's clock."
              : `About ${formatTbnb(refundEstimate)} tBNB comes back to you. The ${formatTbnb(earned ?? 0n)} tBNB it has already earned stays with it.`}{" "}
            One signature, no approval, and it cannot be undone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={cancel}
              className="rounded-full border border-[var(--risk-3)] px-3 py-1.5 text-xs font-semibold text-[var(--risk-3)] transition hover:bg-[color-mix(in_srgb,var(--risk-3)_14%,transparent)]"
            >
              Yes, cancel and refund
            </button>
            <button
              type="button"
              onClick={() => setPhase({ kind: "idle" })}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
            >
              Keep it running
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={ask}
          disabled={phase.kind === "signing"}
          className="rounded-full border border-[var(--risk-3)] px-3 py-1.5 text-xs font-semibold text-[var(--risk-3)] transition hover:bg-[color-mix(in_srgb,var(--risk-3)_14%,transparent)] disabled:opacity-50"
        >
          {phase.kind === "signing"
            ? "Check your wallet…"
            : `Cancel ${agentName} and refund the rest`}
        </button>
      )}

      {phase.kind === "failed" ? (
        <div className="mt-2 rounded-lg border border-[var(--risk-4)] px-3 py-2">
          <p className="text-xs leading-relaxed text-[var(--risk-4)]">{phase.message}</p>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="mt-1.5 rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
          >
            Back
          </button>
        </div>
      ) : null}
    </div>
  );
}
