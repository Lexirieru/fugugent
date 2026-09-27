"use client";

/** The rating tile's value: average and count, read from FuguReputation. */

import { useReadContracts } from "wagmi";
import { CHAIN, CONTRACTS } from "@/lib/chain";
import { REPUTATION_ABI } from "@/lib/wallet/abi";

export function RatingStat({ listingId }: { listingId: string }) {
  const id = BigInt(listingId);
  const read = useReadContracts({
    contracts: [
      { address: CONTRACTS.reputation, abi: REPUTATION_ABI, functionName: "reviewCount", args: [id], chainId: CHAIN.id },
      { address: CONTRACTS.reputation, abi: REPUTATION_ABI, functionName: "averageScoreX100", args: [id], chainId: CHAIN.id },
    ],
  });
  const count = read.data?.[0]?.status === "success" ? (read.data[0].result as bigint) : null;
  const avg = read.data?.[1]?.status === "success" ? (read.data[1].result as bigint) : null;
  if (count === null || avg === null) return <>…</>;
  if (count === 0n) return <>None yet</>;
  return (
    <>
      ★ {(Number(avg) / 100).toFixed(1)}
      <span className="ml-1 text-sm opacity-60">({count.toString()})</span>
    </>
  );
}
