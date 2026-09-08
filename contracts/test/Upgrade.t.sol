// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguRegistryV2} from "./mocks/FuguRegistryV2.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

contract UpgradeTest is Test {
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

    function test_upgradePreservesStorage() public {
        vm.prank(creator);
        uint256 id = registry.list(7, address(0xA6E17), Category.YIELD, 3_00000000, 7 days, "ipfs://x");

        FuguRegistryV2 v2impl = new FuguRegistryV2();
        vm.prank(owner);
        registry.upgradeToAndCall(address(v2impl), "");

        FuguRegistryV2 upgraded = FuguRegistryV2(address(registry));
        assertEq(upgraded.version(), "v2");

        Listing memory l = upgraded.getListing(id);
        assertEq(l.erc8004AgentId, 7);
        assertEq(l.owner, creator);
        assertEq(l.priceUsd8PerPeriod, 3_00000000);
        assertEq(l.metadataURI, "ipfs://x");
        assertEq(upgraded.listingCount(), 1);
        assertEq(upgraded.countByCategory(Category.YIELD), 1);

        // slot baru mulai dari nol dan bisa dipakai
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(99);
        assertEq(upgraded.extraField(), 99);
    }

    function test_nonOwnerCannotUpgrade() public {
        FuguRegistryV2 v2impl = new FuguRegistryV2();
        vm.prank(stranger);
        vm.expectRevert();
        registry.upgradeToAndCall(address(v2impl), "");
    }

    function test_implementationCannotBeInitialized() public {
        FuguRegistry impl = new FuguRegistry();
        vm.expectRevert();
        impl.initialize(owner);
    }
}
