// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
import {FuguRegistryV2} from "./mocks/FuguRegistryV2.sol";
import {FuguSubscriptionV2} from "./mocks/FuguSubscriptionV2.sol";
import {FuguAuditEscrow} from "../src/FuguAuditEscrow.sol";
import {FuguAuditEscrowV2} from "./mocks/FuguAuditEscrowV2.sol";
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

        // the new slot starts at zero and is usable
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

        // Create listing: $10 per 30 days
        vm.prank(creator);
        uint256 listingId = registry.list(1, address(0xA6E17), Category.GRID, 10_00000000, 30 days, "");

        // Subscribe for 1 period (30 days, $10 = 10 tokens)
        vm.prank(user);
        uint256 subId = subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);

        // Advance time to half the period (15 days)
        vm.warp(block.timestamp + 15 days);

        // Record the state before the upgrade
        FuguSubscription.Sub memory subBefore = subs.getSub(subId);
        uint256 claimableBefore = subs.claimable(subId);
        uint256 subsTokenBalBefore = usdt.balanceOf(address(subs));

        // Upgrade to V2
        FuguSubscriptionV2 v2impl = new FuguSubscriptionV2();
        vm.prank(owner);
        subs.upgradeToAndCall(address(v2impl), "");

        // Cast to V2
        FuguSubscriptionV2 upgraded = FuguSubscriptionV2(payable(address(subs)));

        // Verify the upgrade happened
        assertEq(upgraded.version(), "v2");

        // Verify the escrow state is unchanged
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

        // Verify claimable is unchanged
        uint256 claimableAfter = upgraded.claimable(subId);
        assertEq(claimableAfter, claimableBefore);

        // Verify the token balance is unchanged
        assertEq(usdt.balanceOf(address(upgraded)), subsTokenBalBefore);

        // Verify the new slot is available
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(77);
        assertEq(upgraded.extraField(), 77);

        // Verify claim still works: claim the $5 already accrued
        uint256 creatorBalBefore = usdt.balanceOf(creator);
        uint256 treasuryBalBefore = usdt.balanceOf(treasury);
        upgraded.claim(subId);

        // a 5% fee on 5 tokens = 0.25 tokens
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
    // New state variables from the final review fixes — append-only
    // ---------------------------------------------------------------------

    /// @notice The state variables added in the final review fixes
    ///         (`minPaidBpsOfPeriod`, `_periodPriceRef`, `listingByAgentId`) are placed at
    ///         the END of the state list, so the old slots do not shift and V2's
    ///         `extraField` still starts at zero.
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

        // The new variables' values survive the upgrade...
        assertEq(upgraded.minPaidBpsOfPeriod(), 5000);
        assertEq(upgraded.periodPriceRef(listingId, user), 10e18);
        assertEq(upgraded.paidToAgent(listingId, user), paidBefore);
        assertTrue(upgraded.hasSubscribed(listingId, user));

        // ...and the V2 slot appended after them is still untouched.
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(123);
        assertEq(upgraded.extraField(), 123);
        // writing the new slot does not corrupt the old ones
        assertEq(upgraded.minPaidBpsOfPeriod(), 5000);
        assertEq(upgraded.periodPriceRef(listingId, user), 10e18);
    }

    /// @notice `listingByAgentId` was also appended at the end and survives the upgrade.
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

    /// @notice An old proxy (whose `initialize` already ran before this threshold existed)
    ///         fills `minPaidBpsOfPeriod` via `initializeV2`, and only once.
    function test_initializeV2SetsMinPaidBpsOnUpgradedProxy() public {
        _setupSubscription();

        // Simulate an old proxy: force the threshold slot back to 0, the state it was in
        // before this variable existed.
        vm.prank(owner);
        subs.setMinPaidBpsOfPeriod(0);
        assertEq(subs.minPaidBpsOfPeriod(), 0);

        FuguSubscriptionV2 v2impl = new FuguSubscriptionV2();
        vm.prank(owner);
        subs.upgradeToAndCall(address(v2impl), abi.encodeCall(FuguSubscription.initializeV2, ()));

        assertEq(subs.minPaidBpsOfPeriod(), 5000);

        // It cannot be called twice.
        vm.expectRevert();
        subs.initializeV2();
    }

    /// @notice An audit job holding real money must read back identically after an upgrade:
    ///         the escrow is the one contract here whose storage IS the custody record.
    function test_escrowUpgradePreservesFundedJob() public {
        MockERC20 musd = new MockERC20("Mock USD", "mUSD");
        FuguAuditEscrow escrow = FuguAuditEscrow(
            address(
                new ERC1967Proxy(
                    address(new FuguAuditEscrow()),
                    abi.encodeCall(FuguAuditEscrow.initialize, (owner, address(musd), owner))
                )
            )
        );

        address developer = address(0xD3EF);
        address auditorAddr = address(0xA0D17);
        musd.mint(developer, 100e18);
        musd.mint(auditorAddr, 100e18);
        vm.prank(developer);
        musd.approve(address(escrow), type(uint256).max);
        vm.prank(auditorAddr);
        musd.approve(address(escrow), type(uint256).max);

        vm.prank(developer);
        uint256 jobId = escrow.createJob(auditorAddr, 30e18, 12e18, keccak256("skill"));
        vm.prank(developer);
        escrow.fundFee(jobId);
        vm.prank(auditorAddr);
        escrow.postBond(jobId);

        FuguAuditEscrowV2 v2impl = new FuguAuditEscrowV2();
        vm.prank(owner);
        escrow.upgradeToAndCall(address(v2impl), "");
        FuguAuditEscrowV2 upgraded = FuguAuditEscrowV2(address(escrow));

        assertEq(upgraded.version(), "v2");
        FuguAuditEscrow.Job memory j = upgraded.getJob(jobId);
        assertEq(j.developer, developer);
        assertEq(j.auditor, auditorAddr);
        assertEq(j.fee, 30e18);
        assertEq(j.bond, 12e18);
        assertEq(j.skillHash, keccak256("skill"));
        assertEq(uint8(j.status), uint8(FuguAuditEscrow.JobStatus.Funded));
        assertEq(upgraded.jobCount(), 1);
        assertEq(address(upgraded.payToken()), address(musd));
        assertEq(upgraded.arbiter(), owner);

        // the appended V2 slot is fresh and does not overwrite the job book
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(7);
        assertEq(upgraded.getJob(jobId).fee, 30e18);

        // and the money is still payable after the upgrade
        vm.prank(developer);
        upgraded.release(jobId);
        assertEq(musd.balanceOf(auditorAddr), 100e18 - 12e18 + 42e18);
        assertEq(musd.balanceOf(address(upgraded)), 0);
    }
}
