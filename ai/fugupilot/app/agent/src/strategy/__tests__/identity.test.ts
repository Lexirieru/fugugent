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
    //   cast call <FuguRegistry> 'getListing(uint256)(...)' 7
    expect(AGENT_WALLET).toBe("0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D");
  });

  it("is listed under the id and category the rest of the repo agrees on", () => {
    expect(LISTING_ID).toBe(7);
    expect(CATEGORY_INDEX).toBe(6);
    expect(CATEGORY_NAME).toBe("AUTONOMOUS");
    expect(AGENT_LABEL).toBe("Fugu Pilot");
  });

  it("carries a real address and a real transaction, not a placeholder", () => {
    expect(AGENT_WALLET).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(LISTING_TX).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
