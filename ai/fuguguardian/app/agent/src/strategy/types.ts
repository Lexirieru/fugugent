/** Health factor dinyatakan dalam basis 1e18, mengikuti Aave v3. HF 1.0 = 1e18. */
export const HF_ONE = 10n ** 18n;

export type Protocol = "venus" | "aave";

/**
 * Aksi yang boleh diambil Guardian, dari paling ringan ke paling agresif.
 * Keputusan ini SELALU dihasilkan kode deterministik, tidak pernah oleh LLM.
 */
export type Action = "NONE" | "WARN" | "PARTIAL_REPAY" | "DELEVERAGE" | "EMERGENCY";

/**
 * Snapshot posisi pinjaman pada satu blok. Semua nilai uang dalam "base unit"
 * protokol yang bersangkutan (Aave memakai basis 8 desimal USD).
 */
export interface Position {
  protocol: Protocol;
  account: `0x${string}`;
  collateralBase: bigint;
  debtBase: bigint;
  /** Ambang likuidasi dalam basis point, mis. 8000n = 80%. */
  liquidationThresholdBps: bigint;
  /** null berarti tidak ada hutang sama sekali — bukan berbahaya, justru paling aman. */
  healthFactor: bigint | null;
  blockNumber: bigint;
}

export interface Thresholds {
  warn: bigint;
  partialRepay: bigint;
  deleverage: bigint;
}

export interface Decision {
  action: Action;
  healthFactor: bigint | null;
  /** Berapa basis point harga agunan boleh turun sebelum HF mencapai 1.0. */
  dropToLiquidationBps: bigint | null;
  reason: string;
  /** Jumlah yang disarankan dibayar agar HF kembali aman; 0n bila tidak perlu. */
  suggestedRepayBase: bigint;
}

/**
 * Ambang default dari docs/research/06 §4.2. Ini keputusan produk, bukan angka
 * baku protokol — riset kita sendiri menandainya sebagai contoh yang harus
 * dikalibrasi ulang lewat backtest untuk aset yang lebih volatil.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  warn: 1_500_000_000_000_000_000n,
  partialRepay: 1_200_000_000_000_000_000n,
  deleverage: 1_100_000_000_000_000_000n,
};

export class PositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionError";
  }
}
