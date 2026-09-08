"use client";

/**
 * Alur hire.
 *
 * Dua aturan yang membentuk seluruh komponen ini:
 *
 * 1. **Estimasi biaya sebelum hire, bukan sekadar peringatan.** Angka totalnya
 *    dihitung dengan `bigint` basis USD8 — tidak ada satu pun nilai uang yang
 *    lewat `number` di jalur ini.
 * 2. **Jangan pernah mengirim kontrol setengah jadi.** Penandatanganan di dalam
 *    browser belum ada, jadi tidak ada tombol "Connect wallet" yang tidak
 *    menghubungkan apa pun. Yang diberikan adalah panggilan yang sama persis
 *    dengan yang akan dilakukan tombol itu nanti — bisa disalin, bisa dijalankan,
 *    dan menghasilkan transaksi sungguhan.
 */

import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { CHAIN, CONTRACTS, txUrl } from "@/lib/chain";
import { useHires, isTxHash } from "@/lib/hired";
import { estimateCost, formatDuration, formatUsd8, formatPeriod } from "@/lib/money";

const PRESETS = [1, 10, 30, 60];

export function HirePanel({
  agentId,
  agentName,
  listingId,
  /** String desimal USD8 — `bigint` tidak bisa menyeberang batas server/klien. */
  priceUsd8,
  periodSeconds,
}: {
  agentId: string;
  agentName: string;
  listingId: string;
  priceUsd8: string;
  periodSeconds: number;
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
  const usdTotal8 = est.totalUsd8.toString();

  const quoteCommand = `# 1. Ask the oracle what ${formatUsd8(est.totalUsd8)} costs in tBNB right now
AMOUNT=$(cast call ${CONTRACTS.priceOracle} \\
  'quote(address,uint256)(uint256)' \\
  0x0000000000000000000000000000000000000000 ${usdTotal8} \\
  --rpc-url ${CHAIN.rpc} | awk '{print $1}')

# 2. Allow 1% of movement between the quote and the block that lands it.
#    Never send type(uint256).max here — the contract's own NatSpec says the UI must not.
MAX=$((AMOUNT + AMOUNT / 100))`;

  const hireCommand = `cast send ${CONTRACTS.subscription} \\
  'subscribe(uint256,uint32,address,uint256,uint256)' \\
  ${listingId} ${est.periods} 0x0000000000000000000000000000000000000000 "$MAX" $(( $(date +%s) + 600 )) \\
  --value "$AMOUNT" \\
  --rpc-url ${CHAIN.rpc} \\
  --private-key "$PRIVATE_KEY"`;

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

      {/* Estimasi biaya — inti panel ini. */}
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
          transaction, so the tBNB figure is only final at signing — which is why the command
          below quotes it first and caps the slippage.
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

      {/* Kontrol yang jujur: perintah yang sama dengan yang akan dijalankan tombol nanti. */}
      <div className="mt-6 rounded-xl border border-line bg-bg-elev">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
            Step 1 — quote and cap
          </span>
          <CopyButton text={quoteCommand} />
        </div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
          {quoteCommand}
        </pre>
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-line px-4 py-2.5">
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-faint">
            Step 2 — hire
          </span>
          <CopyButton text={hireCommand} />
        </div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-muted">
          {hireCommand}
        </pre>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-faint">
        In-browser wallet signing is not built yet, so there is no Connect button here that would
        do nothing. This is the same call that button will make — one signature, on{" "}
        {CHAIN.name}, chain id {CHAIN.id}.
      </p>

      {/* Badge Hired: dicatat oleh pengguna, dibuktikan oleh tx hash, bisa dihapus lagi. */}
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
              Already paid? Record the transaction
            </label>
            <p className="mt-1 text-xs leading-relaxed text-faint">
              Stored in this browser only, so the marketplace can show a{" "}
              <span className="text-fg">Hired</span> badge and stop you paying twice. The badge
              links to the transaction, so anyone can check it.
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
