// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PlainSummaries} from "../script/PlainSummaries.s.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @dev Exposes the internals so the exact path that will run on testnet runs here first:
///      no env vars, no broadcast, and no tBNB spent to find out that one field of a live
///      listing was overwritten by mistake.
contract PlainSummariesHarness is PlainSummaries {
    function rewriteAll(FuguRegistry registry, address sender) external {
        _rewriteAll(registry, sender);
    }

    function rewriteSummary(string memory uri, string memory summary) external pure returns (string memory) {
        return _rewriteSummary(uri, summary);
    }

    function decodeBase64(string memory data) external pure returns (bytes memory) {
        return _decodeBase64(data);
    }
}

contract PlainSummariesScriptTest is Test {
    PlainSummariesHarness harness;
    FuguRegistry registry;
    /// The harness is what calls `updateListing`, so it has to be the listing owner here.
    /// On testnet the broadcasting EOA is both, which is the same shape.
    address owner;

    /// The four ids the script guards on, in listing order.
    uint256[4] AGENT_IDS = [uint256(8004), 8005, 8006, 8007];
    Category[4] CATS = [Category.HEALTH_FACTOR, Category.REBALANCING, Category.GRID, Category.YIELD];

    function setUp() public {
        harness = new PlainSummariesHarness();
        owner = address(harness);
        FuguRegistry impl = new FuguRegistry();
        registry =
            FuguRegistry(address(new ERC1967Proxy(address(impl), abi.encodeCall(FuguRegistry.initialize, (owner)))));

        vm.startPrank(owner);
        for (uint256 i = 0; i < 4; ++i) {
            registry.list(
                AGENT_IDS[i],
                address(uint160(0xBEEF0000 + i)),
                CATS[i],
                10_000_000,
                120,
                _liveShapedMetadata(i)
            );
        }
        vm.stopPrank();
    }

    /// @dev The same shape the live listings hold: a base64 data URI whose JSON carries a
    ///      jargon-heavy `summary` plus evidence fields that must survive untouched.
    function _liveShapedMetadata(uint256 i) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"name":"Agent ',
            vm.toString(i),
            '","summary":"Drift-band rebalancer: T >= gas * 10000 / (M - r), returns null.',
            '","limits":"It can decide but it cannot act.',
            '","verify":"corepack pnpm test  # 88 tests","chainId":97}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _json(uint256 listingId) internal view returns (string memory) {
        string memory uri = registry.getListing(listingId).metadataURI;
        bytes memory raw = bytes(uri);
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory b64 = new bytes(raw.length - prefix.length);
        for (uint256 i = 0; i < b64.length; ++i) b64[i] = raw[i + prefix.length];
        return string(harness.decodeBase64(string(b64)));
    }

    function test_base64RoundTripsThroughOurDecoder() public view {
        // Three lengths so every padding case is covered: 0, 1 and 2 `=`.
        string[3] memory samples = ["abc", "abcd", "abcde"];
        for (uint256 i = 0; i < samples.length; ++i) {
            bytes memory back = harness.decodeBase64(Base64.encode(bytes(samples[i])));
            assertEq(string(back), samples[i], "base64 round trip");
        }
    }

    function test_rewritesEverySummaryAndLeavesTheEvidenceAlone() public {
        harness.rewriteAll(registry, owner);

        for (uint256 id = 1; id <= 4; ++id) {
            string memory json = _json(id);
            // The jargon is gone from the sentence a buyer reads...
            assertEq(vm.indexOf(json, "gas * 10000"), type(uint256).max, "jargon still on the card");
            // ...and the evidence fields are byte-identical.
            assertTrue(vm.indexOf(json, "It can decide but it cannot act.") != type(uint256).max, "limits lost");
            assertTrue(vm.indexOf(json, "corepack pnpm test  # 88 tests") != type(uint256).max, "verify lost");
        }
    }

    function test_priceAndPeriodAndWalletDoNotMove() public {
        Listing[4] memory before;
        for (uint256 id = 1; id <= 4; ++id) before[id - 1] = registry.getListing(id);

        harness.rewriteAll(registry, owner);

        for (uint256 id = 1; id <= 4; ++id) {
            Listing memory a = registry.getListing(id);
            assertEq(a.priceUsd8PerPeriod, before[id - 1].priceUsd8PerPeriod, "price moved");
            assertEq(a.periodSeconds, before[id - 1].periodSeconds, "period moved");
            assertEq(a.agentWallet, before[id - 1].agentWallet, "agentWallet moved");
            assertEq(uint8(a.category), uint8(before[id - 1].category), "category moved");
        }
    }

    /// The guard that matters most: a listing id that no longer holds the agent it used to
    /// must stop the script rather than rewrite a stranger's listing.
    function test_revertsWhenTheListingHoldsADifferentAgent() public {
        FuguRegistry impl = new FuguRegistry();
        FuguRegistry other =
            FuguRegistry(address(new ERC1967Proxy(address(impl), abi.encodeCall(FuguRegistry.initialize, (owner)))));
        vm.prank(owner);
        other.list(9999, address(0xBEEF), Category.HEALTH_FACTOR, 10_000_000, 120, _liveShapedMetadata(0));

        vm.expectRevert(abi.encodeWithSelector(PlainSummaries.WrongListing.selector, 1, 8004, 9999));
        harness.rewriteAll(other, owner);
    }

    function test_revertsWhenTheBroadcasterIsNotTheListingOwner() public {
        address stranger = address(0xBAD);
        vm.expectRevert(abi.encodeWithSelector(PlainSummaries.NotListingOwner.selector, owner, stranger));
        harness.rewriteAll(registry, stranger);
    }

    /// A rewrite that changed nothing would look like success and ship the old card.
    function test_revertsIfTheMetadataWouldNotActuallyChange() public {
        harness.rewriteAll(registry, owner);
        vm.expectRevert(abi.encodeWithSelector(PlainSummaries.MetadataUnchanged.selector, uint256(1)));
        harness.rewriteAll(registry, owner);
    }
}
