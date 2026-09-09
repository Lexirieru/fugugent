/**
 * Reader for `FuguRegistry` listing metadata — **untrusted input**.
 *
 * ## Why this exists
 *
 * A listing read straight from the chain has no name: `onchain.ts` deliberately
 * does not fetch `metadataURI`, so every record arrives as `Agent #8006`. Next
 * to 113 third-party agents with real names, our own four — the only ones that
 * can actually be rented — looked broken.
 *
 * The real names are on-chain already. The registration writes a
 * `data:application/json;base64,…` payload into each listing's `metadataURI`,
 * carrying `name`, `summary`, and `onchainExecution`.
 *
 * ## The contract of this module
 *
 * **Nothing here ever throws, for any input.** `metadataURI` is a string an
 * arbitrary lister put on-chain: it can be a different scheme, invalid base64,
 * valid base64 of something that is not JSON, JSON that is an array or a number,
 * an object whose `name` is `{}`, or 4 MB of padding. Every one of those must
 * end as "no usable metadata", never as an exception, because a single bad
 * listing must not take down the marketplace page. Same principle as the
 * 8004scan normalizer: an unrecognised shape returns nothing and says so.
 *
 * The caller keeps the placeholder name when this module declines, and reports
 * the count of unreadable listings rather than pretending they were fine.
 *
 * ## What is deliberately NOT done
 *
 * - **No network.** `ipfs://` and `https://` URIs are declined, not fetched.
 *   The first-party overlay runs on every request and must stay cheap and
 *   independent; a fetch here would put a third party back in the critical path
 *   of the one layer that exists to avoid that.
 * - **`agentWallet` is never overwritten from metadata.** The on-chain listing
 *   is what the contract actually holds. Where the two disagree — listing 1
 *   (Guardian) still points at the deployer EOA rather than the Guardian Altana
 *   wallet, and that cannot be fixed without a new listing — the disagreement is
 *   reported ({@link ListingMetadata.agentWalletMatchesListing}) so the UI can
 *   avoid presenting either value as proof of the agent's wallet.
 */

import type { Address, AgentRecord } from "../types.js";

/** Longest `metadataURI` we will even look at. Beyond this, decline without decoding. */
export const MAX_METADATA_URI_LENGTH = 64_000;
/** Longest decoded payload we will parse as JSON. */
export const MAX_METADATA_BYTES = 32_000;
/** Field caps. A listing cannot push an essay into a card title. */
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 4_000;
export const MAX_NOTE_LENGTH = 2_000;

/** Strict base64 alphabet, with optional padding. `Buffer.from` silently drops
 * anything outside it, which would turn "invalid base64" into "partially decoded
 * garbage" — so the shape is checked before decoding rather than after. */
const BASE64_ONLY = /^[A-Za-z0-9+/\r\n]*={0,2}$/;

/** Recognised fields of a listing metadata document. Everything is nullable. */
export interface ListingMetadata {
  name: string | null;
  description: string | null;
  /**
   * Whether this agent has ever been able to act on-chain.
   *
   * The distinction the UI needs is "can be hired" versus "can already act":
   * three of our four agents are deterministic decision engines that have never
   * sent a transaction. Showing them as live traders would be the overclaim this
   * whole layer exists to avoid, so a `false` here is load-bearing, not trivia.
   */
  onchainExecution: boolean | null;
  /**
   * What the lister says the agent has already done, in its own words.
   *
   * Dropping this was a real defect rather than an omission: the registration
   * script writes an evidence paragraph with transaction hashes and block
   * numbers into the listing, and because this parser did not recognise the key,
   * the marketplace answered "No transactions yet" for an agent whose proof was
   * sitting on chain the whole time. The claim was published and then discarded
   * one layer later.
   *
   * It is treated as a claim, not as proof. Nothing here is verified by us; it is
   * whatever the listing owner wrote, and the UI has to present it that way.
   */
  proof: string | null;
  /** Free-text limitations declared by the lister. */
  limits: string | null;
  /** How a reader can verify the claims themselves. */
  verify: string | null;
  /** Wallet the metadata claims. NOT authoritative — see the module header. */
  declaredAgentWallet: Address | null;
  /**
   * `false` when the metadata's declared wallet disagrees with the on-chain
   * listing, `null` when the metadata declares none. Neither value is proof of
   * the agent's wallet when this is `false`.
   */
  agentWalletMatchesListing: boolean | null;
}

/** An `AgentRecord` plus what the listing metadata added. */
export interface ListedAgentRecord extends AgentRecord {
  /** Promoted from {@link ListingMetadata} because the UI must not miss it. */
  onchainExecution?: boolean;
  /** Everything the listing metadata declared, parsed and bounded. */
  listingMetadata?: ListingMetadata;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accept a string field only if it is really a string with content, then bound
 * its length.
 */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Control characters are stripped: a stray NUL or CR in a name corrupts logs
  // and breaks layout, and no honest lister needs them.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** Only a real boolean counts. `"false"` and `0` are not booleans. */
function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function address(value: unknown): Address | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as Address)
    : null;
}

/** Decode the payload of a `data:` URI. Returns `null` for anything unusable. */
function decodeDataUri(uri: string): string | null {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;

  const header = uri.slice(5, comma).toLowerCase();
  const payload = uri.slice(comma + 1);

  // An empty mediatype is legal and defaults to text/plain; we accept it and let
  // the JSON parse decide. Anything that names a non-JSON type is declined
  // rather than guessed at.
  const base64 = header.endsWith(";base64") || header.includes(";base64;");
  const mediatype = header.split(";")[0] ?? "";
  if (mediatype !== "" && !mediatype.includes("json")) return null;

  if (!base64) {
    try {
      const decoded = decodeURIComponent(payload);
      return decoded.length > MAX_METADATA_BYTES ? null : decoded;
    } catch {
      // Malformed percent-encoding.
      return null;
    }
  }

  if (!BASE64_ONLY.test(payload)) return null;
  let decoded: string;
  try {
    const buffer = Buffer.from(payload, "base64");
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_METADATA_BYTES) return null;
    decoded = buffer.toString("utf8");
  } catch {
    return null;
  }
  return decoded;
}

/**
 * Parse a listing's `metadataURI`.
 *
 * @returns the recognised fields, or `null` when the URI carries nothing usable.
 *          Never throws.
 */
export function parseListingMetadata(metadataURI: unknown): ListingMetadata | null {
  if (typeof metadataURI !== "string") return null;
  const uri = metadataURI.trim();
  if (uri === "" || uri.length > MAX_METADATA_URI_LENGTH) return null;
  if (!uri.toLowerCase().startsWith("data:")) return null;

  const decoded = decodeDataUri(uri);
  if (decoded === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const name = text(parsed.name, MAX_NAME_LENGTH);
  // The registration writes `summary`; `description` is accepted too so a later
  // lister using the more obvious key is not silently ignored.
  const description =
    text(parsed.description, MAX_DESCRIPTION_LENGTH) ??
    text(parsed.summary, MAX_DESCRIPTION_LENGTH);
  const onchainExecution = bool(parsed.onchainExecution);
  const proof = text(parsed.proof, MAX_NOTE_LENGTH);
  const limits = text(parsed.limits, MAX_NOTE_LENGTH);
  const verify = text(parsed.verify, MAX_NOTE_LENGTH);
  const declaredAgentWallet = address(parsed.agentWallet);

  // A document that parsed but declared nothing we recognise is not usable
  // metadata; saying so lets the caller count it as unreadable instead of
  // silently replacing a placeholder name with another placeholder name.
  if (
    name === null &&
    description === null &&
    onchainExecution === null &&
    proof === null &&
    limits === null &&
    verify === null &&
    declaredAgentWallet === null
  ) {
    return null;
  }

  return {
    name,
    description,
    onchainExecution,
    proof,
    limits,
    verify,
    declaredAgentWallet,
    agentWalletMatchesListing: null,
  };
}

/**
 * Apply a listing's own metadata to its record.
 *
 * Only fills in what the metadata actually declared: a listing with no readable
 * metadata keeps the `Agent #8006` placeholder rather than being given a made-up
 * name. `ok: false` says the listing carried a `metadataURI` that could not be
 * read, so the caller can report how many listings are in that state.
 */
export function applyListingMetadata(record: AgentRecord): {
  record: ListedAgentRecord;
  ok: boolean;
} {
  const uri = record.fuguListing?.metadataURI;
  if (typeof uri !== "string" || uri.trim() === "") {
    // No metadata was ever written. That is not a failure to report.
    return { record, ok: true };
  }

  const metadata = parseListingMetadata(uri);
  if (metadata === null) return { record, ok: false };

  const declared = metadata.declaredAgentWallet;
  const onchainWallet = record.fuguListing?.agentWallet ?? null;
  const listingMetadata: ListingMetadata = {
    ...metadata,
    agentWalletMatchesListing:
      declared === null || onchainWallet === null
        ? null
        : declared.toLowerCase() === onchainWallet.toLowerCase(),
  };

  const next: ListedAgentRecord = {
    ...record,
    name: listingMetadata.name ?? record.name,
    description: listingMetadata.description ?? record.description,
    listingMetadata,
  };
  if (listingMetadata.onchainExecution !== null) {
    next.onchainExecution = listingMetadata.onchainExecution;
  }
  return { record: next, ok: true };
}

/**
 * Whether a listing's declared metadata can be read at all.
 *
 * Used only to count listings that will keep a placeholder name. Deliberately
 * separate from applying it: applying happens in exactly one place
 * ({@link attachFirstParty}) so that no record can pick up metadata by a second
 * route and diverge from the first.
 */
export function metadataReadable(record: AgentRecord): boolean {
  const uri = record.fuguListing?.metadataURI;
  if (typeof uri !== "string" || uri.trim() === "") return true; // nothing declared
  return parseListingMetadata(uri) !== null;
}

/**
 * The placeholder name `onchain.ts` gives a listing it read without metadata.
 *
 * Mirrors `toAgentRecord` in `src/sources/onchain.ts`, which builds
 * `` `Agent #${tokenId}` `` because it deliberately does not fetch
 * `metadataURI`. Compared exactly rather than by pattern: a third-party agent
 * genuinely named "Agent #7" must not be mistaken for a placeholder.
 */
export function isPlaceholderName(record: AgentRecord): boolean {
  return record.name.trim() === "" || record.name === `Agent #${record.tokenId}`;
}

/**
 * **The single place a record acquires its first-party listing and metadata.**
 *
 * Both the list path and the detail path call this, and that is the whole point.
 * They used to do it separately: the list path merged the overlay record whole,
 * while the detail path hand-copied `fuguListing` and nothing else. The result
 * was a card reading "Fugu Guardian · onchainExecution: true" and a detail page
 * for the same id reading "Agent #8004 · onchainExecution: null" — the page where
 * someone decides to pay denying what the card just promised. Two code paths that
 * can drift is the defect; equal values today would only postpone it.
 *
 * Metadata is re-read from the record's own `fuguListing.metadataURI` rather than
 * copied from the overlay, because a record that came back from the Postgres
 * cache carries the listing but not the parsed fields — those are service-level
 * and never stored. Parsing is deterministic and bounded, so doing it again costs
 * nothing and removes a way for the two to disagree.
 *
 * Discovery metadata wins where it exists: 8004scan knows an agent's name AND its
 * reputation, so its name is kept and ours fills in only a placeholder. Never
 * throws; `ok: false` means this listing carried metadata that could not be read.
 */
export function attachFirstParty(
  record: AgentRecord,
  listings: readonly ListedAgentRecord[],
): { record: ListedAgentRecord; ok: boolean } {
  const match = listings.find((listing) => listing.id === record.id);
  // The registry read WINS over a listing the record already carries.
  //
  // A record from the Postgres cache carries a *copy* of the listing as it was
  // when it was indexed. That copy goes stale the moment the lister changes
  // anything — and it did: the cached row for 97:8004 still held
  // `ipfs://fugu-guardian-v1` after the listing had been updated to a `data:`
  // URI, so the list page (served from the fresh overlay) said "Fugu Guardian"
  // while the detail page (served from cache) said "Agent #8004". Preferring the
  // record's own copy also means a price change would not show until the cache
  // was rewritten, which for the one number a user pays is not acceptable.
  const withListing =
    match?.fuguListing != null ? { ...record, fuguListing: match.fuguListing } : record;

  if (withListing.fuguListing === null) return { record: withListing, ok: true };

  const applied = applyListingMetadata(withListing);
  return {
    record: {
      ...applied.record,
      name: isPlaceholderName(record) ? applied.record.name : record.name,
      description: record.description.trim() === "" ? applied.record.description : record.description,
    },
    ok: applied.ok,
  };
}
