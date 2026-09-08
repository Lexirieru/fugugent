import { HF_ONE, type Position } from "./types.js";

const BPS = 10_000n;

/**
 * Health factor gaya Aave v3, basis 1e18.
 * Mengembalikan null bila tidak ada hutang — itu bukan angka besar, melainkan
 * ketiadaan risiko. Aave sendiri mengembalikan 2^256-1 untuk kasus ini; kita
 * menormalkannya jadi null supaya pemanggil tidak pernah salah membandingkannya.
 */
export function computeHealthFactor(
  collateralBase: bigint,
  debtBase: bigint,
  liquidationThresholdBps: bigint,
): bigint | null {
  if (debtBase === 0n) return null;
  return (collateralBase * liquidationThresholdBps * HF_ONE) / (BPS * debtBase);
}

/** Berapa basis point harga agunan boleh turun sebelum HF menyentuh 1.0. */
export function dropToLiquidationBps(hf: bigint | null): bigint | null {
  if (hf === null) return null;
  if (hf <= HF_ONE) return 0n;
  return BPS - (BPS * HF_ONE) / hf;
}

/** HF seandainya harga agunan turun sebesar `dropBps`. */
export function healthFactorAfterPriceDrop(pos: Position, dropBps: bigint): bigint | null {
  if (pos.debtBase === 0n) return null;
  const sisa = dropBps >= BPS ? 0n : BPS - dropBps;
  return computeHealthFactor(
    (pos.collateralBase * sisa) / BPS,
    pos.debtBase,
    pos.liquidationThresholdBps,
  );
}

/** Jumlah yang harus dibayar agar HF mencapai `targetHf`; 0n bila sudah aman. */
export function repayToReachTarget(pos: Position, targetHf: bigint): bigint {
  if (pos.debtBase === 0n || targetHf === 0n) return 0n;
  const hutangTarget =
    (pos.collateralBase * pos.liquidationThresholdBps * HF_ONE) / (BPS * targetHf);
  if (hutangTarget >= pos.debtBase) return 0n;
  return pos.debtBase - hutangTarget;
}
