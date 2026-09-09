/**
 * These are not tests of behaviour. They are a lock.
 *
 * The wallet in this agent's marketplace listing cannot be changed once the listing exists,
 * so the one place a mistake would be permanent is a freshly generated address quietly
 * replacing the one already recorded. A test that names the exact value makes that
 * replacement impossible to do by accident: anybody who changes the constant has to change
 * this file too, and at that point they are deciding rather than drifting.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_LABEL,
  AGENT_WALLET,
  CATEGORY_INDEX,
  CATEGORY_NAME,
  LISTING_ID,
  LISTING_TX,
} from "../identity.js";

describe("who this agent is on the blockchain", () => {
  it("uses the wallet already written into its listing, and no other", () => {
    // Read back from the chain on 2026-09-09:
    //   cast call <FuguRegistry> 'getListing(uint256)(...)' 9
    expect(AGENT_WALLET).toBe("0xB92Dd50E84560E719627AcE28b32060dbF0E7083");
  });

  it("is listed under the id and category the rest of the repo agrees on", () => {
    expect(LISTING_ID).toBe(9);
    expect(CATEGORY_INDEX).toBe(8);
    expect(CATEGORY_NAME).toBe("TREASURY");
    expect(AGENT_LABEL).toBe("Fugu Steward");
  });

  it("carries a real address and a real transaction, not a placeholder", () => {
    expect(AGENT_WALLET).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(LISTING_TX).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
