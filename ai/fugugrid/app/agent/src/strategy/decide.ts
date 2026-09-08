/**
 * The Grid decision engine.
 *
 * PURE: no network, no `Date.now()`, no `process.env`, no I/O. Its shape is a reducer —
 * `(config, state, observation) -> decision` with the next state returned alongside, so
 * the grid's entire memory lives outside this module and every decision can be replayed
 * exactly from its arguments.
 *
 * A grid that does not know when to stop is a way to lose money slowly, so this module
 * has TWO layers of stopping:
 *   1. soft breakout — the price is outside the buffer for N consecutive observations
 *   2. hard breakout — the price is very far outside; exit at once, no waiting
 * plus one layer of prevention that works before the grid ever runs:
 *   3. profitability validation — a grid whose line spacing is narrower than its
 *      round-trip cost is REJECTED, not run and then quietly loss-making.
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
 * A grid configuration that cannot turn a profit must FAIL, not run. This is the most
 * important check in the whole package: a grid whose line spacing is narrower than one
 * round trip's cost will look busy and successful — every buy fills, every sell fills —
 * while eating the capital on every round trip. A failure like that does not look like a
 * failure until the capital is gone.
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
  // An impossible state: counting a breach without knowing its direction. If this got
  // through, observations above and below could stack into a "confirmation" that never
  // actually happened in either single direction.
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
    // Exiting ALWAYS unwinds the entire inventory. A grid that is no longer valid but
    // still holds lots is not a grid any more: it is a directional position with no exit
    // rule, which is exactly the state this whole module exists to avoid.
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

  // --- layer 2: hard breakout, exit at once with no waiting for confirmation ---
  if (price >= hardUpperBase(config, thresholds)) return keluar("EXIT_ABOVE", "ABOVE", state.consecutiveOutside + 1);
  if (price <= hardLowerBase(config, thresholds)) return keluar("EXIT_BELOW", "BELOW", state.consecutiveOutside + 1);

  // --- layer 1: soft breakout, needs consecutive confirmation ---
  const diAtas = price >= softUpperBase(config, thresholds);
  const diBawah = price <= softLowerBase(config, thresholds);
  const sisi: "ABOVE" | "BELOW" | null = diAtas ? "ABOVE" : diBawah ? "BELOW" : null;

  // Flipping direction RESETS the count: one observation above followed by one below is
  // not two observations pointing to the same conclusion, it is a market churning around
  // the range — precisely the condition this grid is built to serve.
  const hitungan = sisi === null ? 0 : sisi === state.outsideSide ? state.consecutiveOutside + 1 : 1;

  if (sisi !== null && hitungan >= thresholds.breakoutConfirmObservations) {
    return keluar(sisi === "ABOVE" ? "EXIT_ABOVE" : "EXIT_BELOW", sisi, hitungan);
  }

  // --- ordinary trading ---
  // The band is computed from the clamped price, so a price that jumps outside the range
  // still completes the trade at the edge before the breakout is confirmed. Without this,
  // a single candle that jumps out would leave inventory that is never sold at a grid
  // price.
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
      // The band ALWAYS advances to where the price is now, even when the wanted lots
      // could not all be executed. If the band were held back, the same crossing would be
      // detected again on every following observation and the grid would retry the same
      // trade over and over, forever.
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
