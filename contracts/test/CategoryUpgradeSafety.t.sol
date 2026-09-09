// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";
import {FuguRegistryLegacy, CategoryLegacy, ListingLegacy} from "./legacy/FuguRegistryLegacy.sol";

/// @title CategoryUpgradeSafetyTest
/// @notice Proves that widening `Category` from four values to nine does not change the
///         meaning of a single listing that was registered before the widening.
///
/// @dev ## Why this test is written the hard way
///
///      The obvious version of this test would register listings with the CURRENT
///      contract and read them back with the CURRENT contract. That proves nothing: both
///      halves would use the same enum, so a reordering would move the write and the read
///      together and everything would still match.
///
///      The listings that actually matter were written by the implementation deployed at
///      `0xd68968cf68e9930a689e0fc9d648a898050a548a`, which only knew four categories, and
///      they now live in the storage of the proxy at
///      `0xb2f36070E6eae3353E8e755172B477DF213ae248`. To reproduce that, every test here:
///
///        1. deploys a proxy over `FuguRegistryLegacy` (the frozen pre-expansion source,
///           see `test/legacy/FuguRegistryLegacy.sol`),
///        2. registers one listing per old category through the OLD code,
///        3. records what the OLD code says each listing is,
///        4. upgrades the proxy to today's `FuguRegistry`,
///        5. reads every listing back and compares.
///
///      Nothing in step 5 re-derives the expected value from today's enum: the expected
///      numbers are the raw indices the old code stored, written out as literals.
///
///      ## The mutation this test exists to catch
///
///      Insert a value anywhere before `HEALTH_FACTOR` in `src/types/FuguTypes.sol`, or
///      swap two of the first four lines, and `test_oldListingsKeepTheirCategoryAfterUpgrade`
///      fails. Verified by doing exactly that; see the report attached to this change.
contract CategoryUpgradeSafetyTest is Test {
    /// @dev The four categories that already exist in live storage, with the index each
    ///      one was stored as. These are literals ON PURPOSE. If a future edit reorders
    ///      the enum, this table must NOT be "fixed" to match: it is the record of what is
    ///      already on chain, and the enum is what has to move back.
    uint8 constant OLD_REBALANCING = 0;
    uint8 constant OLD_GRID = 1;
    uint8 constant OLD_YIELD = 2;
    uint8 constant OLD_HEALTH_FACTOR = 3;

    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);

    FuguRegistryLegacy legacy;
    address proxy;

    function setUp() public {
        proxy = address(
            new ERC1967Proxy(
                address(new FuguRegistryLegacy()), abi.encodeCall(FuguRegistryLegacy.initialize, (owner))
            )
        );
        legacy = FuguRegistryLegacy(proxy);
    }

    /// @dev Registers one listing per old category through the OLD implementation, in the
    ///      same order the live registry was filled: HEALTH_FACTOR first (Guardian, listing
    ///      1), then REBALANCING, GRID, YIELD.
    function _seedLegacyListings() internal returns (uint256[4] memory ids) {
        vm.startPrank(creator);
        ids[0] = legacy.list(8004, address(0xBDC6), CategoryLegacy.HEALTH_FACTOR, 10_000_000, 120, "guardian");
        ids[1] = legacy.list(8005, address(0xB8F1), CategoryLegacy.REBALANCING, 5_000_000, 120, "rebalancer");
        ids[2] = legacy.list(8006, address(0x2AA5), CategoryLegacy.GRID, 5_000_000, 120, "grid");
        ids[3] = legacy.list(8007, address(0x15DE), CategoryLegacy.YIELD, 5_000_000, 120, "yield");
        vm.stopPrank();
    }

    /// @dev The new implementation is deployed BEFORE the prank: `new` is itself a call,
    ///      so deploying inside `vm.prank(owner)` would spend the prank on the CREATE and
    ///      leave the upgrade to be sent by this test contract, which is not the owner.
    function _upgradeToCurrent() internal returns (FuguRegistry) {
        address newImpl = address(new FuguRegistry());
        vm.prank(owner);
        legacy.upgradeToAndCall(newImpl, "");
        return FuguRegistry(proxy);
    }

    // -----------------------------------------------------------------------------
    // The proof
    // -----------------------------------------------------------------------------

    /// @notice Every listing written by the four-category implementation reads back with
    ///         the same category after the proxy is upgraded to the nine-category one.
    function test_oldListingsKeepTheirCategoryAfterUpgrade() public {
        uint256[4] memory ids = _seedLegacyListings();

        // What the OLD code says, read through the OLD implementation.
        uint8[4] memory before;
        for (uint256 i = 0; i < 4; ++i) {
            before[i] = uint8(legacy.getListing(ids[i]).category);
        }
        assertEq(before[0], OLD_HEALTH_FACTOR, "guardian was not stored as 3");
        assertEq(before[1], OLD_REBALANCING, "rebalancer was not stored as 0");
        assertEq(before[2], OLD_GRID, "grid was not stored as 1");
        assertEq(before[3], OLD_YIELD, "yield was not stored as 2");

        FuguRegistry upgraded = _upgradeToCurrent();

        // ...and the same raw indices come back out of the new implementation.
        for (uint256 i = 0; i < 4; ++i) {
            assertEq(uint8(upgraded.getListing(ids[i]).category), before[i], "category changed across upgrade");
        }

        // Read as names, the way the marketplace reads them: a listing registered as
        // HEALTH_FACTOR must still BE HEALTH_FACTOR, not whatever now sits at index 3.
        assertEq(uint8(upgraded.getListing(ids[0]).category), uint8(Category.HEALTH_FACTOR));
        assertEq(uint8(upgraded.getListing(ids[1]).category), uint8(Category.REBALANCING));
        assertEq(uint8(upgraded.getListing(ids[2]).category), uint8(Category.GRID));
        assertEq(uint8(upgraded.getListing(ids[3]).category), uint8(Category.YIELD));
    }

    /// @notice The rest of each listing survives too, not only its category. A struct that
    ///         gained a wider enum must not shift `priceUsd8PerPeriod` or anything after it.
    function test_wholeListingStructSurvivesTheUpgrade() public {
        uint256[4] memory ids = _seedLegacyListings();

        ListingLegacy memory guardianBefore = legacy.getListing(ids[0]);
        FuguRegistry upgraded = _upgradeToCurrent();
        Listing memory guardianAfter = upgraded.getListing(ids[0]);

        assertEq(guardianAfter.erc8004AgentId, guardianBefore.erc8004AgentId);
        assertEq(guardianAfter.owner, guardianBefore.owner);
        assertEq(guardianAfter.agentWallet, guardianBefore.agentWallet);
        assertEq(uint8(guardianAfter.category), uint8(guardianBefore.category));
        assertEq(guardianAfter.priceUsd8PerPeriod, guardianBefore.priceUsd8PerPeriod);
        assertEq(guardianAfter.periodSeconds, guardianBefore.periodSeconds);
        assertEq(guardianAfter.active, guardianBefore.active);
        assertEq(guardianAfter.curated, guardianBefore.curated);
        assertEq(guardianAfter.metadataURI, guardianBefore.metadataURI);

        // hard literals, so the assertion above cannot pass by comparing two wrong values
        assertEq(guardianAfter.erc8004AgentId, 8004);
        assertEq(guardianAfter.priceUsd8PerPeriod, 10_000_000);
        assertEq(guardianAfter.periodSeconds, 120);
        assertEq(guardianAfter.metadataURI, "guardian");
    }

    /// @notice `_countByCategory` is keyed by the enum index, so a shifted enum would make
    ///         the new code count under keys nobody ever wrote to.
    function test_categoryCountsStillFindTheOldKeys() public {
        _seedLegacyListings();
        FuguRegistry upgraded = _upgradeToCurrent();

        assertEq(upgraded.countByCategory(Category.REBALANCING), 1);
        assertEq(upgraded.countByCategory(Category.GRID), 1);
        assertEq(upgraded.countByCategory(Category.YIELD), 1);
        assertEq(upgraded.countByCategory(Category.HEALTH_FACTOR), 1);

        // the five appended categories start empty; they were never written to
        assertEq(upgraded.countByCategory(Category.HIRING), 0);
        assertEq(upgraded.countByCategory(Category.COMMERCE), 0);
        assertEq(upgraded.countByCategory(Category.AUTONOMOUS), 0);
        assertEq(upgraded.countByCategory(Category.STREAMING), 0);
        assertEq(upgraded.countByCategory(Category.TREASURY), 0);
    }

    /// @notice `listingCount` and `listingByAgentId` are untouched by the widening, so the
    ///         next listing continues the sequence instead of overwriting listing 1.
    function test_listingSequenceContinuesAfterUpgrade() public {
        uint256[4] memory ids = _seedLegacyListings();
        assertEq(legacy.listingCount(), 4);

        FuguRegistry upgraded = _upgradeToCurrent();
        assertEq(upgraded.listingCount(), 4);
        assertEq(upgraded.listingByAgentId(8004), ids[0]);
        assertEq(upgraded.listingByAgentId(8007), ids[3]);

        vm.prank(creator);
        uint256 newId = upgraded.list(8008, address(0xB01), Category.HIRING, 5_000_000, 120, "broker");
        assertEq(newId, 5);
        assertEq(upgraded.listingCount(), 5);

        // the four old listings are still exactly where they were
        for (uint256 i = 0; i < 4; ++i) {
            assertEq(upgraded.getListing(ids[i]).erc8004AgentId, 8004 + i);
        }
    }

    /// @notice A listing registered in one of the five NEW categories reads back as that
    ///         category, and does not collide with any old one.
    function test_newCategoriesRoundTrip() public {
        _seedLegacyListings();
        FuguRegistry upgraded = _upgradeToCurrent();

        Category[5] memory added = [
            Category.HIRING,
            Category.COMMERCE,
            Category.AUTONOMOUS,
            Category.STREAMING,
            Category.TREASURY
        ];
        for (uint256 i = 0; i < added.length; ++i) {
            vm.prank(creator);
            uint256 id = upgraded.list(9000 + i, address(uint160(0xC000 + i)), added[i], 5_000_000, 120, "x");
            assertEq(uint8(upgraded.getListing(id).category), uint8(added[i]));
            assertEq(upgraded.countByCategory(added[i]), 1);
        }
        assertEq(upgraded.listingCount(), 9);
    }

    /// @notice The enum indices themselves, spelled out. This is the cheapest possible
    ///         tripwire: it fails on a reorder even without deploying anything.
    /// @dev Deliberately duplicated with the upgrade test above. The upgrade test proves
    ///      the consequence (old listings change meaning), this one names the cause.
    function test_enumIndicesAreFrozen() public pure {
        assertEq(uint8(Category.REBALANCING), 0);
        assertEq(uint8(Category.GRID), 1);
        assertEq(uint8(Category.YIELD), 2);
        assertEq(uint8(Category.HEALTH_FACTOR), 3);
        assertEq(uint8(Category.HIRING), 4);
        assertEq(uint8(Category.COMMERCE), 5);
        assertEq(uint8(Category.AUTONOMOUS), 6);
        assertEq(uint8(Category.STREAMING), 7);
        assertEq(uint8(Category.TREASURY), 8);
    }

    /// @notice The frozen legacy copy must keep exactly four categories, or it stops being
    ///         a copy of what is deployed and the whole proof above dissolves.
    function test_legacyCopyStillHasExactlyFourCategories() public {
        // 3 is the last valid value: casting 4 into the old enum must revert.
        assertEq(uint8(type(CategoryLegacy).max), 3);

        vm.prank(creator);
        vm.expectRevert();
        this.listWithRawCategory(4);
    }

    /// @dev An external hop, so the panic from an out-of-range enum cast is catchable.
    function listWithRawCategory(uint8 raw) external {
        legacy.list(1234, address(0x1), CategoryLegacy(raw), 1, 1, "");
    }
}
