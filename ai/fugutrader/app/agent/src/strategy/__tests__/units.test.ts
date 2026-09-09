/**
 * The units, the parser, and the way numbers are written out.
 *
 * Small tests guarding the largest mistakes here. A wrong decimal count does not produce
 * a wrong-looking number, it produces a plausible one that is off by four orders of
 * magnitude, and everything around it keeps working.
 */
import { describe, expect, it } from "vitest";
import { BPS_ONE, PurchaseError, WAD, assertToken18, puffFromWindowBps } from "../types.js";
import { formatBps, formatDuration, formatShare, formatToken18 } from "../format.js";
import {
  parsePriceDemand,
  readAmount,
  readChainId,
  readRail,
  readResourceUrl,
} from "../challenge.js";
import { ONE_CENT, SELLER, SETTLER, U_TESTNET, demandBody, option } from "./fixtures.js";

describe("the units", () => {
  it("uses 18 decimals, because every token on this network has 18", () => {
    expect(WAD).toBe(1_000_000_000_000_000_000n);
    expect(BPS_ONE).toBe(10_000n);
  });

  it("refuses a token configured with the six decimals it has on another chain", () => {
    expect(() => assertToken18({ address: U_TESTNET, symbol: "USDT", decimals: 6 })).toThrow(
      PurchaseError,
    );
    expect(() => assertToken18({ address: U_TESTNET, symbol: "U", decimals: 18 })).not.toThrow();
  });
});

describe("puffFromWindowBps", () => {
  it("keeps the calm shape for nothing committed only", () => {
    expect(puffFromWindowBps(0n)).toBe(0);
    expect(puffFromWindowBps(1n)).toBe(1);
  });

  it("rises through even quarters and stops at four", () => {
    expect(puffFromWindowBps(2_499n)).toBe(1);
    expect(puffFromWindowBps(2_500n)).toBe(2);
    expect(puffFromWindowBps(5_000n)).toBe(3);
    expect(puffFromWindowBps(7_500n)).toBe(4);
    expect(puffFromWindowBps(99_999n)).toBe(4);
  });
});

describe("the formatters", () => {
  it("writes a token amount with six decimals, truncating rather than rounding up", () => {
    expect(formatToken18(WAD)).toBe("1.000000");
    expect(formatToken18(ONE_CENT)).toBe("0.010000");
    expect(formatToken18(1n)).toBe("0.000000");
  });

  it("writes shares and basis points without disagreeing with each other", () => {
    expect(formatBps(50n)).toBe("50 bps");
    expect(formatShare(2_500n)).toBe("25.0%");
  });

  it("writes a length of time the way a person would say it", () => {
    expect(formatDuration(480n)).toBe("8 minutes");
    expect(formatDuration(0n)).toBe("0 seconds");
  });
});

describe("readChainId", () => {
  it("reads the current spelling", () => {
    expect(readChainId("eip155:97", undefined)).toBe(97);
  });

  it("reads the older bare-number spelling from either field", () => {
    expect(readChainId(97, undefined)).toBe(97);
    expect(readChainId(undefined, "97")).toBe(97);
  });

  it("returns nothing rather than a guess for anything else", () => {
    expect(readChainId("mainnet", undefined)).toBeNull();
    expect(readChainId(undefined, undefined)).toBeNull();
    expect(readChainId("eip155:", undefined)).toBeNull();
  });
});

describe("readRail", () => {
  it("reads the two ways of signing that exist, and nothing else", () => {
    expect(readRail({ assetTransferMethod: "eip3009" })).toBe("eip3009");
    expect(readRail({ assetTransferMethod: "permit2-exact" })).toBe("permit2-exact");
    expect(readRail({ assetTransferMethod: "something" })).toBeNull();
    expect(readRail(null)).toBeNull();
  });
});

describe("readAmount", () => {
  it("reads both field names that are in use", () => {
    expect(readAmount({ amount: "100" })).toBe(100n);
    expect(readAmount({ maxAmountRequired: "100" })).toBe(100n);
  });

  it("returns nothing rather than zero for a value it cannot read", () => {
    // Zero would read as free, which is the one wrong answer that looks like an answer.
    expect(readAmount({ amount: "lots" })).toBeNull();
    expect(readAmount({})).toBeNull();
    expect(readAmount({ amount: -5 })).toBeNull();
  });
});

describe("readResourceUrl", () => {
  it("reads both shapes sellers use", () => {
    expect(readResourceUrl({ resource: { url: "https://a.test" } })).toBe("https://a.test");
    expect(readResourceUrl({ resource: "https://a.test" })).toBe("https://a.test");
    expect(readResourceUrl({})).toBeNull();
  });
});

describe("parsePriceDemand", () => {
  it("keeps the seller's own wording for each option, so it can be repeated back verbatim", () => {
    const body = demandBody([option()]);
    const parsed = parsePriceDemand(body);
    expect(parsed.options[0]?.raw).toBe((body.accepts as unknown[])[0]);
  });

  it("keeps the token's signing name and version, which belong to the token and not the seller", () => {
    const parsed = parsePriceDemand(demandBody([option()]));
    expect(parsed.options[0]?.tokenName).toBe("United Stables");
    expect(parsed.options[0]?.tokenVersion).toBe("1");
  });

  it("reads the settling address under either of its two names", () => {
    const modern = parsePriceDemand(
      demandBody([option({ assetTransferMethod: "permit2-exact", spenderAddress: SETTLER })]),
    );
    expect(modern.options[0]?.spender).toBe(SETTLER);
  });

  it("turns a body that is not a demand into no options at all, and does not throw", () => {
    for (const body of [null, "text", 7, [], { accepts: "not-a-list" }]) {
      expect(parsePriceDemand(body).options).toHaveLength(0);
    }
  });

  it("gives every unreadable field a null rather than a default", () => {
    const parsed = parsePriceDemand({ accepts: [{}] });
    const first = parsed.options[0]!;
    expect(first.amount).toBeNull();
    expect(first.asset).toBeNull();
    expect(first.payTo).toBeNull();
    expect(first.rail).toBeNull();
    expect(first.chainId).toBeNull();
  });

  it("reads a well-formed demand completely", () => {
    const parsed = parsePriceDemand(demandBody());
    expect(parsed.resourceUrl).toBe("https://api.hellofugu.xyz/quote");
    expect(parsed.options[0]).toMatchObject({
      index: 0,
      scheme: "exact",
      chainId: 97,
      rail: "eip3009",
      asset: U_TESTNET,
      payTo: SELLER,
      amount: ONE_CENT,
      maxTimeoutSeconds: 300,
    });
  });
});
