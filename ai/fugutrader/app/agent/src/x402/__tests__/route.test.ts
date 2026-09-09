/**
 * Switching the selling half on, and refusing to switch it on half way.
 *
 * The failure being guarded against is a seller that starts, demands payment from every
 * caller, and then rejects every payment because something it needed was missing. A buyer
 * cannot tell that apart from a seller that is simply expensive, so they keep trying. It
 * has to fail at start, loudly, or not start at all.
 */
import { describe, expect, it } from "vitest";
import { FUGU_X402_PATH, SellerConfigError, buildX402Seller } from "../route.js";

const KEY = `0x${"11".repeat(32)}`;
const PAY_TO = "0x1B82F72346a8553a968fafD6AC07A21d4A88589f";

function env(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    FUGU_X402_SELLER_ENABLED: "1",
    FUGU_X402_PAY_TO: PAY_TO,
    FUGU_X402_FACILITATOR_KEY: KEY,
    ...over,
  } as NodeJS.ProcessEnv;
}

describe("buildX402Seller", () => {
  it("is switched off unless it is switched on explicitly", () => {
    expect(buildX402Seller({} as NodeJS.ProcessEnv)).toBeNull();
    expect(buildX402Seller({ FUGU_X402_SELLER_ENABLED: "0" } as NodeJS.ProcessEnv)).toBeNull();
    expect(buildX402Seller({ FUGU_X402_SELLER_ENABLED: "true" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses to start without an address to be paid at", () => {
    const missing = env();
    delete missing.FUGU_X402_PAY_TO;
    expect(() => buildX402Seller(missing)).toThrow(SellerConfigError);
  });

  it("refuses to start without the key that pays for delivering the settlement", () => {
    const missing = env();
    delete missing.FUGU_X402_FACILITATOR_KEY;
    expect(() => buildX402Seller(missing)).toThrow(SellerConfigError);
  });

  it("refuses a price of zero, which is a free route wearing a paid route's clothes", () => {
    expect(() => buildX402Seller(env({ FUGU_X402_PRICE_UNITS: "0" }))).toThrow(SellerConfigError);
  });

  it("charges one cent by default, which is what this project's own listing charges", () => {
    const seller = buildX402Seller(env());
    expect(seller?.config.price).toBe(10n ** 16n);
  });

  it("sets a ceiling equal to the price, so an overpayment is refused rather than kept", () => {
    const seller = buildX402Seller(env({ FUGU_X402_PRICE_UNITS: "12345" }));
    expect(seller?.config.maxPrice).toBe(12_345n);
    expect(seller?.config.price).toBe(12_345n);
  });

  it("offers a token with 18 decimals, and only on the testnet chain", () => {
    const seller = buildX402Seller(env());
    expect(seller?.config.chainId).toBe(97);
    expect(seller?.config.rails[0]?.token.decimals).toBe(18);
  });

  it("keeps the authorisation window inside what buyers accept in practice", () => {
    const seller = buildX402Seller(env());
    expect(seller?.config.maxTimeoutSeconds).toBeLessThanOrEqual(480);
  });

  it("does not sit on the path the scaffold's own seller claims", () => {
    expect(FUGU_X402_PATH).not.toBe("/x402");
  });

  it("advertises the price without a payment, so a buyer can look before calling", () => {
    const seller = buildX402Seller(env());
    const body = seller?.merchant.demand();
    expect((body as { accepts: unknown[] }).accepts).toHaveLength(1);
  });
});
