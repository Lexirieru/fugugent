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
 *   - bunga hutang: hutang hanya berubah saat ada pembayaran, tidak pernah
 *     tumbuh sendiri
 *
 * Tiga penyederhanaan berikut lebih tajam lagi karena TIDAK netral — ketiganya
 * memihak agent:
 *
 *   (a) DELEVERAGE dimodelkan sebagai "hutang berkurang, agunan utuh", persis
 *       sama dengan PARTIAL_REPAY dan EMERGENCY. Itu semantik membayar dari
 *       dana eksternal (dompet user). DELEVERAGE yang sungguhan MENJUAL
 *       AGUNAN untuk melunasi hutang, sehingga agunan DAN hutang sama-sama
 *       turun dan lintasan HF sesudahnya berbeda (dan umumnya lebih buruk)
 *       daripada yang disimulasikan di sini. Karena agent jauh lebih sering
 *       mencapai zona DELEVERAGE daripada manusia yang lambat, distorsi ini
 *       menguntungkan agent.
 *
 *   (b) Tanpa `agentBudgetBase`, agent dianggap punya modal TAK TERBATAS dan
 *       boleh melakukan intervensi sesering apa pun, tanpa batas frekuensi
 *       maupun batas nominal. Di dunia nyata session key Altana justru
 *       membatasi keduanya. Ini bukan penyederhanaan yang menimpa kedua pihak
 *       sama rata: hanya sisi agent yang mendapat dompet ajaib. Isi
 *       `agentBudgetBase` untuk memaksa perbandingan yang jujur.
 *
 *   (c) Harga hutang dianggap TETAP; hanya harga agunan yang bergerak lewat
 *       `priceSeriesBps`. Depeg atau kenaikan harga aset hutang (skenario
 *       nyata yang melikuidasi banyak posisi) tidak pernah muncul di sini,
 *       dan skenario semacam itu memukul pihak yang bertindak lambat maupun
 *       cepat — tetapi model ini menghapusnya sepenuhnya dari perbandingan.
 *
 * Kesimpulannya: `liquidationsAvoided` yang dihasilkan modul ini harus dibaca
 * sebagai BATAS ATAS (upper bound) dari keunggulan agent dibanding manusia —
 * bukan janji hasil di dunia nyata. Dunia nyata hanya bisa membuat keunggulan
 * ini terlihat lebih kecil, tidak pernah lebih besar dari yang dilaporkan.
 *
 * Catatan desain (memengaruhi angka hasil): jumlah repay manusia DIHITUNG
 * ULANG dari `decide()` pada candle kematangan (saat manusia benar-benar
 * bertindak), bukan dibekukan dari angka yang muncul saat kebutuhan pertama
 * terdeteksi — manusia nyata mengecek ulang situasi saat akhirnya bertindak,
 * bukan mengeksekusi rencana lama yang sudah basi.
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
   * humanLiquidations - agentLiquidations, jadi nilainya HANYA -1, 0, atau 1
   * untuk satu kali `runBacktest`: tiap pihak berhenti disimulasikan setelah
   * likuidasi pertamanya, sehingga tiap sisi paling banyak menyumbang 1.
   *
   * Karena itu angka ini BUKAN "jumlah likuidasi yang dicegah" dalam arti
   * hitungan kejadian. Ia adalah hasil satu perbandingan biner atas SATU
   * lintasan harga: 1 = manusia terlikuidasi sedangkan agent selamat, 0 = nasib
   * keduanya sama, -1 = justru agent yang terlikuidasi. Klaim seperti "agent
   * mencegah N likuidasi" hanya sah bila N dihitung dari N kali `runBacktest`
   * pada N lintasan harga yang berbeda, bukan dari satu run.
   */
  liquidationsAvoided: number;
  /**
   * true bila `agentBudgetBase` diberikan DAN pada suatu candle agent butuh
   * bertindak tetapi sisa anggarannya tidak cukup. Sejak titik itu agent tidak
   * bertindak lagi sampai akhir simulasi, sehingga hasil run ini menggambarkan
   * agent yang kehabisan modal — bukan agent yang tidak perlu bertindak.
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
   * Total repay maksimum yang boleh dikeluarkan agent SELAMA SELURUH simulasi
   * (basis 8 desimal, satuan yang sama dengan `startDebtBase`). Bila sebuah
   * intervensi tidak muat di sisa anggaran, intervensi itu TIDAK dieksekusi
   * sebagian — agent berhenti bertindak sama sekali untuk sisa simulasi,
   * persis seperti manusia yang tidak pernah bertindak, dan
   * `agentBudgetExhausted` menjadi true.
   *
   * Bila dibiarkan undefined, agent dianggap bermodal tak terbatas: lihat
   * poin (b) di kepala file. Untuk membandingkan agent dengan session key
   * Altana yang sungguhan (yang punya batas nominal), field ini WAJIB diisi.
   */
  agentBudgetBase?: bigint;
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
 *    itu juga — selama `agentBudgetBase` (bila diberikan) masih mencukupi.
 *    Perhatikan bahwa DELEVERAGE pun dimodelkan hanya sebagai pengurangan
 *    hutang, agunan dibiarkan utuh; lihat poin (a) di kepala file.
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
    agentBudgetBase,
  } = input;

  // --- simulasi agent: bertindak pada candle yang sama saat dibutuhkan ---
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
      // Anggaran habis = agent lumpuh untuk SISA simulasi, bukan sekadar
      // melewatkan satu candle. Sengaja tidak ada pembayaran sebagian dari
      // sisa anggaran: repay setengah jalan tidak mengembalikan HF ke target
      // dan akan membuat model kembali melebih-lebihkan apa yang bisa dicapai
      // agent dengan modal yang tidak dimilikinya.
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
    agentBudgetExhausted,
  };
}
