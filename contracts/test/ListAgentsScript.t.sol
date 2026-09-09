// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ListAgents} from "../script/ListAgents.s.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @dev Exposes the internals of `ListAgents` so the EXACT same registration path can
///      run against a local registry — with no env vars and no broadcast. Swapped
///      `list()` arguments (e.g. `agentWallet` with `category`) must be caught here, not
///      after tBNB has been burned.
contract ListAgentsHarness is ListAgents {
    function listAll(FuguRegistry registry) external {
        _listAll(registry);
    }

    function verifyAll(FuguRegistry registry) external view {
        _verifyAll(registry);
    }

    function plan() external pure returns (AgentPlan[8] memory) {
        return _plan();
    }

    function metadata(uint256 i) external pure returns (string memory) {
        return _metadata(_plan()[i]);
    }

    function metadataJson(uint256 i) external pure returns (string memory) {
        return _metadataJson(_plan()[i]);
    }
}

/// @dev A harness whose plan has one entry blanked out, to prove the guard that refuses to
///      write a zero `agentWallet` into a listing actually fires. `agentWallet` has no
///      setter and `updateListing` cannot reach it, so that mistake would be permanent.
contract ListAgentsMissingWalletHarness is ListAgentsHarness {
    function _plan() internal pure override returns (AgentPlan[8] memory plans) {
        plans = super._plan();
        plans[0].agentWallet = address(0);
    }
}

/// @notice `ListAgents.s.sol` must fill exactly the eight categories Guardian does not
///         occupy, with the right wallets and price, and metadata that states its own
///         limits.
contract ListAgentsScriptTest is Test {
    // The Altana wallets from `ai/<agent>/app/agent/studio.toml` — copied here so that a
    // silent change in the script fails a test instead of landing on chain.
    address constant WALLET_REBALANCER = 0xb8f155D1278f0437b9De7c63911f2C0EDa485941;
    address constant WALLET_GRID = 0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9;
    address constant WALLET_YIELD = 0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866;
    address constant WALLET_GUARDIAN = 0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0;

    /// @dev The plan has eight entries; Guardian is the ninth listing and is already live.
    uint256 constant PLAN_SIZE = 8;
    uint256 constant TOTAL_LISTINGS = 9;

    ListAgentsHarness harness;
    FuguRegistry registry;

    function setUp() public {
        harness = new ListAgentsHarness();
        registry = FuguRegistry(
            address(new ERC1967Proxy(
                address(new FuguRegistry()), abi.encodeCall(FuguRegistry.initialize, (address(this)))
            ))
        );
        // Mirror the testnet's starting state: one HEALTH_FACTOR listing (Guardian)
        // already exists with `erc8004AgentId` 8004, the other categories are empty.
        registry.list(8004, WALLET_GUARDIAN, Category.HEALTH_FACTOR, 10_000_000, 120, "ipfs://fugu-guardian-v1");
    }

    function test_planTargetsEveryCategoryGuardianDoesNotHold() public view {
        ListAgents.AgentPlan[8] memory plans = harness.plan();

        assertEq(uint8(plans[0].category), uint8(Category.REBALANCING));
        assertEq(uint8(plans[1].category), uint8(Category.GRID));
        assertEq(uint8(plans[2].category), uint8(Category.YIELD));
        assertEq(uint8(plans[3].category), uint8(Category.HIRING));
        assertEq(uint8(plans[4].category), uint8(Category.COMMERCE));
        assertEq(uint8(plans[5].category), uint8(Category.AUTONOMOUS));
        assertEq(uint8(plans[6].category), uint8(Category.STREAMING));
        assertEq(uint8(plans[7].category), uint8(Category.TREASURY));

        assertEq(plans[0].agentWallet, WALLET_REBALANCER);
        assertEq(plans[1].agentWallet, WALLET_GRID);
        assertEq(plans[2].agentWallet, WALLET_YIELD);

        // The IDs must be unique across entries AND must not collide with Guardian's 8004.
        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            assertEq(plans[i].erc8004AgentId, 8005 + i);
        }
    }

    /// @notice No category may be planned twice: `HIRING` written where `COMMERCE` belongs
    ///         would silently leave a category empty and double another.
    function test_categoriesAreDistinctAndCoverTheCatalog() public view {
        ListAgents.AgentPlan[8] memory plans = harness.plan();
        bool[9] memory seen;
        seen[uint8(Category.HEALTH_FACTOR)] = true; // Guardian, not in the plan
        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            uint8 c = uint8(plans[i].category);
            assertFalse(seen[c], "category planned twice");
            seen[c] = true;
        }
        for (uint256 c = 0; c < seen.length; ++c) {
            assertTrue(seen[c], "category left out of the catalog");
        }
    }

    /// @notice No agent may use another agent's wallet — swapped wallets mean the UI links
    ///         on-chain activity to the wrong listing. The zero address is exempt: it marks
    ///         an agent whose wallet does not exist yet, and `_listAll` refuses those.
    function test_walletsAreDistinct() public view {
        ListAgents.AgentPlan[8] memory plans = harness.plan();
        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            if (plans[i].agentWallet == address(0)) continue;
            assertTrue(plans[i].agentWallet != WALLET_GUARDIAN, "collides with Guardian");
            for (uint256 j = i + 1; j < PLAN_SIZE; ++j) {
                assertTrue(plans[i].agentWallet != plans[j].agentWallet, "two agents share a wallet");
            }
        }
    }

    /// @notice A plan entry with no wallet yet must stop the script, not be written to
    ///         chain with `agentWallet = address(0)`. There is no way to fix it afterwards.
    function test_listAllRefusesAnAgentWithNoWallet() public {
        ListAgentsHarness incomplete = new ListAgentsMissingWalletHarness();
        vm.expectRevert(abi.encodeWithSelector(ListAgents.AgentWalletNotAssigned.selector, "Fugu Rebalancer"));
        incomplete.listAll(registry);
    }

    function test_listAllFillsEveryCategoryExactlyOnce() public {
        _skipIfPlanIncomplete();
        harness.listAll(registry);

        assertEq(registry.listingCount(), TOTAL_LISTINGS);
        for (uint8 c = 0; c <= uint8(Category.TREASURY); ++c) {
            assertEq(registry.countByCategory(Category(c)), 1);
        }

        // `_verifyAll` is the same gate `run()` uses before broadcasting.
        harness.verifyAll(registry);
    }

    function test_listedFieldsMatchThePlan() public {
        _skipIfPlanIncomplete();
        harness.listAll(registry);
        ListAgents.AgentPlan[8] memory plans = harness.plan();

        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            uint256 listingId = registry.listingByAgentId(plans[i].erc8004AgentId);
            assertGt(listingId, 0);
            Listing memory l = registry.getListing(listingId);
            assertEq(l.erc8004AgentId, plans[i].erc8004AgentId);
            assertEq(l.agentWallet, plans[i].agentWallet);
            assertEq(uint8(l.category), uint8(plans[i].category));
            assertEq(l.priceUsd8PerPeriod, 5_000_000); // $0.05 on an 8-decimal basis
            assertEq(l.periodSeconds, 120);
            assertTrue(l.active);
            // `owner` = the caller of `list()` (the payout recipient), NOT `agentWallet`.
            assertEq(l.owner, address(harness));
            assertTrue(l.owner != l.agentWallet);
        }
    }

    /// @notice Re-running the script after some txs landed must neither duplicate listings
    ///         nor revert with `AgentAlreadyListed`.
    function test_listAllIsIdempotent() public {
        _skipIfPlanIncomplete();
        harness.listAll(registry);
        harness.listAll(registry);

        assertEq(registry.listingCount(), TOTAL_LISTINGS);
        for (uint8 c = 0; c <= uint8(Category.TREASURY); ++c) {
            assertEq(registry.countByCategory(Category(c)), 1);
        }
    }

    /// @notice The metadata must be valid JSON, and it must state for itself what the agent
    ///         cannot do: no agent in this plan has ever executed on chain, and an agent
    ///         with no code yet must say that too instead of quoting a test count.
    function test_metadataDeclaresWhatTheAgentCannotDo() public view {
        ListAgents.AgentPlan[8] memory plans = harness.plan();
        string[8] memory expectedCategory =
            ["REBALANCING", "GRID", "YIELD", "HIRING", "COMMERCE", "AUTONOMOUS", "STREAMING", "TREASURY"];

        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            string memory json = harness.metadataJson(i);
            assertFalse(vm.parseJsonBool(json, ".onchainExecution"));
            assertEq(vm.parseJsonBool(json, ".implemented"), plans[i].implemented);
            assertEq(vm.parseJsonString(json, ".category"), expectedCategory[i]);
            assertEq(vm.parseJsonString(json, ".name"), plans[i].name);
            assertEq(vm.parseJsonString(json, ".agent"), plans[i].slug);
            assertEq(vm.parseJsonAddress(json, ".agentWallet"), plans[i].agentWallet);
            assertGt(bytes(vm.parseJsonString(json, ".limits")).length, 0);
            assertGt(bytes(vm.parseJsonString(json, ".verify")).length, 0);
            assertGt(bytes(vm.parseJsonString(json, ".erc8004Identity")).length, 0);
        }
    }

    /// @notice An agent with no code must not be advertised with a test count, and one with
    ///         code must not be described as if it were empty. The two honest sentences are
    ///         different and must not be swapped.
    function test_unbuiltAgentsDoNotClaimATestSuite() public view {
        ListAgents.AgentPlan[8] memory plans = harness.plan();
        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            string memory json = harness.metadataJson(i);
            string memory limits = vm.parseJsonString(json, ".limits");
            string memory verify = vm.parseJsonString(json, ".verify");
            if (plans[i].implemented) {
                assertTrue(_contains(limits, "Deterministic decision engine"), "built agent lost its description");
                assertTrue(_contains(verify, "pnpm test"), "built agent has no runnable proof");
                assertTrue(_contains(verify, plans[i].testCount), "test count missing from the proof command");
            } else {
                assertTrue(_contains(limits, "Not built yet"), "unbuilt agent hides that it is unbuilt");
                assertFalse(_contains(verify, "pnpm test"), "unbuilt agent claims a test suite");
                assertEq(plans[i].testCount, "0");
            }
        }
    }

    /// @notice `metadataURI` must be a self-contained `data:` URI — not an `ipfs://` that
    ///         nobody can ever resolve.
    function test_metadataIsSelfContainedDataUri() public view {
        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            bytes memory uri = bytes(harness.metadata(i));
            string memory prefix = "data:application/json;base64,";
            bytes memory expected = bytes(prefix);
            assertGt(uri.length, expected.length);
            for (uint256 j = 0; j < expected.length; ++j) {
                assertEq(uri[j], expected[j]);
            }
            // base64 length = 4 * ceil(n / 3).
            uint256 jsonLen = bytes(harness.metadataJson(i)).length;
            assertEq(uri.length - expected.length, 4 * ((jsonLen + 2) / 3));
        }
    }

    /// @notice A zero price is rejected by the contract (`InvalidPrice`) — the plan must
    ///         not rely on a value that would revert on the network.
    function test_priceAndPeriodAreAcceptedByTheRegistry() public {
        _skipIfPlanIncomplete();
        harness.listAll(registry);
        Listing memory l = registry.getListing(registry.listingByAgentId(8005));
        assertGt(l.priceUsd8PerPeriod, 0);
        assertGt(l.periodSeconds, 0);
    }

    // -----------------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------------

    /// @dev The tests that register the WHOLE plan cannot run while an entry still has no
    ///      wallet, because `_listAll` refuses those on purpose. Skipping is honest here:
    ///      `test_listAllRefusesAnAgentWithNoWallet` covers that state, and the day the
    ///      last wallet is filled in these come back automatically. A skip is visible in
    ///      the runner output, unlike a test quietly rewritten to assert less.
    function _skipIfPlanIncomplete() internal {
        ListAgents.AgentPlan[8] memory plans = harness.plan();
        for (uint256 i = 0; i < PLAN_SIZE; ++i) {
            if (plans[i].agentWallet == address(0)) {
                vm.skip(true);
            }
        }
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i + n.length <= h.length; ++i) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return true;
        }
        return false;
    }
}
