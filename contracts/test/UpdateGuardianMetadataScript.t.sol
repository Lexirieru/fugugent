// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UpdateGuardianMetadata} from "../script/UpdateGuardianMetadata.s.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @dev Exposes the internal parts of `UpdateGuardianMetadata` so the exact path that
///      will run on testnet can run against a local registry — no env vars, no
///      broadcast. `updateListing` overwrites price and period along with the URI, so
///      a swapped argument must be caught here rather than on a live listing.
contract UpdateGuardianHarness is UpdateGuardianMetadata {
    function updateMetadata(FuguRegistry registry) external {
        _updateMetadata(registry);
    }

    function verify(FuguRegistry registry, Listing memory before) external view {
        _verify(registry, before);
    }

    function metadata() external pure returns (string memory) {
        return _metadata();
    }

    function metadataJson() external pure returns (string memory) {
        return _metadataJson();
    }
}

/// @notice Listing 1 must end up with readable metadata and an untouched price.
contract UpdateGuardianMetadataScriptTest is Test {
    address constant DEPLOYER_EOA = 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E;
    address constant GUARDIAN_ALTANA_WALLET = 0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0;

    uint128 constant LIVE_PRICE_USD8 = 10_000_000; // $0.10, base 8 decimals
    uint32 constant LIVE_PERIOD_SECONDS = 120;

    UpdateGuardianHarness harness;
    FuguRegistry registry;

    function setUp() public {
        harness = new UpdateGuardianHarness();
        registry = FuguRegistry(
            address(new ERC1967Proxy(
                address(new FuguRegistry()), abi.encodeCall(FuguRegistry.initialize, (address(this)))
            ))
        );
        // Mirror listing 1 as it exists on testnet: agent id 8004, HEALTH_FACTOR, the
        // deployer EOA in `agentWallet`, and the unreadable ipfs placeholder. The
        // harness must be the owner, because `updateListing` is owner-only.
        vm.prank(address(harness));
        registry.list(
            8004, DEPLOYER_EOA, Category.HEALTH_FACTOR, LIVE_PRICE_USD8, LIVE_PERIOD_SECONDS, "ipfs://fugu-guardian-v1"
        );
    }

    function test_priceAndPeriodSurviveTheUpdate() public {
        Listing memory before = registry.getListing(1);
        assertEq(before.priceUsd8PerPeriod, LIVE_PRICE_USD8);
        assertEq(before.periodSeconds, LIVE_PERIOD_SECONDS);

        harness.updateMetadata(registry);

        Listing memory after_ = registry.getListing(1);
        assertEq(after_.priceUsd8PerPeriod, LIVE_PRICE_USD8);
        assertEq(after_.periodSeconds, LIVE_PERIOD_SECONDS);
        // Same gate `run()` uses after broadcasting.
        harness.verify(registry, before);
    }

    function test_metadataBecomesAReadableDataUri() public {
        harness.updateMetadata(registry);
        Listing memory l = registry.getListing(1);

        bytes memory uri = bytes(l.metadataURI);
        bytes memory prefix = bytes("data:application/json;base64,");
        assertGt(uri.length, prefix.length);
        for (uint256 i = 0; i < prefix.length; ++i) {
            assertEq(uri[i], prefix[i]);
        }
        // Base64 length is 4 * ceil(n / 3) of the JSON it wraps.
        uint256 jsonLen = bytes(harness.metadataJson()).length;
        assertEq(uri.length - prefix.length, 4 * ((jsonLen + 2) / 3));
    }

    /// @notice The one field that separates Guardian from the other three listings.
    function test_metadataDeclaresOnchainExecutionTrue() public view {
        string memory json = harness.metadataJson();
        assertTrue(vm.parseJsonBool(json, ".onchainExecution"));
        assertEq(vm.parseJsonString(json, ".name"), "Fugu Guardian");
        assertEq(vm.parseJsonString(json, ".agent"), "fuguguardian");
        assertEq(vm.parseJsonString(json, ".category"), "HEALTH_FACTOR");
        assertGt(bytes(vm.parseJsonString(json, ".summary")).length, 0);
        assertGt(bytes(vm.parseJsonString(json, ".proof")).length, 0);
        assertGt(bytes(vm.parseJsonString(json, ".limits")).length, 0);
        assertGt(bytes(vm.parseJsonString(json, ".verify")).length, 0);
    }

    /// @notice The metadata declares the wallet that actually signs, which is NOT the
    ///         listing's on-chain `agentWallet`. The disagreement is deliberate — the
    ///         backend reports it — so it must not be silently "fixed" to match.
    function test_metadataDeclaresTheAltanaWalletAndSaysWhyItDiffers() public {
        harness.updateMetadata(registry);
        Listing memory l = registry.getListing(1);

        assertEq(vm.parseJsonAddress(harness.metadataJson(), ".agentWallet"), GUARDIAN_ALTANA_WALLET);
        // `updateListing` cannot touch `agentWallet`; it is still the deployer EOA.
        assertEq(l.agentWallet, DEPLOYER_EOA);
        assertTrue(l.agentWallet != GUARDIAN_ALTANA_WALLET);
        // And the limitation is stated in the metadata itself, not only in the docs.
        string memory limits = vm.parseJsonString(harness.metadataJson(), ".limits");
        assertTrue(vm.contains(limits, "agentWallet"));
        assertTrue(vm.contains(limits, vm.toString(DEPLOYER_EOA)));
    }

    /// @notice Nothing else about the listing may move.
    function test_categoryOwnerAndCountsAreUntouched() public {
        harness.updateMetadata(registry);
        Listing memory l = registry.getListing(1);

        assertEq(uint8(l.category), uint8(Category.HEALTH_FACTOR));
        assertEq(l.erc8004AgentId, 8004);
        assertEq(l.owner, address(harness));
        assertTrue(l.active);
        assertEq(registry.listingCount(), 1);
        assertEq(registry.countByCategory(Category.HEALTH_FACTOR), 1);
    }

    /// @notice If the live price ever differs from what the script was reviewed against,
    ///         it must abort rather than write a number nobody checked.
    function test_abortsWhenLivePriceIsNotTheReviewedOne() public {
        vm.prank(address(harness));
        registry.updateListing(1, LIVE_PRICE_USD8 + 1, LIVE_PERIOD_SECONDS, "ipfs://fugu-guardian-v1");

        vm.expectRevert(
            abi.encodeWithSelector(
                UpdateGuardianMetadata.UnexpectedPrice.selector, LIVE_PRICE_USD8, LIVE_PRICE_USD8 + 1
            )
        );
        harness.updateMetadata(registry);
    }

    function test_abortsWhenLivePeriodIsNotTheReviewedOne() public {
        vm.prank(address(harness));
        registry.updateListing(1, LIVE_PRICE_USD8, LIVE_PERIOD_SECONDS + 1, "ipfs://fugu-guardian-v1");

        vm.expectRevert(
            abi.encodeWithSelector(
                UpdateGuardianMetadata.UnexpectedPeriod.selector, LIVE_PERIOD_SECONDS, LIVE_PERIOD_SECONDS + 1
            )
        );
        harness.updateMetadata(registry);
    }

    /// @notice Running it twice is harmless: the same URI is written again.
    function test_updateIsIdempotent() public {
        harness.updateMetadata(registry);
        string memory first = registry.getListing(1).metadataURI;
        harness.updateMetadata(registry);
        assertEq(registry.getListing(1).metadataURI, first);
        assertEq(registry.getListing(1).priceUsd8PerPeriod, LIVE_PRICE_USD8);
    }
}
