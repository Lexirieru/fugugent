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

    function _list(address as_, Category cat) internal returns (uint256) {
        vm.prank(as_);
        return registry.list(42, address(0xA6E17), cat, 5_00000000, 30 days, "ipfs://meta");
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

    function test_onlyOwnerCanUpdateListing() public {
        uint256 id = _list(creator, Category.YIELD);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.NotListingOwner.selector, id));
        registry.setActive(id, false);
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
}
