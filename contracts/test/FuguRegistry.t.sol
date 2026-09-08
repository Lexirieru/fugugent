// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

contract FuguRegistryTest is Test {
    FuguRegistry registry;
    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);
    address stranger = address(0xBAD);

    function setUp() public {
        FuguRegistry impl = new FuguRegistry();
        registry = FuguRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(FuguRegistry.initialize, (owner))))
        );
    }

    /// @dev Every listing now needs a unique `erc8004AgentId`, so this helper bumps its
    ///      own nonce. Tests that care about a specific ID call `registry.list` directly.
    uint256 private _agentIdNonce = 41;

    function _list(address as_, Category cat) internal returns (uint256) {
        vm.prank(as_);
        return registry.list(++_agentIdNonce, address(0xA6E17), cat, 5_00000000, 30 days, "ipfs://meta");
    }

    function test_listAssignsSequentialIds() public {
        assertEq(_list(creator, Category.REBALANCING), 1);
        assertEq(_list(creator, Category.GRID), 2);
        assertEq(registry.listingCount(), 2);
    }

    function test_listStoresAllFields() public {
        uint256 id = _list(creator, Category.HEALTH_FACTOR);
        Listing memory l = registry.getListing(id);
        assertEq(l.erc8004AgentId, 42);
        assertEq(l.owner, creator);
        assertEq(uint8(l.category), uint8(Category.HEALTH_FACTOR));
        assertEq(l.priceUsd8PerPeriod, 5_00000000);
        assertEq(l.periodSeconds, 30 days);
        assertTrue(l.active);
        assertFalse(l.curated);
        assertEq(l.metadataURI, "ipfs://meta");
    }

    function test_countByCategoryTracksParity() public {
        _list(creator, Category.REBALANCING);
        _list(creator, Category.GRID);
        _list(creator, Category.GRID);
        assertEq(registry.countByCategory(Category.REBALANCING), 1);
        assertEq(registry.countByCategory(Category.GRID), 2);
        assertEq(registry.countByCategory(Category.YIELD), 0);
    }

    function test_revertsOnZeroPeriod() public {
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.InvalidPeriod.selector);
        registry.list(1, address(0xA6E17), Category.YIELD, 1e8, 0, "");
    }

    function test_onlyListingOwnerCanSetActive() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.NotListingOwner.selector, id));
        registry.setActive(id, false);
    }

    function test_updateListingChangesFields() public {
        uint256 id = _list(creator, Category.GRID);
        vm.prank(creator);
        registry.updateListing(id, 9_00000000, 7 days, "ipfs://new-meta");

        Listing memory l = registry.getListing(id);
        assertEq(l.priceUsd8PerPeriod, 9_00000000);
        assertEq(l.periodSeconds, 7 days);
        assertEq(l.metadataURI, "ipfs://new-meta");

        assertEq(l.erc8004AgentId, 42);
        assertEq(l.owner, creator);
        assertEq(uint8(l.category), uint8(Category.GRID));
        assertTrue(l.active);
    }

    function test_onlyListingOwnerCanUpdateListing() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.NotListingOwner.selector, id));
        registry.updateListing(id, 1_00000000, 1 days, "ipfs://hijacked");
    }

    function test_updateListingRejectsZeroPeriod() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.InvalidPeriod.selector);
        registry.updateListing(id, 1_00000000, 0, "ipfs://meta");
    }

    function test_updateListingEmitsEvent() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.expectEmit(true, false, false, true, address(registry));
        emit FuguRegistry.ListingUpdated(id, 3_00000000, 14 days, "ipfs://emitted");
        vm.prank(creator);
        registry.updateListing(id, 3_00000000, 14 days, "ipfs://emitted");
    }

    function test_setCuratedRevertsForUnknownListing() public {
        vm.prank(owner);
        registry.setCurator(stranger, true);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.ListingNotFound.selector, uint256(99)));
        registry.setCurated(99, true);
    }

    function test_listingOwnerCanDeactivate() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(creator);
        registry.setActive(id, false);
        assertFalse(registry.getListing(id).active);
    }

    function test_onlyCuratorCanCurate() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.NotCurator.selector);
        registry.setCurated(id, true);

        vm.prank(owner);
        registry.setCurator(stranger, true);
        vm.prank(stranger);
        registry.setCurated(id, true);
        assertTrue(registry.getListing(id).curated);
    }

    function test_getListingRevertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.ListingNotFound.selector, uint256(99)));
        registry.getListing(99);
    }

    // ---------------------------------------------------------------------
    // Item 4 — erc8004AgentId uniqueness and self-curation
    // ---------------------------------------------------------------------

    /// @notice Without this, anyone could re-list someone else's `erc8004AgentId` and
    ///         take payments in that identity's name.
    function test_cannotListSameAgentIdTwice() public {
        vm.prank(creator);
        uint256 first = registry.list(1234, address(0xA6E17), Category.GRID, 5_00000000, 30 days, "");

        // Not even the owner can register the same ID twice.
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.AgentAlreadyListed.selector, uint256(1234), first));
        registry.list(1234, address(0xA6E17), Category.GRID, 5_00000000, 30 days, "");

        // Let alone a squatter.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.AgentAlreadyListed.selector, uint256(1234), first));
        registry.list(1234, address(0xBAD), Category.YIELD, 1_00000000, 1 days, "ipfs://hijack");

        assertEq(registry.listingCount(), 1);
    }

    function test_listingByAgentIdPointsToListing() public {
        assertEq(registry.listingByAgentId(4242), 0);
        vm.prank(creator);
        uint256 id = registry.list(4242, address(0xA6E17), Category.GRID, 5_00000000, 30 days, "");
        assertEq(registry.listingByAgentId(4242), id);
        assertEq(registry.getListing(id).erc8004AgentId, 4242);
    }

    function test_differentAgentIdsStillAllowed() public {
        vm.startPrank(creator);
        uint256 a = registry.list(1, address(0xA6E17), Category.GRID, 5_00000000, 30 days, "");
        uint256 b = registry.list(2, address(0xA6E17), Category.GRID, 5_00000000, 30 days, "");
        vm.stopPrank();
        assertEq(a, 1);
        assertEq(b, 2);
    }

    function test_cannotCurateOwnListing() public {
        // `creator` is also a curator — still not allowed to stamp their own listing.
        vm.prank(owner);
        registry.setCurator(creator, true);

        uint256 id = _list(creator, Category.YIELD);
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.CannotCurateOwnListing.selector);
        registry.setCurated(id, true);
        assertFalse(registry.getListing(id).curated);

        // But someone else's listing can still be curated.
        uint256 other = _list(stranger, Category.YIELD);
        vm.prank(creator);
        registry.setCurated(other, true);
        assertTrue(registry.getListing(other).curated);
    }

    /// @notice The ban also applies when REMOVING the curated mark from your own listing.
    function test_cannotUncurateOwnListing() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(owner);
        registry.setCurator(stranger, true);
        vm.prank(stranger);
        registry.setCurated(id, true);

        vm.prank(owner);
        registry.setCurator(creator, true);
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.CannotCurateOwnListing.selector);
        registry.setCurated(id, false);
    }

    // ---------------------------------------------------------------------
    // Item 7 — zero price
    // ---------------------------------------------------------------------

    function test_listRejectsZeroPrice() public {
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.InvalidPrice.selector);
        registry.list(555, address(0xA6E17), Category.YIELD, 0, 30 days, "");
    }

    function test_updateListingRejectsZeroPrice() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.InvalidPrice.selector);
        registry.updateListing(id, 0, 30 days, "");
        // the old price is unchanged
        assertEq(registry.getListing(id).priceUsd8PerPeriod, 5_00000000);
    }
}
