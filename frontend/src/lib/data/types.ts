/**
 * Kontrak lapisan data marketplace.
 *
 * Backend belum ada. Supaya menukarnya nanti tidak berarti menulis ulang UI,
 * seluruh halaman hanya berbicara dengan `MarketplaceSource` — satu antarmuka,
 * dua implementasi (`seed` hari ini, `http` begitu `api.fugugent.xyz` menjawab).
 * Tidak ada satu pun komponen yang boleh memanggil `fetch` sendiri.
 *
 * Dua sifat yang ditiru langsung dari `backend/src/types.ts` dan tidak boleh hilang:
 *
 * 1. **Tidak pernah melempar ke pemanggil.** Kegagalan diwakili `healthy: false`
 *    + `reason`, bukan exception. Halaman yang gagal harus tetap punya bentuk.
 * 2. **Setiap halaman tahu dari mana ia berasal (`source`) dan kapan diambil
 *    (`fetchedAt`).** Itulah yang membuat spanduk "ini data contoh" bisa
 *    ditampilkan otomatis, bukan diingat-ingat manusia.
 */

import type { AgentRecord, AgentSource, Category, SourceHealth } from "@/lib/agent-types";
import type { Proof } from "@/lib/chain";
import type { RiskReading } from "@/lib/risk";

/**
 * Izin session key sebuah agent, dibaca dari Keystore on-chain.
 * Ditampilkan kepada **calon pembeli sebelum hire** (spec §7.3, pelajaran 34) —
 * bukan hanya kepada publisher-nya.
 */
export interface SessionPermission {
  /** Kontrak Keystore Altana tempat keabsahan kunci bisa dibaca siapa pun. */
  keystore: string;
  /** Wallet yang kuncinya berlaku di atasnya. */
  wallet: string;
  keyHash: string;
  /** Allowlist eksplisit. `calls: []` di Altana berarti izin TANPA BATAS. */
  calls: Array<{ contract: string; address: string | null; signature: string }>;
  dailyCap: string;
  expiry: string;
  grantTxHash: string | null;
  /** Perintah yang bisa disalin apa adanya. Tanpa API key. */
  verifyCommand: string;
}

/**
 * Apa yang dilihat satu halaman tentang satu agent.
 *
 * `record` adalah `AgentRecord` persis seperti yang dikunci backend. Sisanya
 * adalah potongan yang **belum** ada di bentuk itu — risiko, izin sesi, bukti —
 * dan sengaja disimpan terpisah supaya menambahkannya di backend nanti tidak
 * mengubah satu pun tipe yang sudah final.
 */
export interface AgentView {
  record: AgentRecord;
  /** `null` = tidak ada bacaan segar. Fugu digambar berlubang, bukan ditebak. */
  risk: RiskReading | null;
  session: SessionPermission | null;
  /** Bukti on-chain milik agent ini. Boleh kosong; tidak boleh diisi klaim. */
  proofs: Proof[];
  /**
   * Apa yang **belum** ada pada agent ini, dinyatakan terbuka di kartu dan
   * halaman detail. `null` berarti tidak ada yang perlu dikurangi dari klaimnya.
   */
  notShipped: string | null;
  /** Kalimat hasil berangka, past tense (pelajaran 2 benchmark HelloMinds). */
  outcomes: string[];
}

/** Amplopnya sama dengan `AgentListPage`; `items` diganti `agents`. */
export interface MarketplacePage {
  agents: AgentView[];
  total: number;
  limit: number;
  offset: number;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
}

export interface AgentDetailView {
  agent: AgentView | null;
  source: AgentSource;
  healthy: boolean;
  reason: string | null;
  fetchedAt: string;
}

export interface CategoryCount {
  category: Category;
  count: number;
}

export interface CategoryListResult {
  categories: CategoryCount[];
  healthy: boolean;
  reason: string | null;
}

export interface ListQuery {
  category?: Category | null;
  limit?: number;
  offset?: number;
}

export interface MarketplaceSource {
  /** `"seed"` = data contoh di dalam bundel. `"http"` = backend sungguhan. */
  readonly kind: "seed" | "http";
  /** Dari mana data ini akan datang, untuk ditampilkan apa adanya ke pengguna. */
  readonly origin: string;
  listAgents(query: ListQuery): Promise<MarketplacePage>;
  getAgent(id: string): Promise<AgentDetailView>;
  listCategories(): Promise<CategoryListResult>;
  health(): Promise<SourceHealth>;
}
