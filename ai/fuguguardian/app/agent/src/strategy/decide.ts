import { dropToLiquidationBps, repayToReachTarget } from "./healthFactor.js";
import { formatHf, formatPercentFromBps } from "./format.js";
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
 * Menyusun kalimat penjelasan dari angka-angka keputusan. Kode ini, bukan
 * LLM, yang menentukan isi kalimat — modul penjelasan LLM (task terpisah)
 * hanya boleh memperindah kalimat ini, tidak pernah mengubah angkanya.
 */
function buildReason(action: Action, hf: bigint | null, dropBps: bigint | null): string {
  if (hf === null) {
    return "Tidak ada hutang sehingga tidak ada risiko likuidasi.";
  }

  // `dropBps` di sini TIDAK PERNAH null: `dropToLiquidationBps` hanya
  // mengembalikan null untuk hf === null, dan kasus itu sudah keluar di atas.
  // Dulu tempat ini punya cabang fallback "0,0" yang tidak pernah tercapai —
  // cabang mati seperti itu menyamarkan pelanggaran invarian jadi kalimat yang
  // terlihat normal ("boleh turun 0,0%"). Sekarang ia gagal keras dan terlihat.
  if (dropBps === null) {
    throw new PositionError(
      `Invariant dilanggar: dropToLiquidationBps null padahal health factor ${hf} bukan null.`,
    );
  }

  const hfStr = formatHf(hf);
  const jarak = `Agunan boleh turun ${formatPercentFromBps(dropBps)}% sebelum likuidasi.`;

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
 * Memastikan `Position` masuk akal sebelum dipakai menghitung apa pun.
 *
 * `decide` sebelumnya memvalidasi ambang tetapi mempercayai `Position` bulat-
 * bulat. Akibatnya `liquidationThresholdBps: 0n` — nilai yang muncul dari
 * pembacaan on-chain yang gagal sebagian, mock test yang lupa diisi, atau
 * pasar yang di-freeze — menghasilkan HF 0 sehingga posisi yang sebenarnya
 * sehat dinilai EMERGENCY dan disarankan melunasi SELURUH hutang. Untuk agent
 * yang membelanjakan uang user, input tak masuk akal harus gagal keras di
 * pintu masuk, bukan berubah jadi saran pembayaran maksimal.
 *
 * Ambang likuidasi valid adalah 0 < bps ≤ 10000 (10000 bps = 100%, batas atas
 * fisik: agunan tidak bisa menjamin lebih dari nilainya sendiri).
 */
function validatePosition(pos: Position): void {
  if (pos.liquidationThresholdBps <= 0n || pos.liquidationThresholdBps > 10_000n) {
    throw new PositionError(
      `Ambang likuidasi tidak masuk akal: ${pos.liquidationThresholdBps} bps. ` +
        `Nilai valid adalah 0 < bps <= 10000.`,
    );
  }
  if (pos.collateralBase < 0n || pos.debtBase < 0n) {
    throw new PositionError(
      `Nilai posisi negatif tidak mungkin: collateralBase=${pos.collateralBase}, ` +
        `debtBase=${pos.debtBase}.`,
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
  validatePosition(pos);

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
