/**
 * The venue list is a claim about the real network, so these tests check two different
 * things: that the list is internally honest (nothing marked live without evidence, nothing
 * marked absent while still carrying addresses to act on), and that the refusal is a real
 * refusal rather than a comment.
 *
 * The addresses themselves were checked live against chain id 97; the evidence strings in
 * `venues.ts` record exactly what was read back. No test here touches the network, because
 * a test that needs an RPC is a test that fails on a plane.
 */
import { describe, expect, it } from "vitest";
import {
  assertVenueUsable,
  CHAIN_ID,
  findVenue,
  liveVenues,
  RPC_URL,
  unusableVenues,
  VENUES,
  VenueUnavailableError,
} from "../venues.js";

describe("the venue list", () => {
  it("is checked against BNB Chain testnet through the RPC the repo mandates", () => {
    expect(CHAIN_ID).toBe(97);
    expect(RPC_URL).toBe("https://data-seed-prebsc-1-s1.bnbchain.org:8545");
    // The SDK default uses a domain that is blocked from Indonesia. Rule 3 of the repo.
    expect(RPC_URL).not.toContain("binance.org");
  });

  it("gives every entry at least two pieces of evidence, live or not", () => {
    for (const venue of VENUES) {
      expect(venue.evidence.length, `${venue.id} has too little evidence`).toBeGreaterThanOrEqual(2);
      for (const line of venue.evidence) {
        expect(line.length, `${venue.id} has an empty evidence line`).toBeGreaterThan(20);
      }
    }
  });

  it("never marks a venue live without addresses and never leaves addresses on one that is not", () => {
    for (const venue of VENUES) {
      if (venue.status === "live") {
        expect(Object.keys(venue.addresses).length, `${venue.id}`).toBeGreaterThan(0);
        expect(venue.capabilities.length, `${venue.id}`).toBeGreaterThan(0);
      } else {
        // An address left on an unusable venue is an invitation to use it anyway.
        expect(Object.keys(venue.addresses), `${venue.id}`).toEqual([]);
        expect(venue.capabilities, `${venue.id}`).toEqual([]);
        expect(venue.note, `${venue.id} needs to say why in plain words`).toBeTruthy();
      }
    }
  });

  it("carries the three that were proven to answer and the two that were not", () => {
    expect(liveVenues().map((v) => v.id).sort()).toEqual([
      "lista-liquid-staking",
      "pancakeswap-v3",
      "venus",
    ]);
    expect(unusableVenues().map((v) => v.id).sort()).toEqual(["aave-v3", "lista-lending"]);
  });

  it("records Aave as absent rather than quietly leaving it out", () => {
    // Leaving it out entirely would hide the fact that the product names four protocols and
    // one of them has nowhere to run.
    const aave = findVenue("aave-v3");
    expect(aave?.status).toBe("absent");
    expect(aave?.note).toContain("no Aave market on BNB Chain testnet");
  });

  it("records Lista lending as not checked rather than as working", () => {
    const lending = findVenue("lista-lending");
    expect(lending?.status).toBe("unverified");
    // Lista's staking side WAS proven, and the two must not be confused for each other.
    expect(findVenue("lista-liquid-staking")?.status).toBe("live");
  });

  it("uses the addresses the repo already verified for PancakeSwap", () => {
    const pancake = findVenue("pancakeswap-v3");
    expect(pancake?.addresses.factory).toBe("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
    // The position manager pointing back at that same factory is what makes it evidence.
    expect(pancake?.evidence[0]).toContain("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
  });
});

describe("refusing a venue that cannot be reached", () => {
  it("lets a live venue with the right capability through", () => {
    expect(assertVenueUsable("pancakeswap-v3", "swap").id).toBe("pancakeswap-v3");
    expect(assertVenueUsable("venus", "borrow").id).toBe("venus");
    expect(assertVenueUsable("lista-liquid-staking", "stake").id).toBe("lista-liquid-staking");
  });

  it("refuses a venue with no contract on this network", () => {
    // MONEY SAFETY RULE P1. Removing the `venue.status !== "live"` branch in
    // assertVenueUsable makes this test fail.
    expect(() => assertVenueUsable("aave-v3", "lend")).toThrow(VenueUnavailableError);
    expect(() => assertVenueUsable("aave-v3", "lend")).toThrow(/cannot be used on this network/);
  });

  it("refuses a venue nobody checked, exactly as firmly as one known to be missing", () => {
    // "We did not look" is not a reason to send money somewhere.
    expect(() => assertVenueUsable("lista-lending", "lend")).toThrow(VenueUnavailableError);
  });

  it("refuses a name that is not in the list at all, and says what is", () => {
    try {
      assertVenueUsable("compound", "lend");
      expect.unreachable("a venue that is not in the list must be refused");
    } catch (err) {
      expect(err).toBeInstanceOf(VenueUnavailableError);
      expect((err as Error).message).toContain("pancakeswap-v3");
    }
  });

  it("refuses a live venue asked to do something it does not do", () => {
    // PancakeSwap answers, but it is not where a loan comes from.
    expect(() => assertVenueUsable("pancakeswap-v3", "borrow")).toThrow(/does not do "borrow"/);
  });

  it("marks the refusal as never sent, so no budget is ever charged for it", () => {
    try {
      assertVenueUsable("aave-v3", "lend");
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as { neverSent?: boolean }).neverSent).toBe(true);
    }
  });
});
