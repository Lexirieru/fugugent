"use client";

/**
 * The live permission check.
 *
 * This panel used to print a shell command and a Copy button, which asked the reader to
 * install a tool, paste a line and read hexadecimal back. That is not a check anyone
 * performs. So the page performs it: one read of `isValidKey` on the Altana keystore
 * contract, no account and no key needed, with the answer written as a sentence.
 *
 * The four states are all real and all named. Loading says it is loading; a true says
 * what was read and where; a false says the permission is not live, which is a real and
 * useful answer rather than an error; a failure says it failed and offers the read
 * again. Nothing is ever a cached yes dressed up as a fresh one.
 *
 * `chainId` is pinned to the test network, so this reads the same contract whether a
 * wallet is connected, connected to something else, or absent entirely.
 */

import { useReadContract } from "wagmi";
import { CHAIN, addressUrl, shorten } from "@/lib/chain";
import { KEYSTORE_ABI } from "@/lib/wallet/abi";
import { walletEnabled } from "@/lib/wallet/config";

export interface PermissionCheckProps {
  keystore: string;
  wallet: string;
  keyHash: string;
}

/**
 * The guard, and the reason it is a separate component: a build with no wallet
 * credential mounts no wagmi provider at all, so the hook below must never be reached
 * on that path. Splitting the two keeps the hook unconditional inside its own component.
 */
export function PermissionCheck(props: PermissionCheckProps) {
  if (!walletEnabled) return <ExplorerFallback {...props} />;
  return <LiveCheck {...props} />;
}

function ExplorerFallback({ keystore, wallet, keyHash }: PermissionCheckProps) {
  return (
    <div className="mt-6 rounded-xl border border-line bg-bg-elev px-4 py-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
        Check it on the explorer
      </h4>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        This build cannot read the contract for you, so it will not claim the permission is live.
        The explorer will answer the same question in one click, under the name{" "}
        <span className="font-mono text-xs">isValidKey</span>.
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
        wallet {shorten(wallet, 12, 8)} · permission {shorten(keyHash, 12, 8)}
      </p>
      <a
        href={`${addressUrl(keystore)}#readContract`}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-4 inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
      >
        Open the keystore contract ↗
      </a>
    </div>
  );
}

function LiveCheck({ keystore, wallet, keyHash }: PermissionCheckProps) {
  const read = useReadContract({
    address: keystore as `0x${string}`,
    abi: KEYSTORE_ABI,
    functionName: "isValidKey",
    args: [wallet as `0x${string}`, keyHash as `0x${string}`],
    chainId: CHAIN.id,
  });

  const link = (
    <a
      href={addressUrl(keystore)}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-xs text-accent-strong underline decoration-dotted underline-offset-4"
    >
      {shorten(keystore)} ↗
    </a>
  );

  return (
    <div className="mt-6 rounded-xl border border-line bg-bg-elev px-4 py-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
        Checked on the blockchain, on this page
      </h4>

      {read.isPending ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Reading the permission from the keystore contract {link} on {CHAIN.name}…
        </p>
      ) : read.isError ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-[var(--risk-4)]">
            The keystore contract did not answer, so this panel is not going to tell you the
            permission is live. It says nothing instead.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            The reason given: {read.error?.message?.slice(0, 180) ?? "no reason given"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => read.refetch()}
              className="inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
            >
              Read it again
            </button>
            {link}
          </div>
        </>
      ) : read.data === true ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-fg">
            The limited permission is live. That answer came from the keystore contract {link}{" "}
            itself, read just now on {CHAIN.name}. Nothing on this page was needed to get it: no
            account, no key, no sign-in.
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
            wallet {shorten(wallet, 12, 8)} · permission {shorten(keyHash, 12, 8)}
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => read.refetch()}
              disabled={read.isFetching}
              className="inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong disabled:opacity-50"
            >
              {read.isFetching ? "Reading…" : "Read it again"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-fg">
            The keystore contract {link} says this permission is not live. It has either run out or
            been withdrawn, so nothing can be signed with it today.
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-faint">
            wallet {shorten(wallet, 12, 8)} · permission {shorten(keyHash, 12, 8)}
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => read.refetch()}
              disabled={read.isFetching}
              className="inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong disabled:opacity-50"
            >
              {read.isFetching ? "Reading…" : "Read it again"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
