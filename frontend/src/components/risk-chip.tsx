/**
 * Chip angka risiko — kanal keenam dari `docs/brand/tingkat-kembung.md` §0, dan
 * satu-satunya yang tidak ambigu. Karena itu ia wajib ada di kartu maupun detail,
 * dan tidak boleh dihilangkan pada ukuran apa pun yang menampilkan tingkat 4–5.
 *
 * Tingkat 5 selalu blok isi + teks putih + huruf kapital, di mode terang maupun
 * gelap: `#A4210E` sebagai teks di atas latar gelap hanya 2,53:1 — keadaan paling
 * gawat justru menjadi paling sulit dibaca. Blok isi memberi 7,49:1.
 */

import { BLOAT, type RiskReading } from "@/lib/risk";
import { txUrl } from "@/lib/chain";

export function RiskChip({ reading, size = "md" }: { reading: RiskReading | null; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  if (!reading) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-line-strong font-medium text-faint ${pad}`}
      >
        no live reading
      </span>
    );
  }

  const spec = BLOAT[reading.level];

  const inner =
    reading.level === 5 ? (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--risk-5)] font-semibold uppercase tracking-wide text-white ${pad}`}
      >
        <span className="tabular-nums">
          {reading.metricLabel} {reading.metricValue}
        </span>
        <span aria-hidden>·</span>
        <span>{spec.name}</span>
      </span>
    ) : (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${pad}`}
        style={{ borderColor: spec.color, color: spec.color }}
      >
        <span className="tabular-nums">
          {reading.metricLabel} {reading.metricValue}
        </span>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <span>{spec.name}</span>
      </span>
    );

  if (!reading.proofTxHash) return inner;

  return (
    <a
      href={txUrl(reading.proofTxHash)}
      target="_blank"
      rel="noreferrer noopener"
      className="relative z-10 inline-flex rounded-full transition hover:opacity-80"
      title="Open the transaction this reading came from"
    >
      {inner}
    </a>
  );
}
