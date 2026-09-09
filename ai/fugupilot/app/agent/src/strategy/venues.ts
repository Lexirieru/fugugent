/**
 * The venue registry: which lending, swapping and staking places Fugu Pilot is actually
 * allowed to touch on BNB Chain testnet, and which ones it is not.
 *
 * ## Why this file exists at all
 *
 * The product brief lists four protocols for Pilot: Aave, Venus, PancakeSwap, Lista. Three
 * of those four have something live on BNB Chain testnet and one does not. An agent that
 * carries a pretty list of four names and then fails on the fourth at the moment money is
 * involved has lied to its user. So the list below records, for every venue, whether it was
 * checked on the real network, what was read back, and what the answer proves.
 *
 * The same reasoning already produced `MockLendingPool` for Fugu Guardian: when a real
 * protocol is not reachable on testnet, the repo says so out loud instead of quietly
 * pointing at a mainnet address that will never answer.
 *
 * ## How each entry was checked
 *
 * Every address below was queried on chain id 97 through
 * `https://data-seed-prebsc-1-s1.bnbchain.org:8545` on 2026-09-09. Two kinds of evidence
 * are recorded, and only the second one counts as proof:
 *
 *   1. the address has contract code at all, and
 *   2. a second, independent contract agrees with it. A contract can be any 24 kilobytes of
 *      bytes; a pair of contracts that point at each other, or two numbers from different
 *      contracts that multiply out to the same total, cannot be faked by accident.
 *
 * `evidence` below is written out in full so a reader can rerun the exact call.
 *
 * ## What the code does with it
 *
 * `assertVenueUsable` refuses to plan anything on a venue whose status is not `live`. That
 * refusal is a money-safety rule, not documentation: a planner that quietly skips an
 * unreachable venue produces a plan that looks complete and is not.
 */

/** How sure we are that a venue can be used from this agent, on this network. */
export type VenueStatus =
  /** Checked on the network and answering, with a second contract agreeing. */
  | "live"
  /** Checked on the network. There is no contract at the address at all. */
  | "absent"
  /** Not checked, or checked and inconclusive. Treated exactly like absent. */
  | "unverified";

/** What a venue lets Pilot do. One venue can offer more than one. */
export type VenueCapability = "swap" | "lend" | "borrow" | "stake";

export interface Venue {
  readonly id: string;
  /** The name a person reads on the agent card. */
  readonly label: string;
  readonly status: VenueStatus;
  readonly capabilities: readonly VenueCapability[];
  /** Addresses that were checked. Empty when the venue is absent. */
  readonly addresses: Readonly<Record<string, `0x${string}`>>;
  /** The exact reads that were run, and what came back. */
  readonly evidence: readonly string[];
  /** For anything other than `live`: why it is not usable, in plain words. */
  readonly note?: string;
}

/** The chain every entry below was checked against. */
export const CHAIN_ID = 97;

/** The RPC used for every check. The SDK default is blocked from Indonesia. */
export const RPC_URL = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";

/** The date every entry below was checked. */
export const VERIFIED_AT = "2026-09-09";

export const VENUES: readonly Venue[] = [
  {
    id: "pancakeswap-v3",
    label: "PancakeSwap v3",
    status: "live",
    capabilities: ["swap"],
    addresses: {
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      positionManager: "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
      smartRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
      quoterV2: "0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2",
      poolWbnbUsdt500: "0x2dbB5a4c235164B9f772179A43faca2c71a8abDB",
    },
    evidence: [
      "positionManager.factory() returns 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865, " +
        "which is the factory address in this same entry. Two contracts agree.",
      "factory.getPool(WBNB, USDT, 500) returns 0x2dbB5a4c235164B9f772179A43faca2c71a8abDB, " +
        "a pool that really exists rather than the zero address.",
      "That pool answers fee() = 500, token0() = USDT 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd, " +
        "token1() = WBNB 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd, and slot0() returns a " +
        "live price, so it is a real trading pool and not an empty shell.",
    ],
  },
  {
    id: "venus",
    label: "Venus",
    status: "live",
    capabilities: ["lend", "borrow"],
    addresses: {
      comptroller: "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D",
      vBNB: "0x2E7222e51c0f6e98610A1543Aa3836E092CDe62c",
      vUSDT: "0xb7526572FFE56AB9D7489838Bf2E18e3323b441A",
    },
    evidence: [
      "vBNB.comptroller() returns 0x94d1820b2D1c7c7452A163983Dc888CEC546b77D, which is the " +
        "comptroller address in this same entry. Two contracts agree.",
      "vBNB.symbol() returns \"vBNB\", so the address is the market it claims to be.",
      "comptroller.getAccountLiquidity(<an address with nothing in it>) answers (0, 0, 0) " +
        "instead of failing, so the borrowing side is callable.",
    ],
  },
  {
    id: "lista-liquid-staking",
    label: "Lista liquid staking",
    status: "live",
    capabilities: ["stake"],
    addresses: {
      stakeManager: "0xc695F964011a5a1024931E2AF0116afBaC41B31B",
      slisBNB: "0xCc752dC4ae72386986d011c2B485be0DAd98C744",
    },
    evidence: [
      "slisBNB.symbol() returns \"slisBNB\" and totalSupply() returns " +
        "9738857718264926990002.",
      "stakeManager.getTotalPooledBnb() returns 9749404058088471087170 and " +
        "convertSnBnbToBnb(1e18) returns 1001082913430777899.",
      "Multiplying the token's own supply by the manager's own exchange rate gives " +
        "9749404058088471083417, which differs from the manager's own total by 3753 wei, " +
        "less than a millionth of a millionth of one BNB. Two contracts that were never " +
        "asked about each other produce the same total, which is what makes this a real " +
        "deployment and not a lookalike address.",
    ],
  },
  {
    id: "aave-v3",
    label: "Aave v3",
    status: "absent",
    capabilities: [],
    addresses: {},
    evidence: [
      "The Aave v3 pool used on BNB Chain mainnet, 0x6807dc923806fE8Fd134338EABCA509979a7e0cB, " +
        "has no contract code on chain id 97.",
      "The provider address 0xA97684ead0e402dC232d5A977953DF7ECBaB3CDb, which Aave uses on " +
        "several other networks, also has no contract code on chain id 97. Our own research " +
        "note docs/research/06-agent-strategies.md already found the same address empty on " +
        "BNB Chain mainnet.",
    ],
    note:
      "There is no Aave market on BNB Chain testnet to act on. Pilot therefore does not " +
      "offer Aave, and will refuse a plan that names it rather than sending the money " +
      "somewhere else. Fugu Guardian solved the same gap with a small lending pool of our " +
      "own, and its page says so.",
  },
  {
    id: "lista-lending",
    label: "Lista lending",
    status: "unverified",
    capabilities: [],
    addresses: {},
    evidence: [
      "The lisUSD token used on BNB Chain mainnet, 0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5, " +
        "has no contract code on chain id 97.",
      "No lending market address for Lista on chain id 97 was found and confirmed, so " +
        "nothing here has been proven either way.",
    ],
    note:
      "Only Lista's staking side was proven to work on this network. The lending side is " +
      "listed as not checked rather than as working, and Pilot treats not checked exactly " +
      "the same as missing.",
  },
];

const BY_ID: ReadonlyMap<string, Venue> = new Map(VENUES.map((v) => [v.id, v]));

/** Every venue that was proven to answer on this network. */
export function liveVenues(): readonly Venue[] {
  return VENUES.filter((v) => v.status === "live");
}

/** Every venue that is named in the product but cannot be used here, with the reason. */
export function unusableVenues(): readonly Venue[] {
  return VENUES.filter((v) => v.status !== "live");
}

export function findVenue(id: string): Venue | undefined {
  return BY_ID.get(id);
}

/**
 * Thrown when something asks Pilot to act on a venue it cannot reach. It always means
 * "send nothing", and it is raised before any planning happens, so no amount is ever
 * computed for a place the money cannot go.
 */
export class VenueUnavailableError extends Error {
  /** Nothing was sent, and nothing could have been: this is raised before any network call. */
  readonly neverSent = true as const;
  readonly venueId: string;
  constructor(message: string, venueId: string) {
    super(message);
    this.name = "VenueUnavailableError";
    this.venueId = venueId;
  }
}

/**
 * Demands that `venueId` is a venue proven to answer on this network AND that it offers
 * `capability`. Anything else throws.
 *
 * This is deliberately strict about the unknown case too. A venue we never checked is
 * refused with the same firmness as one we checked and found empty, because "we did not
 * look" is not a reason to send money somewhere.
 */
export function assertVenueUsable(venueId: string, capability: VenueCapability): Venue {
  const venue = BY_ID.get(venueId);
  if (venue === undefined) {
    throw new VenueUnavailableError(
      `There is no venue called "${venueId}" in this agent's list. The places it can act on ` +
        `are: ${liveVenues().map((v) => v.id).join(", ")}.`,
      venueId,
    );
  }
  if (venue.status !== "live") {
    throw new VenueUnavailableError(
      `${venue.label} cannot be used on this network. ${venue.note ?? ""} ` +
        `Checked on ${VERIFIED_AT}: ${venue.evidence.join(" ")}`.trim(),
      venueId,
    );
  }
  if (!venue.capabilities.includes(capability)) {
    throw new VenueUnavailableError(
      `${venue.label} works on this network, but it does not do "${capability}". ` +
        `What it does: ${venue.capabilities.join(", ")}.`,
      venueId,
    );
  }
  return venue;
}
