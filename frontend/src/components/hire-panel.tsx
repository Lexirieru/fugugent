"use client";

/**
 * The hire flow.
 *
 * Two rules shape this whole component:
 *
 * 1. **A cost estimate before hiring, not merely a warning.** The total is computed
 *    with `bigint` in USD8 base: no money value passes through `number` on this path.
 *    Its tBNB equivalent is read from the price contract inside `HireAction`, so the
 *    user sees both figures before signing anything.
 * 2. **Nothing here asks anyone to type a command.** This panel used to carry two
 *    shell commands with Copy buttons and a box for pasting a transaction hash back
 *    in. All three are gone. Hiring is a button, and the button records itself.
 */

import { useMemo, useState } from "react";
import { HireAction } from "@/components/wallet/hire-action";
import { CONTRACTS, addressUrl, txUrl } from "@/lib/chain";
import { useHires } from "@/lib/hired";
import { estimateCost, formatDuration, formatUsd8, formatPeriod } from "@/lib/money";
import { walletEnabled } from "@/lib/wallet/config";

const PRESETS = [1, 10, 30, 60];

export function HirePanel({
  agentId,
  agentName,
  listingId,
  /** USD8 as a decimal string: `bigint` cannot cross the server and client boundary. */
  priceUsd8,
  periodSeconds,
  notShipped = null,
}: {
  agentId: string;
  agentName: string;
  listingId: string;
  priceUsd8: string;
  periodSeconds: number;
  /** What this agent still cannot do. Shown here, above the pay button, not only further up the page. */
  notShipped?: string | null;
}) {
  const [periods, setPeriods] = useState(10);
  const { ready, find, remove } = useHires();
  const existing = ready ? find(agentId) : null;

  const price = useMemo(() => BigInt(priceUsd8), [priceUsd8]);
  const est = useMemo(
    () => estimateCost(price, periodSeconds, periods),
    [price, periodSeconds, periods],
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-fg">Hire {agentName}</h3>

      <div className="mt-6">
        <label htmlFor="periods" className="text-xs uppercase tracking-[0.16em] text-faint">
          How many periods
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            id="periods"
            type="number"
            min={1}
            max={10_000}
            value={periods}
            onChange={(e) => setPeriods(Math.max(1, Math.min(10_000, Number(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-line bg-bg-elev px-3 py-2 font-mono text-sm tabular-nums text-fg"
          />
          <span className="text-sm text-muted">× {formatPeriod(periodSeconds)}</span>
          <span className="grow" />
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriods(p)}
              aria-pressed={periods === p}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                periods === p
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent-strong"
                  : "border-line text-muted hover:border-line-strong hover:text-fg"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* The cost estimate: the point of this panel. */}
      <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-[var(--border)] sm:grid-cols-3">
        <div className="bg-bg-elev px-4 py-3">
          <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">You pay</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums text-fg">
            {formatUsd8(est.totalUsd8)}
          </dd>
        </div>
        <div className="bg-bg-elev px-4 py-3">
          <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Covers</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums text-fg">
            {formatDuration(est.durationSeconds)}
          </dd>
        </div>
        <div className="bg-bg-elev px-4 py-3">
          <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">Same as</dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums text-fg">
            {formatUsd8(est.perDayUsd8)}
            <span className="ml-1 text-sm text-faint">/ day</span>
          </dd>
        </div>
      </dl>

      <ul className="mt-6 space-y-3 text-pretty text-sm leading-relaxed text-muted">
        <li>
          The price is set in dollars and paid in tBNB. The rate is taken at the moment your payment
          lands, so the tBNB figure is only final at signing. That is why the quote below refreshes,
          and why the payment carries both a ceiling and a cut-off time.
        </li>
        <li>
          Your money is held by <span className="font-mono text-xs">FuguSubscription</span> until
          the work is done, and released to the agent only for time it has actually served.
          Cancelling returns the rest to you.
        </li>
        <li>
          A 5% platform fee comes out of the agent&apos;s payout, not out of your deposit. What you
          pay is the number above.
        </li>
      </ul>

      {/* The limits of the claim, repeated where the money moves. Somebody who
          scrolled straight to Hire must not miss what they are buying: "listed and
          hireable" and "able to act" are two different things. */}
      {notShipped ? (
        <div className="mt-6 rounded-xl border border-[var(--risk-3)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--risk-3)]">
            Before you pay
          </p>
          <p className="mt-2 text-pretty text-sm leading-relaxed break-words text-fg">{notShipped}</p>
        </div>
      ) : null}

      {/* Signing in the browser, which is the only way to hire from this page. */}
      {walletEnabled ? (
        <HireAction
          agentId={agentId}
          agentName={agentName}
          listingId={listingId}
          periods={est.periods}
          catalogPriceUsd8={priceUsd8}
        />
      ) : (
        <div className="mt-6 rounded-xl border border-line bg-bg-elev p-4 sm:p-5">
          <p className="text-sm font-medium text-fg">
            This build cannot open a wallet, so there is no pay button here.
          </p>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-muted">
            A button that opens nothing is worse than no button, so it is left out rather than shown
            broken. The contract that would take the payment is public and you can read it now.
          </p>
          <a
            href={addressUrl(CONTRACTS.subscription)}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-4 inline-flex items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-fg transition hover:border-line-strong hover:bg-surface-strong"
          >
            Open FuguSubscription ↗
          </a>
        </div>
      )}

      {/* A hire this browser has seen land. Written by the button above, never typed. */}
      {existing ? (
        <div className="mt-6 border-t border-line pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-fg">
              This browser has a hire recorded for {agentName}.
            </span>
            <a
              href={txUrl(existing.txHash)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-accent-strong underline decoration-accent/40 underline-offset-4"
            >
              {existing.txHash.slice(0, 12)}… ↗
            </a>
            <button
              type="button"
              onClick={() => remove(agentId)}
              className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
            >
              Forget it
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            The note is kept in this browser only, and it links to the transaction so anyone can
            check it. Whether the hire is still running is read from the contract, not from this
            note.
          </p>
        </div>
      ) : null}
    </div>
  );
}
