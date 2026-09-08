/**
 * ============================================================================
 * HONEST LIMITATIONS — READ BEFORE USING ANY NUMBER FROM THIS MODULE
 * ============================================================================
 * This harness runs `decide` candle by candle over the given price series, then compares
 * its final value against ONE benchmark: the exact same starting allocation, left
 * untouched until the last candle (`holdValueBase`). That benchmark was chosen because
 * it is the only honest one: the grid and its benchmark start from an identical
 * portfolio.
 *
 * What is deliberately NOT modeled:
 *   - non-linear price impact; slippage is modeled as a fixed percentage, so a large lot
 *     in a shallow pool costs far more than this
 *   - failed transactions, reverts, dead RPC, expired Altana sessions
 *   - varying gas; `gasCostBase` is constant for the whole simulation
 *   - price movement BETWEEN two candles. This is the harshest one for a grid: a real
 *     grid is filled by limit orders that candle wicks touch, whereas this model sees
 *     only one price per candle and therefore MISSES round trips that would fill in the
 *     real world. This bias points AGAINST the grid, so the profit reported here is a
 *     lower bound on that side — and it is also why the result must not be read as a
 *     forecast.
 *   - order queueing, cancellations, and front-running
 *
 * Gas is modeled as paid out of a separate NATIVE balance (tBNB), not out of the grid's
 * quote leg, because that is how it works on BSC. The total is subtracted once at the
 * end. If the native balance runs out the agent stops trading entirely — that state is
 * NOT modeled here and must be tested at the execution layer.
 *
 * The price series is an input, not something generated inside this module: every
 * function here is pure and deterministic.
 * ============================================================================
 */
import { decide } from "./decide.js";
import { bandIndexOf, ceilDiv, intervalsOf, lotValueBase } from "./grid.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_GRID_THRESHOLDS,
  GridError,
  WAD,
  type CostModel,
  type GridConfig,
  type GridState,
  type GridThresholds,
} from "./types.js";

export interface GridBacktestInput {
  config: GridConfig;
  /** The base asset's price per candle, USD on the 8-decimal basis. */
  priceSeriesBase: bigint[];
  cost?: CostModel;
  thresholds?: GridThresholds;
}

export interface GridBacktestResult {
  candles: number;
  buys: number;
  sells: number;
  /** Proportional fees + gas, USD on the 8-decimal basis. */
  totalCostBase: bigint;
  /** The grid's final value: quote + inventory marked at the last price, minus gas. */
  finalValueBase: bigint;
  /** The same starting allocation, left untouched until the last candle. */
  holdValueBase: bigint;
  gridBeatsHold: boolean;
  /** The candle index at which the grid exited; null if it never exited. */
  exitedAtCandle: number | null;
  exitSide: "ABOVE" | "BELOW" | null;
}

/**
 * A PURE function: no network, clock, or environment.
 *
 * Inventory is kept as a STACK of per-lot token amounts (18 decimals), and a sale takes
 * from the top of the stack (LIFO). This is not an arbitrary choice: on a grid, the most
 * recently bought lot is the one bought one line below the current sell price — pairing
 * those two is the definition of one grid round trip. FIFO would pair the sale with the
 * oldest lot and report a profit that is not this round trip's profit.
 */
export function runBacktest(input: GridBacktestInput): GridBacktestResult {
  const { config, priceSeriesBase: series } = input;
  const cost = input.cost ?? DEFAULT_COST_MODEL;
  const thresholds = input.thresholds ?? DEFAULT_GRID_THRESHOLDS;

  if (series.length === 0) {
    throw new GridError("Deret harga kosong: tidak ada yang bisa disimulasikan.");
  }
  for (const [i, p] of series.entries()) {
    if (p <= 0n) {
      throw new GridError(
        `Harga pada candle ${i} bernilai ${p}. Itu pembacaan rusak, bukan aset yang menjadi gratis.`,
      );
    }
  }

  const lot = lotValueBase(config);
  const intervals = intervalsOf(config);
  const hargaAwal = series[0]!;
  const hargaAkhir = series[series.length - 1]!;

  /**
   * The grid starts balanced around the opening price: one lot of inventory for every
   * line ABOVE the price (so there is something to sell when the price rises), and the
   * rest of the capital held as quote (so there is something to buy with when the price
   * falls). A grid that starts 100% on one leg can only trade in one direction until the
   * price happens to turn around.
   */
  const bandAwal = bandIndexOf(hargaAwal, config);
  const lotsAwal = intervals - bandAwal;

  let state: GridState = {
    bandIndex: bandAwal,
    lotsHeld: lotsAwal,
    consecutiveOutside: 0,
    outsideSide: null,
  };

  const tokenPerLotAwal = (lot * WAD) / hargaAwal;
  const tumpukan: bigint[] = Array.from({ length: lotsAwal }, () => tokenPerLotAwal);
  let quoteBase = config.capitalBase - BigInt(lotsAwal) * lot;

  let buys = 0;
  let sells = 0;
  let feeBase = 0n;
  let gasBase = 0n;
  let exitedAtCandle: number | null = null;
  let exitSide: "ABOVE" | "BELOW" | null = null;

  /** The proportional fee for one swap on `notional`, rounded up. */
  const feeOf = (notional: bigint): bigint =>
    ceilDiv(notional * (cost.swapFeeBps + cost.slippageBps), BPS_ONE);

  for (const [i, price] of series.entries()) {
    const d = decide(config, state, { priceBase: price, blockNumber: BigInt(i) }, cost, thresholds);

    if (d.action === "BUY" && d.lots > 0) {
      const belanja = BigInt(d.lots) * lot;
      const fee = feeOf(belanja);
      // The proportional fee is embedded in the swap: the dollars spent stay at
      // `belanja`, but the tokens received are reduced by that fee.
      const tokenTotal = ((belanja - fee) * WAD) / price;
      // Split evenly per lot so a later LIFO sale releases equal amounts. The remainder
      // (< one wei per lot, i.e. under 1e-18 tokens) is burned; chasing it would add wei
      // to one lot arbitrarily.
      const tokenPerLot = tokenTotal / BigInt(d.lots);
      quoteBase -= belanja;
      for (let k = 0; k < d.lots; k++) tumpukan.push(tokenPerLot);
      feeBase += fee;
      gasBase += cost.gasCostBase;
      buys += 1;
    } else if (d.action === "SELL" && d.lots > 0) {
      let token = 0n;
      for (let k = 0; k < d.lots; k++) token += tumpukan.pop()!;
      const kotor = (token * price) / WAD;
      const fee = feeOf(kotor);
      quoteBase += kotor - fee;
      feeBase += fee;
      gasBase += cost.gasCostBase;
      sells += 1;
    } else if (d.action === "EXIT_ABOVE" || d.action === "EXIT_BELOW") {
      let token = 0n;
      while (tumpukan.length > 0) token += tumpukan.pop()!;
      if (token > 0n) {
        const kotor = (token * price) / WAD;
        const fee = feeOf(kotor);
        quoteBase += kotor - fee;
        feeBase += fee;
        gasBase += cost.gasCostBase;
        sells += 1;
      }
      exitedAtCandle = i;
      exitSide = d.action === "EXIT_ABOVE" ? "ABOVE" : "BELOW";
      state = d.nextState;
      // After exiting, the grid holds quote only and its value no longer changes. The
      // benchmark is still marked at the LAST candle's price, so the comparison stays
      // honest: both are measured at the end of the same period.
      break;
    }

    state = d.nextState;
  }

  let sisaToken = 0n;
  for (const t of tumpukan) sisaToken += t;

  const finalValueBase = quoteBase + (sisaToken * hargaAkhir) / WAD - gasBase;

  const holdToken = (BigInt(lotsAwal) * lot * WAD) / hargaAwal;
  const holdValueBase =
    config.capitalBase - BigInt(lotsAwal) * lot + (holdToken * hargaAkhir) / WAD;

  return {
    candles: series.length,
    buys,
    sells,
    totalCostBase: feeBase + gasBase,
    finalValueBase,
    holdValueBase,
    gridBeatsHold: finalValueBase > holdValueBase,
    exitedAtCandle,
    exitSide,
  };
}
