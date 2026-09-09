/**
 * Shared fixtures. One catalog, built to look like the live one.
 *
 * The four listings mirror what is actually registered on BSC testnet today: four
 * capabilities, one listing each, at $0.10 for the one that can act and $0.05 for the
 * three that only advise, all renting in blocks of 120 seconds. Making the fixture look
 * like the real catalog matters, because a rule tuned against invented prices is a rule
 * nobody has tested against the prices it will meet.
 */
import type { CatalogListing, Category } from "../types.js";

export const OWNER_A = "0x1111111111111111111111111111111111111111" as const;
export const OWNER_B = "0x2222222222222222222222222222222222222222" as const;
export const OWNER_C = "0x3333333333333333333333333333333333333333" as const;
export const OWNER_D = "0x4444444444444444444444444444444444444444" as const;
export const SELF_OWNER = "0x9999999999999999999999999999999999999999" as const;

/** $0.05 and $0.10, on the 8-decimal basis, exactly as the live listings are priced. */
export const FIVE_CENTS = 5_000_000n;
export const TEN_CENTS = 10_000_000n;

export function listing(over: Partial<CatalogListing> & { listingId: bigint }): CatalogListing {
  return {
    erc8004AgentId: 8000n + over.listingId,
    owner: OWNER_A,
    agentWallet: OWNER_A,
    category: "YIELD" as Category,
    priceUsd8PerPeriod: FIVE_CENTS,
    periodSeconds: 120n,
    active: true,
    curated: false,
    name: "",
    onchainExecution: false,
    ...over,
  };
}

/** A catalog shaped like the live one: four capabilities, one listing each. */
export function liveLikeCatalog(): CatalogListing[] {
  return [
    listing({
      listingId: 1n,
      owner: OWNER_A,
      agentWallet: OWNER_A,
      category: "HEALTH_FACTOR",
      priceUsd8PerPeriod: TEN_CENTS,
      name: "Fugu Guardian",
      onchainExecution: true,
    }),
    listing({
      listingId: 2n,
      owner: OWNER_B,
      agentWallet: OWNER_B,
      category: "REBALANCING",
      name: "Fugu Rebalancer",
    }),
    listing({
      listingId: 3n,
      owner: OWNER_C,
      agentWallet: OWNER_C,
      category: "GRID",
      name: "Fugu Grid",
    }),
    listing({
      listingId: 4n,
      owner: OWNER_D,
      agentWallet: OWNER_D,
      category: "YIELD",
      name: "Fugu Yield",
    }),
  ];
}
