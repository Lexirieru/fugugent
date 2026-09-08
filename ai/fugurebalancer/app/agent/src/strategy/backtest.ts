/**
 * ============================================================================
 * HONEST LIMITATIONS — READ BEFORE USING ANY NUMBER FROM THIS MODULE
 * ============================================================================
 * This harness runs three policies over the SAME price series:
 *   - `banded` : the real policy (`decide`), bands + the cost gate
 *   - `always` : rebalance to target on EVERY candle, whatever it costs
 *   - `never`  : buy and sit still (buy and hold)
 * It has one purpose: to show measurably that rebalancing on every small drift LOSES
 * money to costs, and that the bands are not decoration.
 *
 * What is deliberately NOT modeled:
 *   - non-linear price impact: cost is modeled as a fixed percentage of turnover plus
 *     fixed gas. Large trades in a shallow pool cost far more than that, so this
 *     backtest UNDERSTATES the cost of policies that trade large/often — meaning
 *     `banded`'s edge over `always` in the real world is at best what is reported
 *     here, and usually larger.
 *   - failed transactions, reverts, dead RPC, nonce races, expired Altana sessions
 *   - varying gas: `gasCostBase` is constant for the whole simulation
 *   - price movement BETWEEN two candles; only the price at each candle is seen
 *   - yield, rebates, or funding costs from holding an asset
 *   - taxes and reporting
 *   - partial fills: a rebalance is assumed fully filled at that candle's price
 *
 * One simplification that is NOT neutral: the cost is deducted from the portfolio's
 * total value at rebalance time, then the weights are set exactly to target. In the
 * real world that cost is paid out of one leg and leaves the weights slightly off.
 * This distortion favors the policy that trades often (that is, `always`), so it
 * points against the conclusion we want to show — not in its favor.
 *
 * A FINDING THAT MUST BE READ ALONGSIDE THE RESULTS (measured in __tests__/backtest.test.ts):
 * the bands DO NOT always beat rebalance-always. In a market that swings with an
 * amplitude far larger than the cost, rebalance-always harvests more volatility
 * (selling what rose, buying what fell) than the costs it pays, and the bands miss
 * that harvest. The bands' edge shows up in exactly the opposite place: small
 * portfolios (fixed gas eats the turnover) and small swings (there is nothing worth
 * harvesting). Both are tested, both are in the suite. Anyone setting
 * `rebalanceBandBps` for a new token pair must run this backtest on that pair's own
 * price series rather than assuming the bands always win.
 *
 * The price series is an input, not something generated inside this module: every
 * function here is pure and deterministic.
 * ============================================================================
 */
import { decide } from "./decide.js";
import {
  estimateCostBase,
  maxAbsDeviationBps,
  targetValueBase,
  totalValueBase,
  turnoverBase,
  computeTrades,
} from "./weights.js";
import {
  BPS_ONE,
  DEFAULT_COST_MODEL,
  DEFAULT_THRESHOLDS,
  PortfolioError,
  type Asset,
  type CostModel,
  type RebalanceThresholds,
} from "./types.js";

export interface BacktestAsset {
  symbol: string;
  startValueBase: bigint;
  targetWeightBps: bigint;
}

export interface BacktestInput {
  startAssets: BacktestAsset[];
  /**
   * `priceSeriesBps[candle][assetIndex]` — the price relative to the starting price,
   * in bps. 10_000n means the price is unchanged since the start, 12_000n means it is
   * up 20%. The length of every row must equal the number of assets.
   */
  priceSeriesBps: bigint[][];
  cost?: CostModel;
  thresholds?: RebalanceThresholds;
}

export interface PolicyResult {
  finalValueBase: bigint;
  rebalances: number;
  totalCostBase: bigint;
  /** The largest weight deviation seen at any point in the simulation. */
  maxDeviationBps: bigint;
}

export interface BacktestResult {
  candles: number;
  banded: PolicyResult;
  always: PolicyResult;
  never: PolicyResult;
  /**
   * Comparison of the final value of `banded` vs `always` on ONE price path.
   * This is not statistical proof: one path is one sample. A claim like "the bands
   * beat rebalance-always" is only valid when computed over many different paths.
   */
  bandedBeatsAlways: boolean;
}

const ACCOUNT = "0x0000000000000000000000000000000000000000" as const;

/**
 * A position is expressed as "units at the starting price": the value at candle t is
 * units x price_t / 10000. Storing units (not values) means price movement is never
 * accumulated through a chain of divisions whose error compounds; every candle is
 * recomputed from the starting price. Rounding down happens once per conversion, and
 * is under one basis unit (1e-8 dollars).
 */
interface Holding {
  symbol: string;
  targetWeightBps: bigint;
  units: bigint;
}

const unitsFromValue = (valueBase: bigint, priceBps: bigint): bigint => (valueBase * BPS_ONE) / priceBps;
const valueFromUnits = (units: bigint, priceBps: bigint): bigint => (units * priceBps) / BPS_ONE;

function snapshot(holdings: readonly Holding[], prices: readonly bigint[]): Asset[] {
  return holdings.map((h, i) => ({
    symbol: h.symbol,
    valueBase: valueFromUnits(h.units, prices[i]!),
    targetWeightBps: h.targetWeightBps,
  }));
}

/** Resets every weight to target after paying `costBase`. */
function applyRebalance(holdings: Holding[], assets: readonly Asset[], prices: readonly bigint[], costBase: bigint): void {
  const totalAfterCost = totalValueBase(assets) - costBase;
  if (totalAfterCost <= 0n) {
    throw new PortfolioError(
      `A rebalance cost of ${costBase} consumes the entire portfolio value. The cost model makes no sense.`,
    );
  }
  for (let i = 0; i < holdings.length; i++) {
    const target = targetValueBase(totalAfterCost, holdings[i]!.targetWeightBps);
    holdings[i]!.units = unitsFromValue(target, prices[i]!);
  }
}

function validate(input: BacktestInput): void {
  if (input.startAssets.length < 2) {
    throw new PortfolioError(`A backtest needs at least 2 assets, and was given ${input.startAssets.length}.`);
  }
  if (input.priceSeriesBps.length === 0) {
    throw new PortfolioError("Empty price series: there is nothing to simulate.");
  }
  for (const [i, row] of input.priceSeriesBps.entries()) {
    if (row.length !== input.startAssets.length) {
      throw new PortfolioError(
        `Price row ${i} holds ${row.length} prices for ${input.startAssets.length} assets.`,
      );
    }
    for (const [j, p] of row.entries()) {
      if (p <= 0n) {
        throw new PortfolioError(
          `Price ${j} at candle ${i} is ${p}. A zero or negative price is broken data, ` +
            `not an asset that lost all of its value.`,
        );
      }
    }
  }
}

/**
 * A PURE function: no network, clock, or environment. The output is determined
 * entirely by the arguments.
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  validate(input);

  const cost = input.cost ?? DEFAULT_COST_MODEL;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const series = input.priceSeriesBps;
  const openPrices = series[0]!;

  const makeHoldings = (): Holding[] =>
    input.startAssets.map((a, i) => ({
      symbol: a.symbol,
      targetWeightBps: a.targetWeightBps,
      units: unitsFromValue(a.startValueBase, openPrices[i]!),
    }));

  type Mode = "banded" | "always" | "never";

  const run = (mode: Mode): PolicyResult => {
    const holdings = makeHoldings();
    let rebalances = 0;
    let totalCostBase = 0n;
    let maxDeviationBps = 0n;

    for (const prices of series) {
      const assets = snapshot(holdings, prices);
      const total = totalValueBase(assets);
      if (total <= 0n) continue;

      const dev = maxAbsDeviationBps(assets, total);
      if (dev > maxDeviationBps) maxDeviationBps = dev;

      if (mode === "never") continue;

      if (mode === "banded") {
        const d = decide({ account: ACCOUNT, assets, blockNumber: 0n }, cost, thresholds);
        if (d.action !== "REBALANCE") continue;
        rebalances += 1;
        totalCostBase += d.estimatedCostBase;
        applyRebalance(holdings, assets, prices, d.estimatedCostBase);
        continue;
      }

      // mode "always": rebalance with no gate at all, exactly the mistake we want to
      // prove expensive. Zero turnover means the portfolio is already exactly on target
      // and no transaction is sent — not a policy exception, just nothing to send.
      const turnover = turnoverBase(computeTrades(assets, total));
      if (turnover <= 0n) continue;
      const costOfMove = estimateCostBase(turnover, cost);
      rebalances += 1;
      totalCostBase += costOfMove;
      applyRebalance(holdings, assets, prices, costOfMove);
    }

    const closePrices = series[series.length - 1]!;
    return {
      finalValueBase: totalValueBase(snapshot(holdings, closePrices)),
      rebalances,
      totalCostBase,
      maxDeviationBps,
    };
  };

  const banded = run("banded");
  const always = run("always");
  const never = run("never");

  return {
    candles: series.length,
    banded,
    always,
    never,
    bandedBeatsAlways: banded.finalValueBase > always.finalValueBase,
  };
}
