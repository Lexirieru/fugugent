import { dropToLiquidationBps, repayToReachTarget } from "./healthFactor.js";
import {
  DEFAULT_THRESHOLDS,
  HF_ONE,
  PositionError,
  type Action,
  type Decision,
  type Position,
  type Thresholds,
} from "./types.js";

/**
 * Format health factor (basis 1e18) menjadi string dua desimal dengan koma,
 * mis. 1_300_000_000_000_000_000n -> "1,30". Murni aritmetika bigint, tanpa
 * floating point supaya tidak ada kehilangan presisi.
 */
function formatHf(hf: bigint): string {
  const bulat = hf / HF_ONE;
  const sisa = hf % HF_ONE;
  const desimal = (sisa * 100n) / HF_ONE;
  return `${bulat},${desimal.toString().padStart(2, "0")}`;
}

/**
 * Format basis point (basis 10_000 = 100%) menjadi persen satu desimal
 * dengan koma, mis. 2000n -> "20,0".
 */
function formatPercentFromBps(bps: bigint): string {
  const persepuluhPersen = bps / 10n; // bps/10 = persentase dikali 10
  const bulat = persepuluhPersen / 10n;
  const desimal = persepuluhPersen % 10n;
  return `${bulat},${desimal}`;
}

/**
 * Menyusun kalimat penjelasan dari angka-angka keputusan. Kode ini, bukan
 * LLM, yang menentukan isi kalimat — modul penjelasan LLM (task terpisah)
 * hanya boleh memperindah kalimat ini, tidak pernah mengubah angkanya.
 */
function buildReason(action: Action, hf: bigint | null, dropBps: bigint | null): string {
  if (hf === null) {
    return "Tidak ada hutang sehingga tidak ada risiko likuidasi.";
  }

  const hfStr = formatHf(hf);
  const dropStr = dropBps === null ? "0,0" : formatPercentFromBps(dropBps);
  const jarak = `Agunan boleh turun ${dropStr}% sebelum likuidasi.`;

  switch (action) {
    case "EMERGENCY":
      return `Health factor ${hfStr} sudah di titik likuidasi. ${jarak} Tindakan darurat diperlukan sekarang.`;
    case "DELEVERAGE":
      return `Health factor ${hfStr} berada di zona berisiko tinggi. ${jarak} Perlu mengurangi leverage segera.`;
    case "PARTIAL_REPAY":
      return `Health factor ${hfStr}. ${jarak} Disarankan membayar sebagian hutang agar kembali ke zona aman.`;
    case "WARN":
      return `Health factor ${hfStr} mendekati ambang peringatan. ${jarak}`;
    case "NONE":
    default:
      return `Health factor ${hfStr}, posisi masih aman. ${jarak}`;
  }
}

/**
 * Memastikan ambang terurut secara aman: warn > partialRepay > deleverage > HF_ONE.
 * Ambang yang tidak terurut atau menyentuh/di bawah titik likuidasi (HF_ONE)
 * membuat rantai pemeriksaan di `decide` menghasilkan keputusan yang tidak
 * terdefinisi secara diam-diam — untuk agent yang membelanjakan uang user,
 * ini harus gagal keras dan segera, bukan lolos tanpa terdeteksi.
 */
function validateThresholds(t: Thresholds): void {
  if (t.warn <= t.partialRepay || t.partialRepay <= t.deleverage || t.deleverage <= HF_ONE) {
    throw new PositionError(
      `Ambang tidak valid: warn=${t.warn}, partialRepay=${t.partialRepay}, deleverage=${t.deleverage}. ` +
        `Urutan yang benar adalah warn > partialRepay > deleverage > HF_ONE (${HF_ONE}).`,
    );
  }
}

/**
 * Mesin keputusan Guardian. Murni: tanpa network, Date.now(), process.env,
 * atau I/O apa pun. Memeriksa dari kondisi paling gawat ke paling ringan
 * supaya kasus batas (persis di suatu ambang) selalu jatuh ke tindakan yang
 * lebih aman, bukan yang lebih longgar.
 */
export function decide(pos: Position, thresholds: Thresholds = DEFAULT_THRESHOLDS): Decision {
  validateThresholds(thresholds);

  const hf = pos.healthFactor;
  const drop = dropToLiquidationBps(hf);

  let action: Action;
  let suggestedRepayBase = 0n;

  if (hf === null) {
    action = "NONE";
  } else if (hf <= HF_ONE) {
    action = "EMERGENCY";
    suggestedRepayBase = repayToReachTarget(pos, thresholds.warn);
  } else if (hf <= thresholds.deleverage) {
    action = "DELEVERAGE";
    suggestedRepayBase = repayToReachTarget(pos, thresholds.warn);
  } else if (hf <= thresholds.partialRepay) {
    action = "PARTIAL_REPAY";
    suggestedRepayBase = repayToReachTarget(pos, thresholds.warn);
  } else if (hf <= thresholds.warn) {
    action = "WARN";
  } else {
    action = "NONE";
  }

  return {
    action,
    healthFactor: hf,
    dropToLiquidationBps: drop,
    reason: buildReason(action, hf, drop),
    suggestedRepayBase,
  };
}
