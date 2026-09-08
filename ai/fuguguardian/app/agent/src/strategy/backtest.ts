/**
 * ============================================================================
 * KETERBATASAN JUJUR — BACA SEBELUM MEMAKAI ANGKA DARI MODUL INI
 * ============================================================================
 * Harness ini membandingkan agent (bertindak instan) dengan manusia (bertindak
 * setelah jeda reaksi) di atas deret harga sintetis/historis. Ia dengan
 * sengaja TIDAK memodelkan:
 *   - gas fee — baik agent maupun manusia dianggap gratis saat bertransaksi
 *   - slippage — jumlah repay yang disarankan dianggap selalu terisi penuh
 *     dengan harga yang sama persis dengan candle saat itu
 *   - kegagalan transaksi (revert, nonce race, RPC down, wallet terkunci)
 *   - kongesti jaringan — waktu inklusi transaksi ke blok dianggap instan
 *   - gap harga antar-blok — hanya harga pada tiap candle yang diperiksa,
 *     pergerakan harga di antara dua candle tidak pernah terlihat oleh model
 *
 * Karena semua penyederhanaan di atas menguntungkan KEDUA pihak secara sama
 * (bukan hanya agent), tetapi dunia nyata akan menambahkan gesekan (friction)
 * yang TIDAK diberi kompensasi apa pun di sini, angka `liquidationsAvoided`
 * yang dihasilkan harus dibaca sebagai BATAS ATAS (upper bound) dari
 * keunggulan agent dibanding manusia — bukan janji hasil di dunia nyata.
 * Dunia nyata hanya bisa membuat keunggulan ini terlihat lebih kecil, tidak
 * pernah lebih besar dari yang dilaporkan modul ini.
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
  liquidationsAvoided: number;
}

export interface BacktestInput {
  startCollateralBase: bigint;
  startDebtBase: bigint;
  liquidationThresholdBps: bigint;
  priceSeriesBps: bigint[];
  humanReactionCandles: number;
  thresholds?: Thresholds;
}

const BPS = 10_000n;

/** Alamat bohongan — backtest tidak pernah menyentuh chain, hanya angka murni. */
const DUMMY_ACCOUNT = "0x0000000000000000000000000000000000000000" as const;

/** Aksi yang tidak butuh respons nyata: tidak ada risiko, atau baru peringatan. */
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
 * Fungsi MURNI: tidak ada network, Date.now(), process.env, atau I/O apa pun.
 * Deret harga dan seluruh parameter lain masuk lewat argumen; keluarannya
 * hanya deterministik dari argumen tersebut.
 *
 * Menjalankan dua simulasi terpisah di atas `priceSeriesBps` yang sama:
 *  - agent: pada tiap candle, jika `decide` menyarankan aksi selain
 *    NONE/WARN, hutang langsung dikurangi `suggestedRepayBase` pada candle
 *    itu juga.
 *  - manusia: aksi baru benar-benar dieksekusi `humanReactionCandles` candle
 *    setelah aksi PERTAMA KALI dibutuhkan (candle-candle berikutnya yang
 *    masih membutuhkan aksi sebelum jeda itu selesai tidak mengulang
 *    hitungan mundur).
 *
 * Likuidasi dicatat untuk suatu pihak bila HF-nya sudah ≤ HF_ONE pada suatu
 * candle SEBELUM pihak itu sempat menindaklanjuti kebutuhan yang muncul di
 * candle itu atau sebelumnya. Begitu likuidasi tercatat, simulasi pihak itu
 * berhenti (posisinya sudah disita, tidak ada lagi hutang untuk dikelola).
 */
export function runBacktest(input: BacktestInput): BacktestResult {
  const {
    startCollateralBase,
    startDebtBase,
    liquidationThresholdBps,
    priceSeriesBps,
    humanReactionCandles,
    thresholds = DEFAULT_THRESHOLDS,
  } = input;

  // --- simulasi agent: bertindak pada candle yang sama saat dibutuhkan ---
  let agentDebt = startDebtBase;
  let agentLiquidated = false;
  let agentInterventions = 0;

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
      agentInterventions += 1;
      agentDebt -= decision.suggestedRepayBase;
    }
  }

  // --- simulasi manusia: bertindak humanReactionCandles setelah kebutuhan pertama muncul ---
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
  };
}
