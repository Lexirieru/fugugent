/**
 * Reading the agent catalog.
 *
 * The contract calls themselves are injected, so everything here can be tested without a
 * network: `readCatalog` is handed a function that returns a raw listing, and that
 * function is a real contract read in production and a fixture in a test.
 *
 * Nothing in this file decides anything. It turns what the contract stores into the
 * shapes `decide.ts` understands, and it refuses a reading it cannot understand rather
 * than passing along a guess.
 */
import {
  CatalogError,
  categoryFromIndex,
  type CatalogListing,
} from "../types.js";

/**
 * The two functions this agent calls on the catalog contract. Written out here rather
 * than imported from the contracts package, because the agent is deployed on its own and
 * must not need a Solidity toolchain to build.
 */
export const FUGU_REGISTRY_ABI = [
  {
    type: "function",
    name: "listingCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getListing",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "erc8004AgentId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "agentWallet", type: "address" },
          { name: "category", type: "uint8" },
          { name: "priceUsd8PerPeriod", type: "uint128" },
          { name: "periodSeconds", type: "uint32" },
          { name: "active", type: "bool" },
          { name: "curated", type: "bool" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
] as const;

/** A listing exactly as the contract stores it. */
export interface RawListing {
  erc8004AgentId: bigint;
  owner: `0x${string}`;
  agentWallet: `0x${string}`;
  category: number;
  priceUsd8PerPeriod: bigint;
  periodSeconds: bigint | number;
  active: boolean;
  curated: boolean;
  metadataURI: string;
}

/** What a listing's metadata is allowed to tell this agent. */
export interface ListingMetadata {
  name: string;
  onchainExecution: boolean;
}

const EMPTY_METADATA: ListingMetadata = { name: "", onchainExecution: false };

const DATA_JSON_BASE64 = /^data:application\/json;base64,/;

/**
 * Reads a listing's metadata, and ONLY from the listing itself.
 *
 * The metadata address is a string anybody can set when they add a listing. A reader that
 * followed it would let a stranger point this agent at any address on the internet and
 * have it fetched, from inside the process that holds the spending key. So this reader
 * touches no network at all: it accepts metadata carried inside the listing as base64 and
 * refuses everything else, including addresses that look harmless.
 *
 * Unreadable metadata is never a reason to skip a listing. It costs the listing its name
 * and its claim about being able to act, both of which fail closed, and the price, the
 * capability and the vetting mark are read from the contract fields, which no metadata
 * can contradict.
 */
export function readListingMetadata(metadataURI: string): ListingMetadata {
  if (!DATA_JSON_BASE64.test(metadataURI)) return EMPTY_METADATA;
  let parsed: unknown;
  try {
    const base64 = metadataURI.replace(DATA_JSON_BASE64, "");
    parsed = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return EMPTY_METADATA;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return EMPTY_METADATA;
  }
  const record = parsed as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : "",
    // Anything other than the boolean true reads as false. A listing that writes
    // "onchainExecution": "yes" is not making a claim this agent can act on.
    onchainExecution: record.onchainExecution === true,
  };
}

/**
 * One raw listing turned into the shape the decision engine reads.
 *
 * A capability index this build does not know throws, and the caller drops that one
 * listing. See `categoryFromIndex`: the alternative is to invent a meaning for a number
 * somebody else added to the contract after this agent was built.
 */
export function toCatalogListing(listingId: bigint, raw: RawListing): CatalogListing {
  const metadata = readListingMetadata(raw.metadataURI);
  return {
    listingId,
    erc8004AgentId: raw.erc8004AgentId,
    owner: raw.owner,
    agentWallet: raw.agentWallet,
    category: categoryFromIndex(raw.category),
    priceUsd8PerPeriod: raw.priceUsd8PerPeriod,
    periodSeconds: BigInt(raw.periodSeconds),
    active: raw.active,
    curated: raw.curated,
    name: metadata.name,
    onchainExecution: metadata.onchainExecution,
  };
}

export interface CatalogReadResult {
  listings: CatalogListing[];
  /** Listings that could not be read, with the reason. Never silently dropped. */
  unreadable: { listingId: bigint; reason: string }[];
}

/**
 * Reads the whole catalog, one listing at a time, from id 1 to the count.
 *
 * Ids start at 1, not 0: the contract assigns them with a pre-increment, so id 0 never
 * exists and asking for it throws.
 *
 * A listing that cannot be read does not stop the read. It is recorded in `unreadable`
 * with its reason, because a catalog that silently shrinks is how a hire ends up made
 * from half the market without anyone noticing.
 */
export async function readCatalog(
  count: bigint,
  getListing: (listingId: bigint) => Promise<RawListing>,
): Promise<CatalogReadResult> {
  if (count < 0n) {
    throw new CatalogError(`The catalog reported ${count} listings, which is not a count.`);
  }
  const listings: CatalogListing[] = [];
  const unreadable: { listingId: bigint; reason: string }[] = [];

  for (let id = 1n; id <= count; id++) {
    try {
      listings.push(toCatalogListing(id, await getListing(id)));
    } catch (error) {
      unreadable.push({
        listingId: id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { listings, unreadable };
}
