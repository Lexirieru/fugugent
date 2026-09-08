"use client";

/**
 * The hire flow.
 *
 * Two rules shape this whole component:
 *
 * 1. **A cost estimate before hiring, not merely a warning.** The total is computed
 *    with `bigint` in USD8 base — no money value passes through `number` on this
 *    path. Its tBNB equivalent is read from the oracle inside `HireAction`, so the
 *    user sees both figures before signing anything.
 * 2. **Never ship a half-finished control.** The signing button renders only when
 *    this build genuinely carries Reown credentials; without them, what shows is
 *    the `cast` path, which produces an equally real transaction. There is never a
 *    Connect button that connects nothing.
 */

import { useMemo, useState } from "react";
import { HireCast } from "@/components/hire-cast";
import { HireAction } from "@/components/wallet/hire-action";
import { CHAIN, txUrl } from "@/lib/chain";
import { useHires, isTxHash } from "@/lib/hired";
import { estimateCost, formatDuration, formatUsd8, formatPeriod } from "@/lib/money";
import { walletEnabled } from "@/lib/wallet/config";

const PRESETS = [1, 10, 30, 60];

export function HirePanel({
  agentId,
  agentName,
  listingId,
  /** USD8 as a decimal string — `bigint` cannot cross the server/client boundary. */
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
  const [hash, setHash] = useState("");
  const { ready, find, add, remove } = useHires();
  const existing = ready ? find(agentId) : null;

  const price = useMemo(() => BigInt(priceUsd8), [priceUsd8]);
  const est = useMemo(
    () => estimateCost(price, periodSeconds, periods),
    [price, periodSeconds, periods],
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-fg">Hire {agentName}</h3>

      <div className="mt-4">
        <label htmlFor="periods" className="text-xs uppercase tracking-[0.16em] text-faint">
          How many periods
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
              className={`rounded-full border px-3 py-1 text-xs transition ${
                periods === p
                  ? "border-accent/50 bg-accent-soft text-accent"
                  : "border-line text-muted hover:border-line-strong hover:text-fg"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* The cost estimate — the point of this panel. */}
      <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-[var(--border)] sm:grid-cols-3">
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

      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
        <li>
          Priced in USD and settled in tBNB. The oracle converts at the block that lands your
          transaction, so the tBNB figure is only final at signing — which is why the quote below
          refreshes and the call carries a slippage cap and a deadline.
        </li>
        <li>
          The money sits in escrow on <span className="font-mono text-xs">FuguSubscription</span>{" "}
          and is released to the agent only for time it has actually served. Cancelling returns
          the rest to you.
        </li>
        <li>
          A 5% protocol fee comes out of the agent&apos;s payout, not out of your deposit. What
          you pay is the number above.
        </li>
      </ul>

      {/* The limits of the claim, repeated where the money moves. Somebody who
          scrolled straight to Hire must not miss what they are buying: "listed and
          hireable" and "able to act on chain" are two different things. */}
      {notShipped ? (
        <div className="mt-5 rounded-xl border border-[var(--risk-3)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--risk-3)]">
            Before you pay
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-fg">{notShipped}</p>
        </div>
      ) : null}

      {/* In-browser signing, when this build has Reown credentials. */}
      {walletEnabled ? (
        <HireAction
          agentId={agentId}
          agentName={agentName}
          listingId={listingId}
          periods={est.periods}
          catalogPriceUsd8={priceUsd8}
        />
      ) : (
        <div className="mt-6">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            This build has no Reown project id, so there is no Connect button here that would do
            nothing. The commands below are the same call the button makes — one signature, on{" "}
            {CHAIN.name}, chain id {CHAIN.id}.
          </p>
          <HireCast
            listingId={listingId}
            periods={est.periods}
            usdTotal8={est.totalUsd8.toString()}
          />
        </div>
      )}

      {/* The CLI path stays open: the same call, checkable without a wallet. */}
      {walletEnabled ? (
        <details className="mt-4 rounded-xl border border-line bg-bg-elev px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.14em] text-faint">
            Rather sign from a terminal? The same call, as two commands
          </summary>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            Identical arguments to the button above, including the 1% cap and the ten-minute
            deadline. Useful for checking what the UI actually sends.
          </p>
          <div className="mt-3">
            <HireCast
              listingId={listingId}
              periods={est.periods}
              usdTotal8={est.totalUsd8.toString()}
            />
          </div>
        </details>
      ) : null}

      {/* This device's hire note: for a payment made outside this tab. */}
      <div className="mt-6 border-t border-line pt-5">
        {existing ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-fg">
              This device has a hire recorded for {agentName}.
            </span>
            <a
              href={txUrl(existing.txHash)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-xs text-accent underline decoration-accent/40 underline-offset-4"
            >
              {existing.txHash.slice(0, 12)}… ↗
            </a>
            <button
              type="button"
              onClick={() => remove(agentId)}
              className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
            >
              Remove
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!isTxHash(hash)) return;
              add({
                agentId,
                txHash: hash.trim(),
                periods: est.periods,
                recordedAt: new Date().toISOString(),
              });
              setHash("");
            }}
          >
            <label htmlFor="txhash" className="text-xs uppercase tracking-[0.16em] text-faint">
              Paid from a terminal or another device? Record the transaction
            </label>
            <p className="mt-1 text-xs leading-relaxed text-faint">
              Not needed when you hire with the button above — that records itself. This is for a
              payment made elsewhere. Stored in this browser only; the badge links to the
              transaction, so anyone can check it. Your live subscription state is read from the
              contract, not from this note.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="txhash"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-line bg-bg-elev px-3 py-2 font-mono text-xs text-fg placeholder:text-faint"
              />
              <button
                type="submit"
                disabled={!isTxHash(hash)}
                className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-[#06131a] transition hover:bg-[#ffce35] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Record
              </button>
            </div>
            {hash && !isTxHash(hash) ? (
              <p className="mt-2 text-xs text-[var(--risk-4)]">
                That is not a 32-byte transaction hash.
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
