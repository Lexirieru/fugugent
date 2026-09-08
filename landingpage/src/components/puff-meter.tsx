"use client";

import { useId, useState } from "react";
import { Fugu, puffColor } from "@/components/fugu";
import { GUARDIAN_RESCUE, txUrl } from "@/lib/chain";

/**
 * Alat baca inti produk: geser health factor, lihat fugu mengembang.
 *
 * Ambang dan nama aksinya bukan hiasan — persis `DEFAULT_THRESHOLDS` dan
 * `decide()` di ai/fuguguardian/app/agent/src/strategy. Kalau ambang di
 * strategi berubah, angka di sini harus ikut diubah.
 */

const MIN_CENTS = 100; // health factor 1,00 — batas likuidasi
const MAX_CENTS = 300; // 3,00 — sangat aman
const REAL_CENTS = 114; // 1,14 — bacaan sungguhan pada run yang dibuktikan

type Band = {
  action: string;
  headline: string;
  body: string;
  min: number; // batas bawah eksklusif, dalam sen
};

const BANDS: Band[] = [
  {
    min: 150,
    action: "NONE",
    headline: "Calm",
    body: "Nothing to do. The agent watches and spends nothing.",
  },
  {
    min: 120,
    action: "WARN",
    headline: "Watching",
    body: "Close enough to explain itself, still far enough not to touch your money.",
  },
  {
    min: 110,
    action: "PARTIAL_REPAY",
    headline: "Repaying",
    body: "Repays just enough debt to bring the position back to 1.50 — not a wei more.",
  },
  {
    min: 100,
    action: "DELEVERAGE",
    headline: "Deleveraging",
    body: "Repaying alone is no longer enough; collateral has to come down too.",
  },
  {
    min: 0,
    action: "EMERGENCY",
    headline: "Liquidatable",
    body: "Below 1.00 the position can be liquidated by anyone. Past the point an agent can save.",
  },
];

function bandFor(cents: number): Band {
  return BANDS.find((b) => cents > b.min) ?? BANDS[BANDS.length - 1];
}

/** 0 = tenang, 1 = kritis. Dipetakan dari health factor, bukan dari selera. */
function puffFor(cents: number): number {
  const p = (200 - cents) / 100;
  return Math.min(1, Math.max(0, p));
}

/** Seberapa jauh harga agunan boleh turun sebelum likuidasi: 1 − 1/HF. */
function dropToLiquidation(cents: number): number {
  if (cents <= 100) return 0;
  return (1 - 100 / cents) * 100;
}

export function PuffMeter() {
  const [cents, setCents] = useState(REAL_CENTS);
  const sliderId = useId();
  const band = bandFor(cents);
  const puff = puffFor(cents);
  const tone = puffColor(puff);
  const hf = (cents / 100).toFixed(2);
  const drop = dropToLiquidation(cents).toFixed(1);
  const atReal = cents === REAL_CENTS;
  const repayProof = GUARDIAN_RESCUE.find((p) => p.id === "repay");

  return (
    <div className="w-full rounded-3xl border border-line bg-surface p-5 backdrop-blur-sm sm:p-7">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] sm:items-center">
        <div className="relative mx-auto w-full max-w-[260px]">
          <div
            className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl transition-colors duration-500"
            style={{ background: tone, opacity: 0.16 }}
          />
          <Fugu
            puff={puff}
            className="h-auto w-full transition-[filter] duration-300"
            title={`Fugu at health factor ${hf} — ${band.headline.toLowerCase()}`}
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-4xl tabular-nums sm:text-5xl" style={{ color: tone }}>
              {hf}
            </span>
            <span className="text-xs uppercase tracking-[0.18em] text-faint">health factor</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 font-mono text-[11px] tracking-wide"
              style={{ background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: tone }}
            >
              {band.action}
            </span>
            <span className="text-sm font-medium text-fg">{band.headline}</span>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted">{band.body}</p>

          <p className="mt-3 font-mono text-xs text-faint">
            collateral can fall {drop}% before liquidation
          </p>

          <div className="mt-5">
            <label htmlFor={sliderId} className="text-xs uppercase tracking-[0.16em] text-faint">
              Drag the risk
            </label>
            <input
              id={sliderId}
              type="range"
              min={MIN_CENTS}
              max={MAX_CENTS}
              step={1}
              value={cents}
              onChange={(e) => setCents(Number(e.target.value))}
              aria-valuetext={`Health factor ${hf}, ${band.action}`}
              className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--accent)]"
              style={{ accentColor: tone }}
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
              <span>1.00 liquidation</span>
              <span>3.00 safe</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <button
              type="button"
              onClick={() => setCents(REAL_CENTS)}
              disabled={atReal}
              className="rounded-full border border-line px-3 py-1.5 text-fg transition hover:border-line-strong hover:bg-surface-strong disabled:cursor-default disabled:opacity-45"
            >
              Go to the real reading: 1.14
            </button>
            {repayProof?.hash ? (
              <a
                href={txUrl(repayProof.hash)}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent underline decoration-accent/40 underline-offset-4 transition hover:decoration-accent"
              >
                See what the agent did about it ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
