/**
 * One test per decision rule, named after the rule.
 *
 * Every rule in `decide.ts` is a branch that refuses to sign something, and a branch that
 * refuses is invisible when it breaks: the agent goes on working, it just starts paying
 * for demands it used to put aside. So each rule below has at least one test that FAILS
 * if the rule is deleted, and that claim was checked by deleting each rule in turn and
 * watching the suite go red.
 */
import { describe, expect, it } from "vitest";
import { decidePurchase, windowRemainingUnits, windowUsedBps } from "../decide.js";
import { parsePriceDemand } from "../challenge.js";
import {
  DEFAULT_POLICY,
  PurchaseError,
  WAD,
  type PurchasePolicy,
  type SpendLedger,
} from "../types.js";
import { ONE_CENT, SELLER, SETTLER, USDT_TESTNET, U_TESTNET, demandBody, option } from "./fixtures.js";

function decide(
  options: Record<string, unknown>[] = [option()],
  policy: PurchasePolicy = DEFAULT_POLICY,
  ledger: SpendLedger = { spentUnits: 0n, windowStartedAt: 0n },
  opts: { expectedPayee?: `0x${string}` } = {},
) {
  return decidePurchase(parsePriceDemand(demandBody(options)), policy, ledger, opts);
}

/** The policy with both rails allowed and both tokens known, for the ranking tests. */
const BROAD: PurchasePolicy = {
  ...DEFAULT_POLICY,
  tokens: [
    { address: U_TESTNET, symbol: "U", decimals: 18 },
    { address: USDT_TESTNET, symbol: "USDT", decimals: 18 },
  ],
};

describe("rule SCHEME", () => {
  it("refuses a payment scheme this agent has never read", () => {
    const d = decide([option({ scheme: "upto" })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("SCHEME");
  });

  it("accepts the one scheme that exists on this wire", () => {
    expect(decide().action).toBe("PAY");
  });
});

describe("rule CHAIN", () => {
  it("refuses an option for a different chain, where the money may be real", () => {
    const d = decide([option({ network: "eip155:56" })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("CHAIN");
  });

  it("refuses an option whose chain cannot be read, rather than assuming this one", () => {
    const d = decide([option({ network: "mainnet" })]);
    expect(d.refused[0]?.rule).toBe("CHAIN");
  });

  it("reads the older bare-number spelling as well as the current one", () => {
    expect(decide([option({ network: 97 })]).action).toBe("PAY");
    expect(decide([option({ network: "eip155:97" })]).action).toBe("PAY");
  });
});

describe("rule RAIL", () => {
  it("refuses a way of signing this agent does not use", () => {
    const narrow: PurchasePolicy = { ...DEFAULT_POLICY, rails: ["permit2-exact"] };
    const d = decide([option({ assetTransferMethod: "eip3009" })], narrow);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("RAIL");
  });

  it("refuses an option that does not say what would be signed", () => {
    const d = decide([option({ assetTransferMethod: "something-new" })]);
    expect(d.refused[0]?.rule).toBe("RAIL");
  });

  it("does not read the scheme field as the way of signing, because both rails say exact", () => {
    const eip3009 = parsePriceDemand(demandBody([option({ assetTransferMethod: "eip3009" })]));
    const permit2 = parsePriceDemand(
      demandBody([option({ assetTransferMethod: "permit2-exact", spenderAddress: SETTLER })]),
    );
    expect(eip3009.options[0]?.scheme).toBe(permit2.options[0]?.scheme);
    expect(eip3009.options[0]?.rail).not.toBe(permit2.options[0]?.rail);
  });
});

describe("rule TOKEN", () => {
  it("refuses a token this agent does not pay with", () => {
    const d = decide([option({ asset: USDT_TESTNET })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("TOKEN");
  });

  it("refuses an unreadable token address rather than guessing", () => {
    const d = decide([option({ asset: "not-an-address" })]);
    expect(d.refused[0]?.rule).toBe("TOKEN");
  });

  it("matches a token whatever letter case the hex arrives in", () => {
    // Addresses reach this agent from several sources and their letter case differs
    // between them, while the value does not.
    const d = decide([option({ asset: `0x${U_TESTNET.slice(2).toUpperCase()}` })]);
    expect(d.action).toBe("PAY");
  });

  it("refuses a policy whose token claims six decimals, the mistake that pays ten thousand times over", () => {
    const wrong: PurchasePolicy = {
      ...DEFAULT_POLICY,
      tokens: [{ address: U_TESTNET, symbol: "U", decimals: 6 }],
    };
    expect(() => decide([option()], wrong)).toThrow(/18/);
  });
});

describe("rule PAYEE", () => {
  it("refuses an option that does not say who gets paid", () => {
    const d = decide([option({ payTo: "" })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("PAYEE");
  });

  it("refuses a recipient the caller did not expect", () => {
    const d = decide([option()], DEFAULT_POLICY, { spentUnits: 0n, windowStartedAt: 0n }, {
      expectedPayee: "0x000000000000000000000000000000000000bEEF",
    });
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("PAYEE");
  });

  it("accepts the recipient the caller expected", () => {
    const d = decide([option()], DEFAULT_POLICY, { spentUnits: 0n, windowStartedAt: 0n }, {
      expectedPayee: SELLER,
    });
    expect(d.action).toBe("PAY");
  });
});

describe("rule AMOUNT", () => {
  it("refuses an unreadable amount rather than treating it as free", () => {
    const d = decide([option({ amount: "lots" })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("AMOUNT");
  });

  it("refuses an amount of zero, which is not a price", () => {
    const d = decide([option({ amount: "0" })]);
    expect(d.refused[0]?.rule).toBe("AMOUNT");
  });

  it("reads the older field name as well as the current one", () => {
    const older = option();
    delete (older as Record<string, unknown>).amount;
    (older as Record<string, unknown>).maxAmountRequired = ONE_CENT.toString();
    expect(decide([older]).action).toBe("PAY");
  });
});

describe("rule TIMEOUT_WINDOW", () => {
  it("refuses an authorisation the seller wants to keep usable for too long", () => {
    const d = decide([option({ maxTimeoutSeconds: 3_600 })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("TIMEOUT_WINDOW");
  });

  it("accepts a window exactly on the limit", () => {
    const d = decide([option({ maxTimeoutSeconds: DEFAULT_POLICY.maxTimeoutSeconds })]);
    expect(d.action).toBe("PAY");
  });

  it("signs the shorter of the two windows, so a seller cannot widen it by asking", () => {
    const shorter = decide([option({ maxTimeoutSeconds: 60 })]);
    expect(shorter.chosen?.timeoutSeconds).toBe(60);
    const atLimit = decide([option({ maxTimeoutSeconds: 480 })]);
    expect(atLimit.chosen?.timeoutSeconds).toBe(480);
  });
});

describe("rule PRICE_CAP", () => {
  it("refuses a price above what this agent pays for one call", () => {
    const d = decide([option({ amount: (WAD * 2n).toString() })]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("PRICE_CAP");
  });

  it("accepts a price exactly on the cap", () => {
    const d = decide([option({ amount: DEFAULT_POLICY.maxPricePerCallUnits.toString() })]);
    expect(d.action).toBe("PAY");
  });

  it("is a separate rule from the window, so a first dear call is refused rather than allowed", () => {
    // The window has five whole tokens free, so only the per-call cap can refuse this.
    const d = decide([option({ amount: WAD.toString() })]);
    expect(d.refused[0]?.rule).toBe("PRICE_CAP");
  });
});

describe("rule WINDOW", () => {
  it("refuses once what is left of the window cannot cover this call", () => {
    const ledger: SpendLedger = {
      spentUnits: DEFAULT_POLICY.windowBudgetUnits - ONE_CENT / 2n,
      windowStartedAt: 0n,
    };
    const d = decide([option()], DEFAULT_POLICY, ledger);
    expect(d.action).toBe("REFUSED");
    expect(d.refused[0]?.rule).toBe("WINDOW");
  });

  it("stops altogether once the window is fully spent, whatever the seller offers", () => {
    const ledger: SpendLedger = {
      spentUnits: DEFAULT_POLICY.windowBudgetUnits,
      windowStartedAt: 0n,
    };
    const d = decide([option()], DEFAULT_POLICY, ledger);
    expect(d.action).toBe("WINDOW_EXHAUSTED");
    expect(d.refused).toHaveLength(0);
    expect(d.puffLevel).toBe(4);
  });

  it("tells the two refusals apart, because they need different things from a caller", () => {
    const spent: SpendLedger = { spentUnits: DEFAULT_POLICY.windowBudgetUnits, windowStartedAt: 0n };
    expect(decide([option()], DEFAULT_POLICY, spent).action).toBe("WINDOW_EXHAUSTED");
    expect(decide([option({ asset: USDT_TESTNET })]).action).toBe("REFUSED");
  });

  it("never reports a negative amount left, even after overspending", () => {
    const over: SpendLedger = {
      spentUnits: DEFAULT_POLICY.windowBudgetUnits * 3n,
      windowStartedAt: 0n,
    };
    expect(windowRemainingUnits(over, DEFAULT_POLICY)).toBe(0n);
  });
});

describe("the ranking among options that all passed", () => {
  it("prefers the way of signing this agent listed first", () => {
    const d = decide(
      [
        option({ assetTransferMethod: "eip3009", asset: U_TESTNET }),
        option({ assetTransferMethod: "permit2-exact", asset: USDT_TESTNET, spenderAddress: SETTLER }),
      ],
      BROAD,
    );
    expect(d.chosen?.rail).toBe("permit2-exact");
    expect(d.chosen?.index).toBe(1);
  });

  it("prefers the cheaper option when the way of signing is the same", () => {
    const d = decide(
      [
        option({ amount: (ONE_CENT * 3n).toString() }),
        option({ amount: ONE_CENT.toString() }),
      ],
      BROAD,
    );
    expect(d.chosen?.index).toBe(1);
    expect(d.chosen?.amountUnits).toBe(ONE_CENT);
  });

  it("falls back to the seller's own order, so the answer never depends on chance", () => {
    const d = decide([option(), option()], BROAD);
    expect(d.chosen?.index).toBe(0);
  });

  it("gives the same answer twice for the same demand", () => {
    const a = JSON.stringify(decide([option(), option({ asset: USDT_TESTNET })], BROAD), replacer);
    const b = JSON.stringify(decide([option(), option({ asset: USDT_TESTNET })], BROAD), replacer);
    expect(a).toBe(b);
  });
});

describe("a demand with nothing payable in it", () => {
  it("refuses a body that is not a demand at all", () => {
    const d = decidePurchase(parsePriceDemand("nonsense"));
    expect(d.action).toBe("REFUSED");
    expect(d.reason).toContain("Nothing was signed");
  });

  it("refuses a demand with an empty list of ways to pay", () => {
    const d = decide([]);
    expect(d.action).toBe("REFUSED");
    expect(d.refused).toHaveLength(0);
  });

  it("refuses an entry that is not an object, without crashing on it", () => {
    const d = decidePurchase(
      parsePriceDemand({ accepts: [null, 7, "text"] }),
    );
    expect(d.action).toBe("REFUSED");
    expect(d.refused).toHaveLength(3);
  });
});

describe("a policy that could never pay", () => {
  it("refuses one with no tokens", () => {
    expect(() => decide([option()], { ...DEFAULT_POLICY, tokens: [] })).toThrow(PurchaseError);
  });

  it("refuses one with no way of signing", () => {
    expect(() => decide([option()], { ...DEFAULT_POLICY, rails: [] })).toThrow(PurchaseError);
  });

  it("refuses a per-call cap of zero", () => {
    expect(() => decide([option()], { ...DEFAULT_POLICY, maxPricePerCallUnits: 0n })).toThrow(
      PurchaseError,
    );
  });

  it("refuses a window smaller than the per-call cap, where the cap could never bind", () => {
    expect(() =>
      decide([option()], { ...DEFAULT_POLICY, windowBudgetUnits: 1n }),
    ).toThrow(/look like a control/);
  });

  it("refuses an authorisation window of zero, which could never settle", () => {
    expect(() => decide([option()], { ...DEFAULT_POLICY, maxTimeoutSeconds: 0 })).toThrow(
      PurchaseError,
    );
  });

  it("refuses a chain id that is not a chain", () => {
    expect(() => decide([option()], { ...DEFAULT_POLICY, chainId: 0 })).toThrow(PurchaseError);
  });
});

describe("the puff level", () => {
  it("rises with the share of the window the payment would commit", () => {
    const calm = decide();
    const tight = decide([option()], DEFAULT_POLICY, {
      spentUnits: (DEFAULT_POLICY.windowBudgetUnits * 9n) / 10n,
      windowStartedAt: 0n,
    });
    expect(calm.puffLevel).toBe(1);
    expect(tight.puffLevel).toBe(4);
  });

  it("counts the payment about to be made, not only the ones already made", () => {
    const before = windowUsedBps(0n, DEFAULT_POLICY);
    const after = decide().windowUsedBps;
    expect(before).toBe(0n);
    expect(after).toBeGreaterThan(0n);
  });
});

describe("the sentence a caller reads", () => {
  it("names the money and the recipient when it decides to pay", () => {
    const d = decide();
    expect(d.reason).toContain("0.010000");
    expect(d.reason).toContain(SELLER);
  });

  it("says nothing was signed when it refuses", () => {
    for (const d of [
      decide([option({ asset: USDT_TESTNET })]),
      decide([]),
      decide([option()], DEFAULT_POLICY, {
        spentUnits: DEFAULT_POLICY.windowBudgetUnits,
        windowStartedAt: 0n,
      }),
    ]) {
      expect(d.action).not.toBe("PAY");
      expect(d.reason).toContain("Nothing was signed");
    }
  });

  it("never uses an em dash, which the repo owner asked for directly", () => {
    expect(decide().reason).not.toContain("—");
    expect(decide([option({ asset: USDT_TESTNET })]).reason).not.toContain("—");
  });
});

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
