import { describe, expect, it, vi } from "vitest";
import {
  APPROVE_SIGNATURE,
  REPAY_SIGNATURE,
  SessionPermissionError,
  assertBoundedAllowlist,
  assertNativeSpendCap,
  assertSessionDenial,
  createSessionSendRepay,
  isSessionDenial,
  requiredSessionCalls,
  type SessionCall,
  type SessionPermissions,
  type SessionRepayDeps,
} from "../chain/session.js";

const POOL = "0xb3e1F06Ac529aded2aA20aA38F4C0b4AD317e5F5" as const;
const MUSD = "0x932E82632E80b06318ca969e33F99A54F1a04b10" as const;
const WALLET = "0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0" as const;
const REQUIRED = requiredSessionCalls(POOL, MUSD);

const NATIVE_CAP = { limit: 20_000_000_000_000_000n, period: "day" } as const;

function permissions(overrides: Partial<SessionPermissions> = {}): SessionPermissions {
  return {
    calls: [
      { to: POOL, signature: REPAY_SIGNATURE },
      { to: MUSD, signature: APPROVE_SIGNATURE },
    ],
    spend: [NATIVE_CAP],
    ...overrides,
  };
}

function deps(overrides: Partial<SessionRepayDeps> = {}): SessionRepayDeps {
  return {
    walletAddress: WALLET,
    pool: POOL,
    repayAsset: MUSD,
    permissions: permissions(),
    // $1.00 (8-decimal basis) = 1 token at 18 decimals, price $1.
    toTokenUnits: (_asset, amountUsd8) => (amountUsd8 * 10n ** 18n) / 100_000_000n,
    readAllowance: async () => 0n,
    sendCalls: async () => ({ transactionHash: `0x${"11".repeat(32)}`, status: 1 }),
    ...overrides,
  };
}

describe("requiredSessionCalls", () => {
  it("hanya menuntut repay di pool dan approve di token hutang", () => {
    expect(REQUIRED).toEqual([
      { to: POOL, signature: "repay(address,uint256)" },
      { to: MUSD, signature: "approve(address,uint256)" },
    ]);
  });
});

describe("assertBoundedAllowlist", () => {
  it("meneruskan allowlist yang persis sama dengan yang dibutuhkan", () => {
    expect(() => assertBoundedAllowlist(permissions(), REQUIRED)).not.toThrow();
  });

  it("menerima urutan entri yang berbeda dan huruf besar/kecil alamat yang berbeda", () => {
    const perms: SessionPermissions = {
      calls: [
        { to: MUSD.toLowerCase() as `0x${string}`, signature: APPROVE_SIGNATURE },
        { to: POOL.toUpperCase().replace("0X", "0x") as `0x${string}`, signature: REPAY_SIGNATURE },
      ],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).not.toThrow();
  });

  it("MENOLAK `calls` kosong — di Altana itu izin tanpa batas", () => {
    expect(() => assertBoundedAllowlist(permissions({ calls: [] }), REQUIRED)).toThrow(
      SessionPermissionError,
    );
    expect(() => assertBoundedAllowlist(permissions({ calls: [] }), REQUIRED)).toThrow(
      /TANPA BATAS/,
    );
  });

  it("MENOLAK `calls` yang hilang sama sekali", () => {
    expect(() => assertBoundedAllowlist({ spend: [NATIVE_CAP] }, REQUIRED)).toThrow(
      /TANPA BATAS/,
    );
  });

  it("MENOLAK entri yang hanya mengikat kontrak tanpa selector", () => {
    const perms: SessionPermissions = {
      calls: [{ to: POOL }, { to: MUSD, signature: APPROVE_SIGNATURE }],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/satu sisi/);
  });

  it("MENOLAK entri yang hanya mengikat selector tanpa kontrak", () => {
    const perms: SessionPermissions = {
      calls: [
        { signature: REPAY_SIGNATURE },
        { to: MUSD, signature: APPROVE_SIGNATURE },
      ],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/satu sisi/);
  });

  it("MENOLAK entri tambahan di luar yang dibutuhkan", () => {
    const perms: SessionPermissions = {
      calls: [
        { to: POOL, signature: REPAY_SIGNATURE },
        { to: MUSD, signature: APPROVE_SIGNATURE },
        { to: MUSD, signature: "transfer(address,uint256)" },
      ],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/di luar yang dibutuhkan/);
  });

  it("MENOLAK allowlist yang kekurangan salah satu entri wajib", () => {
    const perms: SessionPermissions = {
      calls: [{ to: POOL, signature: REPAY_SIGNATURE }],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/tidak memuat/);
  });
});

describe("assertNativeSpendCap", () => {
  it("meneruskan cap native yang positif", () => {
    expect(() => assertNativeSpendCap(permissions())).not.toThrow();
  });

  it("MENOLAK sesi tanpa spend sama sekali", () => {
    expect(() => assertNativeSpendCap(permissions({ spend: [] }))).toThrow(/cap native/);
  });

  it("MENOLAK sesi yang hanya punya cap token, tanpa native", () => {
    const perms = permissions({ spend: [{ limit: 100n, period: "day", token: MUSD }] });
    expect(() => assertNativeSpendCap(perms)).toThrow(/native/);
  });

  it("MENOLAK cap native nol", () => {
    const perms = permissions({ spend: [{ limit: 0n, period: "day" }] });
    expect(() => assertNativeSpendCap(perms)).toThrow(/bukan angka positif/);
  });
});

describe("createSessionSendRepay", () => {
  it("gagal saat konstruksi bila izin sesi terlalu longgar — sebelum transaksi apa pun", () => {
    const sendCalls = vi.fn();
    expect(() => createSessionSendRepay(deps({ permissions: { calls: [] }, sendCalls }))).toThrow(
      SessionPermissionError,
    );
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("mengirim approve DAN repay dalam SATU batch atomik saat allowance kurang", async () => {
    const batches: (readonly SessionCall[])[] = [];
    const hashBatch = `0x${"22".repeat(32)}` as const;
    const sendRepay = createSessionSendRepay(
      deps({
        readAllowance: async () => 0n,
        sendCalls: async (calls) => {
          batches.push(calls);
          return { transactionHash: hashBatch, status: 1 };
        },
      }),
    );

    const hash = await sendRepay(MUSD, 1_167_000_000n); // $11,67

    // ONE batch, not two transactions: Porto's guarded executor returns the allowance to
    // zero at the end of the userOp, so approve has to travel with repay.
    expect(batches).toHaveLength(1);
    const calls = batches[0]!;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.address).toBe(MUSD);
    expect(calls[0]?.functionName).toBe("approve");
    expect(calls[0]?.args).toEqual([POOL, 11_670_000_000_000_000_000n]);
    expect(calls[1]?.address).toBe(POOL);
    expect(calls[1]?.functionName).toBe("repay");
    expect(calls[1]?.args).toEqual([MUSD, 11_670_000_000_000_000_000n]);
    expect(hash).toBe(hashBatch);
  });

  it("melewati approve saat allowance sudah cukup", async () => {
    const batches: (readonly SessionCall[])[] = [];
    const sendRepay = createSessionSendRepay(
      deps({
        readAllowance: async () => 10n ** 30n,
        sendCalls: async (calls) => {
          batches.push(calls);
          return { transactionHash: `0x${"ab".repeat(32)}`, status: 1 };
        },
      }),
    );

    await sendRepay(MUSD, 100_000_000n);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]?.[0]?.functionName).toBe("repay");
  });

  it("mengembalikan hash transaksi batch yang memuat repay", async () => {
    const repayHash = `0x${"cd".repeat(32)}` as const;
    const sendRepay = createSessionSendRepay(
      deps({ sendCalls: async () => ({ transactionHash: repayHash, status: 1 }) }),
    );

    await expect(sendRepay(MUSD, 100_000_000n)).resolves.toBe(repayHash);
  });

  it("MENOLAK aset di luar yang di-allowlist sesi", async () => {
    const sendCalls = vi.fn();
    const sendRepay = createSessionSendRepay(deps({ sendCalls }));
    await expect(
      sendRepay("0xF380E8B6803aD065EF0567dd20C894a55050737c", 100_000_000n),
    ).rejects.toThrow(SessionPermissionError);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("MENOLAK jumlah nol atau negatif tanpa menyentuh jaringan", async () => {
    const sendCalls = vi.fn();
    const sendRepay = createSessionSendRepay(deps({ sendCalls }));
    await expect(sendRepay(MUSD, 0n)).rejects.toThrow(/bukan angka positif/);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("MENOLAK konversi yang menghasilkan nol unit token", async () => {
    const sendCalls = vi.fn();
    const sendRepay = createSessionSendRepay(deps({ toTokenUnits: () => 0n, sendCalls }));
    await expect(sendRepay(MUSD, 100_000_000n)).rejects.toThrow(/tidak ada yang bisa dibayar/);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("gagal keras bila receipt repay bukan sukses", async () => {
    const sendRepay = createSessionSendRepay(
      deps({
        readAllowance: async () => 10n ** 30n,
        sendCalls: async () => ({ transactionHash: `0x${"00".repeat(32)}`, status: 0 }),
      }),
    );
    await expect(sendRepay(MUSD, 100_000_000n)).rejects.toThrow(/tidak sukses di rantai/);
  });
});

/**
 * This module is the only one that knows where the network boundary lies, so it is the one
 * that declares it via `neverSent`. `execute.ts` reads that declaration to decide whether
 * the budget gets deducted: a marked error = "did not happen", an unmarked error = "may
 * have happened" (see the C2 note in execute.ts). Mis-marking even one of these makes the
 * agent pay twice.
 */
describe("penandaan batas jaringan (neverSent)", () => {
  async function galatDari(jalankan: () => Promise<unknown>): Promise<SessionPermissionError> {
    const err = await jalankan().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionPermissionError);
    return err as SessionPermissionError;
  }

  it.each([
    [
      "aset di luar allowlist",
      () =>
        createSessionSendRepay(deps({ sendCalls: vi.fn() }))(
          "0xF380E8B6803aD065EF0567dd20C894a55050737c",
          100_000_000n,
        ),
    ],
    ["jumlah nol", () => createSessionSendRepay(deps({ sendCalls: vi.fn() }))(MUSD, 0n)],
    [
      "konversi menghasilkan nol unit",
      () => createSessionSendRepay(deps({ toTokenUnits: () => 0n, sendCalls: vi.fn() }))(MUSD, 100_000_000n),
    ],
    [
      "konversi satuan melempar",
      () =>
        createSessionSendRepay(
          deps({
            toTokenUnits: () => {
              throw new Error("feed harga tidak bisa dibaca");
            },
            sendCalls: vi.fn(),
          }),
        )(MUSD, 100_000_000n),
    ],
    [
      "pembacaan allowance melempar",
      () =>
        createSessionSendRepay(
          deps({
            readAllowance: async () => {
              throw new Error("RPC 502");
            },
            sendCalls: vi.fn(),
          }),
        )(MUSD, 100_000_000n),
    ],
  ])("kegagalan sebelum sendCalls ditandai neverSent (%s)", async (_label, jalankan) => {
    const err = await galatDari(jalankan as () => Promise<unknown>);
    expect(err.neverSent).toBe(true);
  });

  it("receipt yang bukan sukses TIDAK ditandai neverSent — batch sudah punya hash", async () => {
    // A stale node reporting the wrong status still leaves a transaction that landed.
    // Marking it "did not happen" would bring the double-pay bug back.
    const err = await galatDari(() =>
      createSessionSendRepay(
        deps({
          readAllowance: async () => 10n ** 30n,
          sendCalls: async () => ({ transactionHash: `0x${"00".repeat(32)}`, status: 0 }),
        }),
      )(MUSD, 100_000_000n),
    );
    expect(err.neverSent).toBe(false);
  });

  it("sendCalls yang melempar (mis. receipt timeout) tidak ditandai neverSent sama sekali", async () => {
    const sendRepay = createSessionSendRepay(
      deps({
        sendCalls: async () => {
          throw new Error("waitForTransactionReceipt timeout setelah 180s");
        },
      }),
    );
    const err = await sendRepay(MUSD, 100_000_000n).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as { neverSent?: unknown }).neverSent).not.toBe(true);
  });
});

/**
 * The denial error the Altana relay ACTUALLY returned on the 2026-09-08 run (copied verbatim
 * from `probe-session-boundary.ts`'s output). Used as-is so this test exercises the real
 * shape rather than the shape we imagine.
 */
const GALAT_UNAUTHORIZED = `An error occurred while executing calls.

Reason: UnauthorizedCall

Details: UnauthorizedCall(UnauthorizedCall { keyHash: 0x80c191a288a3bdce4585bc1cf3288b3bdecfa1cb237599a36b6c8faa023e558b, target: 0x932e82632e80b06318ca969e33f99a54f1a04b10, data: 0xa9059cbb00000000000000000000000056a2950dde6b1040d1dcc4b4c4fc314bd56efb0e0000000000000000000000000000000000000000000000000000000000000001 })`;

describe("assertSessionDenial", () => {
  it("menerima penolakan UnauthorizedCall yang menyebut kontrak yang dicoba", () => {
    expect(isSessionDenial(new Error(GALAT_UNAUTHORIZED), MUSD)).toBe(true);
    expect(() => assertSessionDenial(new Error(GALAT_UNAUTHORIZED), MUSD, "transfer")).not.toThrow();
  });

  it("MENOLAK kegagalan jaringan sebagai bukti batas sesi", () => {
    const http502 = new Error("HTTP request failed. Status: 502 Bad Gateway URL: https://testnet-relay.altana.network");
    expect(isSessionDenial(http502, MUSD)).toBe(false);
    expect(() => assertSessionDenial(http502, MUSD, "transfer")).toThrow(/BUKAN karena batas sesi/);
  });

  it("MENOLAK timeout receipt sebagai bukti batas sesi", () => {
    const timeout = new Error("Timed out while waiting for transaction to be confirmed.");
    expect(() => assertSessionDenial(timeout, MUSD, "transfer")).toThrow(/BUKAN karena batas sesi/);
  });

  it("MENOLAK revert kontrak tujuan sebagai bukti batas sesi", () => {
    const revert = new Error("ERC20InsufficientAllowance(spender: 0xb3e1f06a…, allowance: 0)");
    expect(() => assertSessionDenial(revert, MUSD, "transfer")).toThrow(/BUKAN karena batas sesi/);
  });

  it("MENOLAK UnauthorizedCall atas kontrak LAIN — penolakan orang lain bukan bukti kita", () => {
    const lain = "0xF380E8B6803aD065EF0567dd20C894a55050737c" as const;
    expect(isSessionDenial(new Error(GALAT_UNAUTHORIZED), lain)).toBe(false);
    expect(() => assertSessionDenial(new Error(GALAT_UNAUTHORIZED), lain, "approve")).toThrow(
      /tidak menyebut kontrak/,
    );
  });

  it("menangani nilai yang dilempar bukan Error", () => {
    expect(isSessionDenial("boom", MUSD)).toBe(false);
    expect(() => assertSessionDenial(null, MUSD, "transfer")).toThrow(SessionPermissionError);
  });

  it("mengembalikan pesan apa adanya untuk dicetak sebagai bukti", () => {
    expect(assertSessionDenial(new Error(GALAT_UNAUTHORIZED), MUSD, "transfer")).toBe(
      GALAT_UNAUTHORIZED,
    );
  });
});
