/**
 * ============================================================================
 * KETERBATASAN JUJUR — BACA SEBELUM MEMAKAI ANGKA DARI MODUL INI
 * ============================================================================
 * Harness ini menjalankan tiga kebijakan di atas deret APY yang SAMA:
 *   - `disciplined` : kebijakan sesungguhnya (`decide`) — gerbang risiko,
 *                     ambang selisih yang diturunkan dari ongkos, dan konfirmasi
 *   - `chaser`      : selalu pindah ke APY tertinggi, tanpa gerbang apa pun
 *   - `passive`     : tidak pernah pindah
 * Tujuannya satu: menunjukkan secara terukur bahwa mengejar APY tertinggi
 * adalah cara kalah, dan bahwa "selisih APY minimum yang membenarkan
 * perpindahan" bukan formalitas.
 *
 * Yang sengaja TIDAK dimodelkan:
 *   - APY yang BERUBAH karena deposit kita sendiri masuk. Ini penyederhanaan
 *     yang MEMIHAK `chaser`: di dunia nyata pool yang dikejar akan langsung
 *     menurunkan APY-nya begitu modal masuk, terutama pool kecil yang justru
 *     paling sering menjadi yang tertinggi. Kekalahan `chaser` yang terukur di
 *     sini karena itu adalah BATAS BAWAH kekalahannya.
 *   - bunga majemuk di dalam satu candle, dan reinvestasi hadiah
 *   - harga token hadiah: APY berbasis emisi diperlakukan sama nyatanya dengan
 *     APY berbasis bunga pinjaman, padahal yang pertama bisa menguap
 *   - transaksi gagal, revert, RPC mati, sesi Altana kedaluwarsa
 *   - lock-up, cooldown, atau antrean penarikan; perpindahan dianggap seketika
 *   - risiko yang benar-benar terjadi (exploit, depeg, bad debt). `riskScore`
 *     hanya menyaring, tidak pernah menimbulkan kerugian di simulasi ini —
 *     sehingga nilai gerbang risiko TIDAK terlihat di angka mana pun di sini.
 *     Itu keterbatasan terbesar modul ini.
 *   - pajak
 *
 * Deret APY adalah masukan; seluruh fungsi di sini murni dan deterministik.
 *
 * CARA MENGHITUNG KONFIRMASI ada di sini juga, dan itu disengaja: `decide`
 * murni dan tidak punya ingatan, jadi penjadwal di `backend/` HARUS memakai
 * aturan yang sama persis dengan yang dipakai `jalankan()` di bawah, kalau
 * tidak, perilaku produksi akan berbeda dari yang dibuktikan backtest ini.
 * ============================================================================
 */
import { decide } from "./decide.js";
import { switchCostBase, yieldOverPeriodBase } from "./apy.js";
import {
  DEFAULT_SWITCH_COST,
  DEFAULT_YIELD_THRESHOLDS,
  YieldError,
  type Pool,
  type SwitchCostModel,
  type YieldThresholds,
} from "./types.js";

export interface BacktestPool {
  poolId: string;
  protocol: string;
  tvlBase: bigint;
  riskScore: number;
}

export interface ApyPoint {
  poolId: string;
  apyBps: bigint;
}

export interface YieldBacktestInput {
  startPrincipalBase: bigint;
  startPoolId: string;
  pools: BacktestPool[];
  /** `apySeriesBps[candle]` wajib memuat tepat satu entri untuk setiap pool. */
  apySeriesBps: ApyPoint[][];
  /** Berapa hari yang diwakili satu candle. */
  daysPerCandle: bigint;
  cost?: SwitchCostModel;
  thresholds?: YieldThresholds;
}

export interface PolicyResult {
  finalPrincipalBase: bigint;
  migrations: number;
  totalCostBase: bigint;
  /** Indeks candle perpindahan pertama; null bila tidak pernah pindah. */
  firstMigrationCandle: number | null;
}

export interface YieldBacktestResult {
  candles: number;
  disciplined: PolicyResult;
  chaser: PolicyResult;
  passive: PolicyResult;
  disciplinedBeatsChaser: boolean;
}

function validate(input: YieldBacktestInput): void {
  if (input.startPrincipalBase <= 0n) {
    throw new YieldError(`Pokok awal ${input.startPrincipalBase} tidak positif.`);
  }
  if (input.daysPerCandle <= 0n) {
    throw new YieldError(`daysPerCandle=${input.daysPerCandle} tidak positif.`);
  }
  if (input.pools.length === 0) {
    throw new YieldError("Daftar pool kosong.");
  }
  if (input.apySeriesBps.length === 0) {
    throw new YieldError("Deret APY kosong: tidak ada yang bisa disimulasikan.");
  }

  const dikenal = new Set(input.pools.map((p) => p.poolId));
  if (dikenal.size !== input.pools.length) {
    throw new YieldError("poolId duplikat di dalam daftar pool.");
  }
  if (!dikenal.has(input.startPoolId)) {
    throw new YieldError(`startPoolId "${input.startPoolId}" tidak ada di dalam daftar pool.`);
  }

  for (const [i, baris] of input.apySeriesBps.entries()) {
    const terlihat = new Set<string>();
    for (const titik of baris) {
      if (!dikenal.has(titik.poolId)) {
        throw new YieldError(`Candle ${i} menyebut pool tak dikenal "${titik.poolId}".`);
      }
      if (terlihat.has(titik.poolId)) {
        throw new YieldError(`Candle ${i} menyebut pool "${titik.poolId}" dua kali.`);
      }
      terlihat.add(titik.poolId);
    }
    if (terlihat.size !== dikenal.size) {
      throw new YieldError(
        `Candle ${i} memuat ${terlihat.size} pool, seharusnya ${dikenal.size}. ` +
          `Setiap candle wajib menyebut APY SELURUH pool, termasuk pool yang sedang ditempati — ` +
          `tanpa itu selisih tidak bisa dihitung.`,
      );
    }
  }
}

/**
 * Fungsi MURNI: tanpa jaringan, jam, atau environment.
 */
export function runBacktest(input: YieldBacktestInput): YieldBacktestResult {
  validate(input);

  const cost = input.cost ?? DEFAULT_SWITCH_COST;
  const thresholds = input.thresholds ?? DEFAULT_YIELD_THRESHOLDS;
  const meta = new Map(input.pools.map((p) => [p.poolId, p]));

  /** Pool lengkap pada satu candle. Data selalu dianggap segar di backtest. */
  const poolsAt = (candle: number): Map<string, Pool> => {
    const m = new Map<string, Pool>();
    for (const titik of input.apySeriesBps[candle]!) {
      const p = meta.get(titik.poolId)!;
      m.set(titik.poolId, {
        poolId: p.poolId,
        protocol: p.protocol,
        apyBps: titik.apyBps,
        tvlBase: p.tvlBase,
        riskScore: p.riskScore,
        isActive: true,
        apyAgeSeconds: 0,
      });
    }
    return m;
  };

  type Mode = "disciplined" | "chaser" | "passive";

  const jalankan = (mode: Mode): PolicyResult => {
    let principal = input.startPrincipalBase;
    let poolId = input.startPoolId;
    let migrations = 0;
    let totalCostBase = 0n;
    let firstMigrationCandle: number | null = null;

    // Ingatan konfirmasi. `decide` murni dan tidak menyimpannya; penjadwal di
    // produksi WAJIB memakai aturan yang sama persis dengan blok ini.
    let favorit: string | null = null;
    let berturut = 0;

    for (let i = 0; i < input.apySeriesBps.length; i++) {
      const pools = poolsAt(i);
      const current = pools.get(poolId)!;
      const candidates = [...pools.values()].filter((p) => p.poolId !== poolId);

      let target: string | null = null;

      if (mode === "disciplined") {
        // Panggilan pertama hanya untuk mengetahui apakah selisihnya memenuhi
        // ambang dan pool mana yang dimaksud; hitungan konfirmasi diperbarui
        // dari jawabannya, lalu keputusan sesungguhnya diambil.
        const probe = decide(
          { position: { principalBase: principal, current }, candidates, consecutiveFavorable: 0, blockNumber: BigInt(i) },
          cost,
          thresholds,
        );
        if (probe.spreadQualifies && probe.targetPoolId !== null) {
          berturut = probe.targetPoolId === favorit ? berturut + 1 : 1;
          favorit = probe.targetPoolId;
        } else {
          berturut = 0;
          favorit = null;
        }

        const d = decide(
          { position: { principalBase: principal, current }, candidates, consecutiveFavorable: berturut, blockNumber: BigInt(i) },
          cost,
          thresholds,
        );
        if (d.action === "MIGRATE") target = d.targetPoolId;
        // EXIT tidak muncul di backtest ini: seluruh pool selalu `isActive` dan
        // metadatanya tetap, sehingga gerbang keselamatan tidak pernah menyala.
        // Itu bagian dari keterbatasan yang ditulis di kepala file.
      } else if (mode === "chaser") {
        let terbaik: Pool | null = null;
        for (const c of candidates) {
          if (terbaik === null || c.apyBps > terbaik.apyBps || (c.apyBps === terbaik.apyBps && c.poolId < terbaik.poolId)) {
            terbaik = c;
          }
        }
        if (terbaik !== null && terbaik.apyBps > current.apyBps) target = terbaik.poolId;
      }

      if (target !== null) {
        const biaya = switchCostBase(principal, cost);
        principal -= biaya;
        totalCostBase += biaya;
        migrations += 1;
        if (firstMigrationCandle === null) firstMigrationCandle = i;
        poolId = target;
        // Setelah pindah, hitungan konfirmasi tidak lagi berlaku untuk pool baru.
        berturut = 0;
        favorit = null;
      }

      const apySekarang = poolsAt(i).get(poolId)!.apyBps;
      principal += yieldOverPeriodBase(principal, apySekarang, input.daysPerCandle);
    }

    return { finalPrincipalBase: principal, migrations, totalCostBase, firstMigrationCandle };
  };

  const disciplined = jalankan("disciplined");
  const chaser = jalankan("chaser");
  const passive = jalankan("passive");

  return {
    candles: input.apySeriesBps.length,
    disciplined,
    chaser,
    passive,
    disciplinedBeatsChaser: disciplined.finalPrincipalBase > chaser.finalPrincipalBase,
  };
}
