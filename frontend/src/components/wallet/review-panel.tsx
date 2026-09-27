"use client";

/**
 * Rating an agent, on chain: `FuguReputation.review(listingId, score, uri)`.
 *
 * The contract accepts a rating only from a wallet the agent has actually been paid
 * by, at least half of one period (`FuguSubscription.hasSubscribed`). Paid means
 * released from escrow by `claim(subId)`, which anyone may call. So the panel walks
 * the one path that exists:
 *
 *   not hired        -> hire first
 *   hired, not paid  -> release the earned payment (claim)
 *   paid             -> pick 1 to 5 stars and sign
 *   rated            -> say so
 *
 * The totals at the top are read from the contract, not from any index.
 */

import { useAppKit } from "@reown/appkit/react";
import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { InfoTip } from "@/components/info-tip";
import { CHAIN, CONTRACTS, txUrl } from "@/lib/chain";
import { REPUTATION_ABI, SUBSCRIPTION_ABI } from "@/lib/wallet/abi";
import { explainWriteError, formatTbnb } from "@/lib/wallet/format";
import { useSubscription } from "@/lib/wallet/subscription";

type Phase =
  | { kind: "idle" }
  | { kind: "signing"; what: "claim" | "review" }
  | { kind: "sent"; what: "claim" | "review"; hash: `0x${string}` }
  | { kind: "failed"; message: string };

function Stars({ value, onPick }: { value: number; onPick?: (n: number) => void }) {
  return (
    <span className="inline-flex gap-1" role={onPick ? "radiogroup" : undefined} aria-label="Score out of 5">
      {[1, 2, 3, 4, 5].map((n) =>
        onPick ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of 5`}
            onClick={() => onPick(n)}
            className={`text-2xl leading-none transition ${n <= value ? "text-accent" : "text-line-strong hover:text-muted"}`}
          >
            ★
          </button>
        ) : (
          <span key={n} aria-hidden className={`text-lg leading-none ${n <= value ? "text-accent" : "text-line-strong"}`}>
            ★
          </span>
        ),
      )}
    </span>
  );
}

export function ReviewPanel({ listingId, agentName }: { listingId: string; agentName: string }) {
  const id = BigInt(listingId);
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN.id });
  const { writeContractAsync } = useWriteContract();
  const subscription = useSubscription(id);
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const totals = useReadContracts({
    contracts: [
      { address: CONTRACTS.reputation, abi: REPUTATION_ABI, functionName: "reviewCount", args: [id], chainId: CHAIN.id },
      { address: CONTRACTS.reputation, abi: REPUTATION_ABI, functionName: "averageScoreX100", args: [id], chainId: CHAIN.id },
    ],
  });
  const count = totals.data?.[0]?.status === "success" ? (totals.data[0].result as bigint) : null;
  const avgX100 = totals.data?.[1]?.status === "success" ? (totals.data[1].result as bigint) : null;

  const who = address ?? "0x0000000000000000000000000000000000000000";
  const gate = useReadContracts({
    contracts: [
      { address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "hasSubscribed", args: [id, who], chainId: CHAIN.id },
      { address: CONTRACTS.reputation, abi: REPUTATION_ABI, functionName: "hasReviewed", args: [id, who], chainId: CHAIN.id },
    ],
    query: { enabled: Boolean(address) },
  });
  const eligible = gate.data?.[0]?.result === true;
  const reviewed = gate.data?.[1]?.result === true;

  // The subscription whose earned payment can be released: the running one, or the
  // most recent one that ended.
  const mine = subscription.active ?? subscription.expired;
  const claimable = useReadContract({
    address: CONTRACTS.subscription,
    abi: SUBSCRIPTION_ABI,
    functionName: "claimable",
    args: mine ? [mine.subId] : undefined,
    chainId: CHAIN.id,
    query: { enabled: Boolean(mine) && !eligible, refetchInterval: 15_000 },
  });

  const receipt = useWaitForTransactionReceipt({
    hash: phase.kind === "sent" ? phase.hash : undefined,
    chainId: CHAIN.id,
  });

  function refresh() {
    void totals.refetch();
    void gate.refetch();
    void claimable.refetch();
    subscription.refetch();
  }

  async function send(what: "claim" | "review") {
    if (!publicClient || !address) return;
    setPhase({ kind: "signing", what });
    try {
      const call =
        what === "claim"
          ? ({ address: CONTRACTS.subscription, abi: SUBSCRIPTION_ABI, functionName: "claim", args: [mine!.subId] } as const)
          : ({ address: CONTRACTS.reputation, abi: REPUTATION_ABI, functionName: "review", args: [id, score, ""] } as const);
      await publicClient.simulateContract({ ...call, account: address } as never);
      const hash = await writeContractAsync({ ...call, chainId: CHAIN.id } as never);
      setPhase({ kind: "sent", what, hash });
    } catch (err) {
      setPhase({ kind: "failed", message: explainWriteError(err) });
    }
  }

  const summary = (
    <div className="flex flex-wrap items-center gap-3">
      <Stars value={avgX100 === null ? 0 : Math.round(Number(avgX100) / 100)} />
      <span className="font-mono text-sm tabular-nums text-fg">
        {avgX100 === null || count === null || count === 0n ? "No ratings yet" : `${(Number(avgX100) / 100).toFixed(1)} from ${count}`}
      </span>
      <InfoTip label="How ratings work">
        Only a wallet that has paid this agent can rate it, once. Read from FuguReputation on chain.
      </InfoTip>
    </div>
  );

  let action: React.ReactNode;
  if (!isConnected || !address) {
    action = (
      <button type="button" onClick={() => open()} className="rounded-full border border-line px-4 py-2 text-sm text-fg transition hover:border-line-strong">
        Connect to rate
      </button>
    );
  } else if (chainId !== CHAIN.id) {
    action = <p className="text-sm text-muted">Switch to {CHAIN.name} to rate.</p>;
  } else if (reviewed) {
    action = <p className="text-sm text-[var(--risk-1)]">You rated {agentName}. Thank you.</p>;
  } else if (phase.kind === "sent" && receipt.data?.status === "success") {
    action = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--risk-1)]">{phase.what === "review" ? "Rating recorded on chain." : "Payment released."}</span>
        <a href={txUrl(phase.hash)} target="_blank" rel="noreferrer noopener" className="font-mono text-xs text-accent-strong">
          {phase.hash.slice(0, 12)}… ↗
        </a>
        <button
          type="button"
          onClick={() => {
            setPhase({ kind: "idle" });
            refresh();
          }}
          className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-fg"
        >
          {phase.what === "claim" ? "Continue to rating" : "Done"}
        </button>
      </div>
    );
  } else if (phase.kind === "sent") {
    action = <p className="text-sm text-muted">Waiting for the block…</p>;
  } else if (eligible) {
    action = (
      <div className="flex flex-wrap items-center gap-3">
        <Stars value={score} onPick={setScore} />
        <button
          type="button"
          disabled={score === 0 || phase.kind === "signing"}
          onClick={() => void send("review")}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-40"
        >
          {phase.kind === "signing" ? "Check your wallet…" : score === 0 ? "Pick a score" : `Rate ${agentName} ${score}/5`}
        </button>
      </div>
    );
  } else if (mine) {
    const ready = typeof claimable.data === "bigint" && claimable.data > 0n;
    action = (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready || phase.kind === "signing"}
          onClick={() => void send("claim")}
          className="rounded-full border border-line px-4 py-2 text-sm text-fg transition hover:border-line-strong disabled:opacity-40"
        >
          {phase.kind === "signing"
            ? "Check your wallet…"
            : ready
              ? `Release ${formatTbnb(claimable.data as bigint)} tBNB to ${agentName}`
              : "Nothing earned yet"}
        </button>
        <InfoTip label="Why release first">
          Your payment sits in escrow. Rating unlocks once the agent has been paid for at least half a period. Anyone can release what it has earned.
        </InfoTip>
      </div>
    );
  } else {
    action = <p className="text-sm text-muted">Hire {agentName} to be able to rate it.</p>;
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6" data-testid="review-panel">
      {summary}
      <div className="mt-4 border-t border-line pt-4">{action}</div>
      {phase.kind === "failed" ? (
        <div className="mt-3 rounded-lg border border-[var(--risk-4)] px-3 py-2">
          <p className="text-xs leading-relaxed text-[var(--risk-4)]">{phase.message}</p>
          <button type="button" onClick={() => setPhase({ kind: "idle" })} className="mt-1 text-xs text-muted underline">
            Back
          </button>
        </div>
      ) : null}
    </div>
  );
}
