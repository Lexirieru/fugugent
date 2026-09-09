"use client";

/**
 * Listing an agent that somebody else owns.
 *
 * 103 of the 112 agents in the live catalogue end in a card that says nothing can be
 * paid, because nobody has put a price on them. This panel is how that stops being a
 * dead end: the agent's own owner signs one transaction and their agent becomes
 * hireable, with the money going to them.
 *
 * ## Why only the owner, and why that gate is ours rather than the chain's
 *
 * `FuguRegistry.list()` is permissionless and writes `owner: msg.sender`, and
 * `FuguSubscription.claim()` pays `listing.owner`. So whoever signs is whoever gets
 * paid. If this app listed an agent on its owner's behalf, every renter's money would
 * arrive at us. That is the whole reason the button is gated.
 *
 * The gate compares the connected wallet against the `ownerAddress` the catalogue
 * holds. **The contract does not check that.** Its own comments say so: `list()` never
 * asks the ERC-8004 registry whether the signer owns the id, and all it guarantees is
 * that one agent id maps to one listing, first come first served. The screen says that
 * too, because a check the reader thinks the chain is making, and it is not, is worse
 * than no check at all.
 *
 * ## Three fields are permanent
 *
 * `updateListing` can change the price, the period and the metadata later. It cannot
 * change the category or the agent wallet, and nothing can change the owner. Each of
 * those is marked on screen where it is typed, not in a footnote.
 *
 * ## What is never promised
 *
 * Not one third-party agent in this catalogue has a verified endpoint. Listing puts a
 * price on the blockchain; it does not make the agent answer. The panel says that in
 * plain words above the signing button, in the same place and the same tone as the
 * "before you pay" block a renter sees.
 */

import { useAppKit } from "@reown/appkit/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/agents";
import { CATEGORIES, type Category } from "@/lib/agent-types";
import { CHAIN, CONTRACTS, addressUrl, shorten, txUrl } from "@/lib/chain";
import {
  ZERO_ADDRESS,
  asAddress,
  listingMetadataUri,
  sameAddress,
} from "@/lib/listing-metadata";
import { estimateCost, formatDuration, formatPeriod, formatUsd8, parseUsdToUsd8 } from "@/lib/money";
import { REGISTRY_WRITE_ABI } from "@/lib/wallet/abi";
import { explainWriteError } from "@/lib/wallet/format";
import { walletEnabled } from "@/lib/wallet/config";

/** The period lengths on offer. Anything else is a number nobody would pick on purpose. */
const PERIODS: Array<{ seconds: number; label: string }> = [
  { seconds: 120, label: "2 minutes" },
  { seconds: 3_600, label: "1 hour" },
  { seconds: 86_400, label: "1 day" },
  { seconds: 604_800, label: "7 days" },
  { seconds: 2_592_000, label: "30 days" },
];

export interface ListAgentProps {
  /** The catalogue's record, serialised across the server and client boundary. */
  agentName: string;
  agentDescription: string;
  /** The ERC-8004 token id, as a decimal string. */
  tokenId: string;
  /** Who the catalogue says owns this agent. `null` when it does not know. */
  ownerAddress: string | null;
  /** The wallet the catalogue says the agent signs with. `null` when it does not know. */
  agentWallet: string | null;
  /** Our classifier's answer, or `null`. */
  classifiedCategory: Category | null;
  classifierConfidence: number | null;
  classifierReason: string | null;
  endpointVerified: boolean;
  catalogueSource: string;
}

export function ListAgent(props: ListAgentProps) {
  if (!walletEnabled) return <NoWalletBuild {...props} />;
  return <Panel {...props} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      {children}
    </div>
  );
}

function OwnerLine({ ownerAddress }: { ownerAddress: string | null }) {
  if (!ownerAddress) {
    return (
      <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
        The catalogue does not hold an owner for this agent, so there is nobody this page
        can name. Nothing here can be listed until the record carries one.
      </p>
    );
  }
  return (
    <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
      Only the wallet that owns it can, and the catalogue records that as{" "}
      <a
        href={addressUrl(ownerAddress)}
        target="_blank"
        rel="noreferrer noopener"
        className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
      >
        {shorten(ownerAddress)} ↗
      </a>
      .
    </p>
  );
}

function NoWalletBuild({ ownerAddress }: ListAgentProps) {
  return (
    <Shell>
      <h3 className="text-lg font-semibold text-fg">This agent has no price on it yet</h3>
      <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
        Nobody has listed it, so there is nothing to pay and nothing to pay for.
      </p>
      <OwnerLine ownerAddress={ownerAddress} />
      <p className="mt-4 text-pretty text-sm leading-relaxed text-muted">
        This build cannot open a wallet, so the form that would do it is left out rather
        than shown broken. The registry that holds every listing is public and you can read
        it now.
      </p>
      <a
        href={addressUrl(CONTRACTS.registry)}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
      >
        Open FuguRegistry ↗
      </a>
    </Shell>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "sent"; hash: `0x${string}` }
  | { kind: "failed"; message: string };

function Panel(props: ListAgentProps) {
  const {
    agentName,
    agentDescription,
    tokenId,
    ownerAddress,
    agentWallet,
    classifiedCategory,
    classifierConfidence,
    classifierReason,
    endpointVerified,
    catalogueSource,
  } = props;

  const router = useRouter();
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const onRightChain = chainId === CHAIN.id;
  const isOwner = sameAddress(address, ownerAddress);

  const [priceText, setPriceText] = useState("0.05");
  const [periodSeconds, setPeriodSeconds] = useState(120);
  const [category, setCategory] = useState<Category>(classifiedCategory ?? "REBALANCING");
  const [walletText, setWalletText] = useState(agentWallet ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const agentId = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return null;
    }
  }, [tokenId]);

  /**
   * `AgentAlreadyListed`, found before anybody signs.
   *
   * The contract reverts when this id already maps to a listing. Reading the mapping
   * first costs nothing and turns a rejected signature into a sentence.
   */
  const existing = useReadContract({
    address: CONTRACTS.registry,
    abi: REGISTRY_WRITE_ABI,
    functionName: "listingByAgentId",
    args: agentId === null ? undefined : [agentId],
    chainId: CHAIN.id,
    query: { enabled: agentId !== null },
  });

  const alreadyListed = typeof existing.data === "bigint" && existing.data > 0n;

  const priceUsd8 = useMemo(() => parseUsdToUsd8(priceText), [priceText]);
  const estimate = useMemo(
    () => (priceUsd8 === null ? null : estimateCost(priceUsd8, periodSeconds, 30)),
    [priceUsd8, periodSeconds],
  );
  const walletValue = walletText.trim() === "" ? ZERO_ADDRESS : asAddress(walletText);
  const walletIsBad = walletValue === null;
  const priceIsBad = priceUsd8 === null || priceUsd8 === 0n;

  const receipt = useWaitForTransactionReceipt({
    hash: phase.kind === "sent" ? phase.hash : undefined,
    chainId: CHAIN.id,
  });
  const confirmed = phase.kind === "sent" && receipt.data?.status === "success";

  async function submit() {
    if (agentId === null || priceUsd8 === null || walletValue === null) return;
    setPhase({ kind: "signing" });
    try {
      const metadataURI = listingMetadataUri({
        name: agentName,
        description: agentDescription,
        tokenId,
        category,
        agentWallet: walletValue,
        endpointVerified,
        catalogueSource,
        listedAt: new Date().toISOString(),
      });
      const hash = await writeContractAsync({
        address: CONTRACTS.registry,
        abi: REGISTRY_WRITE_ABI,
        functionName: "list",
        args: [
          agentId,
          walletValue,
          CATEGORIES.indexOf(category),
          priceUsd8,
          periodSeconds,
          metadataURI,
        ],
        chainId: CHAIN.id,
      });
      setPhase({ kind: "sent", hash });
    } catch (err) {
      setPhase({ kind: "failed", message: explainWriteError(err) });
    }
  }

  // --- states that are not the form ----------------------------------------

  if (agentId === null) {
    return (
      <Shell>
        <h3 className="text-lg font-semibold text-fg">This agent cannot be listed here</h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
          Its id in the catalogue is not a number the registry can hold, so this page
          cannot build a listing for it without inventing one.
        </p>
      </Shell>
    );
  }

  if (alreadyListed) {
    return (
      <Shell>
        <h3 className="text-lg font-semibold text-fg">This agent id is already listed</h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
          The registry already maps agent id {tokenId} to listing number{" "}
          {existing.data?.toString()}, and it holds one listing per id. Whatever this page
          is showing, the price and the payee live there.
        </p>
        <a
          href={addressUrl(CONTRACTS.registry)}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-4 inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
        >
          Read the listing on FuguRegistry ↗
        </a>
      </Shell>
    );
  }

  if (confirmed && phase.kind === "sent") {
    return (
      <Shell>
        <h3 className="text-lg font-semibold text-[var(--risk-1)]">
          Listed. The transaction is in a block.
        </h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
          {agentName} now carries a price, and payments for it go to your wallet. Reload the
          page and the hire panel takes the place of this one.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
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
            onClick={() => {
              void existing.refetch();
              router.refresh();
            }}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-line-strong hover:text-fg"
          >
            Reload this page
          </button>
        </div>
      </Shell>
    );
  }

  if (!isConnected || !address) {
    return (
      <Shell>
        <h3 className="text-lg font-semibold text-fg">This agent has no price on it yet</h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
          Nobody has listed it, so there is nothing to pay and nothing to pay for.
        </p>
        <OwnerLine ownerAddress={ownerAddress} />
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
          If that wallet is yours, connect it and you can put a price on this agent in one
          signature. The money from every hire then goes to the wallet that signed, which is
          why nobody else can do it for you.
        </p>
        <button
          type="button"
          onClick={() => open()}
          className="mt-5 w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover sm:w-auto"
        >
          Connect the owner&apos;s wallet
        </button>
      </Shell>
    );
  }

  if (!isOwner) {
    return (
      <Shell>
        <h3 className="text-lg font-semibold text-fg">This agent has no price on it yet</h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
          Nobody has listed it, so there is nothing to pay and nothing to pay for.
        </p>
        <OwnerLine ownerAddress={ownerAddress} />
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
          The wallet you have connected is{" "}
          <span className="font-mono text-xs">{shorten(address)}</span>, which is not that
          one. There is no button here, because listing writes the payee into the contract
          and a listing you signed would send this agent&apos;s earnings to you.
        </p>
      </Shell>
    );
  }

  if (!onRightChain) {
    return (
      <Shell>
        <h3 className="text-lg font-semibold text-fg">You own this agent, on another network</h3>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted">
          Your wallet is on network {chainId ?? "unknown"}. The registry only exists on{" "}
          {CHAIN.name}, network {CHAIN.id}, so nothing here can be signed until you switch.
        </p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: CHAIN.id })}
          disabled={switching}
          className="mt-5 w-full rounded-full border border-[var(--risk-3)] px-4 py-2.5 text-sm font-semibold text-[var(--risk-3)] transition hover:bg-[color-mix(in_srgb,var(--risk-3)_14%,transparent)] disabled:opacity-50 sm:w-auto"
        >
          {switching ? "Switching…" : `Switch to ${CHAIN.name}`}
        </button>
      </Shell>
    );
  }

  // --- the form -------------------------------------------------------------

  const meta = CATEGORY_META[category];

  return (
    <Shell>
      <h3 className="text-lg font-semibold text-fg">List {agentName}</h3>
      <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">
        You are connected as{" "}
        <span className="font-mono text-xs">{shorten(address)}</span>, the wallet the
        catalogue records as this agent&apos;s owner. One signature puts a price on it, and
        every payment for it afterwards goes to you.
      </p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="list-price" className="text-xs uppercase tracking-[0.16em] text-faint">
            Price per period, in dollars
          </label>
          <input
            id="list-price"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            inputMode="decimal"
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-line bg-bg-elev px-3 py-2 font-mono text-sm tabular-nums text-fg"
          />
          <p className="mt-2 text-xs leading-relaxed text-faint">
            Set in dollars and paid in tBNB at the rate of the block that lands the payment.
            You can change this later with <span className="font-mono">updateListing</span>.
          </p>
          {priceIsBad ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--risk-4)]">
              {priceUsd8 === null
                ? "That is not a dollar amount. Digits, and up to eight decimal places."
                : "The contract refuses a price of zero, so this has to be more than nothing."}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="list-period" className="text-xs uppercase tracking-[0.16em] text-faint">
            One period lasts
          </label>
          <select
            id="list-period"
            value={periodSeconds}
            onChange={(e) => setPeriodSeconds(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-line bg-bg-elev px-3 py-2 text-sm text-fg"
          >
            {PERIODS.map((p) => (
              <option key={p.seconds} value={p.seconds}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            A renter buys whole periods. You can change this later too.
          </p>
        </div>

        <div>
          <label htmlFor="list-category" className="text-xs uppercase tracking-[0.16em] text-faint">
            Kind of agent
          </label>
          <select
            id="list-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="mt-2 w-full rounded-lg border border-line bg-bg-elev px-3 py-2 text-sm text-fg"
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-pretty text-xs leading-relaxed text-faint">
            {classifiedCategory
              ? `Filled in from our own reading of this agent's description${
                  classifierConfidence === null
                    ? ""
                    : `, which we put at ${Math.round(classifierConfidence * 100)} out of 100`
                }. It is a guess about somebody else's agent, so change it if it is wrong.`
              : "We could not read a kind from this agent's description, so this one is unset and yours to choose."}{" "}
            <strong className="font-medium text-[var(--risk-3)]">
              This cannot be changed after you sign.
            </strong>{" "}
            The contract has no setter for it.
          </p>
          {classifierReason ? (
            <p className="mt-1.5 text-pretty text-[11px] leading-relaxed text-faint">
              Why we guessed that: {classifierReason}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="list-wallet" className="text-xs uppercase tracking-[0.16em] text-faint">
            The wallet this agent signs with
          </label>
          <input
            id="list-wallet"
            value={walletText}
            onChange={(e) => setWalletText(e.target.value)}
            placeholder="0x… , or leave it empty"
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-line bg-bg-elev px-3 py-2 font-mono text-xs text-fg placeholder:text-faint"
          />
          <p className="mt-2 text-pretty text-xs leading-relaxed text-faint">
            {agentWallet
              ? "Filled in from the catalogue."
              : "The catalogue does not know it, so this starts empty."}{" "}
            No money is ever sent here: payments go to the wallet that signs this listing.
            It is a label saying which wallet does the agent&apos;s work.{" "}
            <strong className="font-medium text-[var(--risk-3)]">
              This cannot be changed afterwards either.
            </strong>
          </p>
          {walletIsBad ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--risk-4)]">
              That is not an address. Forty hexadecimal characters after 0x, or nothing at
              all.
            </p>
          ) : null}
        </div>
      </div>

      {/* What a renter would see, worked out from what is typed above. */}
      {estimate && !priceIsBad ? (
        <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-[var(--border)] sm:grid-cols-3">
          <div className="bg-bg-elev px-4 py-3">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Per period</dt>
            <dd className="mt-1 font-mono text-xl tabular-nums text-fg">
              {formatUsd8(priceUsd8!)}
            </dd>
          </div>
          <div className="bg-bg-elev px-4 py-3">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Per day</dt>
            <dd className="mt-1 font-mono text-xl tabular-nums text-fg">
              {formatUsd8(estimate.perDayUsd8)}
            </dd>
          </div>
          <div className="bg-bg-elev px-4 py-3">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">
              30 periods cost
            </dt>
            <dd className="mt-1 font-mono text-xl tabular-nums text-fg">
              {formatUsd8(estimate.totalUsd8)}
              <span className="ml-1.5 text-xs text-faint">
                for {formatDuration(estimate.durationSeconds)}
              </span>
            </dd>
          </div>
        </dl>
      ) : null}

      {/* The two things a reader has to know before signing, in the same place and the
          same tone as the block a renter sees before paying. */}
      <div className="mt-6 rounded-xl border border-[var(--risk-3)] px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--risk-3)]">
          Before you sign
        </p>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-fg">
          Listing puts a price on the blockchain. It does not make the agent answer. This
          catalogue has never checked an address for {agentName}, and no third-party agent in
          it has a checked one. If somebody hires it and nothing happens, they can cancel and
          take back the time that was not served, and that is the whole of their protection.
        </p>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-fg">
          The registry does not ask anyone whether you own agent id {tokenId}. The check that
          put this form in front of you is ours, made against the catalogue&apos;s record of
          the owner. What the contract guarantees is only that one agent id maps to one
          listing, first come first served. Its own comments say so, and it is one of the
          reasons none of this is on the main network.
        </p>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={submit}
          disabled={priceIsBad || walletIsBad || phase.kind === "signing" || existing.isPending}
          className="w-full rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {phase.kind === "signing"
            ? "Check your wallet…"
            : `List it as ${meta.label} at ${priceIsBad ? "a price" : formatUsd8(priceUsd8!)} per ${formatPeriod(periodSeconds)}`}
        </button>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          One signature, on {CHAIN.name}, network {CHAIN.id}. You pay the network fee and
          nothing else.
        </p>
      </div>

      {phase.kind === "sent" ? (
        <div className="mt-4 rounded-lg border border-line px-3 py-2.5">
          <p className="text-sm font-medium text-fg">
            {receipt.data?.status === "reverted"
              ? "The transaction was mined but reverted."
              : "Signed. Waiting for the block."}
          </p>
          <a
            href={txUrl(phase.hash)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-block font-mono text-xs text-accent-strong"
          >
            {phase.hash.slice(0, 14)}… ↗
          </a>
        </div>
      ) : null}

      {phase.kind === "failed" ? (
        <div className="mt-4 rounded-lg border border-[var(--risk-4)] px-3 py-2.5">
          <p className="text-pretty text-sm leading-relaxed text-[var(--risk-4)]">
            {phase.message}
          </p>
          <button
            type="button"
            onClick={() => setPhase({ kind: "idle" })}
            className="mt-2 rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
          >
            Back to the form
          </button>
        </div>
      ) : null}
    </Shell>
  );
}
