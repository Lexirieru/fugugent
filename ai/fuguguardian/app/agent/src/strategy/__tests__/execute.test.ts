import { describe, expect, it, vi } from "vitest";
import {
  NeverSentError,
  RepaySendError,
  clearPendingRepay,
  executeDecision,
  reconcilePendingRepay,
  type ExecuteDeps,
  type ExecuteLimits,
  type ExecuteState,
  type PendingRepay,
} from "../execute.js";
import type { Decision, Position } from "../types.js";

/** Alamat aset repay kini DISUNTIKKAN, bukan konstanta di dalam execute.ts. */
const REPAY_ASSET = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;

const POS: Position = {
  protocol: "aave",
  account: "0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E",
  collateralBase: 750_000_000_000n,
  debtBase: 312_500_000_000n,
  liquidationThresholdBps: 7_500n,
  healthFactor: 1_800_000_000_000_000_000n,
  blockNumber: 1n,
};

function decisionWith(action: Decision["action"], suggestedRepayBase: bigint): Decision {
  return {
    action,
    healthFactor: POS.healthFactor,
    dropToLiquidationBps: 0n,
    reason: "test",
    suggestedRepayBase,
  };
}

function limits(overrides: Partial<ExecuteLimits> = {}): ExecuteLimits {
  return {
    maxPerActionUsd8: 100_000_000_000n, // $1000
    maxPerDayUsd8: 500_000_000_000n, // $5000
    minIntervalSeconds: 300,
    ...overrides,
  };
}

function state(overrides: Partial<ExecuteState> = {}): ExecuteState {
  return {
    spentTodayUsd8: 0n,
    dayStartedAt: 1_000_000,
    lastActionAt: 0,
    killed: false,
    pendingRepay: null,
    ...overrides,
  };
}

function pending(overrides: Partial<PendingRepay> = {}): PendingRepay {
  return {
    asset: REPAY_ASSET,
    amountUsd8: 10_000_000_000n,
    startedAt: 999_000,
    txHash: null,
    debtBaseBeforeSend: POS.debtBase,
    blockNumberBeforeSend: POS.blockNumber,
    ...overrides,
  };
}

function deps(overrides: Partial<ExecuteDeps> = {}): ExecuteDeps {
  return {
    repayAsset: REPAY_ASSET,
    sendRepay: vi.fn(async () => "0xdeadbeef" as `0x${string}`),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe("executeDecision", () => {
  it("aturan 1: kill switch mutlak, tidak pernah mengirim", async () => {
    const d = decisionWith("EMERGENCY", 50_000_000_000n);
    const s = state({ killed: true });
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 1: kill switch mengalahkan segalanya, bahkan saat semua batas lain longgar", async () => {
    const d = decisionWith("PARTIAL_REPAY", 1_000n);
    const s = state({ killed: true, lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 999_999 });
    const result = await executeDecision(d, POS, limits({ minIntervalSeconds: 0 }), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it.each(["NONE", "WARN"] as const)("aturan 2: aksi %s tidak pernah mengirim", async (action) => {
    const d = decisionWith(action, 0n);
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 3: jumlah melebihi batas per-aksi dipotong, bukan ditolak", async () => {
    const d = decisionWith("PARTIAL_REPAY", 200_000_000_000n); // $2000, batas $1000
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(true);
    expect(result.amountSentUsd8).toBe(100_000_000_000n);
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 100_000_000_000n);
  });

  it("tidak memotong bila jumlah masih di bawah batas per-aksi", async () => {
    const d = decisionWith("PARTIAL_REPAY", 50_000_000_000n); // $500
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), state(), dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(false);
    expect(result.amountSentUsd8).toBe(50_000_000_000n);
  });

  it("aturan 4: jumlah melebihi sisa anggaran harian dipotong ke sisa", async () => {
    const d = decisionWith("PARTIAL_REPAY", 80_000_000_000n); // $800, di bawah cap per-aksi
    const s = state({ spentTodayUsd8: 450_000_000_000n }); // sisa dari $5000: $500
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerDay).toBe(true);
    expect(result.amountSentUsd8).toBe(50_000_000_000n); // sisa $500
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 50_000_000_000n);
  });

  it("pemotongan per-aksi dan harian berlaku bersamaan", async () => {
    // suggestedRepayBase ($2000) > maxPerActionUsd8 ($1000) > sisa harian ($300)
    const d = decisionWith("PARTIAL_REPAY", 200_000_000_000n);
    const s = state({ spentTodayUsd8: 470_000_000_000n }); // sisa dari $5000: $300
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerAction).toBe(true);
    expect(result.cappedPerDay).toBe(true);
    // Jumlah yang benar-benar terkirim adalah sisa harian ($300), bukan
    // batas per-aksi ($1000) — pemotongan kedua lebih ketat dari yang pertama.
    expect(result.amountSentUsd8).toBe(30_000_000_000n);
    expect(dep.sendRepay).toHaveBeenCalledWith(expect.anything(), 30_000_000_000n);
  });

  it("aturan 4: sisa anggaran harian nol -> tidak mengirim", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 500_000_000_000n }); // sudah habis
    const dep = deps();
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 5: cooldown menolak sebelum minIntervalSeconds terlewati", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 299 }); // minIntervalSeconds default 300
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(false);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("aturan 5: cooldown mengizinkan tepat setelah minIntervalSeconds terlewati", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ lastActionAt: 1_000_000 });
    const dep = deps({ now: () => 1_000_000 + 300 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(dep.sendRepay).toHaveBeenCalledOnce();
  });

  it("aturan 6: setelah kirim berhasil, spentTodayUsd8 dan lastActionAt diperbarui", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 5_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({ now: () => 1_000_500 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.state.spentTodayUsd8).toBe(15_000_000_000n);
    expect(result.state.lastActionAt).toBe(1_000_500);
    expect(result.state.dayStartedAt).toBe(1_000_000);
  });

  it("aturan 6: anggaran harian direset bila sudah lewat 24 jam", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 499_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({ now: () => 1_000_000 + 86_401 });
    const result = await executeDecision(d, POS, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.cappedPerDay).toBe(false);
    expect(result.amountSentUsd8).toBe(10_000_000_000n);
    expect(result.state.spentTodayUsd8).toBe(10_000_000_000n);
    expect(result.state.dayStartedAt).toBe(1_000_000 + 86_401);
  });

  it("tidak mengirim apa pun ke jaringan sungguhan — sendRepay selalu dependency yang disuntikkan", async () => {
    const d = decisionWith("EMERGENCY", 10_000_000_000n);
    const dep = deps();
    await executeDecision(d, POS, limits(), state(), dep);
    expect(dep.sendRepay).toHaveBeenCalledTimes(1);
  });

  // ————————————————————————————————————————————————————————————————
  // C2 — "gagal" tidak berarti "tidak terjadi"
  //
  // Test lama di tempat ini bernama "kegagalan kirim tidak menghabiskan
  // anggaran" dan mengunci kebalikan dari aturan di bawah. Ia dibuat sengaja
  // di putaran sebelumnya dan memang benar untuk sebuah fungsi murni; ia SALAH
  // untuk pengiriman jaringan, karena `waitForTransactionReceipt` yang timeout
  // melempar SESUDAH transaksinya mendarat. Ia diganti, bukan dihapus diam-diam.
  // ————————————————————————————————————————————————————————————————

  it("kegagalan kirim yang tidak bertanda TETAP memotong anggaran dan mencatat repay menggantung", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ spentTodayUsd8: 5_000_000_000n, dayStartedAt: 1_000_000, lastActionAt: 0 });
    const dep = deps({
      sendRepay: vi.fn(async () => {
        // Bentuk kegagalan yang menjadi alasan aturan ini ada: transaksinya
        // sudah mendarat, yang gagal hanya pembacaan receipt-nya.
        throw new Error("waitForTransactionReceipt timeout setelah 180s");
      }),
      now: () => 1_000_500,
    });

    const err = await executeDecision(d, POS, limits(), s, dep).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RepaySendError);
    const sendErr = err as RepaySendError;
    // Galat aslinya tidak boleh hilang: pemanggil tetap harus bisa membacanya.
    expect(sendErr.message).toContain("waitForTransactionReceipt timeout");
    expect(sendErr.cause).toBeInstanceOf(Error);

    // Anggaran DAN cooldown sudah bergerak, karena uangnya mungkin sudah pindah.
    expect(sendErr.stateAfterSend.spentTodayUsd8).toBe(15_000_000_000n);
    expect(sendErr.stateAfterSend.lastActionAt).toBe(1_000_500);

    // Dan yang paling menentukan: catatan menggantung yang akan menahan siklus
    // berikutnya, lengkap dengan jangkar rekonsiliasinya.
    expect(sendErr.stateAfterSend.pendingRepay).toEqual({
      asset: REPAY_ASSET,
      amountUsd8: 10_000_000_000n,
      startedAt: 1_000_500,
      txHash: null,
      debtBaseBeforeSend: POS.debtBase,
      blockNumberBeforeSend: POS.blockNumber,
    });

    // Objek masukan tetap tidak dimutasi — modul ini masih murni.
    expect(s.spentTodayUsd8).toBe(5_000_000_000n);
    expect(s.pendingRepay).toBeNull();
  });

  it("galat yang menyatakan dirinya belum menyentuh jaringan dilempar apa adanya, anggaran utuh", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const asli = new NeverSentError("aset repay bukan yang di-allowlist; menolak mengirim apa pun");
    const dep = deps({ sendRepay: vi.fn(async () => { throw asli; }) });

    const err = await executeDecision(d, POS, limits(), state(), dep).catch((e: unknown) => e);

    // Bukan RepaySendError: tidak ada anggaran terpotong dan tidak ada yang menggantung.
    expect(err).toBe(asli);
    expect(err).not.toBeInstanceOf(RepaySendError);
  });

  it("galat berbentuk objek biasa dengan neverSent:true juga dihormati (bukan lewat instanceof)", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    // `chain/session.ts` menandai galatnya sendiri lewat properti supaya ia tidak
    // perlu mewarisi kelas dari execute.ts.
    const asli = Object.assign(new Error("konversi menghasilkan nol unit token"), {
      neverSent: true as const,
    });
    const dep = deps({ sendRepay: vi.fn(async () => { throw asli; }) });

    await expect(executeDecision(d, POS, limits(), state(), dep)).rejects.toBe(asli);
  });

  it("aturan 2: repay menggantung menahan SEMUA pengiriman baru, bahkan saat batas lain longgar", async () => {
    const d = decisionWith("EMERGENCY", 10_000_000_000n);
    const s = state({ pendingRepay: pending() });
    const dep = deps({ now: () => 9_999_999 }); // cooldown pasti terlewati

    const result = await executeDecision(d, POS, limits({ minIntervalSeconds: 0 }), s, dep);

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/belum terbukti selesai/i);
    expect(dep.sendRepay).not.toHaveBeenCalled();
  });

  it("kirim berhasil tidak meninggalkan apa pun menggantung", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const result = await executeDecision(d, POS, limits(), state(), deps());

    expect(result.sent).toBe(true);
    expect(result.state.pendingRepay).toBeNull();
  });
});

describe("reconcilePendingRepay", () => {
  it("hutang berkurang di blok yang lebih baru = terbukti mendarat -> catatan dibereskan", () => {
    const s = state({ spentTodayUsd8: 10_000_000_000n, pendingRepay: pending() });
    const sesudah = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber + 1n,
      debtBase: POS.debtBase - 1n,
    });

    expect(sesudah.pendingRepay).toBeNull();
    // Anggaran yang sudah terpotong TIDAK dikembalikan: transaksinya memang jadi.
    expect(sesudah.spentTodayUsd8).toBe(10_000_000_000n);
  });

  it("hutang belum berkurang = belum terbukti -> catatan DIBIARKAN, walau blok sudah maju jauh", () => {
    const s = state({ pendingRepay: pending() });
    const sesudah = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber + 10_000n,
      debtBase: POS.debtBase,
    });

    // Transaksi yang masih di mempool bisa mendarat kapan saja; "belum terlihat"
    // tidak pernah berarti "tidak akan terjadi".
    expect(sesudah.pendingRepay).toEqual(pending());
  });

  it("hutang berkurang tapi bacaan dari blok yang sama/lebih tua tidak dianggap bukti", () => {
    const s = state({ pendingRepay: pending() });
    const sesudah = reconcilePendingRepay(s, {
      ...POS,
      blockNumber: POS.blockNumber,
      debtBase: POS.debtBase - 1n,
    });

    expect(sesudah.pendingRepay).toEqual(pending());
  });

  it("tanpa catatan menggantung, state dikembalikan apa adanya", () => {
    const s = state();
    expect(reconcilePendingRepay(s, POS)).toBe(s);
  });

  it("executeDecision merekonsiliasi sendiri sebelum aturan apa pun, lalu boleh mengirim lagi", async () => {
    const d = decisionWith("PARTIAL_REPAY", 10_000_000_000n);
    const s = state({ pendingRepay: pending(), lastActionAt: 0 });
    const posBaru: Position = {
      ...POS,
      blockNumber: POS.blockNumber + 1n,
      debtBase: POS.debtBase - 500_000_000n,
    };
    const dep = deps();

    const result = await executeDecision(d, posBaru, limits(), s, dep);

    expect(result.sent).toBe(true);
    expect(result.state.pendingRepay).toBeNull();
    expect(dep.sendRepay).toHaveBeenCalledOnce();
  });
});

describe("clearPendingRepay", () => {
  it("jalan keluar operator: catatan dibuang, anggaran yang sudah terpotong tidak dikembalikan", () => {
    const s = state({ spentTodayUsd8: 10_000_000_000n, pendingRepay: pending() });
    const sesudah = clearPendingRepay(s);

    expect(sesudah.pendingRepay).toBeNull();
    expect(sesudah.spentTodayUsd8).toBe(10_000_000_000n);
  });
});
