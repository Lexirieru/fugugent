/**
 * Who this agent is on the blockchain.
 *
 * ## Why this is a constant in code and not a note in a document
 *
 * The marketplace listing for this agent is already recorded on the blockchain, and the
 * wallet written into it CANNOT be changed afterwards. `FuguRegistry` has no setter for that
 * field and `updateListing` does not reach it, so a listing pointing at the wrong wallet
 * points at the wrong wallet for good. The only repair is a second listing, which would put
 * two entries in one category and make the marketplace count wrong as well.
 *
 * So the address lives here, next to the code that would use it, and a test asserts it. A
 * value nobody can quietly replace with a freshly generated one is the whole point.
 *
 * ## What was checked, and how
 *
 * On 2026-09-09, against chain id 97 through
 * https://data-seed-prebsc-1-s1.bnbchain.org:8545:
 *
 *   cast call <FuguRegistry> 'getListing(uint256)(...)' 9
 *
 * returned category 8 (TREASURY) and this wallet. Separately, the private key kept in
 * `contracts/.env` was turned into its address and came out as this same wallet, so adopting
 * the existing key really is possible and no new one has to be made.
 *
 * The key itself is never read, printed or copied by any code in this package.
 */

/** The marketplace listing this agent is recorded under. */
export const LISTING_ID = 9;

/** The category this agent is listed in, as the number the contract stores. */
export const CATEGORY_INDEX = 8;

/** The category name shared across the whole repo. Never abbreviate or reorder these. */
export const CATEGORY_NAME = "TREASURY" as const;

/**
 * The wallet already written into the listing. Fixed for good.
 *
 * Anything that needs a wallet for this agent has to use this one. Making a new one is not a
 * smaller version of the same thing: it is a listing that points somewhere else for ever.
 */
export const AGENT_WALLET = "0xB92Dd50E84560E719627AcE28b32060dbF0E7083" as const;

/** The transaction that recorded the listing, so anybody can check the claim above. */
export const LISTING_TX = "0xf0ad5e8dc18844b4dc87cba288db97137836ba6d237a6271c46a167828de2b9c" as const;

/** The name a person reads. */
export const AGENT_LABEL = "Fugu Steward" as const;
