/**
 * Composition root Guardian: satu tempat yang merakit rantai lengkap
 * baca posisi → `decide` → `executeDecision` → kirim lewat session key,
 * beserta persistensi state dan kill switch-nya.
 *
 * ## Kenapa modul ini ada
 *
 * Sampai sekarang perakitan itu hanya hidup di dalam `scripts/e2e-guardian.ts`
 * sebagai ±200 baris yang tidak bisa dipakai ulang dan tidak dijaga test apa
 * pun. Lima potongan tidak punya padanan di `src/` sama sekali: konversi USD8 →
 * unit token, pembacaan `assets()` + feed harga, cek saldo sebelum kirim,
 * pembuatan `ExecuteState` awal, dan penyusunan `sendRepay`. Siapa pun yang
 * menyambungkan runtime berikutnya akan menyalinnya dari sebuah skrip demo, dan
 * salinan pertama yang meleset satu orde pada konversi satuan tidak akan
 * tertangkap satu test pun.
 *
 * Sekarang `createGuardian` yang memilikinya, E2E memanggilnya, dan backend
 * akan memanggil yang sama.
 *
 * ## Yang SENGAJA tetap di luar
 *
 * `sendCalls` — jalur relay Altana (`AltanaWalletProvider._relayExecute`) —
 * disuntikkan, tidak dirakit di sini. Dua alasan: modul di `src/strategy/`
 * tidak boleh menarik dependensi SDK pihak ketiga, dan jalur itu memakai API
 * internal SDK yang bisa berubah tanpa pemberitahuan. Batas suntikannya adalah
 * batas yang sama yang dipakai `chain/session.ts`, sehingga seluruh modul ini
 * bisa diuji tanpa menyentuh jaringan sama sekali.
 *
 * `explainDecision` juga disuntikkan dan default-nya BUKAN LLM, melainkan
 * `decision.reason` apa adanya. dGrid butuh 3–46 detik; memasangnya secara
 * diam-diam sebagai default akan menaruhnya di jalur yang dipakai backend
 * tanpa ada yang memintanya (CLAUDE.md #1).
 */
import type { PublicClient } from "viem";
import { readAavePosition } from "./chain/aave.js";
import { createSessionSendRepay, type SessionPermissions, type SessionRepayDeps } from "./chain/session.js";
import {
  executeDecision,
  type ExecuteLimits,
  type ExecuteState,
} from "./execute.js";
import {
  runGuardCycle,
  startGuardLoop,
  type CycleResult,
  type ExecuteFn,
  type ExplainFn,
  type GuardCycleDeps,
  type GuardCycleOutcome,
  type GuardLoopHandle,
  type Logger,
} from "./guard.js";
import { createMemoryStateStore, initialExecuteState, type ExecuteStateStore } from "./state/store.js";
import type { Position, Thresholds } from "./types.js";
import {
  assertFeedIsUsd8,
  assertTokenDecimalsAgree,
  usd8ToTokenUnits,
} from "./units.js";

const POOL_ASSETS_ABI = [
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "feed", type: "address" },
      { name: "ltvBps", type: "uint16" },
      { name: "liquidationThresholdBps", type: "uint16" },
      { name: "tokenDecimals", type: "uint8" },
      { name: "enabled", type: "bool" },
    ],
  },
] as const;

const PRICE_FEED_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Kesalahan perakitan Guardian: selalu berarti "jangan mulai loop sama sekali". */
export class GuardianConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianConfigError";
  }
}

export interface GuardianConfig {
  /** Wallet pemilik posisi — yang hutangnya dibayar, dan atas nama siapa sesi bertindak. */
  account: `0x${string}`;
  /** Client viem read-only untuk rantai tempat posisi berada. */
  client: PublicClient;
  /** Pool ber-ABI `getUserAccountData` Aave v3. */
  pool: `0x${string}`;
  /** Token hutang yang boleh dibayar. */
  repayAsset: `0x${string}`;
  /** Izin sesi apa adanya dari file sesi; diperiksa saat konstruksi. */
  permissions: SessionPermissions;
  /** Pengirim batch lewat sesi Altana. Lihat catatan "Yang SENGAJA tetap di luar". */
  sendCalls: SessionRepayDeps["sendCalls"];
  limits: ExecuteLimits;
  logger: Logger;
  /** Persistensi state; default memori (batas hilang saat restart — sengaja harus dipilih). */
  stateStore?: ExecuteStateStore;
  /** Jam dalam detik epoch; disuntikkan agar bisa dikontrol penuh saat test. */
  now?: () => number;
  /** Default: `decision.reason` apa adanya, TANPA LLM. */
  explainDecision?: ExplainFn;
  thresholds?: Thresholds;
  onCycle?: (result: CycleResult) => void;
  /** Catatan rinci jalur sesi (konversi satuan, approve). Default: senyap. */
  log?: (message: string) => void;
}

/** Konfigurasi aset repay yang dibaca dari rantai saat konstruksi, bukan diasumsikan. */
export interface RepayAssetInfo {
  readonly asset: `0x${string}`;
  readonly feed: `0x${string}`;
  readonly tokenDecimals: number;
}

export interface Guardian {
  /** Konfigurasi aset repay apa adanya dari rantai — dicetak skrip, dipakai backend. */
  readonly repayAsset: RepayAssetInfo;
  /** Membaca posisi terkini, ditambatkan ke satu blok (lihat `chain/aave.ts`). */
  readPosition(): Promise<Position>;
  /** Menjalankan SATU siklus, mengalirkan dan mempersist state-nya sendiri. */
  runOnce(): Promise<GuardCycleOutcome>;
  /** Menjalankan loop; handle-nya punya `kill()` yang sungguhan (lihat `guard.ts`). */
  start(intervalMs: number): GuardLoopHandle;
  /** State eksekusi terkini (anggaran, cooldown, kill switch, repay menggantung). */
  getExecuteState(): ExecuteState;
}

function requireHexAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new GuardianConfigError(`${label} bukan alamat yang sah: ${String(value)}`);
  }
  return value as `0x${string}`;
}

/**
 * Merakit Guardian yang siap dijalankan.
 *
 * Semua pembacaan konfigurasi aset terjadi DI SINI, saat konstruksi, bukan saat
 * transaksi pertama: aset yang tidak aktif, desimal yang tidak konsisten, feed
 * yang bukan 8 desimal, atau izin sesi yang terlalu longgar harus terlihat
 * sebelum siklus pertama berjalan — bukan setelah agent memutuskan membayar.
 */
export async function createGuardian(config: GuardianConfig): Promise<Guardian> {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const log = config.log ?? (() => {});
  const store = config.stateStore ?? createMemoryStateStore();
  const explain: ExplainFn = config.explainDecision ?? (async (_pos, decision) => decision.reason);

  // --- Konfigurasi aset repay, dibaca dari pool ------------------------------
  const [feedRaw, , , tokenDecimalsFromPool, enabled] = (await config.client.readContract({
    address: config.pool,
    abi: POOL_ASSETS_ABI,
    functionName: "assets",
    args: [config.repayAsset],
  })) as readonly [`0x${string}`, number, number, number, boolean];

  if (!enabled) {
    throw new GuardianConfigError(
      `Aset repay ${config.repayAsset} tidak aktif di pool ${config.pool}; tidak ada yang bisa dibayar.`,
    );
  }
  const feed = requireHexAddress(feedRaw, `Feed harga aset ${config.repayAsset}`);

  // Dua sumber independen untuk desimal token, dan feed yang wajib 8 desimal.
  // Inilah pengganti "cek bolak-balik" tautologis yang dulu ada di skrip E2E —
  // lihat catatan lengkapnya di kepala `units.ts`.
  const tokenDecimals = Number(
    (await config.client.readContract({
      address: config.repayAsset,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number,
  );
  assertTokenDecimalsAgree(Number(tokenDecimalsFromPool), tokenDecimals, config.repayAsset);

  const feedDecimals = Number(
    (await config.client.readContract({
      address: feed,
      abi: PRICE_FEED_ABI,
      functionName: "decimals",
    })) as number,
  );
  assertFeedIsUsd8(feedDecimals, config.repayAsset);

  /** Harga aset repay, dibaca SEGAR setiap konversi — bukan disimpan saat konstruksi. */
  async function readRepayPriceUsd8(): Promise<bigint> {
    const [, answer] = (await config.client.readContract({
      address: feed,
      abi: PRICE_FEED_ABI,
      functionName: "latestRoundData",
    })) as readonly [bigint, bigint, bigint, bigint, bigint];
    if (answer <= 0n) {
      throw new GuardianConfigError(
        `Feed ${feed} melaporkan harga ${answer} untuk aset repay; konversi ditolak.`,
      );
    }
    return answer;
  }

  // Gagal cepat kalau feed-nya memang tidak bisa dibaca sama sekali.
  await readRepayPriceUsd8();

  // --- Jembatan satuan + cek saldo -----------------------------------------
  const toTokenUnits: SessionRepayDeps["toTokenUnits"] = async (asset, amountUsd8) => {
    const priceUsd8 = await readRepayPriceUsd8();
    const units = usd8ToTokenUnits(amountUsd8, tokenDecimals, priceUsd8);
    log(`satuan: ${amountUsd8} (USD basis 8) -> ${units} unit token (${tokenDecimals} desimal)`);

    const saldo = (await config.client.readContract({
      address: asset,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [config.account],
    })) as bigint;
    if (saldo < units) {
      // Gagal SEBELUM kirim, bukan membiarkan transaksi revert on-chain dan
      // membakar gas untuk sesuatu yang sudah bisa diketahui dari satu bacaan.
      throw new GuardianConfigError(
        `Saldo token repay kurang: ${saldo} unit < ${units} unit yang dibutuhkan.`,
      );
    }
    return units;
  };

  // --- Penanda tangan repay lewat session key ------------------------------
  // `createSessionSendRepay` memeriksa allowlist sesi saat dikonstruksi dan
  // menolak berjalan sama sekali bila `calls` kosong/hilang (= izin tanpa batas
  // di Altana) atau lebih luas daripada repay + approve.
  const sendRepay = createSessionSendRepay({
    walletAddress: config.account,
    pool: config.pool,
    repayAsset: config.repayAsset,
    permissions: config.permissions,
    toTokenUnits,
    readAllowance: async (asset, owner, spender) =>
      (await config.client.readContract({
        address: asset,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, spender],
      })) as bigint,
    sendCalls: config.sendCalls,
    log,
  });

  // --- State: dimuat dari store, BUKAN direset setiap start -----------------
  const tersimpan = await store.load();
  let currentState: ExecuteState = tersimpan ?? initialExecuteState(now());
  if (tersimpan === null) {
    config.logger.info("guardian: tidak ada state tersimpan, memulai dari anggaran kosong", {
      account: config.account,
    });
  } else {
    config.logger.info("guardian: state eksekusi dimuat dari store", {
      account: config.account,
      spentTodayUsd8: tersimpan.spentTodayUsd8.toString(),
      killed: tersimpan.killed,
      pendingRepay: tersimpan.pendingRepay !== null,
    });
  }

  const readPosition = (account: `0x${string}`) =>
    readAavePosition(config.client, account, config.pool);

  const execFn: ExecuteFn = (decision, pos, state) =>
    executeDecision(decision, pos, config.limits, state, {
      repayAsset: config.repayAsset,
      sendRepay,
      now,
    });

  const cycleDeps: GuardCycleDeps = {
    account: config.account,
    readPosition,
    executeDecision: execFn,
    explainDecision: explain,
    now,
    logger: config.logger,
    ...(config.thresholds ? { thresholds: config.thresholds } : {}),
    ...(config.onCycle ? { onCycle: config.onCycle } : {}),
  };

  return {
    repayAsset: { asset: config.repayAsset, feed, tokenDecimals },
    readPosition: () => readPosition(config.account),
    getExecuteState: () => currentState,
    runOnce: async () => {
      const outcome = await runGuardCycle(cycleDeps, currentState);
      currentState = outcome.nextExecuteState;
      try {
        await store.save(currentState);
      } catch (err) {
        // Sama seperti di dalam loop: kegagalan menyimpan dilaporkan, bukan
        // dibiarkan menghentikan perlindungan posisi.
        config.logger.error("guardian: gagal menyimpan state eksekusi", {
          account: config.account,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return outcome;
    },
    start: (intervalMs) =>
      startGuardLoop(cycleDeps, intervalMs, currentState, {
        saveExecuteState: async (state) => {
          currentState = state;
          await store.save(state);
        },
      }),
  };
}
