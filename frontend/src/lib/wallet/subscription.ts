"use client";

/**
 * Subscription state **read from the contract**, not from local state.
 *
 * This is what makes the `Hired` badge worth trusting. `FuguSubscription` keeps no
 * "subscriptions belonging to address X" index, so without an indexer the only way
 * to read that state is to sweep `getSub(1..subCount())` and filter it here. The
 * sweep is capped (`SCAN_CAP`), and when the cap is hit this hook says so
 * (`truncated`) so the UI can admit "not every subscription was checked" rather
 * than staying quiet. One `eth_call` per id would be wasteful; wagmi folds them
 * into Multicall3, which exists on BSC testnet.
 *
 * Why not `hasSubscribed`: that gate only flips to `true` once the agent has
 * **actually drawn** payment (>= 50% of one period's price), so it answers "may
 * this wallet write a review?", not "is it hiring right now?". Using it for the
 * `Hired` badge would leave a user who just paid still marked as not hired, which
 * is exactly the nudge towards paying twice.
 *
 * "Now" comes from the block timestamp, not the browser clock: a skewed clock must
 * never make an active subscription look expired.
 *
 * Every card in the marketplace list runs this same sweep. The arguments are
 * identical, so react-query collapses them into **one** request rather than one per
 * card. That is why this hook takes no `address` argument and reads nothing that
 * differs per listing.
 */

import { useMemo } from "react";
import { useAccount, useBlock, useReadContract, useReadContracts } from "wagmi";
import { CHAIN, CONTRACTS } from "@/lib/chain";
import { SUBSCRIPTION_ABI } from "@/lib/wallet/abi";
import { walletEnabled } from "@/lib/wallet/config";

/** How many of the most recent subscriptions to sweep. Big enough for testnet, still bounded. */
export const SCAN_CAP = 300;

export interface OnchainSub {
  subId: bigint;
  deposited: bigint;
  claimed: bigint;
  startedAt: bigint;
  endsAt: bigint;
  cancelled: boolean;
}

export type SubscriptionStatus =
  | "disabled"
  | "disconnected"
  | "wrong-network"
  | "loading"
  | "error"
  | "ready";

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** The subscription still running according to the block timestamp. */
  active: OnchainSub | null;
  /** The most recent expired subscription, proof of a past hire, not a reason to skip paying. */
  expired: OnchainSub | null;
  /** This wallet has a subscription on this listing, within the swept range. */
  everSubscribed: boolean;
  /** The sweep did not reach the first subscription; some were not checked. */
  truncated: boolean;
  chainNow: bigint | null;
  reason: string | null;
  refetch: () => void;
}

const IDLE: Omit<SubscriptionState, "status" | "reason" | "refetch"> = {
  active: null,
  expired: null,
  everSubscribed: false,
  truncated: false,
  chainNow: null,
};

/**
 * @param listingId The listing to check, or `null` when the agent has no listing.
 */
export function useSubscription(listingId: bigint | null): SubscriptionState {
  const { address, isConnected, chainId } = useAccount();
  const onRightChain = chainId === CHAIN.id;
  const enabled = walletEnabled && isConnected && onRightChain && Boolean(address) && listingId !== null;

  const block = useBlock({
    chainId: CHAIN.id,
    query: { enabled, refetchInterval: 20_000 },
  });

  const count = useReadContract({
    address: CONTRACTS.subscription,
    abi: SUBSCRIPTION_ABI,
    functionName: "subCount",
    chainId: CHAIN.id,
    query: { enabled },
  });

  const ids = useMemo(() => {
    const total = count.data ?? 0n;
    if (total === 0n) return [];
    const first = total > BigInt(SCAN_CAP) ? total - BigInt(SCAN_CAP) + 1n : 1n;
    const out: bigint[] = [];
    for (let id = total; id >= first; id -= 1n) out.push(id);
    return out;
  }, [count.data]);

  const subs = useReadContracts({
    contracts: ids.map((id) => ({
      address: CONTRACTS.subscription,
      abi: SUBSCRIPTION_ABI,
      functionName: "getSub" as const,
      args: [id] as const,
      chainId: CHAIN.id,
    })),
    query: { enabled: enabled && ids.length > 0 },
  });

  const refetch = () => {
    void count.refetch();
    void subs.refetch();
    void block.refetch();
  };

  if (!walletEnabled) return { status: "disabled", ...IDLE, reason: null, refetch };
  if (!isConnected || !address) return { status: "disconnected", ...IDLE, reason: null, refetch };
  if (!onRightChain) return { status: "wrong-network", ...IDLE, reason: null, refetch };
  if (listingId === null) return { status: "ready", ...IDLE, reason: null, refetch };

  const failure = count.error ?? subs.error;
  if (failure) {
    return {
      status: "error",
      ...IDLE,
      reason: failure instanceof Error ? failure.message : "chain read failed",
      refetch,
    };
  }

  const total = count.data;
  const now = block.data?.timestamp ?? null;
  if (total === undefined || now === null) {
    return { status: "loading", ...IDLE, reason: null, refetch };
  }
  if (ids.length > 0 && subs.data === undefined) {
    return { status: "loading", ...IDLE, reason: null, refetch };
  }

  const mine: OnchainSub[] = [];
  (subs.data ?? []).forEach((row, i) => {
    if (row.status !== "success") return;
    const s = row.result as {
      listingId: bigint;
      subscriber: string;
      deposited: bigint;
      claimed: bigint;
      startedAt: bigint;
      endsAt: bigint;
      cancelled: boolean;
    };
    if (s.listingId !== listingId) return;
    if (s.subscriber.toLowerCase() !== address.toLowerCase()) return;
    mine.push({
      subId: ids[i],
      deposited: s.deposited,
      claimed: s.claimed,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      cancelled: s.cancelled,
    });
  });

  // `ids` descends from the newest, so the first match is the most recent one.
  const active = mine.find((s) => !s.cancelled && s.endsAt > now) ?? null;
  const expired = active ? null : (mine[0] ?? null);

  return {
    status: "ready",
    active,
    expired,
    everSubscribed: mine.length > 0,
    truncated: total > BigInt(SCAN_CAP),
    chainNow: now,
    reason: null,
    refetch,
  };
}
