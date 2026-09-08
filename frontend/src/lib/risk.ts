/**
 * Tingkat kembung — mekanik inti produk.
 * Sumber: `docs/brand/tingkat-kembung.md`.
 *
 * Aturan yang paling penting di berkas ini, dan alasan tidak ada satu pun ambang
 * numerik di sini: **frontend tidak menghitung ambang.** Backend mengirim
 * `level: 1|2|3|4|5` yang sudah dihitung dari metrik mentah oleh mesin keputusan
 * yang sama dengan yang menjalankan agent. Kalau UI menampilkan "Tense" sementara
 * agent sedang menjalankan DELEVERAGE, kita mengulang persis kesalahan yang
 * membunuh Giza/ARMA: dashboard bercerita lain daripada rantai.
 *
 * `level: null` bukan "tingkat 0". Ia berarti **tidak ada bacaan segar**, dan
 * ditampilkan sebagai siluet berlubang — menebak tingkat dari data lama adalah
 * kebohongan yang paling mahal di produk ini.
 */

export type BloatLevel = 1 | 2 | 3 | 4 | 5;

export const BLOAT_LEVELS: readonly BloatLevel[] = [1, 2, 3, 4, 5];

export interface BloatLevelSpec {
  level: BloatLevel;
  name: string;
  /** Apa yang sedang dilakukan agent pada tingkat ini. */
  meaning: string;
  /** Pola cincin — kanal yang bertahan di grayscale. Warna adalah kanal kedua. */
  ring: string;
  color: string;
  /** Kelas gerak; tingkat 3 dan 5 sengaja tidak punya animasi berulang. */
  motionClass: string | null;
  /** Apakah tingkat ini punya konsekuensi finansial. */
  spendsMoney: boolean;
}

export const BLOAT: Record<BloatLevel, BloatLevelSpec> = {
  1: {
    level: 1,
    name: "Calm",
    meaning: "Nothing to do. The agent watches and spends nothing.",
    ring: "thin solid arc",
    color: "var(--risk-1)",
    motionClass: "fugu-motion-1",
    spendsMoney: false,
  },
  2: {
    level: 2,
    name: "Watching",
    meaning: "First threshold touched. The agent explains itself, it does not spend.",
    ring: "solid ring with a notch",
    color: "var(--risk-2)",
    motionClass: "fugu-motion-2",
    spendsMoney: false,
  },
  3: {
    level: 3,
    name: "Tense",
    meaning: "The agent is about to act, and acting costs money.",
    ring: "dashed ring",
    color: "var(--risk-3)",
    motionClass: null,
    spendsMoney: true,
  },
  4: {
    level: 4,
    name: "Critical",
    meaning: "Aggressive action underway. The position can still be saved.",
    ring: "double ring",
    color: "var(--risk-4)",
    motionClass: "fugu-motion-4",
    spendsMoney: true,
  },
  5: {
    level: 5,
    name: "Emergency",
    meaning: "The last threshold is behind us. Readable with no colour at all.",
    ring: "45° hazard stripes",
    color: "var(--risk-5)",
    // Sengaja diam. Perubahan dari bergerak ke berhenti adalah sinyalnya sendiri.
    motionClass: null,
    spendsMoney: true,
  },
};

/**
 * Satu pembacaan risiko. Ini **bukan** bagian dari `AgentRecord` — bentuk itu
 * dikunci di `backend/src/types.ts` dan belum memuat risiko. Ia disajikan lapisan
 * data sebagai potongan terpisah, supaya saat backend menambahkan endpoint risiko
 * yang mengisinya, tidak ada satu pun komponen yang perlu berubah.
 */
export interface RiskReading {
  level: BloatLevel;
  /** Mis. "Health factor" — metrik risiko utama kategori ini. */
  metricLabel: string;
  /** Sudah diformat oleh lapisan data. UI tidak membulatkan ulang. */
  metricValue: string;
  /** Kalimat pendamping yang bisa ditindaklanjuti, atau `null`. */
  companion: string | null;
  /** ISO 8601 — kapan angka ini dibaca dari rantai. */
  observedAt: string;
  /** Blok tempat angkanya dibaca. `null` bila sumbernya bukan pembacaan blok. */
  blockNumber: number | null;
  /** Bukti yang bisa dibuka siapa pun. `null` berarti belum ada blok untuk dibuka. */
  proofTxHash: string | null;
}

/**
 * Kalimat `aria-label` penuh — bukan angka telanjang.
 * `tingkat-kembung.md` §5.6 mewajibkan bentuk ini.
 */
export function riskAriaLabel(agentName: string, reading: RiskReading | null): string {
  if (!reading) {
    return `${agentName}. No fresh risk reading — the fish is drawn hollow rather than guessed.`;
  }
  const spec = BLOAT[reading.level];
  const tail = reading.companion ? ` ${reading.companion}.` : "";
  return `${agentName}, level ${reading.level} of 5, ${spec.name.toLowerCase()}. ${reading.metricLabel} ${reading.metricValue}.${tail}`;
}
