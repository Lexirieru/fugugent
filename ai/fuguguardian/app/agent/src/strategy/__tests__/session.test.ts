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
  it("demands only repay on the pool and approve on the debt token", () => {
    expect(REQUIRED).toEqual([
      { to: POOL, signature: "repay(address,uint256)" },
      { to: MUSD, signature: "approve(address,uint256)" },
    ]);
  });
});

describe("assertBoundedAllowlist", () => {
  it("passes an allowlist exactly equal to what is required", () => {
    expect(() => assertBoundedAllowlist(permissions(), REQUIRED)).not.toThrow();
  });

  it("accepts a different entry order and different address casing", () => {
    const perms: SessionPermissions = {
      calls: [
        { to: MUSD.toLowerCase() as `0x${string}`, signature: APPROVE_SIGNATURE },
        { to: POOL.toUpperCase().replace("0X", "0x") as `0x${string}`, signature: REPAY_SIGNATURE },
      ],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).not.toThrow();
  });

  it("REFUSES an empty `calls` — in Altana that is unlimited permission", () => {
    expect(() => assertBoundedAllowlist(permissions({ calls: [] }), REQUIRED)).toThrow(
      SessionPermissionError,
    );
    expect(() => assertBoundedAllowlist(permissions({ calls: [] }), REQUIRED)).toThrow(
      /UNLIMITED/,
    );
  });

  it("REFUSES a `calls` that is missing entirely", () => {
    expect(() => assertBoundedAllowlist({ spend: [NATIVE_CAP] }, REQUIRED)).toThrow(
      /UNLIMITED/,
    );
  });

  it("REFUSES an entry that binds only the contract with no selector", () => {
    const perms: SessionPermissions = {
      calls: [{ to: POOL }, { to: MUSD, signature: APPROVE_SIGNATURE }],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/binds only one side/);
  });

  it("REFUSES an entry that binds only the selector with no contract", () => {
    const perms: SessionPermissions = {
      calls: [
        { signature: REPAY_SIGNATURE },
        { to: MUSD, signature: APPROVE_SIGNATURE },
      ],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/binds only one side/);
  });

  it("REFUSES an extra entry beyond what is required", () => {
    const perms: SessionPermissions = {
      calls: [
        { to: POOL, signature: REPAY_SIGNATURE },
        { to: MUSD, signature: APPROVE_SIGNATURE },
        { to: MUSD, signature: "transfer(address,uint256)" },
      ],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/outside what this agent needs/);
  });

  it("REFUSES an allowlist missing one of the required entries", () => {
    const perms: SessionPermissions = {
      calls: [{ to: POOL, signature: REPAY_SIGNATURE }],
      spend: [NATIVE_CAP],
    };
    expect(() => assertBoundedAllowlist(perms, REQUIRED)).toThrow(/does not carry/);
  });
});

describe("assertNativeSpendCap", () => {
  it("passes a positive native cap", () => {
    expect(() => assertNativeSpendCap(permissions())).not.toThrow();
  });

  it("REFUSES a session with no spend at all", () => {
    expect(() => assertNativeSpendCap(permissions({ spend: [] }))).toThrow(/native cap/);
  });

  it("REFUSES a session with only a token cap and no native one", () => {
    const perms = permissions({ spend: [{ limit: 100n, period: "day", token: MUSD }] });
    expect(() => assertNativeSpendCap(perms)).toThrow(/native/);
  });

  it("REFUSES a zero native cap", () => {
    const perms = permissions({ spend: [{ limit: 0n, period: "day" }] });
    expect(() => assertNativeSpendCap(perms)).toThrow(/is not a positive number/);
  });
});

describe("createSessionSendRepay", () => {
  it("fails at construction when the session permissions are too loose — before any transaction", () => {
    const sendCalls = vi.fn();
    expect(() => createSessionSendRepay(deps({ permissions: { calls: [] }, sendCalls }))).toThrow(
      SessionPermissionError,
    );
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("sends approve AND repay in ONE atomic batch when the allowance is short", async () => {
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

    const hash = await sendRepay(MUSD, 1_167_000_000n); // $11.67

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

  it("skips approve when the allowance is already enough", async () => {
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

  it("returns the transaction hash of the batch that carries the repay", async () => {
    const repayHash = `0x${"cd".repeat(32)}` as const;
    const sendRepay = createSessionSendRepay(
      deps({ sendCalls: async () => ({ transactionHash: repayHash, status: 1 }) }),
    );

    await expect(sendRepay(MUSD, 100_000_000n)).resolves.toBe(repayHash);
  });

  it("REFUSES an asset outside the session allowlist", async () => {
    const sendCalls = vi.fn();
    const sendRepay = createSessionSendRepay(deps({ sendCalls }));
    await expect(
      sendRepay("0xF380E8B6803aD065EF0567dd20C894a55050737c", 100_000_000n),
    ).rejects.toThrow(SessionPermissionError);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("REFUSES a zero or negative amount without touching the network", async () => {
    const sendCalls = vi.fn();
    const sendRepay = createSessionSendRepay(deps({ sendCalls }));
    await expect(sendRepay(MUSD, 0n)).rejects.toThrow(/is not a positive number/);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("REFUSES a conversion that yields zero token units", async () => {
    const sendCalls = vi.fn();
    const sendRepay = createSessionSendRepay(deps({ toTokenUnits: () => 0n, sendCalls }));
    await expect(sendRepay(MUSD, 100_000_000n)).rejects.toThrow(/there is nothing to repay/);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("fails hard when the repay receipt is not a success", async () => {
    const sendRepay = createSessionSendRepay(
      deps({
        readAllowance: async () => 10n ** 30n,
        sendCalls: async () => ({ transactionHash: `0x${"00".repeat(32)}`, status: 0 }),
      }),
    );
    await expect(sendRepay(MUSD, 100_000_000n)).rejects.toThrow(/did not succeed on chain/);
  });
});

/**
 * This module is the only one that knows where the network boundary lies, so it is the one
 * that declares it via `neverSent`. `execute.ts` reads that declaration to decide whether
 * the budget gets deducted: a marked error = "did not happen", an unmarked error = "may
 * have happened" (see the C2 note in execute.ts). Mis-marking even one of these makes the
 * agent pay twice.
 */
describe("marking the network boundary (neverSent)", () => {
  async function errorFrom(run: () => Promise<unknown>): Promise<SessionPermissionError> {
    const err = await run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SessionPermissionError);
    return err as SessionPermissionError;
  }

  it.each([
    [
      "an asset outside the allowlist",
      () =>
        createSessionSendRepay(deps({ sendCalls: vi.fn() }))(
          "0xF380E8B6803aD065EF0567dd20C894a55050737c",
          100_000_000n,
        ),
    ],
    ["a zero amount", () => createSessionSendRepay(deps({ sendCalls: vi.fn() }))(MUSD, 0n)],
    [
      "a conversion yielding zero units",
      () => createSessionSendRepay(deps({ toTokenUnits: () => 0n, sendCalls: vi.fn() }))(MUSD, 100_000_000n),
    ],
    [
      "the unit conversion throwing",
      () =>
        createSessionSendRepay(
          deps({
            toTokenUnits: () => {
              throw new Error("the price feed cannot be read");
            },
            sendCalls: vi.fn(),
          }),
        )(MUSD, 100_000_000n),
    ],
    [
      "the allowance read throwing",
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
  ])("a failure before sendCalls is marked neverSent (%s)", async (_label, run) => {
    const err = await errorFrom(run as () => Promise<unknown>);
    expect(err.neverSent).toBe(true);
  });

  it("a non-success receipt is NOT marked neverSent — the batch already has a hash", async () => {
    // A stale node reporting the wrong status still leaves a transaction that landed.
    // Marking it "did not happen" would bring the double-pay bug back.
    const err = await errorFrom(() =>
      createSessionSendRepay(
        deps({
          readAllowance: async () => 10n ** 30n,
          sendCalls: async () => ({ transactionHash: `0x${"00".repeat(32)}`, status: 0 }),
        }),
      )(MUSD, 100_000_000n),
    );
    expect(err.neverSent).toBe(false);
  });

  it("a throwing sendCalls (e.g. a receipt timeout) is not marked neverSent at all", async () => {
    const sendRepay = createSessionSendRepay(
      deps({
        sendCalls: async () => {
          throw new Error("waitForTransactionReceipt timed out after 180s");
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
const UNAUTHORIZED_ERROR = `An error occurred while executing calls.

Reason: UnauthorizedCall

Details: UnauthorizedCall(UnauthorizedCall { keyHash: 0x80c191a288a3bdce4585bc1cf3288b3bdecfa1cb237599a36b6c8faa023e558b, target: 0x932e82632e80b06318ca969e33f99a54f1a04b10, data: 0xa9059cbb00000000000000000000000056a2950dde6b1040d1dcc4b4c4fc314bd56efb0e0000000000000000000000000000000000000000000000000000000000000001 })`;

describe("assertSessionDenial", () => {
  it("accepts an UnauthorizedCall denial that names the contract we tried", () => {
    expect(isSessionDenial(new Error(UNAUTHORIZED_ERROR), MUSD)).toBe(true);
    expect(() => assertSessionDenial(new Error(UNAUTHORIZED_ERROR), MUSD, "transfer")).not.toThrow();
  });

  it("REFUSES a network failure as evidence of the session boundary", () => {
    const http502 = new Error("HTTP request failed. Status: 502 Bad Gateway URL: https://testnet-relay.altana.network");
    expect(isSessionDenial(http502, MUSD)).toBe(false);
    expect(() => assertSessionDenial(http502, MUSD, "transfer")).toThrow(/NOT because of the session boundary/);
  });

  it("REFUSES a receipt timeout as evidence of the session boundary", () => {
    const timeout = new Error("Timed out while waiting for transaction to be confirmed.");
    expect(() => assertSessionDenial(timeout, MUSD, "transfer")).toThrow(/NOT because of the session boundary/);
  });

  it("REFUSES a revert from the target contract as evidence of the session boundary", () => {
    const revert = new Error("ERC20InsufficientAllowance(spender: 0xb3e1f06a…, allowance: 0)");
    expect(() => assertSessionDenial(revert, MUSD, "transfer")).toThrow(/NOT because of the session boundary/);
  });

  it("REFUSES an UnauthorizedCall about ANOTHER contract — someone else's denial is not our evidence", () => {
    const other = "0xF380E8B6803aD065EF0567dd20C894a55050737c" as const;
    expect(isSessionDenial(new Error(UNAUTHORIZED_ERROR), other)).toBe(false);
    expect(() => assertSessionDenial(new Error(UNAUTHORIZED_ERROR), other, "approve")).toThrow(
      /does not name the contract/,
    );
  });

  it("handles a thrown value that is not an Error", () => {
    expect(isSessionDenial("boom", MUSD)).toBe(false);
    expect(() => assertSessionDenial(null, MUSD, "transfer")).toThrow(SessionPermissionError);
  });

  it("returns the message as-is so it can be printed as evidence", () => {
    expect(assertSessionDenial(new Error(UNAUTHORIZED_ERROR), MUSD, "transfer")).toBe(
      UNAUTHORIZED_ERROR,
    );
  });
});
