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
    // $1,00 (basis 8 desimal) = 1 token 18 desimal, harga $1.
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

    // SATU batch, bukan dua transaksi: guarded executor Porto mengembalikan
    // allowance ke nol di akhir userOp, jadi approve harus menyatu dengan repay.
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
 * Galat penolakan yang BENAR-BENAR dikembalikan relay Altana pada jalan
 * 2026-09-08 (disalin verbatim dari keluaran `probe-session-boundary.ts`).
 * Dipakai apa adanya supaya test ini menguji bentuk yang nyata, bukan bentuk
 * yang kita bayangkan.
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
