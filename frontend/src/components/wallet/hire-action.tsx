"use client";

/**
 * The hire button that genuinely signs `FuguSubscription.subscribe`.
 *
 * Four things this file holds, and why:
 *
 * 1. **The price is read from `FuguRegistry`, not from the catalogue.** The contract
 *    bills from the on-chain `Listing.priceUsd8PerPeriod`. If the backend says a
 *    different number, the backend is the one that is wrong — and the user must be
 *    told before signing, not after.
 *
 * 2. **`maxAmount` and `deadline` are sent correctly.** Without them the listing
 *    owner can front-run `updateListing` from $0.10 to $1000 and drain the user's
 *    allowance; the NatSpec on `subscribe` states that the UI **must not** send
 *    `type(uint256).max`. What is sent here: `maxAmount` = a fresh quote + 1%, and
 *    `deadline` = the latest block timestamp + 10 minutes (block time, not the
 *    browser clock, which can drift).
 *
 * 3. **The native path demands the exact amount.** `subscribe` rejects
 *    `msg.value != amount`, so the quote is refetched immediately before signing and
 *    simulated first — a revert is found before the wallet opens, not after the user
 *    signed something that was always going to fail.
 *
 * 4. **No dead ends.** Not connected, wrong network, not enough balance, rejected,
 *    pending, already hired — every state names what happened and offers the next
 *    step.
 */

import { useAppKit } from "@reown/appkit/react";
import { useEffect, useState } from "react";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { CHAIN, CONTRACTS, addressUrl, txUrl } from "@/lib/chain";
import { useHires } from "@/lib/hired";
import { formatDuration, formatUsd8 } from "@/lib/money";
import { NATIVE_TOKEN, ORACLE_ABI, REGISTRY_ABI, SUBSCRIPTION_ABI } from "@/lib/wallet/abi";
import { explainWriteError, formatChainTime, formatTbnb } from "@/lib/wallet/format";
import { useSubscription } from "@/lib/wallet/subscription";

const FAUCET = "https://www.bnbchain.org/en/testnet-faucet";
/** The signing window. Long enough to read the modal, short enough not to go stale. */
const DEADLINE_WINDOW = 600n;

/** Slippage headroom: 1% above the fresh quote. Never `type(uint256).max`. */
function capFor(amount: bigint): bigint {
  return amount + amount / 100n;
}

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "sent"; hash: `0x${string}` }
  | { kind: "failed"; message: string };

export function HireAction({
  agentId,
  agentName,
  listingId,
  periods,
  catalogPriceUsd8,
}: {
  agentId: string;
  agentName: string;
  listingId: string;
  periods: number;
  /** The catalogue's price per period, USD8 as a decimal string. */
  catalogPriceUsd8: string;
}) {
  const listingIdBig = BigInt(listingId);
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: CHAIN.id });
  const { writeContractAsync } = useWriteContract();
  const { add } = useHires();
  const subscription = useSubscription(listingIdBig);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const onRightChain = chainId === CHAIN.id;

  /** The price that actually applies, read from the registry — not the catalogue. */
  const listing = useReadContract({
    address: CONTRACTS.registry,
    abi: REGISTRY_ABI,
    functionName: "getListing",
    args: [listingIdBig],
    chainId: CHAIN.id,
  });

  const onchainPrice = listing.data?.priceUsd8PerPeriod ?? null;
  const usdTotal8 = onchainPrice === null ? null : onchainPrice * BigInt(periods);

  const quote = useReadContract({
    address: CONTRACTS.priceOracle,
    abi: ORACLE_ABI,
    functionName: "quote",
    args: usdTotal8 === null ? undefined : [NATIVE_TOKEN, usdTotal8],
    chainId: CHAIN.id,
    query: { enabled: usdTotal8 !== null, refetchInterval: 15_000 },
  });

  const balance = useBalance({
    address,
    chainId: CHAIN.id,
    query: { enabled: Boolean(address) && onRightChain },
  });

  const amount = quote.data ?? null;

  const receipt = useWaitForTransactionReceipt({
    hash: phase.kind === "sent" ? phase.hash : undefined,
    chainId: CHAIN.id,
  });

  const confirmed = phase.kind === "sent" && receipt.data?.status === "success";

  // Once the transaction is in a block: record its hash once, then re-read the chain.
  // That local note is not the source of truth — it only keeps the badge present when
  // the wallet is disconnected, and it always links to the transaction that proves it.
  useEffect(() => {
    if (phase.kind !== "sent" || receipt.data?.status !== "success") return;
    add({ agentId, txHash: phase.hash, periods, recordedAt: new Date().toISOString() });
    subscription.refetch();
    // `subscription.refetch` is a new function each render; putting it in the deps
    // would retrigger forever. The hash is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, receipt.data?.status]);

  const priceMismatch =
    onchainPrice !== null && onchainPrice.toString() !== catalogPriceUsd8 ? onchainPrice : null;

  const shortfall =
    amount !== null && balance.data !== undefined && balance.data.value < amount
      ? amount - balance.data.value
      : null;

  async function hire() {
    if (!publicClient || !address) return;
    setPhase({ kind: "signing" });
    try {
      // Freshest quote and chain time, taken immediately before signing.
      const [fresh, block] = await Promise.all([quote.refetch(), publicClient.getBlock()]);
      const value = fresh.data;
      if (value === undefined || value === 0n) {
        setPhase({
          kind: "failed",
          message:
            "The oracle did not return a price for tBNB just now, so we will not ask you to sign a payment we cannot size. Try again in a moment.",
        });
        return;
      }
      const maxAmount = capFor(value);
      const deadline = block.timestamp + DEADLINE_WINDOW;

      // Simulate first: a revert is found before the wallet opens.
      await publicClient.simulateContract({
        address: CONTRACTS.subscription,
        abi: SUBSCRIPTION_ABI,
        functionName: "subscribe",
        args: [listingIdBig, periods, NATIVE_TOKEN, maxAmount, deadline],
        value,
        account: address,
      });

      const hash = await writeContractAsync({
        address: CONTRACTS.subscription,
        abi: SUBSCRIPTION_ABI,
        functionName: "subscribe",
        args: [listingIdBig, periods, NATIVE_TOKEN, maxAmount, deadline],
        value,
        chainId: CHAIN.id,
      });
      setPhase({ kind: "sent", hash });
    } catch (err) {
      setPhase({ kind: "failed", message: explainWriteError(err) });
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-bg-elev p-4 sm:p-5">
      {/* What will be paid, in both currencies, BEFORE signing. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs uppercase tracking-[0.14em] text-faint">Charged at signing</span>
        <span className="font-mono text-xl tabular-nums text-fg">
          {amount === null ? "—" : `${formatTbnb(amount)} tBNB`}
        </span>
        {usdTotal8 !== null ? (
          <span className="text-sm text-muted">= {formatUsd8(usdTotal8)}</span>
        ) : null}
      </div>

      {amount === null ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {listing.isError || quote.isError
            ? "We could not read the price from the contracts, so there is no figure to sign against. The buttons stay out until we can quote it."
            : "Reading the listing price and the oracle quote from chain…"}
        </p>
      ) : (
        <ul className="mt-3 space-y-1 text-xs leading-relaxed text-faint">
          <li>
            Slippage cap sent with the call:{" "}
            <span className="font-mono text-muted">{formatTbnb(capFor(amount))} tBNB</span> — the
            quote plus 1%. Never <span className="font-mono">type(uint256).max</span>: that would
            let the listing owner raise the price after you sign.
          </li>
          <li>
            Deadline sent with the call: 10 minutes from the latest block, measured on chain time.
            A stale transaction that sits in the mempool expires instead of executing at a price you
            never saw.
          </li>
        </ul>
      )}

      {priceMismatch !== null ? (
        <p className="mt-3 rounded-lg border border-[var(--risk-3)] px-3 py-2 text-xs leading-relaxed text-[var(--risk-3)]">
          The catalogue lists {formatUsd8(BigInt(catalogPriceUsd8))} per period, but{" "}
          <a
            href={addressUrl(CONTRACTS.registry)}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
          >
            FuguRegistry
          </a>{" "}
          says {formatUsd8(priceMismatch)}. The figures above use the contract, because that is what
          you will actually be charged.
        </p>
      ) : null}

      {/* Already hired: read from the contract, not from the local note. */}
      {subscription.active ? (
        <div className="mt-4 rounded-lg border border-[var(--risk-1)] px-3 py-2.5">
          <p className="text-sm font-medium text-[var(--risk-1)]">
            You already have subscription #{subscription.active.subId.toString()} running on this
            listing.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            It covers {agentName} until {formatChainTime(subscription.active.endsAt)}
            {subscription.chainNow !== null && subscription.active.endsAt > subscription.chainNow
              ? ` — ${formatDuration(Number(subscription.active.endsAt - subscription.chainNow))} left`
              : ""}
            . {formatTbnb(subscription.active.deposited)} tBNB is in escrow and{" "}
            {formatTbnb(subscription.active.claimed)} tBNB has been drawn so far. Hiring again opens
            a <em>second</em> subscription and charges you again — it does not extend this one.
          </p>
        </div>
      ) : null}

      {subscription.truncated ? (
        <p className="mt-3 text-xs leading-relaxed text-faint">
          Note: this page checked only the most recent 300 subscriptions on the contract. If yours is
          older than that, it will not be found here — the badge can be missing, never wrong.
        </p>
      ) : null}

      {subscription.status === "error" ? (
        <p className="mt-3 text-xs leading-relaxed text-[var(--risk-3)]">
          We could not read your subscription state from chain ({subscription.reason}), so we cannot
          promise you are not about to pay twice. Retry before hiring.{" "}
          <button
            type="button"
            onClick={subscription.refetch}
            className="underline underline-offset-2"
          >
            Retry the chain read
          </button>
        </p>
      ) : null}

      {/* The action. One button; its state is what changes. */}
      <div className="mt-4">
        {!isConnected || !address ? (
          <>
            <button
              type="button"
              onClick={() => open()}
              className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover sm:w-auto"
            >
              Connect a wallet to hire
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              The figures above are read straight from the contracts and need no wallet. Connecting
              only lets you sign — one transaction, on {CHAIN.name}, chain id {CHAIN.id}.
            </p>
          </>
        ) : !onRightChain ? (
          <>
            <button
              type="button"
              onClick={() => switchChain({ chainId: CHAIN.id })}
              disabled={switching}
              className="w-full rounded-full border border-[var(--risk-3)] px-4 py-2.5 text-sm font-semibold text-[var(--risk-3)] transition hover:bg-[color-mix(in_srgb,var(--risk-3)_14%,transparent)] disabled:opacity-50 sm:w-auto"
            >
              {switching ? "Switching…" : `Switch to ${CHAIN.name}`}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              Your wallet is on chain id {chainId ?? "unknown"}. These contracts only exist on{" "}
              {CHAIN.name} (chain id {CHAIN.id}), so nothing here can be signed until you switch.
            </p>
          </>
        ) : confirmed && phase.kind === "sent" ? (
          <>
            <p className="text-sm font-medium text-[var(--risk-1)]">
              Hired. The transaction is in a block.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              The money is in escrow on FuguSubscription and is released to {agentName} only for time
              it actually serves. Cancelling returns the rest to you.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={txUrl(phase.hash)}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-line px-3 py-1.5 font-mono text-xs text-accent-strong transition hover:border-line-strong"
              >
                {phase.hash.slice(0, 14)}… ↗
              </a>
              <button
                type="button"
                onClick={() => setPhase({ kind: "idle" })}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
              >
                Hire again
              </button>
            </div>
          </>
        ) : phase.kind === "sent" ? (
          <>
            <p className="text-sm font-medium text-fg">
              {receipt.data?.status === "reverted"
                ? "The transaction was mined but reverted."
                : "Signed. Waiting for the block."}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {receipt.data?.status === "reverted"
                ? "Nothing was charged beyond gas. Open the transaction to read the revert reason, then try again."
                : "Nothing else is needed from you. BSC testnet blocks land in a few seconds."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={txUrl(phase.hash)}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-line px-3 py-1.5 font-mono text-xs text-accent-strong transition hover:border-line-strong"
              >
                {phase.hash.slice(0, 14)}… ↗
              </a>
              {receipt.data?.status === "reverted" ? (
                <button
                  type="button"
                  onClick={() => setPhase({ kind: "idle" })}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
                >
                  Try again
                </button>
              ) : null}
            </div>
          </>
        ) : shortfall !== null ? (
          <>
            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink opacity-40 sm:w-auto"
            >
              Not enough tBNB
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              This wallet holds {formatTbnb(balance.data?.value ?? 0n)} tBNB and the payment needs{" "}
              {amount === null ? "—" : formatTbnb(amount)} tBNB, plus a little for gas — short by{" "}
              {formatTbnb(shortfall)} tBNB.{" "}
              <a
                href={FAUCET}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent-strong underline decoration-accent/40 underline-offset-4"
              >
                Get testnet tBNB from the faucet ↗
              </a>{" "}
              or lower the number of periods above.
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={hire}
              disabled={amount === null || phase.kind === "signing"}
              className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              {phase.kind === "signing"
                ? "Check your wallet…"
                : subscription.active
                  ? `Hire again anyway — ${usdTotal8 === null ? "" : formatUsd8(usdTotal8)}`
                  : `Hire for ${usdTotal8 === null ? "" : formatUsd8(usdTotal8)}`}
            </button>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              One signature. We simulate the call against the live contract first, so a listing that
              went inactive or a price that moved is caught before your wallet opens.
            </p>
          </>
        )}
      </div>

      {phase.kind === "failed" ? (
        <div className="mt-3 rounded-lg border border-[var(--risk-4)] px-3 py-2.5">
          <p className="text-sm leading-relaxed text-[var(--risk-4)]">{phase.message}</p>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="mt-2 rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
          >
            Back to the quote
          </button>
        </div>
      ) : null}
    </div>
  );
}
