// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @title ListAgents
/// @notice Registers every Fugugent agent that is missing from `FuguRegistry`, so that
///         all nine marketplace categories hold exactly one listing.
///
///         Guardian (HEALTH_FACTOR) was registered during the 2026-09-08 end-to-end run
///         and is not in this script's plan. The eight entries here are:
///         Rebalancer, Grid, Yield (registered 2026-09-09) and Broker, Trader, Pilot,
///         Meter, Steward (added when the catalog was widened to nine categories).
///
/// @dev How to use it (ALWAYS simulate first, without `--broadcast`, and read the output):
///
///      ```
///      cd contracts
///      forge script script/ListAgents.s.sol:ListAgents --rpc-url "$BSC_TESTNET_RPC_URL"
///      forge script script/ListAgents.s.sol:ListAgents --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast
///      ```
///
///      ## The registry must be upgraded BEFORE this script runs
///
///      The five categories added in 2026-09 do not exist in the implementation that was
///      deployed before them. Sending `list(..., Category.HIRING, ...)` to that old
///      implementation reverts while decoding the calldata, because 4 is out of range for
///      a four-value enum. Run `script/Upgrade.s.sol` first.
///
///      ## Idempotent — unlike `DeployMocks.s.sol`
///
///      Each entry is skipped if its `erc8004AgentId` already maps to a listing
///      (`listingByAgentId != 0`). Re-running this script after one tx failed therefore
///      does not duplicate the listings that already landed, and does not burn tBNB on
///      transactions guaranteed to revert with `AgentAlreadyListed`.
///
///      ## The `erc8004AgentId` values here are PLACEHOLDERS, not real ERC-8004 identities
///
///      Not one of our agent wallets holds an ERC-8004 IdentityRegistry token on BSC
///      testnet (`balanceOf` on `0x8004A818BFB912233c491871b3d84c89A494BD9e` = 0 for all
///      of them, as of 2026-09-09). The IDs 8005-8012 continue from the `8004` already
///      used by the Guardian listing: they are nothing but locally unique keys.
///      `FuguRegistry` does not verify ERC-8004 ownership (see its contract NatSpec), so
///      these IDs MUST NOT be read as proof of identity. That fact is written into each
///      listing's metadata too, not only into the docs.
///
///      ## Metadata is embedded on-chain as a `data:` URI
///
///      `metadataURI` is not an `ipfs://...` that can never be resolved; it holds base64
///      JSON that anyone can read without a server, IPFS, or an API key:
///
///      ```
///      cast call --rpc-url "$BSC_TESTNET_RPC_URL" 0xb2f36070E6eae3353E8e755172B477DF213ae248 \
///        'getListing(uint256)((uint256,address,address,uint8,uint128,uint32,bool,bool,string))' 2 \
///        | sed -E 's/.*base64,//; s/"\)$//' | base64 -d
///      ```
///
///      That metadata states each agent's limits itself. `implemented` is `false` for an
///      agent whose code does not exist in this repository yet, and `onchainExecution` is
///      `false` for every agent except Guardian. `metadataURI` is the one field
///      `updateListing` can still change afterwards, so a listing registered while its
///      agent was still empty can be corrected the day the agent is real. `agentWallet`
///      and `category` can NOT be changed after `list()` — get those right the first time.
///
///      `chainId` is hardcoded to 97 (BSC testnet). **Change it when using this for mainnet.**
contract ListAgents is Script {
    /// @dev BSC testnet. Change to 56 for mainnet.
    uint256 constant EXPECTED_CHAIN_ID = 97;

    /// @dev The FuguRegistry proxy — verified live, see `deployments/bsc-testnet.json`.
    address constant REGISTRY = 0xb2f36070E6eae3353E8e755172B477DF213ae248;

    /// @dev The canonical ERC-8004 IdentityRegistry on BSC testnet, referenced in the
    ///      metadata so a reader can check for themselves that we hold NO identity token.
    address constant ERC8004_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    /// @dev Subscription price on an 8-decimal basis: 5_000_000 = $0.05 per period.
    ///
    ///      Half of the Guardian listing ($0.10), and deliberately so: Guardian has
    ///      demonstrably executed on-chain transactions, while none of these eight has.
    ///      The price gap states the same capability gap that is written in the metadata —
    ///      it is not a number picked to look good. Zero is forbidden by the contract
    ///      (`InvalidPrice`), and a price this small still makes escrow/claim/the 5% fee
    ///      run with non-zero numbers.
    uint128 constant PRICE_USD8 = 5_000_000;

    /// @dev A 120-second period, the same as the Guardian listing already live.
    ///
    ///      It is short NOT because this is a commercial price ($0.05 per 2 minutes
    ///      certainly is not), but because the anti-sybil gate
    ///      `FuguSubscription.hasSubscribed` only opens once the agent has actually
    ///      RECEIVED >= `minPaidBpsOfPeriod` (50%) of the price of ONE period, and `claim`
    ///      is proportional to elapsed time. A 30-day period would mean the right to
    ///      review opens only after 15 days — the hire -> claim -> review cycle would
    ///      never finish in front of the judges. 120 seconds makes it finish in about 60
    ///      seconds. It also makes every card comparable, since they use the same period.
    uint32 constant PERIOD_SECONDS = 120;

    /// @dev The 1 existing Guardian listing + the 8 this script registers.
    uint256 constant EXPECTED_TOTAL_LISTINGS = 9;

    error WrongChain(uint256 expected, uint256 actual);
    error NoCode(string label, address addr);
    error ListingMismatch(uint256 listingId, string field);
    error UnexpectedListingCount(uint256 expected, uint256 actual);
    error UnexpectedCategoryCount(uint8 category, uint256 expected, uint256 actual);
    error AgentWalletNotAssigned(string name);
    error RegistryTooOldForNewCategories(address registry);

    struct AgentPlan {
        uint256 erc8004AgentId;
        /// @dev The agent's operational wallet. **Immutable once `list()` has run** — no
        ///      setter exists, and `updateListing` cannot reach it. A wrong address here
        ///      is permanent for that listing, which is why `_listAll` refuses to register
        ///      an entry whose wallet is still the zero address.
        address agentWallet;
        Category category;
        /// @dev Display name, the same one the marketplace uses.
        string name;
        /// @dev The agent's directory at `ai/<slug>/app/agent`.
        string slug;
        /// @dev What this agent does, in plain words. For an agent that is already built
        ///      this describes the decision rules that exist; for one that is not, it
        ///      describes only what the listing reserves, and `implemented` says so.
        string summary;
        /// @dev True only when the agent's code exists in this repository and its test
        ///      suite runs. False means the listing reserves a category and a price and
        ///      nothing else.
        bool implemented;
        /// @dev The number of tests a reader can re-run. "0" when `implemented` is false.
        string testCount;
    }

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);

        // The five new categories only decode against an upgraded implementation. Probe
        // for the highest one before spending anything: on the pre-expansion code this
        // static call reverts while decoding `uint8(8)` into a four-value enum, which is
        // a far clearer failure than a reverted broadcast.
        (bool newCategoriesKnown,) =
            REGISTRY.staticcall(abi.encodeWithSignature("countByCategory(uint8)", uint8(Category.TREASURY)));
        if (!newCategoriesKnown) revert RegistryTooOldForNewCategories(REGISTRY);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address lister = vm.addr(pk);
        FuguRegistry registry = FuguRegistry(REGISTRY);

        console.log("== Context (verify before broadcasting) ==");
        console.log("chainId               ", block.chainid);
        console.log("FuguRegistry          ", REGISTRY);
        console.log("lister (listing owner)", lister);
        console.log("lister balance (wei)  ", lister.balance);
        console.log("listingCount before   ", registry.listingCount());
        console.log("price (USD, 8 dp)     ", uint256(PRICE_USD8));
        console.log("period (seconds)      ", uint256(PERIOD_SECONDS));

        vm.startBroadcast(pk);
        _listAll(registry);
        vm.stopBroadcast();

        _verifyAll(registry);
        _logResult(registry);
    }

    /// @notice Register every plan entry that is not yet registered.
    /// @dev Split out of `run()` so the exact same path can be tested against a local
    ///      `FuguRegistry` (`test/ListAgentsScript.t.sol`) with no env vars, no broadcast,
    ///      and without spending tBNB to discover that two arguments were swapped.
    function _listAll(FuguRegistry registry) internal {
        AgentPlan[8] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            AgentPlan memory p = plans[i];
            uint256 existing = registry.listingByAgentId(p.erc8004AgentId);
            if (existing != 0) {
                console.log("skipped (already listed):", p.name, existing);
                continue;
            }
            // `agentWallet` can never be corrected later. Rather than write a zero address
            // into a listing forever, refuse and let a human fill the plan in.
            if (p.agentWallet == address(0)) revert AgentWalletNotAssigned(p.name);
            uint256 listingId = registry.list(
                p.erc8004AgentId, p.agentWallet, p.category, PRICE_USD8, PERIOD_SECONDS, _metadata(p)
            );
            console.log("listed:", p.name, listingId);
        }
    }

    /// @notice Fail hard if the on-chain result is not exactly what was planned.
    /// @dev This also runs during simulation (`forge script` without `--broadcast`), so a
    ///      mismatch aborts the whole run BEFORE a single tx is sent.
    function _verifyAll(FuguRegistry registry) internal view {
        AgentPlan[8] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            AgentPlan memory p = plans[i];
            uint256 listingId = registry.listingByAgentId(p.erc8004AgentId);
            if (listingId == 0) revert ListingMismatch(0, "not listed");
            _verifyListing(registry, listingId, p);
        }

        uint256 total = registry.listingCount();
        if (total != EXPECTED_TOTAL_LISTINGS) revert UnexpectedListingCount(EXPECTED_TOTAL_LISTINGS, total);

        // All nine categories must hold exactly one listing: that is why this script exists.
        for (uint8 c = 0; c <= uint8(Category.TREASURY); ++c) {
            uint256 n = registry.countByCategory(Category(c));
            if (n != 1) revert UnexpectedCategoryCount(c, 1, n);
        }
    }

    function _verifyListing(FuguRegistry registry, uint256 listingId, AgentPlan memory p) internal view {
        Listing memory l = registry.getListing(listingId);
        if (l.erc8004AgentId != p.erc8004AgentId) revert ListingMismatch(listingId, "erc8004AgentId");
        if (l.agentWallet != p.agentWallet) revert ListingMismatch(listingId, "agentWallet");
        if (l.category != p.category) revert ListingMismatch(listingId, "category");
        if (l.priceUsd8PerPeriod != PRICE_USD8) revert ListingMismatch(listingId, "priceUsd8PerPeriod");
        if (l.periodSeconds != PERIOD_SECONDS) revert ListingMismatch(listingId, "periodSeconds");
        if (!l.active) revert ListingMismatch(listingId, "active");
        if (bytes(l.metadataURI).length == 0) revert ListingMismatch(listingId, "metadataURI");
    }

    /// @notice The registration plan. Wallets come from `ai/<slug>/app/agent/studio.toml`.
    /// @dev The categories MUST match the enum indices in `src/types/FuguTypes.sol`:
    ///      0 REBALANCING, 1 GRID, 2 YIELD, 3 HEALTH_FACTOR (Guardian, already live),
    ///      4 HIRING, 5 COMMERCE, 6 AUTONOMOUS, 7 STREAMING, 8 TREASURY.
    function _plan() internal pure virtual returns (AgentPlan[8] memory plans) {
        plans[0] = AgentPlan({
            erc8004AgentId: 8005,
            agentWallet: 0xb8f155D1278f0437b9De7c63911f2C0EDa485941,
            category: Category.REBALANCING,
            name: "Fugu Rebalancer",
            slug: "fugurebalancer",
            summary: "Drift-band rebalancer: a 500 bps band plus a 50 bps cost gate on turnover. The minimum economic turnover is derived from gas and budget (T >= gas * 10000 / (M - r)) and returns null when the budget makes rebalancing impossible, instead of quietly never trading.",
            implemented: true,
            testCount: "88"
        });
        plans[1] = AgentPlan({
            erc8004AgentId: 8006,
            agentWallet: 0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9,
            category: Category.GRID,
            name: "Fugu Grid",
            slug: "fugugrid",
            summary: "Grid trading on PancakeSwap v3: line spacing must be at least 2x the round-trip cost, measured at the upper bound where percentage spacing is tightest. Structurally mean-reverting, so its own backtest shows buy-and-hold beating it in a trending market.",
            implemented: true,
            testCount: "99"
        });
        plans[2] = AgentPlan({
            erc8004AgentId: 8007,
            agentWallet: 0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866,
            category: Category.YIELD,
            name: "Fugu Yield",
            slug: "fuguyield",
            summary: "Pool migration gated by breakEvenSpreadBps = ceil(cost * 10000 * 365 / (principal * days)) times a 2.00x safety multiplier. The threshold rises as principal or horizon shrinks ($10,000 over 30 days needs 390 bps, $200 needs 1582 bps), so highest APY is not the answer.",
            implemented: true,
            testCount: "93"
        });

        // --- the five capabilities added when the catalog was widened to nine ---
        //
        // These were registered while their code was still being written in `ai/`. Each
        // summary describes what the listing reserves, and `implemented: false` says the
        // code was not there yet. When an agent becomes real, replace its summary and flip
        // the flag, then run `updateListing` — that is the one field still changeable.
        //
        // Their wallets were created ahead of the agents, with `cast wallet new`, because
        // `agentWallet` cannot be corrected after `list()` and the agent directories held
        // no wallet yet. Each key is in `contracts/.env` as
        // `AGENT_WALLET_<NAME>_PRIVATE_KEY`; the agent that owns the directory adopts its
        // address with `bag wallet new --private-key -` rather than generating a fresh one,
        // which is what would make the chain and the repo disagree. Brand-new testnet EOAs,
        // never used anywhere else, no balance, never signed anything.
        plans[3] = AgentPlan({
            erc8004AgentId: 8008,
            agentWallet: 0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3,
            category: Category.HIRING,
            name: "Fugu Broker",
            slug: "fugubroker",
            summary: "Hires and pays other agents on your behalf. The money is held until the work is done, so nobody is paid in advance and nobody works for free.",
            implemented: false,
            testCount: "0"
        });
        plans[4] = AgentPlan({
            erc8004AgentId: 8009,
            agentWallet: 0x1B82F72346a8553a968fafD6AC07A21d4A88589f,
            category: Category.COMMERCE,
            name: "Fugu Trader",
            slug: "fugutrader",
            summary: "Buys one call at a time, paying per request for data or for a model answer. Neither side ever holds the other side's keys.",
            implemented: false,
            testCount: "0"
        });
        plans[5] = AgentPlan({
            erc8004AgentId: 8010,
            agentWallet: 0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D,
            category: Category.AUTONOMOUS,
            name: "Fugu Pilot",
            slug: "fugupilot",
            summary: "Moves money between lending and trading venues inside limits that it cannot exceed. The limits are set once, in advance, and the agent is refused when it tries to go past them.",
            implemented: false,
            testCount: "0"
        });
        plans[6] = AgentPlan({
            erc8004AgentId: 8011,
            agentWallet: 0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8,
            category: Category.STREAMING,
            name: "Fugu Meter",
            slug: "fugumeter",
            summary: "Pays by the call, by the second, or by the unit, without a person approving each one. The permission it uses expires on its own.",
            implemented: false,
            testCount: "0"
        });
        plans[7] = AgentPlan({
            erc8004AgentId: 8012,
            agentWallet: 0xB92Dd50E84560E719627AcE28b32060dbF0E7083,
            category: Category.TREASURY,
            name: "Fugu Steward",
            slug: "fugusteward",
            summary: "Runs payments that repeat on a schedule, and keeps a record of what it already paid so a restart does not pay twice.",
            implemented: false,
            testCount: "0"
        });
    }

    /// @notice The listing metadata as `data:application/json;base64,...`.
    /// @dev Its contents deliberately name what does NOT exist yet. `onchainExecution:
    ///      false` and `limits` are the same sentences as `docs/STATUS.md` — the
    ///      marketplace must not contradict our own honesty document.
    function _metadata(AgentPlan memory p) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(_metadataJson(p))));
    }

    /// @notice The raw JSON before it is wrapped in base64.
    /// @dev Split out so tests can parse it with `vm.parseJson*` — which at the same time
    ///      proves the result is valid JSON, not a string that merely looks like it.
    function _metadataJson(AgentPlan memory p) internal pure returns (string memory) {
        return string.concat(
            '{"name":"', p.name,
            '","agent":"', p.slug,
            '","category":"', _categoryName(p.category),
            '","agentWallet":"', vm.toString(p.agentWallet),
            '","summary":"', p.summary,
            '","onchainExecution":false',
            ',"implemented":', p.implemented ? "true" : "false",
            ',"limits":"', _limits(p),
            '","verify":"', _verify(p),
            '","erc8004Identity":"placeholder id, locally unique in FuguRegistry only: no ERC-8004 IdentityRegistry token has been minted for this wallet at ', vm.toString(ERC8004_IDENTITY_REGISTRY),
            '","chainId":97}'
        );
    }

    /// @dev The honest sentence shown on the agent card. Two different truths, because
    ///      "has a tested decision engine but cannot act" and "has no code at all" are not
    ///      the same limitation and must not be blurred into one comfortable phrase.
    function _limits(AgentPlan memory p) internal pure returns (string memory) {
        if (p.implemented) {
            return "Deterministic decision engine and backtest only. This agent has never sent a transaction of its own. Hiring it holds your payment until it is claimed and does not start an autonomous loop yet. See docs/STATUS.md.";
        }
        return string.concat(
            "Not built yet. This listing reserves the category, the price, and the wallet the agent will sign from. At the time it was registered there was no code for it in ai/",
            p.slug,
            ", the wallet had never signed anything, and hiring it holds your payment without anything running. See docs/STATUS.md."
        );
    }

    /// @dev What a reader can run to check the claim above. An agent with no code gets a
    ///      command that shows its absence, not a test count that does not exist.
    function _verify(AgentPlan memory p) internal pure returns (string memory) {
        if (p.implemented) {
            return string.concat("cd ai/", p.slug, "/app/agent && corepack pnpm test  # ", p.testCount, " tests");
        }
        return string.concat("ls ai/", p.slug, "  # no test suite at the time of listing");
    }

    function _categoryName(Category c) internal pure returns (string memory) {
        if (c == Category.REBALANCING) return "REBALANCING";
        if (c == Category.GRID) return "GRID";
        if (c == Category.YIELD) return "YIELD";
        if (c == Category.HEALTH_FACTOR) return "HEALTH_FACTOR";
        if (c == Category.HIRING) return "HIRING";
        if (c == Category.COMMERCE) return "COMMERCE";
        if (c == Category.AUTONOMOUS) return "AUTONOMOUS";
        if (c == Category.STREAMING) return "STREAMING";
        return "TREASURY";
    }

    function _logResult(FuguRegistry registry) internal view {
        console.log("== Result (re-read from chain) ==");
        console.log("listingCount          ", registry.listingCount());
        for (uint8 c = 0; c <= uint8(Category.TREASURY); ++c) {
            console.log("countByCategory", _categoryName(Category(c)), registry.countByCategory(Category(c)));
        }

        AgentPlan[8] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            uint256 listingId = registry.listingByAgentId(plans[i].erc8004AgentId);
            Listing memory l = registry.getListing(listingId);
            console.log("--", plans[i].name);
            console.log("  listingId       ", listingId);
            console.log("  erc8004AgentId  ", l.erc8004AgentId);
            console.log("  category (enum) ", uint256(uint8(l.category)));
            console.log("  priceUsd8       ", uint256(l.priceUsd8PerPeriod));
            console.log("  periodSeconds   ", uint256(l.periodSeconds));
            console.log("  owner           ", l.owner);
            console.log("  agentWallet     ", l.agentWallet);
            console.log("  metadataURI len ", bytes(l.metadataURI).length);
        }
    }
}
