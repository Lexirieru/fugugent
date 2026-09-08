// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @title ListAgents
/// @notice Register the three Fugugent agents missing from `FuguRegistry` —
///         Rebalancer (REBALANCING), Grid (GRID), Yield (YIELD) — so that all four
///         marketplace categories are filled, not just HEALTH_FACTOR.
///
/// @dev How to use it (ALWAYS simulate first, without `--broadcast`, and read the output):
///
///      ```
///      cd contracts
///      forge script script/ListAgents.s.sol:ListAgents --rpc-url "$BSC_TESTNET_RPC_URL"
///      forge script script/ListAgents.s.sol:ListAgents --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast
///      ```
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
///      four, as of 2026-09-09). The IDs 8005/8006/8007 continue from the `8004` already
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
///      That metadata states the limits of these three agents itself: a decision engine
///      plus a backtest, **not yet wired to on-chain execution**, and it has never sent a
///      single transaction (`docs/STATUS.md` §B3). The marketplace must not claim more
///      than that.
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
    ///      demonstrably executed on-chain transactions, while these three agents are
    ///      still only decision engines. The price gap states the same capability gap
    ///      that is written in the metadata — it is not a number picked to look good.
    ///      Zero is forbidden by the contract (`InvalidPrice`), and a price this small
    ///      still makes escrow/claim/the 5% fee run with non-zero numbers.
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
    ///      seconds. It also makes all four cards comparable, since they use the same period.
    uint32 constant PERIOD_SECONDS = 120;

    /// @dev The 1 existing Guardian listing + the 3 this script registers.
    uint256 constant EXPECTED_TOTAL_LISTINGS = 4;

    error WrongChain(uint256 expected, uint256 actual);
    error NoCode(string label, address addr);
    error ListingMismatch(uint256 listingId, string field);
    error UnexpectedListingCount(uint256 expected, uint256 actual);
    error UnexpectedCategoryCount(uint8 category, uint256 expected, uint256 actual);

    struct AgentPlan {
        uint256 erc8004AgentId;
        address agentWallet;
        Category category;
        /// @dev Display name, the same one the marketplace uses.
        string name;
        /// @dev The agent's directory at `ai/<slug>/app/agent` — used in the proof command.
        string slug;
        /// @dev What the decision engine actually does, with thresholds that are derived
        ///      (not guessed). Condensed from `docs/STATUS.md` §A5.
        string summary;
        /// @dev The number of tests a reader can re-run.
        string testCount;
    }

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);

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
        AgentPlan[3] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            AgentPlan memory p = plans[i];
            uint256 existing = registry.listingByAgentId(p.erc8004AgentId);
            if (existing != 0) {
                console.log("skipped (already listed):", p.name, existing);
                continue;
            }
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
        AgentPlan[3] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            AgentPlan memory p = plans[i];
            uint256 listingId = registry.listingByAgentId(p.erc8004AgentId);
            if (listingId == 0) revert ListingMismatch(0, "not listed");
            _verifyListing(registry, listingId, p);
        }

        uint256 total = registry.listingCount();
        if (total != EXPECTED_TOTAL_LISTINGS) revert UnexpectedListingCount(EXPECTED_TOTAL_LISTINGS, total);

        // All four categories must hold exactly one listing: that is why this script exists.
        for (uint8 c = 0; c <= uint8(Category.HEALTH_FACTOR); ++c) {
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
    ///      0 REBALANCING, 1 GRID, 2 YIELD, 3 HEALTH_FACTOR (Guardian, already live).
    function _plan() internal pure returns (AgentPlan[3] memory plans) {
        plans[0] = AgentPlan({
            erc8004AgentId: 8005,
            agentWallet: 0xb8f155D1278f0437b9De7c63911f2C0EDa485941,
            category: Category.REBALANCING,
            name: "Fugu Rebalancer",
            slug: "fugurebalancer",
            summary: "Drift-band rebalancer: a 500 bps band plus a 50 bps cost gate on turnover. The minimum economic turnover is derived from gas and budget (T >= gas * 10000 / (M - r)) and returns null when the budget makes rebalancing impossible, instead of quietly never trading.",
            testCount: "88"
        });
        plans[1] = AgentPlan({
            erc8004AgentId: 8006,
            agentWallet: 0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9,
            category: Category.GRID,
            name: "Fugu Grid",
            slug: "fugugrid",
            summary: "Grid trading on PancakeSwap v3: line spacing must be at least 2x the round-trip cost, measured at the upper bound where percentage spacing is tightest. Structurally mean-reverting, so its own backtest shows buy-and-hold beating it in a trending market.",
            testCount: "99"
        });
        plans[2] = AgentPlan({
            erc8004AgentId: 8007,
            agentWallet: 0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866,
            category: Category.YIELD,
            name: "Fugu Yield",
            slug: "fuguyield",
            summary: "Pool migration gated by breakEvenSpreadBps = ceil(cost * 10000 * 365 / (principal * days)) times a 2.00x safety multiplier. The threshold rises as principal or horizon shrinks ($10,000 over 30 days needs 390 bps, $200 needs 1582 bps), so highest APY is not the answer.",
            testCount: "93"
        });
    }

    /// @notice The listing metadata as `data:application/json;base64,...`.
    /// @dev Its contents deliberately name what does NOT exist yet. `onchainExecution:
    ///      false` and `limits` are the same sentences as `docs/STATUS.md` §B3 — the
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
            ',"limits":"Deterministic decision engine and backtest only. This agent has never sent an on-chain transaction. Hiring it records payment in escrow and does not start an autonomous loop yet. See docs/STATUS.md section B3."',
            ',"verify":"cd ai/', p.slug, '/app/agent && corepack pnpm test  # ', p.testCount, ' tests"',
            ',"erc8004Identity":"placeholder id, locally unique in FuguRegistry only: no ERC-8004 IdentityRegistry token has been minted for this wallet at ', vm.toString(ERC8004_IDENTITY_REGISTRY),
            '","chainId":97}'
        );
    }

    function _categoryName(Category c) internal pure returns (string memory) {
        if (c == Category.REBALANCING) return "REBALANCING";
        if (c == Category.GRID) return "GRID";
        if (c == Category.YIELD) return "YIELD";
        return "HEALTH_FACTOR";
    }

    function _logResult(FuguRegistry registry) internal view {
        console.log("== Result (re-read from chain) ==");
        console.log("listingCount          ", registry.listingCount());
        console.log("countByCategory(0) REBALANCING  ", registry.countByCategory(Category.REBALANCING));
        console.log("countByCategory(1) GRID         ", registry.countByCategory(Category.GRID));
        console.log("countByCategory(2) YIELD        ", registry.countByCategory(Category.YIELD));
        console.log("countByCategory(3) HEALTH_FACTOR", registry.countByCategory(Category.HEALTH_FACTOR));

        AgentPlan[3] memory plans = _plan();
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
