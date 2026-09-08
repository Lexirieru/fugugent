// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
import {FuguRegistryV2} from "./mocks/FuguRegistryV2.sol";
import {FuguSubscriptionV2} from "./mocks/FuguSubscriptionV2.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract UpgradeTest is Test {
    FuguRegistry registry;
    FuguPriceOracle oracle;
    FuguSubscription subs;
    MockERC20 usdt;
    MockAggregator usdtFeed;

    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);
    address stranger = address(0xBAD);
    address treasury = address(0x7EA);
    address user = address(0x5E1);

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

    function _setupSubscription() internal {
        vm.warp(1_700_000_000);

        FuguRegistry rImpl = new FuguRegistry();
        registry = FuguRegistry(
            address(new ERC1967Proxy(address(rImpl), abi.encodeCall(FuguRegistry.initialize, (owner))))
        );

        FuguPriceOracle oImpl = new FuguPriceOracle();
        oracle = FuguPriceOracle(
            address(new ERC1967Proxy(address(oImpl), abi.encodeCall(FuguPriceOracle.initialize, (owner))))
        );

        FuguSubscription sImpl = new FuguSubscription();
        subs = FuguSubscription(
            payable(address(new ERC1967Proxy(
                address(sImpl),
                abi.encodeCall(FuguSubscription.initialize, (owner, address(registry), address(oracle), treasury, 500))
            )))
        );

        usdt = new MockERC20("Tether", "USDT");
        usdtFeed = new MockAggregator(8, 1_00000000);

        vm.startPrank(owner);
        oracle.setToken(
            address(usdt),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(usdtFeed),
                maxStaleness: 90000,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        vm.stopPrank();

        usdt.mint(user, 1000e18);
        vm.prank(user);
        usdt.approve(address(subs), type(uint256).max);
    }

    function test_subscriptionUpgradePreservesEscrowState() public {
        _setupSubscription();

        // Create listing: $10 per 30 hari
        vm.prank(creator);
        uint256 listingId = registry.list(1, address(0xA6E17), Category.GRID, 10_00000000, 30 days, "");

        // Subscribe untuk 1 periode (30 hari, $10 = 10 token)
        vm.prank(user);
        uint256 subId = subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);

        // Majukan waktu ke separuh periode (15 hari)
        vm.warp(block.timestamp + 15 days);

        // Catat state sebelum upgrade
        FuguSubscription.Sub memory subBefore = subs.getSub(subId);
        uint256 claimableBefore = subs.claimable(subId);
        uint256 subsTokenBalBefore = usdt.balanceOf(address(subs));

        // Upgrade ke V2
        FuguSubscriptionV2 v2impl = new FuguSubscriptionV2();
        vm.prank(owner);
        subs.upgradeToAndCall(address(v2impl), "");

        // Cast ke V2
        FuguSubscriptionV2 upgraded = FuguSubscriptionV2(payable(address(subs)));

        // Verifikasi upgrade terjadi
        assertEq(upgraded.version(), "v2");

        // Verifikasi state escrow tetap sama
        FuguSubscription.Sub memory subAfter = upgraded.getSub(subId);
        assertEq(subAfter.listingId, subBefore.listingId);
        assertEq(subAfter.subscriber, subBefore.subscriber);
        assertEq(subAfter.payToken, subBefore.payToken);
        assertEq(subAfter.deposited, subBefore.deposited);
        assertEq(subAfter.claimed, subBefore.claimed);
        assertEq(subAfter.startedAt, subBefore.startedAt);
        assertEq(subAfter.endsAt, subBefore.endsAt);
        assertEq(subAfter.cancelled, subBefore.cancelled);
        assertEq(subAfter.feeBps, subBefore.feeBps);

        // Verifikasi claimable tetap sama
        uint256 claimableAfter = upgraded.claimable(subId);
        assertEq(claimableAfter, claimableBefore);

        // Verifikasi saldo token tetap sama
        assertEq(usdt.balanceOf(address(upgraded)), subsTokenBalBefore);

        // Verifikasi slot baru tersedia
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(77);
        assertEq(upgraded.extraField(), 77);

        // Verifikasi claim masih berfungsi: claim $5 yang sudah accrued
        uint256 creatorBalBefore = usdt.balanceOf(creator);
        uint256 treasuryBalBefore = usdt.balanceOf(treasury);
        upgraded.claim(subId);

        // fee 5% dari 5 token = 0.25 token
        uint256 expectedFee = (5e18 * 500) / 10_000;
        uint256 expectedToCreator = 5e18 - expectedFee;
        assertEq(usdt.balanceOf(creator), creatorBalBefore + expectedToCreator);
        assertEq(usdt.balanceOf(treasury), treasuryBalBefore + expectedFee);
    }

    function test_subscriptionNonOwnerCannotUpgrade() public {
        _setupSubscription();

        FuguSubscriptionV2 v2impl = new FuguSubscriptionV2();
        vm.prank(stranger);
        vm.expectRevert();
        subs.upgradeToAndCall(address(v2impl), "");
    }

    // ---------------------------------------------------------------------
    // Variabel state baru dari perbaikan review akhir — append-only
    // ---------------------------------------------------------------------

    /// @notice Variabel state yang ditambahkan pada perbaikan review akhir
    ///         (`minPaidBpsOfPeriod`, `_periodPriceRef`, `listingByAgentId`) diletakkan
    ///         di AKHIR daftar state, sehingga slot lama tidak bergeser dan `extraField`
    ///         milik V2 tetap dimulai dari nol.
    function test_newStateVarsAppendOnlyAcrossUpgrade() public {
        _setupSubscription();

        vm.prank(creator);
        uint256 listingId = registry.list(1, address(0xA6E17), Category.GRID, 10_00000000, 30 days, "");

        vm.prank(user);
        uint256 subId = subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);

        vm.warp(block.timestamp + 20 days);
        subs.claim(subId);

        assertEq(subs.minPaidBpsOfPeriod(), 5000);
        assertEq(subs.periodPriceRef(listingId, user), 10e18);
        assertTrue(subs.hasSubscribed(listingId, user));
        uint256 paidBefore = subs.paidToAgent(listingId, user);

        FuguSubscriptionV2 v2impl = new FuguSubscriptionV2();
        vm.prank(owner);
        subs.upgradeToAndCall(address(v2impl), "");
        FuguSubscriptionV2 upgraded = FuguSubscriptionV2(payable(address(subs)));

        // Nilai variabel baru selamat melewati upgrade...
        assertEq(upgraded.minPaidBpsOfPeriod(), 5000);
        assertEq(upgraded.periodPriceRef(listingId, user), 10e18);
        assertEq(upgraded.paidToAgent(listingId, user), paidBefore);
        assertTrue(upgraded.hasSubscribed(listingId, user));

        // ...dan slot V2 yang ditambahkan sesudahnya tetap perawan.
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(123);
        assertEq(upgraded.extraField(), 123);
        // menulis slot baru tidak merusak yang lama
        assertEq(upgraded.minPaidBpsOfPeriod(), 5000);
        assertEq(upgraded.periodPriceRef(listingId, user), 10e18);
    }

    /// @notice `listingByAgentId` juga ditambahkan di akhir dan selamat melewati upgrade.
    function test_registryListingByAgentIdSurvivesUpgrade() public {
        vm.prank(creator);
        uint256 id = registry.list(7, address(0xA6E17), Category.YIELD, 3_00000000, 7 days, "ipfs://x");
        assertEq(registry.listingByAgentId(7), id);

        FuguRegistryV2 v2impl = new FuguRegistryV2();
        vm.prank(owner);
        registry.upgradeToAndCall(address(v2impl), "");
        FuguRegistryV2 upgraded = FuguRegistryV2(address(registry));

        assertEq(upgraded.listingByAgentId(7), id);
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(5);
        assertEq(upgraded.listingByAgentId(7), id);
    }

    /// @notice Proxy lama (yang `initialize`-nya sudah jalan sebelum ambang ini ada)
    ///         mengisi `minPaidBpsOfPeriod` lewat `initializeV2`, dan hanya sekali.
    function test_initializeV2SetsMinPaidBpsOnUpgradedProxy() public {
        _setupSubscription();

        // Simulasikan proxy lama: paksa slot ambang kembali ke 0 seperti kondisi
        // sebelum variabel ini ada.
        vm.prank(owner);
        subs.setMinPaidBpsOfPeriod(0);
        assertEq(subs.minPaidBpsOfPeriod(), 0);

        FuguSubscriptionV2 v2impl = new FuguSubscriptionV2();
        vm.prank(owner);
        subs.upgradeToAndCall(address(v2impl), abi.encodeCall(FuguSubscription.initializeV2, ()));

        assertEq(subs.minPaidBpsOfPeriod(), 5000);

        // Tidak bisa dipanggil dua kali.
        vm.expectRevert();
        subs.initializeV2();
    }
}
