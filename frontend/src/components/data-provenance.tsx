import { ButtonLink } from "@/components/ui";
import {
  SOURCE_LABEL,
  SOURCE_MEANING,
  formatAge,
  outcomeLabel,
  weightOf,
  type Provenance,
} from "@/lib/provenance";

/**
 * Dari mana angka di halaman ini datang, dan seberapa tua.
 *
 * Backend menempuh tangga jatuh 8004scan -> cache -> on-chain -> seed, dan setiap
 * jawabannya membawa tangga yang benar-benar ditempuh. Menampilkannya bukan
 * hiasan: saat 8004scan tumbang dan kita melayani dari cache, halaman yang tampak
 * normal membiarkan pengguna salah paham — dan dashboard yang tidak bisa diperiksa
 * itulah yang menutup Giza/ARMA.
 *
 * Bobotnya menyesuaikan keadaan, karena peringatan yang selalu berteriak berhenti
 * didengar: sehat dan segar = satu baris redup; tidak bisa dipastikan segar atau
 * turun tingkat = strip yang terlihat; gagal = blok merah. Tangga penuhnya selalu
 * ada di balik satu klik, di ketiga bobot.
 */
export function DataProvenance({
  provenance,
  origin,
  className = "",
}: {
  provenance: Provenance;
  /** Alamat backend, atau keterangan sumber lokal. */
  origin: string;
  className?: string;
}) {
  const weight = weightOf(provenance);
  const age = formatAge(provenance.ageSeconds);
  const label = SOURCE_LABEL[provenance.source];

  if (weight === "failure") {
    return (
      <div
        className={`rounded-xl border border-[var(--risk-4)]/50 bg-[color-mix(in_srgb,var(--risk-4)_10%,transparent)] px-4 py-3 ${className}`}
      >
        <p className="text-sm font-medium text-fg">The catalogue did not answer.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {origin} replied:{" "}
          <span className="font-mono text-xs">{provenance.reason ?? "no reason given"}</span>. Nothing
          below is stale data pretending to be live — the list is empty because we have nothing we
          can stand behind.
        </p>
        <Trail provenance={provenance} />
      </div>
    );
  }

  if (provenance.source === "seed") {
    return (
      <div className={`rounded-xl border border-line bg-surface px-4 py-3 ${className}`}>
        <p className="text-sm font-medium text-fg">
          Bundled sample — no marketplace API is connected.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {SOURCE_MEANING.seed} These are the agents that exist in this repository, with each one&apos;s
          real status written on its card. Every transaction hash is real and opens on BscScan.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ButtonLink href="https://fugugent.xyz" variant="ghost" external>
            What is actually shipped ↗
          </ButtonLink>
        </div>
        <Trail provenance={provenance} />
      </div>
    );
  }

  if (weight === "attention") {
    return (
      <div
        className={`rounded-xl border border-line border-l-2 border-l-[var(--risk-3)] bg-surface px-4 py-3 ${className}`}
      >
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="font-medium text-fg">Served from {label}</span>
          {age ? <span className="tnum text-muted">· {age}</span> : null}
          {provenance.stale ? (
            <span className="text-[var(--risk-3)]">· not confirmed fresh</span>
          ) : null}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {SOURCE_MEANING[provenance.source]}
          {provenance.reason ? ` ${provenance.reason}` : ""}
        </p>
        <Trail provenance={provenance} />
      </div>
    );
  }

  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-faint ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--risk-1)]"
        />
        Live from {label}
      </span>
      {age ? <span className="tnum">· {age}</span> : null}
      <Trail provenance={provenance} inline />
    </p>
  );
}

/**
 * Tangga yang ditempuh, di balik satu klik. Ia ada di ketiga bobot — klaim
 * ketahanan yang tidak bisa diperiksa tidak lebih baik daripada klaim AUM yang
 * tidak bisa diperiksa.
 */
function Trail({ provenance, inline = false }: { provenance: Provenance; inline?: boolean }) {
  if (provenance.trail.length === 0) return null;

  return (
    <details className={inline ? "inline" : "mt-2"}>
      <summary className="cursor-pointer list-none text-xs text-faint underline decoration-dotted underline-offset-4 transition hover:text-fg">
        {inline ? "· how it got here" : "How it got here"}
      </summary>
      <ol className="mt-2 space-y-1.5">
        {provenance.trail.map((step, i) => (
          <li key={`${step.source}-${i}`} className="flex gap-2 text-xs leading-relaxed">
            <span className="tnum shrink-0 text-faint">{i + 1}</span>
            <span className="min-w-0">
              <span className="font-mono text-fg">{SOURCE_LABEL[step.source]}</span>
              <span className="text-faint"> — {outcomeLabel(step.outcome)}</span>
              {typeof step.items === "number" ? (
                <span className="tnum text-faint">
                  , {step.items} {step.items === 1 ? "item" : "items"}
                </span>
              ) : null}
              {step.reason ? <span className="block text-faint">{step.reason}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
