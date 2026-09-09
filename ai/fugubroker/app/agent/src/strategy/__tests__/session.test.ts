/**
 * The boundary around the delegated key.
 *
 * The single most expensive mistake available in this file is an empty list of allowed
 * methods, because in this wallet an empty list means UNLIMITED permission rather than
 * "nothing is allowed". A test that only checked "a key with no entries cannot pay" would
 * pass against a key that can do anything, so the first test below asserts the refusal
 * explicitly.
 *
 * Nothing here touches a network. The sending function is injected, which is what lets
 * every rule be checked without money and without a chain.
 */
import { describe, expect, it, vi } from "vitest";
import {
  APPROVE_SIGNATURE,
  SUBSCRIBE_SIGNATURE,
  SessionPermissionError,
  assertBoundedAllowlist,
  assertNativeSpendCap,
  assertTokenSpendCap,
  createSessionHire,
  requiredSessionCalls,
  type SessionCall,
  type SessionPermissions,
  type SessionSendResult,
} from "../chain/session.js";
import { WAD } from "../types.js";
import type { PaymentIntent } from "../plan.js";

const SUBSCRIPTION = "0xfdb083371f44Cf53181350389D3217e51B431776" as const;
const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as const;
const WALLET = "0x1111111111111111111111111111111111111111" as const;

function goodPermissions(over: Partial<SessionPermissions> = {}): SessionPermissions {
  return {
    calls: requiredSessionCalls(SUBSCRIPTION, USDT),
    spend: [
      { limit: 20_000_000_000_000_000n, period: "day" },
      { limit: 5n * WAD, period: "day", token: USDT },
    ],
    ...over,
  };
}

function intent(over: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    listingId: 4n,
    periods: 30n,
    payToken: USDT,
    maxAmountWad: 1_515n * WAD / 1_000n,
    deadlineUnix: 1_800_000_300n,
    quotedAmountWad: 150n * WAD / 100n,
    totalUsd8: 150_000_000n,
    slippageBps: 100n,
    ...over,
  };
}

const ok: SessionSendResult = { transactionHash: "0xabc", status: 1 };

/** The injected sender, typed so the recorded arguments can be read back. */
type Sender = (calls: readonly SessionCall[], description: string) => Promise<SessionSendResult>;
const sender = () => vi.fn<Sender>(async () => ok);

describe("the required list of allowed methods", () => {
  it("names exactly two entries, each binding a contract and a method together", () => {
    const calls = requiredSessionCalls(SUBSCRIPTION, USDT);
    expect(calls).toEqual([
      { to: SUBSCRIPTION, signature: SUBSCRIBE_SIGNATURE },
      { to: USDT, signature: APPROVE_SIGNATURE },
    ]);
  });

  it("uses the exact method signature the payment contract declares", () => {
    expect(SUBSCRIBE_SIGNATURE).toBe("subscribe(uint256,uint32,address,uint256,uint256)");
  });
});

describe("assertBoundedAllowlist", () => {
  const required = requiredSessionCalls(SUBSCRIPTION, USDT);

  it("REFUSES an empty list, which in this wallet means unlimited permission", () => {
    expect(() => assertBoundedAllowlist({ calls: [] }, required)).toThrow(/UNLIMITED/);
  });

  it("refuses a missing list, which means the same thing", () => {
    expect(() => assertBoundedAllowlist({}, required)).toThrow(/UNLIMITED/);
    expect(() => assertBoundedAllowlist({ calls: null }, required)).toThrow(/UNLIMITED/);
  });

  it("refuses an entry that names only a contract, so every method on it would be allowed", () => {
    expect(() => assertBoundedAllowlist({ calls: [{ to: SUBSCRIPTION }] }, required)).toThrow(
      /only one side/,
    );
  });

  it("refuses an entry that names only a method, so it would be allowed on any contract", () => {
    expect(() =>
      assertBoundedAllowlist({ calls: [{ signature: APPROVE_SIGNATURE }] }, required),
    ).toThrow(/only one side/);
  });

  it("refuses a key that can do more than this agent needs", () => {
    expect(() =>
      assertBoundedAllowlist(
        { calls: [...required, { to: USDT, signature: "transfer(address,uint256)" }] },
        required,
      ),
    ).toThrow(/more than this agent needs/);
  });

  it("refuses a key that is missing an entry it needs to work at all", () => {
    expect(() => assertBoundedAllowlist({ calls: [required[0]!] }, required)).toThrow(
      /does not allow/,
    );
  });

  it("accepts the exact list, whatever order it is in and whatever case the addresses use", () => {
    expect(() =>
      assertBoundedAllowlist(
        {
          calls: [
            { to: USDT.toUpperCase() as `0x${string}`, signature: APPROVE_SIGNATURE },
            { to: SUBSCRIPTION, signature: SUBSCRIBE_SIGNATURE },
          ],
        },
        required,
      ),
    ).not.toThrow();
  });

  it("says the failure happened before anything was sent", () => {
    try {
      assertBoundedAllowlist({ calls: [] }, required);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SessionPermissionError);
      expect((e as SessionPermissionError).neverSent).toBe(true);
    }
  });
});

describe("assertNativeSpendCap", () => {
  it("refuses a key with no cap on the chain's own coin, which pays for delivery", () => {
    expect(() =>
      assertNativeSpendCap({ spend: [{ limit: WAD, period: "day", token: USDT }] }),
    ).toThrow(/own coin/);
  });

  it("refuses a key with no caps at all", () => {
    expect(() => assertNativeSpendCap({})).toThrow(/no spending caps/);
    expect(() => assertNativeSpendCap({ spend: [] })).toThrow(/no spending caps/);
  });

  it("refuses a cap of zero", () => {
    expect(() => assertNativeSpendCap({ spend: [{ limit: 0n, period: "day" }] })).toThrow(
      /not a positive amount/,
    );
  });
});

describe("assertTokenSpendCap", () => {
  it("refuses to start a payment the cap could never cover", () => {
    expect(() =>
      assertTokenSpendCap(goodPermissions(), USDT, 6n * WAD),
    ).toThrow(/Nothing was sent/);
  });

  it("refuses a token the key may not move at all", () => {
    expect(() =>
      assertTokenSpendCap(goodPermissions(), "0x0000000000000000000000000000000000000dead", WAD),
    ).toThrow(/no spending cap/);
  });

  it("allows an amount exactly on the cap", () => {
    expect(() => assertTokenSpendCap(goodPermissions(), USDT, 5n * WAD)).not.toThrow();
  });
});

describe("createSessionHire", () => {
  it("checks the key when it is built, not when the first payment is attempted", () => {
    const sendCalls = sender();
    expect(() =>
      createSessionHire({
        walletAddress: WALLET,
        subscription: SUBSCRIPTION,
        payToken: USDT,
        permissions: { calls: [] },
        sendCalls,
      }),
    ).toThrow(/UNLIMITED/);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("sends the approval and the payment as one batch, in that order", async () => {
    const sendCalls = sender();
    const pay = createSessionHire({
      walletAddress: WALLET,
      subscription: SUBSCRIPTION,
      payToken: USDT,
      permissions: goodPermissions(),
      sendCalls,
    });
    await pay(intent());

    expect(sendCalls).toHaveBeenCalledTimes(1);
    const [calls] = sendCalls.mock.calls[0]!;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.functionName).toBe("approve");
    expect(calls[0]?.address).toBe(USDT);
    expect(calls[1]?.functionName).toBe("subscribe");
    expect(calls[1]?.address).toBe(SUBSCRIPTION);
  });

  it("approves exactly the ceiling of this one payment, never an open-ended amount", async () => {
    const sendCalls = sender();
    const pay = createSessionHire({
      walletAddress: WALLET,
      subscription: SUBSCRIPTION,
      payToken: USDT,
      permissions: goodPermissions(),
      sendCalls,
    });
    const i = intent();
    await pay(i);
    const [calls] = sendCalls.mock.calls[0]!;
    expect(calls[0]?.args).toEqual([SUBSCRIPTION, i.maxAmountWad]);
  });

  it("passes the ceiling and the deadline through to the payment untouched", async () => {
    const sendCalls = sender();
    const pay = createSessionHire({
      walletAddress: WALLET,
      subscription: SUBSCRIPTION,
      payToken: USDT,
      permissions: goodPermissions(),
      sendCalls,
    });
    const i = intent();
    await pay(i);
    const [calls] = sendCalls.mock.calls[0]!;
    expect(calls[1]?.args).toEqual([i.listingId, 30, USDT, i.maxAmountWad, i.deadlineUnix]);
  });

  it("refuses a payment in a token this key may not pay in, and sends nothing", async () => {
    const sendCalls = sender();
    const pay = createSessionHire({
      walletAddress: WALLET,
      subscription: SUBSCRIPTION,
      payToken: USDT,
      permissions: goodPermissions(),
      sendCalls,
    });
    await expect(pay(intent({ payToken: "0x000000000000000000000000000000000000dEaD" }))).rejects.toThrow(
      /may only pay in/,
    );
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("refuses a payment larger than the key's own cap, and sends nothing", async () => {
    const sendCalls = sender();
    const pay = createSessionHire({
      walletAddress: WALLET,
      subscription: SUBSCRIPTION,
      payToken: USDT,
      permissions: goodPermissions(),
      sendCalls,
    });
    await expect(pay(intent({ maxAmountWad: 6n * WAD }))).rejects.toThrow(/Nothing was sent/);
    expect(sendCalls).not.toHaveBeenCalled();
  });

  it("treats a result that is not a success as a failure, and does not claim it never happened", async () => {
    const pay = createSessionHire({
      walletAddress: WALLET,
      subscription: SUBSCRIPTION,
      payToken: USDT,
      permissions: goodPermissions(),
      sendCalls: async () => ({ transactionHash: "0xdef", status: 0 }),
    });
    try {
      await pay(intent());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SessionPermissionError);
      // It has a transaction hash, so it may have landed. Saying otherwise would invite a
      // caller to pay a second time.
      expect((e as SessionPermissionError).neverSent).toBe(false);
    }
  });
});
