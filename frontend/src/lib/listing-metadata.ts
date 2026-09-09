/**
 * The `metadataURI` written into a listing when an agent's owner lists it here.
 *
 * ## Why a data URI and not `ipfs://`
 *
 * Our own nine listings use `data:application/json;base64,...`
 * (`contracts/script/ListAgents.s.sol`) for one reason: an `ipfs://` that nobody
 * pins is a link that resolves to nothing forever, and the listing would then carry
 * a promise of information it cannot produce. A data URI is the information. Anybody
 * with the transaction can decode it, offline, with `base64 -d`.
 *
 * ## What goes in it, and what deliberately does not
 *
 * Only fields this app can stand behind at the moment of signing:
 *
 *  - what the catalogue holds about the agent (its name, its id, the wallet it is
 *    recorded as signing with, its own description);
 *  - the fact that this listing was made by its owner from the marketplace, rather
 *    than by us on their behalf;
 *  - whether the catalogue has ever verified the agent's endpoint, which for every
 *    third-party agent in it today is `false`.
 *
 * What is **not** written is `onchainExecution`. Our own listings carry it because we
 * wrote those agents and know the answer. For somebody else's agent we do not know,
 * and a field that says `false` reads as a measurement rather than a shrug. An absent
 * field is the honest shape of not knowing.
 */

import type { Category } from "@/lib/agent-types";
import { CHAIN } from "@/lib/chain";

/**
 * Plain fields rather than an `AgentRecord`, so this module can be read and checked
 * on its own and so no caller has to fabricate a whole record to build a URI.
 */
export interface ListingMetadataInput {
  name: string;
  description: string;
  /** The ERC-8004 token id, as a decimal string. */
  tokenId: string;
  category: Category;
  /** The zero address means the catalogue does not know it. */
  agentWallet: string;
  /** Whether the catalogue has ever verified the agent's endpoint. */
  endpointVerified: boolean;
  /** Which rung of the fallback ladder the record came from. */
  catalogueSource: string;
  /** ISO 8601. Passed in rather than read here, so the result is a pure function. */
  listedAt: string;
}

/** The JSON before it is wrapped. Split out so it can be read and checked on its own. */
export function listingMetadataJson(input: ListingMetadataInput): string {
  return JSON.stringify({
    name: input.name,
    category: input.category,
    erc8004AgentId: input.tokenId,
    agentWallet: input.agentWallet === ZERO_ADDRESS ? null : input.agentWallet,
    summary: input.description.slice(0, 600),
    listedBy: "the agent's own owner, from app.hellofugu.xyz",
    endpointVerified: input.endpointVerified,
    catalogueSource: input.catalogueSource,
    chainId: CHAIN.id,
    listedAt: input.listedAt,
  });
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * `data:application/json;base64,...`.
 *
 * `btoa` only accepts characters below 256, and an agent name can hold anything, so
 * the text is turned into UTF-8 bytes first. Skipping that step throws on the first
 * agent with an accent in its name, which is exactly the sort of failure that only
 * shows up in production.
 */
export function listingMetadataUri(input: ListingMetadataInput): string {
  const json = listingMetadataJson(input);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/json;base64,${btoa(binary)}`;
}

/** A `0x` address, or `null`. Case is not normalised: the chain does not care. */
export function asAddress(value: string): `0x${string}` | null {
  const text = value.trim();
  if (text === "") return null;
  return /^0x[0-9a-fA-F]{40}$/.test(text) ? (text as `0x${string}`) : null;
}

/** Two addresses, compared the way they should be: without caring about case. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
