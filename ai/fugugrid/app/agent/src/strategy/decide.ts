/**
 * Mesin keputusan Grid.
 *
 * MURNI: tanpa jaringan, tanpa `Date.now()`, tanpa `process.env`, tanpa I/O.
 * Bentuknya reducer — `(config, state, observation) -> decision` dengan state
 * berikutnya ikut dikembalikan, sehingga seluruh ingatan grid hidup di luar
 * modul ini dan setiap keputusan bisa diputar ulang persis dari argumennya.
 *
 * Grid yang tidak tahu kapan berhenti adalah cara kehilangan uang secara
 * perlahan, jadi modul ini punya DUA lapis penghentian:
 *   1. breakout lunak  — harga di luar buffer selama N pengamatan berturut-turut
 *   2. breakout keras  — harga sangat jauh di luar; keluar seketika tanpa menunggu
 * dan satu lapis pencegahan yang bekerja sebelum grid sempat berjalan:
 *   3. validasi profitabilitas — grid yang jarak garisnya lebih sempit daripada
 *      ongkos putaran DITOLAK, bukan dijalankan lalu merugi diam-diam.
 */
import {
  bandIndexOf,
  hardLowerBase,
  hardUpperBase,
  intervalsOf,
  lotValueBase,
  minProfitableStepBps,
  minStepBps,
  roundTripCostBps,
  softLowerBase,
  softUpperBase,
  stepBase,
} from "./grid.js";
import { formatPriceUsd8, formatUsd8 } from "./format.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  type BreakoutStatus,
  type CostModel,
  type GridAction,
  type GridConfig,
  type GridDecision,
  type GridObservation,
  type GridState,
  type GridThresholds,
} from "./types.js";

function validateThresholds(t: GridThresholds): void {
  if (t.breakoutBufferBps <= 0n || t.breakoutBufferBps >= t.hardBreakoutBps) {
    throw new GridError(
      `Ambang breakout tidak valid: buffer=${t.breakoutBufferBps} bps, keras=${t.hardBreakoutBps} bps. ` +
        `Urutan yang benar adalah 0 < buffer < keras.`,
    );
  }
  if (t.hardBreakoutBps >= BPS_ONE) {
    throw new GridError(
      `hardBreakoutBps=${t.hardBreakoutBps} mencapai 100%: batas bawah grid dikurangi angka ini menjadi nol atau negatif, ` +
        `dan harga nol bukan harga.`,
    );
  }
  if (!Number.isInteger(t.breakoutConfirmObservations) || t.breakoutConfirmObservations < 1) {
    throw new GridError(
      `breakoutConfirmObservations=${t.breakoutConfirmObservations} harus bilangan bulat >= 1.`,
    );
  }
  if (t.minProfitMultipleBps < BPS_ONE) {
    throw new GridError(
      `minProfitMultipleBps=${t.minProfitMultipleBps} di bawah 10000 (1,00x): itu meresmikan grid yang ` +
        `setiap putarannya merugi setelah ongkos.`,
    );
  }
  if (t.maxRangeRatioBps <= BPS_ONE) {
    throw new GridError(`maxRangeRatioBps=${t.maxRangeRatioBps} harus lebih besar dari 10000 (1,00x).`);
  }
}

/**
 * Konfigurasi grid yang tidak bisa untung harus GAGAL, bukan berjalan. Ini
 * pemeriksaan terpenting di seluruh paket: grid yang jarak garisnya lebih
 * sempit daripada ongkos satu putaran akan tampak sibuk dan berhasil — setiap
 * beli terisi, setiap jual terisi — sambil menggerus modal pada setiap putaran.
 * Kegagalan seperti itu tidak terlihat seperti kegagalan sampai modalnya habis.
 */
function validateConfig(config: GridConfig, cost: CostModel, t: GridThresholds): void {
  if (config.lowerBase <= 0n) {
    throw new GridError(`Batas bawah ${config.lowerBase} tidak positif; harga nol bukan harga.`);
  }
  if (config.upperBase <= config.lowerBase) {
    throw new GridError(
      `Batas atas ${config.upperBase} tidak melebihi batas bawah ${config.lowerBase}.`,
    );
  }
  if (config.upperBase * BPS_ONE > config.lowerBase * t.maxRangeRatioBps) {
    throw new GridError(
      `Rentang ${config.lowerBase}..${config.upperBase} melebihi batas ${t.maxRangeRatioBps} bps ` +
        `(${t.maxRangeRatioBps / BPS_ONE}x). Pada grid aritmetik, rasio rentang SAMA DENGAN rasio antara ` +
        `jarak persentase terlebar (di dasar) dan tersempit (di puncak).`,
    );
  }
  if (!Number.isInteger(config.levels) || config.levels < 3) {
    throw new GridError(
      `levels=${config.levels} harus bilangan bulat >= 3. Dua garis hanya membentuk satu interval, ` +
        `yaitu sepasang limit order — bukan grid.`,
    );
  }
  if (config.capitalBase <= 0n) {
    throw new GridError(`Modal grid ${config.capitalBase} tidak positif.`);
  }
  if (stepBase(config) <= 0n) {
    throw new GridError(
      `Jarak antar-garis membulat menjadi nol: rentang terlalu sempit untuk ${config.levels} garis.`,
    );
  }

  const lot = lotValueBase(config);
  if (lot <= 0n) {
    throw new GridError(
      `Nilai lot membulat menjadi nol: modal ${config.capitalBase} terlalu kecil untuk ${intervalsOf(config)} interval.`,
    );
  }

  const step = minStepBps(config);
  const minimum = minProfitableStepBps(lot, cost, t.minProfitMultipleBps);
  if (step < minimum) {
    throw new GridError(
      `Grid tidak bisa untung: jarak antar-garis tersempit ${step} bps, sedangkan satu putaran ` +
        `beli-lalu-jual memerlukan minimal ${minimum} bps (ongkos putaran ${roundTripCostBps(lot, cost)} bps ` +
        `dikali pengali ${t.minProfitMultipleBps} bps). Kurangi jumlah level, lebarkan rentang, atau tambah modal.`,
    );
  }
}

function validateCost(cost: CostModel): void {
  if (cost.swapFeeBps < 0n || cost.slippageBps < 0n || cost.gasCostBase < 0n) {
    throw new GridError(
      `Model biaya negatif tidak mungkin: swapFeeBps=${cost.swapFeeBps}, ` +
        `slippageBps=${cost.slippageBps}, gasCostBase=${cost.gasCostBase}.`,
    );
  }
}

function validateState(state: GridState, config: GridConfig): void {
  const intervals = intervalsOf(config);
  if (!Number.isInteger(state.bandIndex) || state.bandIndex < 0 || state.bandIndex > intervals - 1) {
    throw new GridError(`bandIndex=${state.bandIndex} di luar rentang 0..${intervals - 1}.`);
  }
  if (!Number.isInteger(state.lotsHeld) || state.lotsHeld < 0 || state.lotsHeld > intervals) {
    throw new GridError(`lotsHeld=${state.lotsHeld} di luar rentang 0..${intervals}.`);
  }
  if (!Number.isInteger(state.consecutiveOutside) || state.consecutiveOutside < 0) {
    throw new GridError(`consecutiveOutside=${state.consecutiveOutside} harus bilangan bulat >= 0.`);
  }
  // State mustahil: menghitung pelanggaran tanpa tahu arahnya. Kalau ini lolos,
  // pengamatan di atas dan di bawah bisa saling menumpuk menjadi "konfirmasi"
  // yang tidak pernah benar-benar terjadi ke satu arah.
  if ((state.consecutiveOutside > 0) !== (state.outsideSide !== null)) {
    throw new GridError(
      `State tidak konsisten: consecutiveOutside=${state.consecutiveOutside} dengan outsideSide=${state.outsideSide}.`,
    );
  }
}

function validateObservation(obs: GridObservation): void {
  if (obs.priceBase <= 0n) {
    throw new GridError(
      `Harga ${obs.priceBase} tidak positif. Itu pembacaan yang rusak, bukan aset yang menjadi gratis.`,
    );
  }
}

function buildReason(
  action: GridAction,
  priceBase: bigint,
  lots: number,
  notionalBase: bigint,
  lotsCapped: boolean,
  breakout: BreakoutStatus,
  confirmProgress: string,
): string {
  const harga = formatPriceUsd8(priceBase);
  const batas = lotsCapped ? " Jumlah lot dibatasi oleh modal atau persediaan yang tersedia." : "";
  switch (action) {
    case "IDLE":
      return `Harga ${harga} masih di pita yang sama; tidak ada garis grid yang dilintasi.${batas}`;
    case "BUY":
      return `Harga turun ke ${harga} dan melintasi ${lots} garis grid: membeli ${lots} lot senilai ${formatUsd8(notionalBase)}.${batas}`;
    case "SELL":
      return `Harga naik ke ${harga} dan melintasi ${lots} garis grid: menjual ${lots} lot senilai ${formatUsd8(notionalBase)}.${batas}`;
    case "WATCH_BREAKOUT":
      return `Harga ${harga} berada di luar rentang grid (${breakout === "WATCHING_ABOVE" ? "di atas" : "di bawah"}), ${confirmProgress}. Belum ada tindakan.`;
    case "EXIT_ABOVE":
      return `Harga ${harga} menembus ke atas rentang grid; grid tidak berlaku lagi. Membongkar ${lots} lot senilai ${formatUsd8(notionalBase)} dan berhenti.`;
    case "EXIT_BELOW":
      return `Harga ${harga} menembus ke bawah rentang grid; grid tidak berlaku lagi dan posisinya sepenuhnya berarah. Membongkar ${lots} lot senilai ${formatUsd8(notionalBase)} dan berhenti.`;
  }
}

export function decide(
  config: GridConfig,
  state: GridState,
  observation: GridObservation,
  cost: CostModel = DEFAULT_COST_MODEL,
  thresholds: GridThresholds = DEFAULT_GRID_THRESHOLDS,
): GridDecision {
  validateCost(cost);
  validateThresholds(thresholds);
  validateConfig(config, cost, thresholds);
  validateState(state, config);
  validateObservation(observation);

  const price = observation.priceBase;
  const lot = lotValueBase(config);
  const rt = roundTripCostBps(lot, cost);
  const step = minStepBps(config);
  const band = bandIndexOf(price, config);

  const keluar = (action: "EXIT_ABOVE" | "EXIT_BELOW", side: "ABOVE" | "BELOW", hitungan: number): GridDecision => {
    // Keluar SELALU membongkar seluruh persediaan. Grid yang sudah tidak berlaku
    // tetapi masih memegang lot bukan lagi grid: ia posisi berarah tanpa aturan
    // keluar, yaitu persis keadaan yang seluruh modul ini dibuat untuk dihindari.
    const lots = state.lotsHeld;
    return {
      action,
      bandIndex: band,
      lots,
      notionalBase: BigInt(lots) * lot,
      lotsCapped: false,
      breakout: side === "ABOVE" ? "WATCHING_ABOVE" : "WATCHING_BELOW",
      roundTripCostBps: rt,
      minStepBps: step,
      nextState: { bandIndex: band, lotsHeld: 0, consecutiveOutside: hitungan, outsideSide: side },
      reason: buildReason(action, price, lots, BigInt(lots) * lot, false, side === "ABOVE" ? "WATCHING_ABOVE" : "WATCHING_BELOW", ""),
    };
  };

  // --- lapis 2: breakout keras, keluar seketika tanpa menunggu konfirmasi ---
  if (price >= hardUpperBase(config, thresholds)) return keluar("EXIT_ABOVE", "ABOVE", state.consecutiveOutside + 1);
  if (price <= hardLowerBase(config, thresholds)) return keluar("EXIT_BELOW", "BELOW", state.consecutiveOutside + 1);

  // --- lapis 1: breakout lunak, butuh konfirmasi berturut-turut ---
  const diAtas = price >= softUpperBase(config, thresholds);
  const diBawah = price <= softLowerBase(config, thresholds);
  const sisi: "ABOVE" | "BELOW" | null = diAtas ? "ABOVE" : diBawah ? "BELOW" : null;

  // Berbalik arah MERESET hitungan: satu pengamatan di atas lalu satu di bawah
  // bukan dua pengamatan yang menuju kesimpulan yang sama, itu pasar yang
  // bergejolak di sekitar rentang — justru keadaan yang grid ini layani.
  const hitungan = sisi === null ? 0 : sisi === state.outsideSide ? state.consecutiveOutside + 1 : 1;

  if (sisi !== null && hitungan >= thresholds.breakoutConfirmObservations) {
    return keluar(sisi === "ABOVE" ? "EXIT_ABOVE" : "EXIT_BELOW", sisi, hitungan);
  }

  // --- perdagangan biasa ---
  // Pita dihitung dari harga yang sudah dijepit, sehingga harga yang melompat
  // keluar rentang tetap menuntaskan transaksi di tepi sebelum breakout
  // dikonfirmasi. Tanpa ini, satu lilin yang melompat keluar akan meninggalkan
  // persediaan yang tidak pernah dijual di harga grid.
  const delta = band - state.bandIndex;
  const intervals = intervalsOf(config);

  let action: GridAction;
  let lots = 0;
  let capped = false;

  if (delta < 0) {
    const diinginkan = -delta;
    const kapasitas = intervals - state.lotsHeld;
    lots = Math.min(diinginkan, kapasitas);
    capped = lots < diinginkan;
    action = lots > 0 ? "BUY" : sisi !== null ? "WATCH_BREAKOUT" : "IDLE";
  } else if (delta > 0) {
    const diinginkan = delta;
    lots = Math.min(diinginkan, state.lotsHeld);
    capped = lots < diinginkan;
    action = lots > 0 ? "SELL" : sisi !== null ? "WATCH_BREAKOUT" : "IDLE";
  } else {
    action = sisi !== null ? "WATCH_BREAKOUT" : "IDLE";
  }

  const lotsHeldBerikutnya =
    action === "BUY" ? state.lotsHeld + lots : action === "SELL" ? state.lotsHeld - lots : state.lotsHeld;

  const breakout: BreakoutStatus =
    sisi === "ABOVE" ? "WATCHING_ABOVE" : sisi === "BELOW" ? "WATCHING_BELOW" : "NONE";

  return {
    action,
    bandIndex: band,
    lots,
    notionalBase: BigInt(lots) * lot,
    lotsCapped: capped,
    breakout,
    roundTripCostBps: rt,
    minStepBps: step,
    nextState: {
      // Pita SELALU maju ke posisi harga sekarang, walaupun lot yang diinginkan
      // tidak seluruhnya bisa dieksekusi. Kalau pita ditahan, persilangan yang
      // sama akan terdeteksi lagi pada setiap pengamatan berikutnya dan grid
      // akan mencoba transaksi yang sama berulang-ulang selamanya.
      bandIndex: band,
      lotsHeld: lotsHeldBerikutnya,
      consecutiveOutside: hitungan,
      outsideSide: sisi,
    },
    reason: buildReason(
      action,
      price,
      lots,
      BigInt(lots) * lot,
      capped,
      breakout,
      `pengamatan ke-${hitungan} dari ${thresholds.breakoutConfirmObservations} yang dibutuhkan untuk memastikan breakout`,
    ),
  };
}
