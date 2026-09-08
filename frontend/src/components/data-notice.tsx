import { ButtonLink } from "@/components/ui";
import type { AgentSource } from "@/lib/agent-types";

/**
 * Spanduk asal data. Ia berdiri di atas halaman marketplace setiap kali data
 * yang tampil bukan data hidup — dan ia tidak bisa lupa, karena isinya diturunkan
 * dari amplop `source`/`healthy` yang dikirim lapisan data, bukan dari ingatan
 * seseorang untuk menyalakannya.
 *
 * Ini bagian dari janji produk: sebuah marketplace agent yang menampilkan angka
 * tak terperiksa persis seperti yang menjatuhkan Giza/ARMA tidak layak dipercaya,
 * dan "kami belum punya datanya" adalah kalimat yang harus berani kami tulis.
 */
export function DataNotice({
  source,
  healthy,
  reason,
  origin,
}: {
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  origin: string;
}) {
  if (!healthy) {
    return (
      <div className="rounded-xl border border-[var(--risk-4)]/50 bg-[color-mix(in_srgb,var(--risk-4)_10%,transparent)] px-4 py-3">
        <p className="text-sm font-medium text-fg">The catalogue did not answer.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {origin} replied: <span className="font-mono text-xs">{reason ?? "no reason given"}</span>
          . Nothing below is stale data pretending to be live — the list is empty because we have
          nothing we can stand behind.
        </p>
      </div>
    );
  }

  if (source !== "seed") return null;

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-sm font-medium text-fg">
        Sample data — the marketplace API is not connected yet.
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        The four agents below are the four that exist in this repository, with each one&apos;s real
        status written on its card. Every transaction hash is real and opens on BscScan. What is
        missing is the indexer that will pull the rest of the ERC-8004 catalogue in.
      </p>
      <div className="mt-3">
        <ButtonLink href="https://fugugent.xyz" variant="ghost" external>
          What is actually shipped ↗
        </ButtonLink>
      </div>
    </div>
  );
}
