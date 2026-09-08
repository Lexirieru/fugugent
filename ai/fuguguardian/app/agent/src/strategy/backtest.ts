/**
 * ============================================================================
 * HONEST LIMITATIONS — READ BEFORE USING ANY NUMBER FROM THIS MODULE
 * ============================================================================
 * This harness compares an agent (acting instantly) with a human (acting after a reaction
 * delay) over a synthetic/historical price series. It deliberately does NOT model:
 *   - gas fees — both the agent and the human transact for free
 *   - slippage — the suggested repay amount is assumed to always fill completely at
 *     exactly that candle's price
 *   - failed transactions (reverts, nonce races, RPC down, a locked wallet)
 *   - network congestion — a transaction's inclusion time is assumed instant
 *   - price gaps between blocks — only the price at each candle is examined, movement
 *     between two candles is never seen by the model
 *   - debt interest: the debt only changes when a payment is made, it never grows on
 *     its own
 *
 * The three simplifications below are sharper still because they are NOT neutral — all
 * three favor the agent:
 *
 *   (a) DELEVERAGE is modeled as "debt goes down, collateral stays intact", exactly like
 *       PARTIAL_REPAY and EMERGENCY. That is the semantics of paying from external funds
 *       (the user's wallet). A real DELEVERAGE SELLS COLLATERAL to repay debt, so
 *       collateral AND debt both fall and the HF path afterwards differs from (and is
 *       usually worse than) what is simulated here. Because the agent reaches the
 *       DELEVERAGE zone far more often than a slow human does, this distortion favors the
 *       agent.
 *
 *   (b) Without `agentBudgetBase`, the agent is assumed to have UNLIMITED capital and may
 *       intervene as often as it likes, with no frequency cap and no amount cap. In the
 *       real world an Altana session key limits both. This is not a simplification that
 *       hits both sides equally: only the agent's side gets the magic wallet. Set
 *       `agentBudgetBase` to force an honest comparison.
 *
 *   (c) The debt's price is assumed FIXED; only the collateral price moves, via
 *       `priceSeriesBps`. A depeg or a rise in the debt asset's price (a real scenario
 *       that liquidates plenty of positions) never appears here, and such a scenario hits
 *       the slow actor and the fast one alike — but this model removes it from the
 *       comparison entirely.
 *
 * The conclusion: the `liquidationsAvoided` this module produces must be read as an UPPER
 * BOUND on the agent's edge over a human — not a promise about the real world. The real
 * world can only make this edge look smaller, never larger than reported.
 *
 * A design note (it affects the resulting numbers): the human's repay amount is
 * RECOMPUTED from `decide()` on the candle it matures (when the human actually acts), not
 * frozen from the number that appeared when the need was first detected — a real human
 * re-checks the situation when they finally act, rather than executing a stale old plan.
 * ============================================================================
 */
import { computeHealthFactor } from "./healthFactor.js";
import { decide } from "./decide.js";
import { DEFAULT_THRESHOLDS, HF_ONE, type Position, type Thresholds } from "./types.js";

export interface BacktestResult {
  candles: number;
  agentInterventions: number;
  agentLiquidations: number;
  humanLiquidations: number;
  /**
   * humanLiquidations - agentLiquidations, so its value is ONLY -1, 0, or 1 for a single
   * `runBacktest`: each side stops being simulated after its first liquidation, so each
   * side contributes at most 1.
   *
   * This number is therefore NOT "the number of liquidations prevented" in the sense of
   * an event count. It is the outcome of one binary comparison over ONE price path:
   * 1 = the human was liquidated while the agent survived, 0 = both met the same fate,
   * -1 = it was the agent that got liquidated. A claim like "the agent prevented N
   * liquidations" is only valid when N is counted from N `runBacktest` calls over N
   * different price paths, not from one run.
   */
  liquidationsAvoided: number;
  /**
   * true when `agentBudgetBase` was given AND on some candle the agent needed to act but
   * its remaining budget was not enough. From that point on the agent does not act again
   * for the rest of the simulation, so this run's result describes an agent that ran out
   * of capital — not an agent that had no need to act.
   */
  agentBudgetExhausted: boolean;
}

export interface BacktestInput {
  startCollateralBase: bigint;
  startDebtBase: bigint;
  liquidationThresholdBps: bigint;
  priceSeriesBps: bigint[];
  humanReactionCandles: number;
  thresholds?: Thresholds;
  /**
   * The maximum total repay the agent may spend ACROSS THE WHOLE simulation (8-decimal
   * basis, the same unit as `startDebtBase`). If an intervention does not fit in the
   * remaining budget, that intervention is NOT partially executed — the agent stops
   * acting entirely for the rest of the simulation, exactly like a human who never acted,
   * and `agentBudgetExhausted` becomes true.
   *
   * Left undefined, the agent is treated as having unlimited capital: see point (b) at the
   * top of this file. To compare the agent against a real Altana session key (which has an
   * amount cap), this field MUST be set.
   */
  agentBudgetBase?: bigint;
}

const BPS = 10_000n;

/** A fake address — the backtest never touches the chain, only pure numbers. */
const DUMMY_ACCOUNT = "0x0000000000000000000000000000000000000000" as const;

/** Actions that need no real response: there is no risk, or it is only a warning. */
function actionNeedsResponse(action: string): boolean {
  return action !== "NONE" && action !== "WARN";
}

function buildPosition(
  collateralBase: bigint,
  debtBase: bigint,
  liquidationThresholdBps: bigint,
  healthFactor: bigint | null,
): Position {
  return {
    protocol: "aave",
    account: DUMMY_ACCOUNT,
    collateralBase,
    debtBase,
    liquidationThresholdBps,
    healthFactor,
    blockNumber: 0n,
  };
}

/**
 * A PURE function: no network, no Date.now(), no process.env, no I/O of any kind. The
 * price series and every other parameter arrive as arguments; the output is determined
 * only by those arguments.
 *
 * It runs two separate simulations over the same `priceSeriesBps`:
 *  - the agent: on each candle, if `decide` suggests anything other than NONE/WARN, the
 *    debt is reduced by `suggestedRepayBase` on that same candle — as long as
 *    `agentBudgetBase` (when given) still covers it. Note that even DELEVERAGE is modeled
 *    as nothing but a debt reduction, with collateral left intact; see point (a) at the
 *    top of this file.
 *  - the human: an action is only actually executed `humanReactionCandles` candles after
 *    an action was FIRST needed (later candles that still need action before that delay
 *    elapses do not restart the countdown).
 *
 * A liquidation is recorded for a side when its HF is already <= HF_ONE on some candle
 * BEFORE that side got to act on a need that arose on that candle or earlier. Once a
 * liquidation is recorded, that side's simulation stops (its position has been seized,
 * there is no debt left to manage).
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  const {
    startCollateralBase,
    startDebtBase,
    liquidationThresholdBps,
    priceSeriesBps,
    humanReactionCandles,
    thresholds = DEFAULT_THRESHOLDS,
    agentBudgetBase,
  } = input;

  // --- agent simulation: acts on the same candle the need appears ---
  let agentDebt = startDebtBase;
  let agentLiquidated = false;
  let agentInterventions = 0;
  let agentSpent = 0n;
  let agentBudgetExhausted = false;

  for (const priceBps of priceSeriesBps) {
    if (agentLiquidated) break;

    const collateral = (startCollateralBase * priceBps) / BPS;
    const hf = computeHealthFactor(collateral, agentDebt, liquidationThresholdBps);

    if (hf !== null && hf <= HF_ONE) {
      agentLiquidated = true;
      break;
    }

    const decision = decide(buildPosition(collateral, agentDebt, liquidationThresholdBps, hf), thresholds);
    if (actionNeedsResponse(decision.action)) {
      // An exhausted budget = the agent is paralyzed for the REST of the simulation, not
      // merely skipping one candle. There is deliberately no partial payment from what is
      // left of the budget: a half-way repay does not bring HF back to target and would
      // once again have the model overstate what the agent can achieve with capital it
      // does not have.
      if (agentBudgetExhausted) continue;

      if (agentBudgetBase !== undefined && agentSpent + decision.suggestedRepayBase > agentBudgetBase) {
        agentBudgetExhausted = true;
        continue;
      }

      agentInterventions += 1;
      agentSpent += decision.suggestedRepayBase;
      agentDebt -= decision.suggestedRepayBase;
    }
  }

  // --- human simulation: acts humanReactionCandles after the first need appears ---
  let humanDebt = startDebtBase;
  let humanLiquidated = false;
  let pendingSince: number | null = null;

  for (let i = 0; i < priceSeriesBps.length; i++) {
    if (humanLiquidated) break;

    const priceBps = priceSeriesBps[i]!;
    const collateral = (startCollateralBase * priceBps) / BPS;
    const hf = computeHealthFactor(collateral, humanDebt, liquidationThresholdBps);

    if (hf !== null && hf <= HF_ONE) {
      humanLiquidated = true;
      break;
    }

    const decision = decide(buildPosition(collateral, humanDebt, liquidationThresholdBps, hf), thresholds);

    if (pendingSince === null && actionNeedsResponse(decision.action)) {
      pendingSince = i;
    }

    if (pendingSince !== null && i - pendingSince === humanReactionCandles) {
      humanDebt -= decision.suggestedRepayBase;
      pendingSince = null;
    }
  }

  const agentLiquidations = agentLiquidated ? 1 : 0;
  const humanLiquidations = humanLiquidated ? 1 : 0;

  return {
    candles: priceSeriesBps.length,
    agentInterventions,
    agentLiquidations,
    humanLiquidations,
    liquidationsAvoided: humanLiquidations - agentLiquidations,
    agentBudgetExhausted,
  };
}
