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
 *   cast call <FuguRegistry> 'getListing(uint256)(...)' 7
 *
 * returned category 6 (AUTONOMOUS) and this wallet. Separately, the private key kept in
 * `contracts/.env` was turned into its address and came out as this same wallet, so adopting
 * the existing key really is possible and no new one has to be made.
 *
 * The key itself is never read, printed or copied by any code in this package.
 */

/** The marketplace listing this agent is recorded under. */
export const LISTING_ID = 7;

/** The category this agent is listed in, as the number the contract stores. */
export const CATEGORY_INDEX = 6;

/** The category name shared across the whole repo. Never abbreviate or reorder these. */
export const CATEGORY_NAME = "AUTONOMOUS" as const;

/**
 * The wallet already written into the listing. Fixed for good.
 *
 * Anything that needs a wallet for this agent has to use this one. Making a new one is not a
 * smaller version of the same thing: it is a listing that points somewhere else for ever.
 */
export const AGENT_WALLET = "0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D" as const;

/** The transaction that recorded the listing, so anybody can check the claim above. */
export const LISTING_TX = "0x074830b01b4ef0461114b4734c2d4eaeef34938318ca788e21a47b13d2f92eb9" as const;

/** The name a person reads. */
export const AGENT_LABEL = "Fugu Pilot" as const;
